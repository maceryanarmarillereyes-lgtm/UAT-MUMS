(function () {
  // services-grid.js v4 — DOM-safe render, context menu, auto-resize
  var grid        = document.getElementById('svcGrid');
  var empty       = document.getElementById('svcEmptyState');
  var addRowBtn   = document.getElementById('svcAddRow');
  var addColBtn   = document.getElementById('svcAddCol');
  var exportBtn   = document.getElementById('svcExportCsv');
  var undoBtn     = document.getElementById('svcUndo');
  var redoBtn     = document.getElementById('svcRedo');
  var saveBtn     = document.getElementById('svcSaveBtn');
  var backupBtn   = document.getElementById('svcBackupBtn');
  var qbUpdateBtn = document.getElementById('svcQbUpdateBtn');
  var refreshBtn  = document.getElementById('svcRefreshBtn');
  var columnsBtn  = document.getElementById('svcColumnsBtn');
  var statusCells = document.getElementById('svcStatusCells');
  var statusSaved = document.getElementById('svcStatusSaved');
  var backupModal = document.getElementById('svcBackupModal');
  var backupClose = document.getElementById('svcBackupClose');
  var backupSaveBtn = document.getElementById('svcBackupSaveBtn');
  var backupNameEl = document.getElementById('svcBackupName');
  var backupListEl = document.getElementById('svcBackupList');
  var SAVE_DEBOUNCE_MS = 800;
  var current      = null;
  var subscription = null;
  var saveTimers   = new Map();
  var undoStack    = [];
  var redoStack    = [];
  var _columnRepairPromise = null;
  var _columnStateDbUnavailable = false;
  // ── Sort State ──────────────────────────────────────────────────────────────
  // key: column key string | null (no sort), dir: 'asc' | 'desc'
  var _sortState   = { key: null, dir: 'asc' };
  var isResizing  = false;

  function sanitizeHeaderLabel(label, fallbackIndex) {
    var s = String(label == null ? '' : label)
      // Strip BOM + zero-width marks that make labels look "blank/sabog"
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      // Collapse line breaks/tabs and trim visual noise
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
    if (!s) return 'Column ' + String((fallbackIndex || 0) + 1);
    return s;
  }

  function normalizeColumnDefs(columnDefs) {
    var changed = false;
    var normalized = (columnDefs || []).map(function (c, idx) {
      var next = Object.assign({}, c || {});
      var safeLabel = sanitizeHeaderLabel(next.label, idx);
      if (next.label !== safeLabel) changed = true;
      next.label = safeLabel;
      return next;
    });
    return { normalized: normalized, changed: changed };
  }

  function setStatus(state, text) {
    if (!statusSaved) return;
    statusSaved.textContent = text;
    statusSaved.className   = 'svc-status-' + state;
  }

  function notify(type, title, message, duration) {
    if (window.Notify && typeof window.Notify.show === 'function') {
      return window.Notify.show(type, title, message, duration);
    }
    if (window.svcToast && typeof window.svcToast.show === 'function') {
      return window.svcToast.show(type, title, message, duration);
    }
  }


  async function saveColumnState() {
    if (!current || !current.sheet || !current.sheet.id || isResizing) return;
    var columnDefs = Array.isArray(current.sheet.column_defs) ? current.sheet.column_defs : [];
    var state = {
      widths: current.sheet.column_widths || {},
      hidden: columnDefs.filter(function (c) { return !!(c && c.hidden); }).map(function (c) { return c.key; })
    };

    try {
      localStorage.setItem('svc_cols_' + String(current.sheet.id), JSON.stringify(state));
      current.sheet.column_state = state;
    } catch (_) {}

    clearTimeout(window._colStateDbTimer);
    window._colStateDbTimer = setTimeout(async function () {
      if (_columnStateDbUnavailable) return;
      try {
        var client = window.servicesDB && window.servicesDB.client;
        if (!client || typeof client.from !== 'function') return;
        var out = await client
          .from('services_sheets')
          .update({
            column_state: state,
            updated_at: new Date().toISOString()
          })
          .eq('id', current.sheet.id);
        if (out && out.error) throw out.error;
        console.log('[COLUMNS] Saved to DB');
      } catch (err) {
        var msg = String((err && (err.message || err.details || err.hint)) || '').toLowerCase();
        var missingColumn = (err && String(err.code || '') === '42703')
          || msg.indexOf('column_state') !== -1 && msg.indexOf('does not exist') !== -1;
        if (missingColumn) {
          _columnStateDbUnavailable = true;
          console.warn('[COLUMNS] column_state DB field unavailable, using local-only persistence.');
          return;
        }
        console.error('[COLUMNS] DB save failed, local state retained:', err);
      }
    }, 2000);
  }

  function queueColumnStateSave(delayMs) {
    clearTimeout(window._colStateQueueTimer);
    window._colStateQueueTimer = setTimeout(function () {
      saveColumnState();
    }, delayMs || 300);
  }

  function toggleColumnVisibility(colKey, hide) {
    if (!current || !current.sheet || !Array.isArray(current.sheet.column_defs)) return;
    var col = current.sheet.column_defs.find(function (c) { return c && c.key === colKey; });
    if (!col) return;

    col.hidden = !!hide;

    document.querySelectorAll('[data-key="' + String(colKey) + '"]').forEach(function (el) {
      if (!el) return;
      el.style.display = hide ? 'none' : '';
    });

    render();
    queueColumnStateSave(300);
    console.log('[COLUMN]', hide ? 'Hidden' : 'Shown', colKey);
  }

  function formatCellValue(col, value) {
    if ((col && (col.type === 'date' || col.format === 'date'))) {
      if (!value || value === '' || value === 'mm/dd/yyyy' || value === 'undefined') {
        return '---';
      }
      try {
        var d = new Date(value);
        if (isNaN(d.getTime())) return '---';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      } catch (_) { return '---'; }
    }
    return value || '';
  }

  function evaluateConditionalFormat(row, columns) {
    var safeRow = row || {};
    var data = safeRow.data || {};
    var status = String(data.status || '');
    var tracking = String(data.tracking_case_progress || '');

    if (status.includes('Waiting') || tracking === 'Mace Ryan Reyes') {
      return { match: true, ruleId: 'waiting', color: '#2d1b0e' };
    }
    return { match: false };
  }

  function clear() {
    DuplicateDetector.clear();
    current = null;
    if (subscription) { try { subscription.unsubscribe(); } catch (_) {} subscription = null; }
    grid.hidden = true;
    empty.style.display = '';
    window.servicesDashboard && window.servicesDashboard.reset();
  }

  async function load(sheet) {
    DuplicateDetector.clear();
    if (subscription) { try { subscription.unsubscribe(); } catch (_) {} subscription = null; }
    // Invalidate resize cache on new sheet load so columns get measured fresh
    _resizeSheetId = null;
    current   = { sheet: JSON.parse(JSON.stringify(sheet)), rows: [] };
    var colNorm = normalizeColumnDefs(current.sheet.column_defs);
    current.sheet.column_defs = colNorm.normalized;
    if (!current.sheet.column_widths || typeof current.sheet.column_widths !== 'object') {
      current.sheet.column_widths = {};
    }

    var localStateRaw = null;
    try {
      localStateRaw = localStorage.getItem('svc_cols_' + String(sheet.id));
    } catch (_) {}

    if (localStateRaw) {
      try {
        var localState = JSON.parse(localStateRaw);
        current.sheet.column_state = localState;
        current.sheet.column_widths = Object.assign({}, localState.widths || {});
        if (Array.isArray(localState.hidden)) {
          localState.hidden.forEach(function (key) {
            var localCol = current.sheet.column_defs.find(function (c) { return c && c.key === key; });
            if (localCol) localCol.hidden = true;
          });
        }
        console.log('[COLUMNS] Loaded from localStorage');
      } catch (_) {}
    } else if (sheet.column_state) {
      current.sheet.column_state = sheet.column_state;
      current.sheet.column_widths = Object.assign({}, (sheet.column_state && sheet.column_state.widths) || {});
      if (Array.isArray(sheet.column_state.hidden)) {
        sheet.column_state.hidden.forEach(function (key) {
          var col = current.sheet.column_defs.find(function (c) { return c && c.key === key; });
          if (col) col.hidden = true;
        });
      }
    }
    // One-time self-heal: persist sanitized labels so future loads stay clean
    if (colNorm.changed && !_columnRepairPromise) {
      _columnRepairPromise = window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs)
        .catch(function (err) { console.error('[services-grid] updateColumns repair failed:', err); })
        .finally(function () { _columnRepairPromise = null; });
    }
    undoStack = [];
    redoStack = [];
    current.rows = await window.servicesDB.listRows(sheet.id);
    console.log('[LOAD] Loaded', current.rows.length, 'rows');

    var caseCol = (current.sheet.column_defs || []).find(function (c) {
      return c && c.label && String(c.label).toUpperCase().includes('CASE');
    });
    if (caseCol && current.rows.length > 0) {
      DuplicateDetector.init(current.rows, caseCol.key);
    }

    // Auto-refresh QB data in background after 2 seconds
    setTimeout(function () {
      if (window.servicesQB && current && current.rows.length > 0) {
        console.log('[AUTO-QB] Refreshing QB data...');
        window.servicesQB.refreshAllLinkedColumns(current, document.getElementById('svcGrid'));
      }
    }, 2000);
    autoFitColumns();
    render();
    window.servicesDashboard && window.servicesDashboard.update(current);
    subscription = window.servicesDB.subscribeToSheet(sheet.id, function (payload) {
      if (isResizing) {
        console.log('[REALTIME] Paused during resize');
        return;
      }
      if (!current) return;
      var ev  = payload.eventType;
      var row = payload.new;
      var old = payload.old;
      if (ev === 'INSERT') {
        if (!current.rows.some(function (r) { return r.id === row.id; })) current.rows.push(row);
      } else if (ev === 'UPDATE') {
        var i = current.rows.findIndex(function (r) { return r.id === row.id; });
        if (i >= 0) current.rows[i] = row; else current.rows.push(row);
      } else if (ev === 'DELETE') {
        current.rows = current.rows.filter(function (r) { return r.id !== (old && old.id); });
      }
      if (ev === 'INSERT' || ev === 'UPDATE') applyRowToGrid(row); else render();
      window.servicesDashboard && window.servicesDashboard.update(current);
    });
  }

  function applyRowToGrid(row) {
    if (!current || !row) return;
    (current.sheet.column_defs || []).forEach(function (c) {
      var inp = grid.querySelector('input.cell[data-row="' + row.row_index + '"][data-key="' + c.key + '"]');
      if (inp && document.activeElement !== inp) {
        var displayVal = String(formatCellValue(c, row.data[c.key]));
        inp.value = displayVal;
        // BUG2 FIX: Apply gray '---' styling for empty date cells
        if ((c.type === 'date' || c.format === 'date') && displayVal === '---') {
          inp.style.color = '#64748b';
          inp.style.textAlign = 'center';
        } else if (c.type === 'date' || c.format === 'date') {
          inp.style.removeProperty('color');
          inp.style.removeProperty('text-align');
        }
      }
    });
    var tr = grid.querySelector('tbody tr[data-row="' + row.row_index + '"]');
    if (tr) {
      tr.classList.add('qb-updated');
      setTimeout(function () { tr.classList.remove('qb-updated'); }, 650);
    }
  }

  function mkEl(tag, props, parent) {
    var el = document.createElement(tag);
    if (props) Object.assign(el, props);
    if (parent) parent.appendChild(el);
    return el;
  }

  // FREE TIER OPTIMIZED DUPLICATE DETECTOR
  // Memory: minimal map/set state | CPU: O(1) lookups | Network: 0
  var DuplicateDetector = {
    index: null,
    caseKey: null,
    lastBuild: 0,

    init: function (rows, key) {
      var now = Date.now();
      if (this.index && this.caseKey === key && (now - this.lastBuild < 5000)) return;

      this.caseKey = key;
      this.index = new Map();
      this.lastBuild = now;

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var data = row.data || {};
        var val = data[key];
        if (!val) continue;
        var str = String(val).trim();
        if (str.length < 3) continue;
        var rowIndex = Number.isFinite(row.row_index) ? row.row_index : i;
        this.add(str, rowIndex);
      }
      console.log('[DUP] Index:', this.index.size, 'cases');
    },

    check: function (val, currentIdx) {
      if (!this.index || !val) return null;
      var str = String(val).trim();
      var set = this.index.get(str);
      if (!set || !set.size) return null;
      var dupRows = [];
      set.forEach(function (idx) {
        if (idx !== currentIdx) dupRows.push(idx);
      });
      return dupRows.length ? dupRows.sort(function (a, b) { return a - b; }) : null;
    },

    add: function (val, idx) {
      if (!this.index || !val) return;
      var str = String(val).trim();
      if (!str || str.length < 3) return;
      if (!this.index.has(str)) this.index.set(str, new Set());
      this.index.get(str).add(idx);
    },

    remove: function (val, idx) {
      if (!this.index || !val) return;
      var str = String(val).trim();
      var set = this.index.get(str);
      if (!set) return;
      set.delete(idx);
      if (!set.size) this.index.delete(str);
    },

    duplicateRowCount: function () {
      if (!this.index) return 0;
      var count = 0;
      this.index.forEach(function (set) {
        if (set && set.size > 1) count += set.size;
      });
      return count;
    },

    clear: function () {
      if (this.index) {
        this.index.clear();
        this.index = null;
      }
      this.caseKey = null;
      this.lastBuild = 0;
    }
  };

  var dupCheckTimer = null;
  var dupPaintTimer = null;

  function checkDuplicateDebounced(input, caseVal, rowIdx) {
    clearTimeout(dupCheckTimer);
    dupCheckTimer = setTimeout(function () {
      var duplicates = DuplicateDetector.check(caseVal, rowIdx);
      if (duplicates) showDuplicateBubble(input, caseVal, duplicates);
    }, 300);
  }

  function getCaseColumnDef() {
    if (!current || !current.sheet || !Array.isArray(current.sheet.column_defs)) return null;
    return current.sheet.column_defs.find(function (c) {
      return c && c.key && c.label && String(c.label).toUpperCase().includes('CASE');
    }) || null;
  }

  function applyDuplicateStyles(inputEl, caseNum, duplicateRows) {
    inputEl.classList.add('cell-has-duplicate');
    inputEl.setAttribute('data-dup-case', caseNum);
    inputEl.setAttribute('data-dup-rows', duplicateRows.join(','));
    inputEl.style.borderLeft = '3px solid #ef4444';
    inputEl.style.backgroundColor = 'rgba(239, 68, 68, 0.08)';
    inputEl.style.boxShadow = 'inset 0 0 0 1px rgba(239, 68, 68, 0.3)';
  }

  function clearDuplicateStyles(inputEl) {
    inputEl.classList.remove('cell-has-duplicate');
    inputEl.style.borderLeft = '';
    inputEl.style.backgroundColor = '';
    inputEl.style.boxShadow = '';
    inputEl.removeAttribute('data-dup-case');
    inputEl.removeAttribute('data-dup-rows');
    delete inputEl._dupCaseNum;
  }

  function refreshDuplicateIndicators() {
    var caseCol = getCaseColumnDef();
    if (!caseCol) return;
    grid.querySelectorAll('input.cell[data-key="' + caseCol.key + '"]').forEach(function (inp) {
      var rowIdx = Number(inp.dataset.row);
      var val = String(inp.value || '').trim();
      var duplicates = DuplicateDetector.check(val, rowIdx);
      if (duplicates) {
        applyDuplicateStyles(inp, val, duplicates);
      } else {
        if (inp._dupBubble) {
          inp._dupBubble.remove();
          inp._dupBubble = null;
        }
        clearDuplicateStyles(inp);
      }
    });
  }

  function refreshDuplicateIndicatorsDebounced() {
    clearTimeout(dupPaintTimer);
    dupPaintTimer = setTimeout(refreshDuplicateIndicators, 120);
  }

  function showDuplicateBubble(inputEl, caseNum, duplicateRows) {
    grid.querySelectorAll('input.cell').forEach(function (cell) {
      if (cell !== inputEl && cell._dupBubble) cell._dupBubble = null;
    });
    document.querySelectorAll('.dup-notice').forEach(function (n) { n.remove(); });

    var rect = inputEl.getBoundingClientRect();
    var bubble = document.createElement('div');
    bubble.className = 'dup-notice';
    bubble.innerHTML = '' +
      '<div class="dup-wrap dup-bubble-inner">' +
      '<span class="dup-ico">⚠</span>' +
      '<span>Duplicate: <b>' + String(caseNum) + '</b> exists in row(s) <b>' + duplicateRows.map(function (idx) { return idx + 1; }).join(', ') + '</b></span>' +
      '<button data-goto="' + String(duplicateRows[0]) + '">Go</button>' +
      '<button class="dup-x">×</button>' +
      '</div>';

    bubble.style.cssText = '' +
      'position:fixed;' +
      'left:' + Math.min(rect.left, window.innerWidth - 300) + 'px;' +
      'top:' + (rect.bottom + 4) + 'px;' +
      'z-index:9999;' +
      'background:#1e293b;' +
      'border:1px solid #ef4444;' +
      'border-radius:6px;' +
      'padding:8px 10px;' +
      'font-size:12px;' +
      'color:#e2e8f0;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
      'max-width:280px;';

    document.body.appendChild(bubble);

    // PERSISTENT: No auto-remove - stays until fixed
    // Store reference for manual cleanup
    inputEl._dupBubble = bubble;
    inputEl._dupCaseNum = caseNum;
    applyDuplicateStyles(inputEl, caseNum, duplicateRows);

    var gotoBtn = bubble.querySelector('[data-goto]');
    if (gotoBtn) {
      gotoBtn.onclick = function () {
        var targetRow = document.querySelector('tr[data-row="' + duplicateRows[0] + '"]');
        if (targetRow) {
          targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetRow.style.outline = '2px solid #ef4444';
          setTimeout(function () { targetRow.style.outline = ''; }, 2000);
          var inp = targetRow.querySelector('input[data-key*="case" i]');
          if (inp) inp.focus();
        }
      };
    }

    var closeBtn = bubble.querySelector('.dup-x');
    if (closeBtn) {
      closeBtn.onclick = function () {
        bubble.remove();
        inputEl._dupBubble = null;
        // Keep visual warning but remove bubble
        console.log('[DUP] Manually dismissed (still duplicate)');
      };
    }
  }

  function render() {
    if (document.getElementById('svcLoadingScreen') && !document.getElementById('svcLoadingScreen').classList.contains('hidden')) {
      console.log('[GRID] Render blocked - loader active');
      return;
    }
    if (isResizing) {
      console.log('[RENDER] Skipped - resizing in progress');
      return;
    }
    if (!current) { clear(); return; }
    empty.style.display = 'none';
    grid.hidden = false;
    var cols      = (current.sheet.column_defs || []).filter(function (c) { return !c.hidden; });
    var isFilteredView = Array.isArray(current.__treeFilteredRows);
    var viewRows = isFilteredView
      ? current.__treeFilteredRows.slice().sort(function (a, b) { return a.row_index - b.row_index; })
      : current.rows.slice();

    // APPLY COLUMN FILTERS (Excel-style)
    var hasColumnFilters = Object.keys(_columnFilters).length > 0;
    if (hasColumnFilters) {
      viewRows = viewRows.filter(function(row) {
        for (var key in _columnFilters) {
          var filterVal = _columnFilters[key];
          var cellVal = row.data && row.data[key] != null ? String(row.data[key]).toLowerCase() : '';
          if (cellVal.indexOf(filterVal) === -1) {
            return false;
          }
        }
        return true;
      });
    }

    // Update footer count
    setTimeout(function() {
      var footer = document.querySelector('.svc-grid-footer,.grid-status');
      if (footer && hasColumnFilters) {
        var originalCount = current.rows.length;
        var filteredCount = viewRows.length;
        footer.textContent = footer.textContent.replace(/\d+ rows/, filteredCount + ' of ' + originalCount + ' rows (filtered)');
      }
    }, 0);

    // ── Apply sort if active ─────────────────────────────────────────────────
    var isSorted = !!_sortState.key;
    if (isSorted) {
      var _sk = _sortState.key;
      var _sd = _sortState.dir;
      viewRows = viewRows.slice().sort(function (a, b) {
        var va = (a.data && a.data[_sk] != null) ? String(a.data[_sk]).trim() : '';
        var vb = (b.data && b.data[_sk] != null) ? String(b.data[_sk]).trim() : '';
        var na = parseFloat(va), nb = parseFloat(vb);
        var cmp = (!isNaN(na) && !isNaN(nb)) ? (na - nb) : va.toLowerCase().localeCompare(vb.toLowerCase());
        return _sd === 'desc' ? -cmp : cmp;
      });
    }

    var totalRows = (isFilteredView || isSorted)
      ? Math.max(viewRows.length, 1)
      : Math.max(current.rows.length + 2, 10);

    var colgroup = mkEl('colgroup');
    var rowNumCol = document.createElement('col');
    rowNumCol.setAttribute('data-key', '__rownum__');
    rowNumCol.style.width = '56px';
    colgroup.appendChild(rowNumCol);
    cols.forEach(function (c) {
      var col = document.createElement('col');
      col.setAttribute('data-key', c.key);
      var savedWidth = Number(current.sheet.column_widths && current.sheet.column_widths[c.key]);
      if (savedWidth) col.style.width = savedWidth + 'px';
      else col.style.width = ((parseInt(c.width, 10) || 150) + 'px');
      colgroup.appendChild(col);
    });

    var thead   = mkEl('thead');
    var headTr  = mkEl('tr', null, thead);
    headTr.className = 'header-main-row';

    // ADD FILTER ROW (Excel-style)
    var filterTr = mkEl('tr', { className: 'header-filter-row' }, thead);
    filterTr.style.background = '#0f172a';
    filterTr.style.borderBottom = '2px solid #1e293b';
    var thCorner = mkEl('th', { className: 'row-num row-header', textContent: '#' }, headTr);
    var filterCorner = mkEl('th', { className: 'row-num' }, filterTr);
    filterCorner.innerHTML = '<div style="text-align:center;color:#475569;font-size:9px;padding:4px;">▼</div>';
    filterCorner.style.background = '#0f172a';
    filterCorner.style.padding = '4px';
    cols.forEach(function (c) {
      var th = mkEl('th', { textContent: sanitizeHeaderLabel(c.label, 0) }, headTr);
      th.dataset.key = c.key;
      th.tabIndex = 0;
      th.title = 'Right-click for column options · Right-click to sort';

      var savedWidth = Number(current.sheet.column_widths && current.sheet.column_widths[c.key]);
      if (savedWidth) {
        var px = savedWidth + 'px';
        th.style.width = px;
        th.style.minWidth = px;
        th.style.maxWidth = px;
      }
      if (c.hidden) th.style.display = 'none';

      var resizeHandle = document.createElement('div');
      resizeHandle.className = 'col-resize-handle';
      resizeHandle.innerHTML = '<div class="resize-grip"></div>';
      th.style.position = 'relative';
      th.appendChild(resizeHandle);

      // Create filter cell
      var filterTh = mkEl('th', null, filterTr);
      filterTh.dataset.key = c.key;
      filterTh.style.padding = '4px';
      filterTh.style.background = '#0f172a';
      if (_columnFilters[c.key]) th.classList.add('filtered');
      else th.classList.remove('filtered');

      if (c.hidden) {
        filterTh.style.display = 'none';
      } else {
        var filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.placeholder = 'Filter...';
        filterInput.dataset.columnKey = c.key;
        filterInput.className = 'column-filter-input';
        filterInput.value = _columnFilters[c.key] || '';

        Object.assign(filterInput.style, {
          width: '100%',
          height: '24px',
          padding: '0 6px',
          background: '#020617',
          border: '1px solid #334155',
          borderRadius: '4px',
          color: '#e2e8f0',
          fontSize: '11px',
          outline: 'none'
        });

        filterInput.addEventListener('focus', function() {
          this.style.borderColor = '#3b82f6';
          this.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.15)';
        });

        filterInput.addEventListener('blur', function() {
          this.style.borderColor = '#334155';
          this.style.boxShadow = 'none';
        });

        filterInput.addEventListener('input', function(e) {
          var key = e.target.dataset.columnKey;
          var val = e.target.value.trim();

          if (val) {
            _columnFilters[key] = val.toLowerCase();
          } else {
            delete _columnFilters[key];
          }

          // Re-render with filters
          render();
        });

        // Prevent context menu on filter input
        filterInput.addEventListener('contextmenu', function(e) {
          e.stopPropagation();
        });

        filterTh.appendChild(filterInput);
      }

      resizeHandle.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        isResizing = true;
        document.body.style.userSelect = 'none';
        var startX = ev.clientX;
        var startWidth = th.offsetWidth;
        var colKey = c.key;

        var preview = document.createElement('div');
        preview.id = 'col-resize-preview';
        Object.assign(preview.style, {
          position: 'fixed',
          left: ev.clientX + 'px',
          top: th.getBoundingClientRect().top + 'px',
          width: '2px',
          height: window.innerHeight + 'px',
          background: '#0ea5e9',
          zIndex: '99999',
          pointerEvents: 'none',
          boxShadow: '0 0 8px rgba(14,165,233,0.5)'
        });
        document.body.appendChild(preview);

        function onMouseMove(moveEv) {
          var delta = moveEv.clientX - startX;
          var newWidth = Math.max(60, Math.min(800, startWidth + delta));
          var leftPx = (th.getBoundingClientRect().left + newWidth) + 'px';
          preview.style.left = leftPx;
          var colEl = grid.querySelector('colgroup col[data-key="' + colKey + '"]');
          if (colEl) colEl.style.width = newWidth + 'px';
        }

        function onMouseUp() {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          preview.remove();

          var colEl = grid.querySelector('colgroup col[data-key="' + colKey + '"]');
          var finalWidth = Math.max(60, Math.min(800, (colEl ? parseInt(colEl.style.width, 10) : th.offsetWidth) || th.offsetWidth));
          if (!current.sheet.column_widths) current.sheet.column_widths = {};
          current.sheet.column_widths[colKey] = finalWidth;
          if (colEl) colEl.style.width = finalWidth + 'px';
          var targetCol = current.sheet.column_defs.find(function (col) { return col && col.key === colKey; });
          if (targetCol) targetCol.width = finalWidth + 'px';
          grid.style.tableLayout = 'fixed';
          queueColumnStateSave(400);
          isResizing = false;
          document.body.style.userSelect = '';
          render();
          console.log('[RESIZE] Saved:', colKey, finalWidth + 'px');
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      // Sort indicator
      if (_sortState.key === c.key) {
        var sortBadge = document.createElement('span');
        sortBadge.className = 'th-sort-badge';
        sortBadge.textContent = _sortState.dir === 'asc' ? ' ▲' : ' ▼';
        sortBadge.title = _sortState.dir === 'asc' ? 'Sorted A→Z (click header menu to change)' : 'Sorted Z→A (click header menu to change)';
        th.appendChild(sortBadge);
      }
      // QB Lookup badge
      if (c.qbLookup && c.qbLookup.fieldLabel) {
        var badge = document.createElement('span');
        badge.className   = 'th-qb-badge';
        badge.textContent = 'QB';
        badge.title       = '🔗 Linked: ' + c.qbLookup.fieldLabel;
        th.appendChild(badge);
      }
    });

    var tbody = mkEl('tbody');
    for (var i = 0; i < totalRows; i++) {
      var rowData = (isFilteredView || isSorted)
        ? (viewRows[i] || { row_index: i, data: {} })
        : (current.rows.find(function (r) { return r.row_index === i; }) || { row_index: i, data: {} });
      if (typeof rowData._cfMatch === 'undefined') {
        var cf = evaluateConditionalFormat(rowData, current.sheet.column_defs || []);
        rowData._cfMatch = !!cf.match;
        rowData._cfRuleId = cf.ruleId || '';
        rowData._cfColor = cf.color || '';
      }
      var rowIndex = Number.isFinite(rowData.row_index) ? rowData.row_index : i;
      var tr = mkEl('tr', { className: 'grid-row' }, tbody);
      tr.dataset.row = String(rowIndex);
      if (rowData._cfMatch) {
        tr.setAttribute('data-cf-applied', 'true');
        tr.setAttribute('data-cf-rule', rowData._cfRuleId);
        tr.style.setProperty('--cf-bg', rowData._cfColor);
      } else {
        tr.removeAttribute('data-cf-applied');
        tr.removeAttribute('data-cf-rule');
      }
      var rowNumTd = mkEl('td', {
        className: 'row-num',
        textContent: String(rowIndex + 1),
        title: 'Row ' + (rowIndex + 1) + ' - Click to select'
      }, tr);
      rowNumTd.dataset.rowIndex = rowIndex;
      rowNumTd.dataset.row = String(rowIndex);
      cols.forEach(function (c) {
        var td  = mkEl('td', null, tr);
        var savedWidth = Number(current.sheet.column_widths && current.sheet.column_widths[c.key]);
        if (savedWidth) {
          var tdPx = savedWidth + 'px';
          td.style.width = tdPx;
          td.style.minWidth = tdPx;
          td.style.maxWidth = tdPx;
        }
        if (c.hidden) td.style.display = 'none';
        td.setAttribute('data-col', c.key);
        var inputType = 'text';
        var validation = c && c.validation && c.validation.type === 'list' && Array.isArray(c.validation.options)
          ? c.validation.options.filter(function (v) { return String(v || '').trim() !== ''; })
          : null;
        var listId = validation && validation.length
          ? ('svc-dv-' + String(c.key || i) + '-' + String(rowIndex))
          : '';
        var inp = mkEl('input', {
          className    : 'cell',
          type         : inputType,
          autocomplete : 'off',
          spellcheck   : false,
          value        : String(formatCellValue(c, rowData.data[c.key]))
        }, td);
        // FORCE "---" for QB-linked date columns with CASE# but no value
        var isQBDate = c && c.qbLookup && (c.type === 'date' || c.format === 'date' || (c.key && c.key.toLowerCase().includes('date')));
        var hasCaseId = rowData.data && Object.values(rowData.data).some(function (v) { return String(v).match(/^\d{5,}$/); });
        if (isQBDate && hasCaseId && (!rowData.data[c.key] || rowData.data[c.key] === '')) {
          inp.value = '---';
          inp.style.color = '#64748b';
          inp.style.fontStyle = 'italic';
          inp.style.textAlign = 'center';
        }
        // SPECIAL HANDLING FOR DATE COLUMNS
        if (c && (c.type === 'date' || c.format === 'date' || (c.key && c.key.toLowerCase().includes('date')))) {
          var caseColDef = (current.sheet.column_defs || []).find(function (col) {
            return col && col.label && col.label.toUpperCase().includes('CASE');
          });
          var hasCase = rowData.data && (
            rowData.data['case_number'] ||
            rowData.data['case#'] ||
            (caseColDef && rowData.data[caseColDef.key])
          );
          var rawVal = rowData.data[c.key];
          if (!hasCase || !String(hasCase).trim()) {
            // No CASE# - show empty
            inp.value = '';
            inp.placeholder = '';
          } else if (!rawVal || rawVal === '') {
            // Has CASE# but no date - show ---
            inp.value = '---';
            inp.style.color = '#64748b';
            inp.style.textAlign = 'center';
            inp.style.fontStyle = 'italic';
          }
        }
        if (validation && validation.length) {
          inp.setAttribute('list', listId);
          inp.dataset.validationList = validation.join('\n');
          inp.dataset.validationStrict = '1';
          var dl = document.createElement('datalist');
          dl.id = listId;
          validation.forEach(function (opt) {
            var o = document.createElement('option');
            o.value = String(opt);
            dl.appendChild(o);
          });
          td.appendChild(dl);
        }
        inp.dataset.row = rowIndex;
        inp.dataset.key = c.key;
        inp.dataset.format = (c && c.format) ? c.format : 'auto';
        inp.dataset.raw = (rowData.data[c.key] != null ? rowData.data[c.key] : '').toString();
        if (c.format === 'number') inp.inputMode = 'numeric';

        var isCase = c && c.key && c.label && String(c.label).toUpperCase().includes('CASE');
        if (isCase) {
          var prevVal = '';
          var handleCheck = function () {
            var val = String(inp.value || '').trim();
            if (!val || val === prevVal || val.length < 3) return;
            prevVal = val;
            checkDuplicateDebounced(inp, val, rowIndex);
          };
          var checkIfFixed = function () {
            var currentVal = String(inp.value || '').trim();
            var duplicates = DuplicateDetector.check(currentVal, rowIndex);
            if (!duplicates && inp._dupBubble) {
              var oldCase = inp._dupCaseNum;
              inp._dupBubble.remove();
              inp._dupBubble = null;
              clearDuplicateStyles(inp);
              DuplicateDetector.remove(oldCase, rowIndex);
              DuplicateDetector.add(currentVal, rowIndex);
              console.log('[DUP] Fixed:', currentVal);
            }
          };

          inp.addEventListener('blur', handleCheck);
          inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') setTimeout(handleCheck, 100);
          });
          inp.addEventListener('input', function () {
            if (inp._dupBubble) setTimeout(checkIfFixed, 100);
          });
          inp.addEventListener('blur', function () {
            if (inp._dupBubble) checkIfFixed();
          });
          inp.addEventListener('focus', function () {
            var val = String(inp.value || '').trim();
            if (!val) return;
            var duplicates = DuplicateDetector.check(val, rowIndex);
            if (duplicates && !inp._dupBubble) {
              showDuplicateBubble(inp, val, duplicates);
            }
          });
        }

        // BUG2 FIX: Style '---' placeholder for date columns with no value
        if ((c.type === 'date' || c.format === 'date') && inp.value === '---') {
          inp.style.color = '#64748b';
          inp.style.textAlign = 'center';
        }
      });
    }

    grid.innerHTML = '';
    grid.appendChild(colgroup);
    grid.appendChild(thead);
    grid.appendChild(tbody);

    attachCellHandlers();
    attachHeaderContextMenu();
    attachRowContextMenu();
    updateStatusBar();
    refreshDuplicateIndicators();

    // ── Column resize ──────────────────────────────────────────────────────────
    // FIX-ALIGN: On filter switch the grid DOM is fully rebuilt (innerHTML replaced)
    // so we MUST re-apply column widths. If cache exists → apply synchronously via
    // rAF (deferred one frame so the browser has measured the new nodes).
    // If no cache → run full measurement as normal.
    autoFitColumns();

    // refreshCounts builds treeview DOM — skip on filter switches (treeview
    // manages its own badge counts via updateSheetCountBadge already).
    if (!_renderIsFilterSwitch) {
      if (window.servicesTreeview && typeof window.servicesTreeview.refreshCounts === 'function') {
        window.servicesTreeview.refreshCounts(current.sheet.id);
      }
    }

    // ── QB auto-populate ────────────────────────────────────────────────────────
    // FIX-LATENCY: During a filter switch, row.data already contains QB values from
    // the previous autofill run (persisted in Supabase). inp.value is set directly
    // from row.data during render(). Skip autofillLinkedColumns entirely on filter
    // switches — it schedules debounced API calls that are unnecessary and cause lag.
    // Only run on full sheet loads (non-filter-switch renders).
    if (!_renderIsFilterSwitch && window.svcQbLookup) {
      window.svcQbLookup.autofillLinkedColumns(current, grid);
    }

    // ── Scroll-triggered re-autofill ─────────────────────────────────────────
    // FIX-LATENCY: Skip re-attaching scroll handler on filter switches.
    // The handler is already attached from the full load render and scrolled-to
    // rows already have their QB data in row.data. Re-attaching on every folder
    // click creates unnecessary work and minor memory pressure.
    (function attachScrollRepaint() {
      if (_renderIsFilterSwitch) return; // already attached from full load
      var wrap = document.getElementById('svcGridWrap');
      if (!wrap) return;
      if (wrap._qbScrollHandler) {
        wrap.removeEventListener('scroll', wrap._qbScrollHandler);
        wrap._qbScrollHandler = null;
      }
      var scrollTimer = null;
      var capturedCurrent = current;
      wrap._qbScrollHandler = function () {
        if (current !== capturedCurrent) {
          wrap.removeEventListener('scroll', wrap._qbScrollHandler);
          wrap._qbScrollHandler = null;
          return;
        }
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
          if (window.svcQbLookup && current === capturedCurrent) {
            window.svcQbLookup.autofillLinkedColumns(current, grid);
          }
        }, 200);
      };
      wrap.addEventListener('scroll', wrap._qbScrollHandler, { passive: true });
    })();
  }

  function attachCellHandlers() {
    grid.querySelectorAll('input.cell').forEach(function (inp) {
      inp.addEventListener('input', onCellInput);
      inp.addEventListener('keydown', onCellKey);
    });
  }

  function attachHeaderContextMenu() {
    document.querySelectorAll('.svc-col-ctx-menu').forEach(function (m) { m.remove(); });

    grid.querySelectorAll('thead tr.header-main-row th[data-key]').forEach(function (th) {
      th.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllCtxMenus();

        var key    = th.dataset.key;
        var cols   = current.sheet.column_defs;
        var colIdx = cols.findIndex(function (c) { return c.key === key; });
        if (colIdx < 0) return;

        var menu = document.createElement('div');
        menu.className = 'svc-col-ctx-menu';

        /* ── Close (X) button ── */
        var closeBtn = document.createElement('button');
        closeBtn.className = 'ctx-close-btn';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Close menu';
        closeBtn.addEventListener('click', function (ev) { ev.stopPropagation(); closeAllCtxMenus(); });
        menu.appendChild(closeBtn);

        /* ── helpers ── */
        function mkEl(tag, props, parent) {
          var el = document.createElement(tag);
          if (props) Object.assign(el, props);
          if (parent) parent.appendChild(el);
          return el;
        }

        function addSectionHeader(label) {
          mkEl('div', { className: 'ctx-section-header', textContent: label }, menu);
        }

        function addSep() {
          mkEl('div', { className: 'ctx-separator' }, menu);
        }

        function buildItem(parent, cfg) {
          var item = mkEl('div', { className: 'ctx-item' + (cfg.disabled ? ' disabled' : '') }, parent);
          if (cfg.action) item.dataset.action = cfg.action;
          mkEl('span', { className: 'ctx-icon', textContent: cfg.icon || '' }, item);
          mkEl('span', { className: 'ctx-label', textContent: cfg.label }, item);
          if (cfg.badge) mkEl('span', { className: 'ctx-badge', textContent: cfg.badge }, item);
          if (cfg.sub) {
            mkEl('span', { className: 'ctx-arrow', textContent: '›' }, item);
            var sub = mkEl('div', { className: 'ctx-sub' }, item);
            cfg.sub.forEach(function (child) { buildItem(sub, child); });
            /* flip submenu left if it would overflow right edge */
            item.addEventListener('mouseenter', function () {
              var r = sub.getBoundingClientRect();
              if (r.right > window.innerWidth - 8) sub.classList.add('flip-left');
              else sub.classList.remove('flip-left');
            });
          }
          return item;
        }

        /* ── RENAME COLUMN (inline) ── */
        addSectionHeader('COLUMN');
        var renameRow = mkEl('div', { className: 'ctx-item' }, menu);
        mkEl('span', { className: 'ctx-icon', textContent: '✏️' }, renameRow);
        var renameInput = mkEl('input', {
          className: 'ctx-rename-input',
          value: cols[colIdx].label,
          placeholder: 'Column name…'
        }, renameRow);
        var renameOk = mkEl('button', { className: 'ctx-rename-ok', textContent: '✓' }, renameRow);

        async function doRename() {
          var val = renameInput.value.trim();
          if (val && val !== cols[colIdx].label) {
            cols[colIdx].label = val;
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
          }
          closeAllCtxMenus();
        }
        renameOk.addEventListener('click', function (ev) { ev.stopPropagation(); doRename(); });
        renameInput.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') doRename();
          if (ev.key === 'Escape') closeAllCtxMenus();
          ev.stopPropagation();
        });
        renameInput.addEventListener('click', function (ev) { ev.stopPropagation(); });

        addSep();

        /* ── SET PROGRAM ── */
        addSectionHeader('SET PROGRAM');
        var qbLinked     = cols[colIdx].qbLookup;
        var qbBadgeText  = qbLinked ? 'Linked ✓' : 'QB';
        buildItem(menu, {
          icon: '🔗', label: 'Lookup to Global Quickbase',
          badge: qbLinked ? '✓' : '',
          sub: [
            { icon: '📋', label: qbLinked ? 'Change Field (' + qbLinked.fieldLabel + ')' : 'Select Quickbase Field', action: 'select-qb-field', badge: 'QB' }
          ]
        });
        buildItem(menu, {
          icon: '🧾',
          label: 'Data Validation',
          action: 'data-validation',
          badge: (cols[colIdx] && cols[colIdx].validation && cols[colIdx].validation.type === 'list') ? '✓' : ''
        });
        buildItem(menu, { icon: '🎨', label: 'Conditional Formatting', action: 'conditional-format' });

        addSep();

        /* ── SORT COLUMN ── */
        addSectionHeader('SORT');
        var isAscActive  = (_sortState.key === key && _sortState.dir === 'asc');
        var isDescActive = (_sortState.key === key && _sortState.dir === 'desc');
        buildItem(menu, {
          icon: '↑',
          label: 'Sort A → Z  (Ascending)',
          action: 'sort-asc',
          badge: isAscActive ? '✓' : ''
        });
        buildItem(menu, {
          icon: '↓',
          label: 'Sort Z → A  (Descending)',
          action: 'sort-desc',
          badge: isDescActive ? '✓' : ''
        });
        if (_sortState.key) {
          buildItem(menu, {
            icon: '✕',
            label: 'Clear Sort',
            action: 'sort-clear'
          });
        }

        addSep();

        /* ── COLUMN VISIBILITY ── */
        addSectionHeader('COLUMN VIEW');
        buildItem(menu, { icon: '👁️', label: 'Hide Column', action: 'hide-column' });
        buildItem(menu, { icon: '↔️', label: 'Auto-fit', action: 'autofit-column' });
        buildItem(menu, { icon: '📌', label: 'Freeze', action: 'freeze-column' });

        addSep();

        /* ── MOVE COLUMN ── */
        addSectionHeader('MOVE COLUMN');
        buildItem(menu, {
          icon: '⬅️', label: 'To Left',
          action: 'move-left',
          disabled: colIdx <= 0
        });
        buildItem(menu, {
          icon: '➡️', label: 'To Right',
          action: 'move-right',
          disabled: colIdx >= cols.length - 1
        });

        addSep();

        /* ── CELL FORMAT ── */
        addSectionHeader('CELL FORMAT');
        var currentFormat = cols[colIdx].format || 'auto';
        var cellFormats = [
          { icon: '📅', label: 'Date',            format: 'date',   hint: 'Calendar date picker' },
          { icon: '🔢', label: 'Numbers',          format: 'number', hint: 'Numeric input' },
          { icon: '🔤', label: 'Text',             format: 'text',   hint: 'Plain text' },
          { icon: '🔄', label: 'Automatic',        format: 'auto',   hint: 'Default — auto detect' }
        ];
        cellFormats.forEach(function (f) {
          var isActive = currentFormat === f.format;
          var item = buildItem(menu, {
            icon   : f.icon,
            label  : f.label,
            action : 'cell-format-' + f.format,
            badge  : isActive ? '✓' : ''
          });
          if (isActive) item.classList.add('ctx-active');
        });

        addSep();

        /* ── DELETE COLUMN ── */
        addSectionHeader('DANGER ZONE');
        buildItem(menu, {
          icon: '🗑️', label: 'Delete This Column',
          action: 'delete-column'
        });

        /* ── Position menu ── */
        menu.style.left = e.clientX + 'px';
        menu.style.top  = e.clientY + 'px';
        document.body.appendChild(menu);

        // Auto-focus rename input
        setTimeout(function () { renameInput.focus(); renameInput.select(); }, 60);

        // Flip if overflows
        var r = menu.getBoundingClientRect();
        if (r.right  > window.innerWidth  - 8) menu.style.left = (e.clientX - r.width)  + 'px';
        if (r.bottom > window.innerHeight - 8) menu.style.top  = (e.clientY - r.height) + 'px';

        /* ── Action handler ── */
        menu.addEventListener('click', async function (ev) {
          var target = ev.target.closest('[data-action]');
          if (!target || !target.dataset.action) return;
          var action = target.dataset.action;

          // ── SORT ACTIONS ────────────────────────────────────────────────────
          if (action === 'sort-asc') {
            _sortState = { key: key, dir: 'asc' };
            render(); closeAllCtxMenus();
          } else if (action === 'sort-desc') {
            _sortState = { key: key, dir: 'desc' };
            render(); closeAllCtxMenus();
          } else if (action === 'sort-clear') {
            _sortState = { key: null, dir: 'asc' };
            render(); closeAllCtxMenus();
          } else if (action === 'hide-column') {
            var col = current.sheet.column_defs[colIdx];
            toggleColumnVisibility(key, true);
            notify('info', 'Column Hidden', col.label + ' hidden. Click ⊞ Columns to unhide.');
            closeAllCtxMenus();
          } else if (action === 'autofit-column') {
            cols[colIdx].width = 'auto';
            autoFitColumns();
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
            closeAllCtxMenus();
          } else if (action === 'freeze-column') {
            notify('info', 'Freeze', 'Freeze column is queued for next iteration.');
            closeAllCtxMenus();
          } else if (action === 'move-left' && colIdx > 0) {
            var tmp = cols[colIdx]; cols[colIdx] = cols[colIdx-1]; cols[colIdx-1] = tmp;
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
            closeAllCtxMenus();
          } else if (action === 'move-right' && colIdx < cols.length - 1) {
            var tmp2 = cols[colIdx]; cols[colIdx] = cols[colIdx+1]; cols[colIdx+1] = tmp2;
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
            closeAllCtxMenus();
          } else if (action === 'select-qb-field') {
            if (window.svcQbLookup) {
              closeAllCtxMenus();
              window.svcQbLookup.openFieldPicker({
                colIdx: colIdx,
                cols  : cols,
                onSelect: async function (fieldId, fieldLabel) {
                  // Backward/forward compatible payload handling:
                  // - legacy: onSelect(fieldId, fieldLabel)
                  // - current picker: onSelect({ fieldId, fieldLabel })
                  var selectedFieldId = fieldId;
                  var selectedFieldLabel = fieldLabel;
                  if (fieldId && typeof fieldId === 'object' && !Array.isArray(fieldId)) {
                    selectedFieldId = fieldId.fieldId;
                    selectedFieldLabel = fieldId.fieldLabel;
                  }

                  if (selectedFieldId === null) {
                    // Unlink
                    delete cols[colIdx].qbLookup;
                  } else {
                    cols[colIdx].qbLookup = {
                      fieldId: String(selectedFieldId || '').trim(),
                      fieldLabel: String(selectedFieldLabel || selectedFieldId || '').trim()
                    };
                  }
                  await window.servicesDB.updateColumns(current.sheet.id, cols);
                  render();
                }
              });
            } else {
              alert('QB Lookup module not loaded. Please refresh.');
            }
          } else if (action === 'conditional-format') {
            closeAllCtxMenus();
            var cfCol = cols[colIdx];
            if (window.svcConditionalFormat) {
              window.svcConditionalFormat.open(
                colIdx,
                cfCol.key,
                cfCol.label || ('Column ' + (colIdx + 1)),
                cfCol.conditionalRules || []
              );
            } else {
              notify('error', 'Conditional Formatting', 'Module not loaded. Please refresh.');
            }
          } else if (action === 'data-validation') {
            closeAllCtxMenus();
            var currentRules = cols[colIdx] && cols[colIdx].validation;
            var currentList = (currentRules && Array.isArray(currentRules.options)) ? currentRules.options.join(', ') : '';
            var entered = prompt(
              'Set dropdown options for "' + (cols[colIdx].label || 'Column') + '".\n' +
              'Use comma-separated values.\n' +
              'Leave blank to remove validation.',
              currentList
            );
            if (entered === null) return;
            var opts = String(entered)
              .split(',')
              .map(function (v) { return String(v || '').trim(); })
              .filter(function (v) { return !!v; });
            if (!opts.length) {
              delete cols[colIdx].validation;
            } else {
              cols[colIdx].validation = { type: 'list', strict: true, options: opts };
            }
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
            notify('success', 'Data Validation', opts.length ? ('Dropdown set (' + opts.length + ' options).') : 'Dropdown removed.');
          } else if (action === 'delete-column') {
            var colName = cols[colIdx] ? (cols[colIdx].label || 'this column') : 'this column';
            if (!confirm('Delete column "' + colName + '"?\n\nAll data in this column will be permanently removed from every row. This cannot be undone.')) {
              closeAllCtxMenus();
              return;
            }
            closeAllCtxMenus();
            // Remove column def
            cols.splice(colIdx, 1);
            // Strip that key from every row's data object
            current.rows.forEach(function (row) {
              if (row.data) delete row.data[key];
            });
            // Persist column defs + all rows
            try {
              await window.servicesDB.updateColumns(current.sheet.id, cols);
              var nonEmpty = current.rows.filter(function (r) {
                return r.data && Object.keys(r.data).length > 0;
              });
              if (nonEmpty.length) {
                await window.servicesDB.bulkUpsertRows(current.sheet.id,
                  nonEmpty.map(function (r) { return { row_index: r.row_index, data: r.data }; }));
              }
            } catch (err) {
              notify('error', 'Delete Failed', err.message);
            }
            render();
            notify('success', 'Column Deleted', '"' + colName + '" removed.');
          } else if (action.indexOf('cell-format-') === 0) {
            var fmt = action.replace('cell-format-', '');
            cols[colIdx].format = fmt === 'auto' ? undefined : fmt;
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
            closeAllCtxMenus();
          }
        });
      });
    });

    /* Close menu on outside click / scroll / Esc */
    document.addEventListener('mousedown', function onOutside(ev) {
      if (!ev.target.closest('.svc-col-ctx-menu')) {
        closeAllCtxMenus();
        document.removeEventListener('mousedown', onOutside);
      }
    });
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { closeAllCtxMenus(); document.removeEventListener('keydown', onEsc); }
    });
  }

  // ── Services Case Detail Modal ───────────────────────────────────────────────
  // Opens when user LEFT-CLICKS a row number in the grid.
  // Fetches QB data for the case# found in that row, then populates the
  // #svcCaseDetailModal overlay (HTML is in services.html).
  // ─────────────────────────────────────────────────────────────────────────────

  (function _initSvcCaseDetailModal() {
    var modal = document.getElementById('svcCaseDetailModal');
    if (!modal) return;

    function _esc(v) {
      return String(v == null ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function _set(id, v)  { var el = document.getElementById(id); if (el) el.textContent = v; }
    function _html(id, h) { var el = document.getElementById(id); if (el) el.innerHTML  = h;  }

    function _dur(val) {
      var n = Number(val);
      if (!isFinite(n) || n < 0) return String(val == null ? '' : val);
      var d = Math.round(n / (1000 * 60 * 60 * 24));
      if (d < 1) return '< 1 day';
      return d + ' day' + (d === 1 ? '' : 's');
    }

    function _badge(s) {
      var sl = (s || '').toLowerCase();
      var cls = 'svc-qb-status-default';
      if      (sl.includes('investigating'))                               cls = 'svc-qb-status-investigating';
      else if (sl.includes('waiting'))                                     cls = 'svc-qb-status-waiting';
      else if (sl.includes('initial'))                                     cls = 'svc-qb-status-initial';
      else if (sl.includes('soft close') || sl.includes('soft-close'))    cls = 'svc-qb-status-soft-close';
      else if (sl.includes('response received') || sl.includes('for support')) cls = 'svc-qb-status-response';
      else if (sl.includes('closed') || sl.startsWith('c -'))             cls = 'svc-qb-status-closed';
      else if (sl.startsWith('s -'))                                       cls = 'svc-qb-status-soft-close';
      else if (sl.startsWith('o -'))                                       cls = 'svc-qb-status-investigating';
      return '<span class="svc-qb-status-badge ' + cls + '">' +
             '<span class="svc-qb-status-dot"></span>' + _esc(s || '—') + '</span>';
    }

    var GROUPS = {
      caseId:  ['case #','case#','case number','case no','case id'], // prevents Case# duplication in Additional Fields
      desc:    ['short description','description','concern','subject','title'],
      assign:  ['assigned to','assigned','agent'],
      contact: ['contact','full name','customer name'],
      endUser: ['end user','client','account','customer'],
      type:    ['type','category'],
      status:  ['case status','status'],
      age:     ['age'],
      lastUpd: ['last update days','last update','update days'],
      latest:  ['latest update on the case','latest update','last update','last comment','most recent update','update on the case','latest'],
      notes:   ['case notes detail','case notes','case note','case details','resolution details','notes'],
      email:   ['e-mail','email','mail address'], // prevent email appearing redundantly
    };

    function _matchGroup(rec, keys) {
      if (!rec || !rec.columnMap) return null;
      return Object.keys(rec.columnMap).find(function (id) {
        var lbl = (rec.columnMap[id] || '').toLowerCase();
        return keys.some(function (k) { return lbl.includes(k); });
      }) || null;
    }

    function _populate(caseNum, rec) {
      var knownColIds = new Set();
      var resolved = {};
      Object.keys(GROUPS).forEach(function (key) {
        var colId = _matchGroup(rec, GROUPS[key]);
        resolved[key] = colId;
        if (colId) knownColIds.add(colId);
      });
      function getVal(key) {
        var colId = resolved[key];
        if (!colId) return '';
        var f = rec.fields[colId];
        return f && f.value != null ? String(f.value) : '';
      }
      var desc    = getVal('desc')    || '—';
      var assign  = getVal('assign')  || '—';
      var contact = getVal('contact') || '—';
      var endUser = getVal('endUser') || '—';
      var type    = getVal('type')    || '—';
      var status  = getVal('status')  || '—';
      var age     = getVal('age');
      var lastUpd = getVal('lastUpd');
      var latest  = getVal('latest')  || '—';
      var notes   = getVal('notes');

      _set('svcQbcdRowBadge',  caseNum);
      _set('svcQbcdCaseId',    caseNum);
      _set('svcQbcdCaseId2',   caseNum);
      _set('svcQbcdDesc',      desc);
      _html('svcQbcdStatusBadge', _badge(status));
      _html('svcQbcdStatus2',     _badge(status));
      _set('svcQbcdMeta',      endUser);
      _set('svcQbcdKpiAge',    age     ? _dur(age)     : '—');
      _set('svcQbcdKpiLast',   lastUpd ? _dur(lastUpd) : '—');
      _set('svcQbcdKpiType',   type);
      _set('svcQbcdKpiEndUser', endUser);
      _set('svcQbcdAssigned',  assign);
      _set('svcQbcdContact',   contact);
      _set('svcQbcdEndUser',   endUser);
      _set('svcQbcdType2',     type);
      _set('svcQbcdLatest',    latest);

      var notesBlock = document.getElementById('svcQbcdNotesBlock');
      if (notes && notes !== 'N/A') {
        _set('svcQbcdNotes', notes);
        if (notesBlock) notesBlock.style.display = '';
      } else {
        if (notesBlock) notesBlock.style.display = 'none';
      }

      var extraContainer = document.getElementById('svcQbcdExtraFields');
      var extraBlock     = document.getElementById('svcQbcdExtraBlock');
      if (extraContainer && rec.columnMap) {
        var extraCols = Object.keys(rec.columnMap).filter(function (id) { return !knownColIds.has(id); });
        var extraHtml = extraCols.map(function (colId) {
          var label = rec.columnMap[colId] || ('Field #' + colId);
          var f     = rec.fields[colId];
          var val   = (f && f.value != null) ? String(f.value) : '';
          if (!val || val === 'N/A' || val === '—') return '';
          return '<div class="svc-qbcd-kv"><span class="svc-qbcd-kv-lbl">' + _esc(label) +
            '</span><span class="svc-qbcd-kv-val">' + _esc(val) + '</span></div>';
        }).filter(Boolean).join('');
        extraContainer.innerHTML = extraHtml || '';
        if (extraBlock) extraBlock.style.display = extraHtml ? '' : 'none';
      }

      var loading = document.getElementById('svcQbcdLoading');
      var content = document.getElementById('svcQbcdContent');
      if (loading) loading.style.display = 'none';
      if (content) content.style.display = '';
    }

    function _showError(msg) {
      var loading = document.getElementById('svcQbcdLoading');
      if (loading) {
        loading.innerHTML = '<span style="font-size:22px">⚠️</span>' +
          '<span style="color:rgba(239,68,68,.8);font-size:12px;">' + _esc(msg) + '</span>';
        loading.style.display = '';
      }
      var content = document.getElementById('svcQbcdContent');
      if (content) content.style.display = 'none';
    }

    function _closeSvcModal() {
      modal.classList.remove('svc-cdm-open');
    }

    window._openSvcCaseDetailModal = function (rowIndex) {
      if (!current) return;
      var qbBase = 'https://copeland-coldchainservices.quickbase.com/nav/app/bpvmztzkw/table/bpvmztzr5';

      var CASE_EXACT = ['case#','case #','case number','case no','case id','case'];
      var cols = (current.sheet && current.sheet.column_defs) || [];
      var caseCol = cols.find(function (c) {
        return CASE_EXACT.indexOf(String(c.label || '').trim().toLowerCase()) !== -1;
      });
      if (!caseCol) caseCol = cols.find(function (c) {
        return String(c.label || '').toLowerCase().includes('case');
      });
      if (!caseCol) caseCol = cols[0];

      var rowObj  = caseCol ? current.rows.find(function (r) { return r.row_index === rowIndex; }) : null;
      var caseNum = (rowObj && caseCol) ? String(rowObj.data[caseCol.key] || '').trim() : '';

      // Grab SITE column for instant description display (no QB wait needed)
      var siteCol = cols.find(function (c) { return /^site$/i.test(String(c.label || '').trim()); });
      if (!siteCol) siteCol = cols.find(function (c) { return String(c.label || '').toLowerCase().includes('site'); });
      var siteVal = (rowObj && siteCol) ? String(rowObj.data[siteCol.key] || '').trim() : '';
      var displayRowNum = rowIndex + 1; // 1-based display number for badge
      var ridCol = cols.find(function (c) { return /^record id#$/i.test(String(c.label || '').trim()); });
      if (!ridCol) ridCol = cols.find(function (c) {
        var lower = String(c.label || '').trim().toLowerCase();
        return lower === 'record id' || lower === 'rid' || lower.indexOf('record id#') !== -1;
      });
      var rid = (rowObj && ridCol) ? String(rowObj.data[ridCol.key] || '').trim() : '';
      if (!rid) rid = caseNum;
      var editUrl = qbBase + '/action/er?rid=' + encodeURIComponent(rid || '') + '&rl=bmg5';
      var viewUrl = qbBase + '/action/dr?rid=' + encodeURIComponent(rid || '') + '&rl=bmg5';
      var editLink = document.getElementById('svcQbcdEditLink');
      var viewLink = document.getElementById('svcQbcdViewLink');
      var ridEl = document.getElementById('svcQbcdRid');
      if (editLink) editLink.href = editUrl;
      if (viewLink) viewLink.href = viewUrl;
      if (ridEl) ridEl.textContent = rid || 'N/A';

      // Reset & show modal in loading state immediately
      _set('svcQbcdRowBadge', String(displayRowNum)); // Row number badge (96, 460…), not case#
      _set('svcQbcdCaseId',   caseNum || '—');
      _set('svcQbcdDesc',     siteVal);               // Show site instantly from local data
      _html('svcQbcdStatusBadge', '');
      _set('svcQbcdMeta', 'Row ' + displayRowNum);
      var loading = document.getElementById('svcQbcdLoading');
      var content = document.getElementById('svcQbcdContent');
      if (loading) {
        loading.innerHTML = '<div class="svc-qbcd-spinner"></div><span>Fetching QB data…</span>';
        loading.style.display = '';
      }
      if (content) content.style.display = 'none';

      modal.classList.add('svc-cdm-open');
      if (modal.parentElement !== document.body) document.body.appendChild(modal);

      if (!caseNum) { _showError('No Case # found in this row.'); return; }
      if (!window.svcQbLookup) { _showError('QB Lookup module not loaded.'); return; }

      // Use fetchCaseRecord (MODE A direct) — independent of the batch pipeline.
      // lookupCase() can block if a 520-row Update batch is in-flight.
      // fetchCaseRecord() goes straight to /api/studio/qb_data?recordId=X — always fast.
      window.svcQbLookup.fetchCaseRecord(caseNum).then(function (rec) {
        if (!modal.classList.contains('svc-cdm-open')) return;
        if (!rec) { _showError('Case #' + caseNum + ' not found in QuickBase.'); return; }
        _populate(caseNum, rec);
      }).catch(function (err) {
        if (!modal.classList.contains('svc-cdm-open')) return;
        _showError('Failed: ' + (err && err.message ? err.message : String(err)));
      });
    };

    // Wire close buttons
    ['svcQbcdCloseBtn','svcQbcdCloseBtn2'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', _closeSvcModal);
    });

    var copyBtn = document.getElementById('svcQbcdCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var id = (document.getElementById('svcQbcdCaseId') || {}).textContent || '';
        if (!id || id === '—') return;
        var labelSpan = copyBtn.querySelector('span');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(function () {
            if (labelSpan) labelSpan.textContent = 'Copied!';
            setTimeout(function () {
              if (labelSpan) labelSpan.textContent = 'Copy Case #';
            }, 1800);
          }).catch(function () {});
        }
      });
    }

    modal.addEventListener('mousedown', function (e) { if (e.target === modal) _closeSvcModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('svc-cdm-open')) _closeSvcModal();
    });
  })();

  // ── Row number right-click context menu ────────────────────────────────────────
  // Right-clicking any row-num td shows "Delete this row" action.
  // Deletes from current.rows + re-indexes all rows below + persists to Supabase.
  function attachRowContextMenu() {
    grid.querySelectorAll('tbody td.row-num').forEach(function (td) {
      // LEFT-CLICK → open case detail modal
      td.addEventListener('click', function (e) {
        e.stopPropagation();
        var rowIndex = parseInt(td.dataset.rowIndex, 10);
        if (isNaN(rowIndex)) return;
        if (typeof window._openSvcCaseDetailModal === 'function') {
          window._openSvcCaseDetailModal(rowIndex);
        }
      });

      td.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllCtxMenus();

        var rowIndex = parseInt(td.dataset.rowIndex, 10);
        var displayNum = rowIndex + 1;

        // Check if this row actually has data
        var rowObj = current.rows.find(function (r) { return r.row_index === rowIndex; });
        var hasData = rowObj && rowObj.data && Object.values(rowObj.data).some(function (v) {
          return v !== '' && v != null;
        });

        var menu = document.createElement('div');
        menu.className = 'svc-col-ctx-menu svc-row-ctx-menu';

        // Close button
        var closeBtn = document.createElement('button');
        closeBtn.className = 'ctx-close-btn';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', function (ev) { ev.stopPropagation(); closeAllCtxMenus(); });
        menu.appendChild(closeBtn);

        // Section header
        var hdr = document.createElement('div');
        hdr.className = 'ctx-section-header';
        hdr.textContent = 'ROW ' + displayNum;
        menu.appendChild(hdr);

        // Delete row item
        var delItem = document.createElement('div');
        delItem.className = 'ctx-item ctx-item-danger';
        delItem.innerHTML = '<span class="ctx-icon">🗑️</span><span class="ctx-label">Delete this row</span>';
        delItem.title = hasData ? 'Permanently delete row ' + displayNum + ' and its data' : 'Remove empty row ' + displayNum;
        delItem.addEventListener('click', async function (ev) {
          ev.stopPropagation();
          closeAllCtxMenus();

          if (hasData) {
            var confirmed = confirm(
              'Delete Row ' + displayNum + '?\n\n' +
              'All data in this row will be permanently removed. This cannot be undone.'
            );
            if (!confirmed) return;
          }

          // 1. Find the row in current.rows
          var rowIdx = current.rows.findIndex(function (r) { return r.row_index === rowIndex; });

          // If row has a DB record, delete it and shift rows below it.
          // IMPORTANT: do NOT use bulk upsert for shifting indexes because it can leave stale
          // rows at old indexes and make deleted row appear to "come back".
          if (rowIdx >= 0) {
            var targetRow = current.rows[rowIdx];
            var shiftedPlan = current.rows
              .filter(function (r) { return r.row_index > rowIndex; })
              .map(function (r) {
                return {
                  id: r.id,
                  oldRowIndex: r.row_index,
                  newRowIndex: r.row_index - 1,
                  data: r.data || {}
                };
              });

            // Remove from local state immediately for snappy UX
            current.rows.splice(rowIdx, 1);
            current.rows.forEach(function (r) {
              if (r.row_index > rowIndex) r.row_index -= 1;
            });

            try {
              var c = window.servicesDB.client;
              if (c) {
                // Delete target row by stable DB id first (fallback to row_index if id missing)
                var delQ = c.from('services_rows').delete().eq('sheet_id', current.sheet.id);
                if (targetRow && targetRow.id != null) delQ = delQ.eq('id', targetRow.id);
                else delQ = delQ.eq('row_index', rowIndex);
                var delOut = await delQ;
                if (delOut && delOut.error) throw delOut.error;

                // Shift rows by id so old row_index records do not remain in DB.
                for (var s = 0; s < shiftedPlan.length; s++) {
                  var step = shiftedPlan[s];
                  if (step.id == null) continue;
                  var updOut = await c.from('services_rows')
                    .update({ row_index: step.newRowIndex, data: step.data })
                    .eq('id', step.id)
                    .eq('sheet_id', current.sheet.id);
                  if (updOut && updOut.error) throw updOut.error;
                }
              }
            } catch (err) {
              console.error('[services-grid] deleteRow error:', err);
              notify('error', 'Delete Failed', err.message || 'Could not delete row.');
              // Keep local update to avoid UX freeze; realtime/db sync will reconcile.
            }
          } else {
            // Empty/virtual row — no DB record, local render only
          }

          render();
          window.servicesDashboard && window.servicesDashboard.update(current);
          notify('success', 'Row Deleted', 'Row ' + displayNum + ' removed.');
        });
        menu.appendChild(delItem);

        // Position menu
        menu.style.left = e.clientX + 'px';
        menu.style.top  = e.clientY + 'px';
        document.body.appendChild(menu);

        // Flip if overflows viewport
        var rect = menu.getBoundingClientRect();
        if (rect.right  > window.innerWidth  - 8) menu.style.left = (e.clientX - rect.width)  + 'px';
        if (rect.bottom > window.innerHeight - 8) menu.style.top  = (e.clientY - rect.height) + 'px';

        // Close on outside click / Esc
        setTimeout(function () {
          function onOut(ev) {
            if (!ev.target.closest('.svc-row-ctx-menu')) {
              closeAllCtxMenus();
              document.removeEventListener('mousedown', onOut);
            }
          }
          function onEsc(ev) {
            if (ev.key === 'Escape') { closeAllCtxMenus(); document.removeEventListener('keydown', onEsc); }
          }
          document.addEventListener('mousedown', onOut);
          document.addEventListener('keydown', onEsc);
        }, 0);
      });
    });
  }

  function closeAllCtxMenus() {
    document.querySelectorAll('.svc-col-ctx-menu, .svc-row-ctx-menu').forEach(function (m) { m.remove(); });
  }

  // FIX: autoResizeColumns is the main latency source on large grids.
  // Run it deferred via requestAnimationFrame so it never blocks the render.
  // Also: cache column widths per sheet — only re-measure if sheet changed.
  var _resizeCache      = {};   // sheetId → { key: widthPx, ... }
  var _resizeSheetId    = null;
  var _resizeRafPending = false;

  function applyColumnWidths() {
    _applyColumnWidths();
  }

  function autoFitColumns() {
    if (!current || !current.sheet) return;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = '13px Inter, system-ui, -apple-system';

    current.sheet.column_defs.forEach(function (col) {
      if (col.hidden) return;

      var saved = Number(current.sheet.column_widths && current.sheet.column_widths[col.key]);
      if (saved) {
        col.width = saved + 'px';
        return;
      }

      // Measure header
      var maxWidth = ctx.measureText(col.name || col.key).width + 48;

      // Measure first 30 rows of data
      var sampleRows = current.rows.slice(0, 30);
      sampleRows.forEach(function (row) {
        var val = formatCellValue(col, row.data[col.key]);
        var w = ctx.measureText(String(val)).width + 32;
        if (w > maxWidth) maxWidth = w;
      });

      // NEW: Increase floor from 80 to 140, ceiling from 300 to 400
      col.width = Math.min(Math.max(maxWidth, 140), 400) + 'px';
    });

    _applyColumnWidths();
  }

  function autoResizeColumns() {
    if (!current) return;
    var sheetId = current.sheet && current.sheet.id;
    var visibleCols = (current.sheet.column_defs || []).filter(function (c) { return !c.hidden; });
    if (visibleCols.length && visibleCols.every(function (c) { return c.width && c.width !== 'auto'; })) {
      applyColumnWidths();
      return;
    }

    // Use cached widths if same sheet (filter switches) — no DOM reads at all
    if (sheetId && _resizeSheetId === sheetId && _resizeCache[sheetId]) {
      _applyColumnWidths(_resizeCache[sheetId]);
      return;
    }

    // New sheet — measure via rAF so render() completes first, browser paints,
    // then we do the costly measurement in the next frame (non-blocking)
    if (_resizeRafPending) return;
    _resizeRafPending = true;
    requestAnimationFrame(function () {
      _resizeRafPending = false;
      if (!current) return;
      var sid  = current.sheet && current.sheet.id;
      var cols = current.sheet.column_defs || [];
      var widths = {};
      var m = mkEl('span');
      m.style.cssText = 'visibility:hidden;position:absolute;white-space:nowrap;top:-9999px;left:-9999px;';
      document.body.appendChild(m);
      cols.forEach(function (c) {
        var maxW = 80;
        var th = grid.querySelector('thead th[data-key="' + c.key + '"]');
        if (th) {
          m.style.font = '600 11px/1 Inter,system-ui,sans-serif';
          m.style.letterSpacing = '0.05em';
          m.textContent = c.label;
          maxW = Math.max(maxW, m.offsetWidth + 32);
        }
        grid.querySelectorAll('input.cell[data-key="' + c.key + '"]').forEach(function (inp) {
          if (!inp.value) return;
          m.style.font = '13px/1 Consolas,monospace';
          m.style.letterSpacing = '';
          m.textContent = inp.value;
          maxW = Math.max(maxW, m.offsetWidth + 32);
        });
        widths[c.key] = Math.min(500, maxW) + 'px';
      });
      m.remove();
      // Cache and apply
      if (sid) {
        _resizeCache[sid]  = widths;
        _resizeSheetId     = sid;
      }
      _applyColumnWidths(widths);
    });
  }

  function _applyColumnWidths() {
    if (!grid || !current || !current.sheet) return;
    var headers = grid.querySelectorAll('thead th');
    headers.forEach(function (th, idx) {
      var col = current.sheet.column_defs[idx - 1]; // -1 for row-num column
      if (col && col.width) {
        th.style.width = col.width;
        th.style.minWidth = col.width;
        th.style.maxWidth = col.width;
        var colCells = grid.querySelectorAll('tbody tr td:nth-child(' + (idx + 1) + ')');
        colCells.forEach(function (td) {
          td.style.width = col.width;
          td.style.minWidth = col.width;
          td.style.maxWidth = col.width;
        });
      }
    });
  }

  function onCellInput(e) {
    var rowIdx = +e.target.dataset.row;
    var key    = e.target.dataset.key;
    var value  = e.target.value;
    var format = e.target.dataset.format || 'auto';
    var strictList = (e.target.dataset.validationStrict === '1');
    if (strictList) {
      var allowed = String(e.target.dataset.validationList || '')
        .split('\n')
        .map(function (v) { return String(v || '').trim(); })
        .filter(function (v) { return !!v; });
      if (value && allowed.length && allowed.indexOf(value) === -1) {
        notify('warning', 'Invalid Value', 'Please select from the dropdown list.');
        var rowExisting = current.rows.find(function (r) { return r.row_index === rowIdx; });
        e.target.value = rowExisting && rowExisting.data && rowExisting.data[key] != null ? String(rowExisting.data[key]) : '';
        return;
      }
    }
    var rowObj = current.rows.find(function (r) { return r.row_index === rowIdx; });
    if (!rowObj) { rowObj = { row_index: rowIdx, data: {} }; current.rows.push(rowObj); }
    if (format === 'number' && value && !/^\d+$/.test(value)) {
      alert('Please input only Numbers if naka format ng numbers or change the format.');
      e.target.value = rowObj.data[key] != null ? String(rowObj.data[key]) : '';
      return;
    }
    var prevValue = rowObj.data[key] != null ? rowObj.data[key] : '';
    undoStack.push({ rowIdx: rowIdx, key: key, prev: prevValue, next: value });
    redoStack = [];
    rowObj.data[key] = value;
    if (DuplicateDetector.caseKey === key) {
      DuplicateDetector.remove(prevValue, rowIdx);
      DuplicateDetector.add(value, rowIdx);
      refreshDuplicateIndicatorsDebounced();
    }
    setStatus('unsaved', 'Unsaved');
    updateStatusBar();
    var tKey = rowIdx + ':' + key;
    clearTimeout(saveTimers.get(tKey));
    saveTimers.set(tKey, setTimeout(async function () {
      setStatus('saving', 'Saving…');
      await window.servicesDB.upsertRow(current.sheet.id, rowIdx, rowObj.data);
      setStatus('saved', '✓ Saved');
      window.svcToast && window.svcToast.pulse();
      window.servicesDashboard && window.servicesDashboard.update(current);
    }, SAVE_DEBOUNCE_MS));
  }

  function onCellKey(e) {
    var row  = +e.target.dataset.row;
    var key  = e.target.dataset.key;
    var cols = current.sheet.column_defs.filter(function (c) { return !c.hidden; }).map(function (c) { return c.key; });
    var idx  = cols.indexOf(key);
    var nextRow = row, nextKey = key;
    if      (e.key === 'Enter' || e.key === 'ArrowDown') nextRow = row + 1;
    else if (e.key === 'ArrowUp')                        nextRow = Math.max(0, row - 1);
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (idx > 0) nextKey = cols[idx - 1];
        else { nextKey = cols[cols.length - 1]; nextRow = Math.max(0, row - 1); }
      } else {
        if (idx + 1 < cols.length) nextKey = cols[idx + 1];
        else { nextKey = cols[0]; nextRow = row + 1; }
      }
    }
    else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length)
      nextKey = cols[Math.min(cols.length - 1, idx + 1)];
    else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0)
      nextKey = cols[Math.max(0, idx - 1)];
    else return;
    var target = grid.querySelector('input.cell[data-row="' + nextRow + '"][data-key="' + nextKey + '"]');
    if (target) { e.preventDefault(); target.focus(); target.select(); }
  }

  function updateStatusBar() {
    if (!current) { statusCells.textContent = '0 cells'; return; }
    statusCells.textContent = current.rows.length + ' rows × ' + current.sheet.column_defs.length + ' cols';
  }

  addRowBtn.addEventListener('click', function () {
    if (!current) return;
    var maxIdx = current.rows.reduce(function (m, r) { return Math.max(m, r.row_index); }, -1);
    current.rows.push({ row_index: maxIdx + 1, data: {} });
    render();
  });

  addColBtn.addEventListener('click', async function () {
    if (!current) return;
    var label = prompt('Column name:', 'New Column');
    if (!label || !label.trim()) return;
    var key = 'col_' + Math.random().toString(36).slice(2, 8);
    current.sheet.column_defs.push({ key: key, label: sanitizeHeaderLabel(label, current.sheet.column_defs.length), type: 'text', width: 'auto' });
    autoFitColumns();
    await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
    render();
  });

  exportBtn.addEventListener('click', async function () {
    if (!current) return;
    exportBtn.disabled = true;
    var originalText = exportBtn.textContent;
    exportBtn.textContent = '⏳ Exporting…';
    try {
      if (window.svcQbLookup && window.svcQbLookup.hydrateLinkedColumnsForExport) {
        await window.svcQbLookup.hydrateLinkedColumnsForExport(current, grid);
      }
      await saveAllRows();
      var cols   = current.sheet.column_defs;
      var header = cols.map(function (c) { return JSON.stringify(c.label); }).join(',');
      var lines  = current.rows
        .sort(function (a, b) { return a.row_index - b.row_index; })
        .map(function (r) {
          return cols.map(function (c) { return JSON.stringify(r.data[c.key] != null ? r.data[c.key] : ''); }).join(',');
        });
      var blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
      var a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: current.sheet.title + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) {
      notify('error', 'Export Failed', err && err.message ? err.message : 'Try again.');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalText;
    }
  });

  undoBtn.addEventListener('click', function () {
    if (!undoStack.length || !current) return;
    var op = undoStack.pop(); redoStack.push(op); applyOp(op.rowIdx, op.key, op.prev);
  });
  redoBtn.addEventListener('click', function () {
    if (!redoStack.length || !current) return;
    var op = redoStack.pop(); undoStack.push(op); applyOp(op.rowIdx, op.key, op.next);
  });
  function applyOp(rowIdx, key, value) {
    var inp = grid.querySelector('input.cell[data-row="' + rowIdx + '"][data-key="' + key + '"]');
    if (inp) { inp.value = value; inp.dispatchEvent(new Event('input')); }
  }

  async function saveAllRows() {
    if (!current) { notify('warning', 'No Sheet Open', 'Open a sheet first.'); return; }
    if (window.updateTimer) window.updateTimer.reset();
    localStorage.setItem('svc_lastFullUpdate', Date.now().toString());
    await saveColumnState();
    var nonEmpty = current.rows.filter(function (r) {
      return r.data && Object.values(r.data).some(function (v) { return v !== '' && v != null; });
    });
    if (nonEmpty.length === 0) { notify('info', 'Nothing to Save', 'No data yet.'); return; }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
    setStatus('saving', 'Saving all…');
    try {
      var result = await window.servicesDB.bulkUpsertRows(current.sheet.id,
        nonEmpty.map(function (r) { return { row_index: r.row_index, data: r.data }; }));
      if (result && result.error) throw new Error(result.error.message || 'Write failed');
      setStatus('saved', '✓ All saved');
      notify('success', 'Saved', nonEmpty.length + ' rows saved.');
      window.servicesDashboard && window.servicesDashboard.update(current);
    } catch (err) {
      setStatus('error', '✕ Save failed');
      notify('error', 'Save Failed', err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 SAVE'; }
    }
  }

  async function createBackup(name) {
    var snapshot = {
      columns: JSON.parse(JSON.stringify(current.sheet.column_defs)),
      rows: current.rows.map(function (r) { return { row_index: r.row_index, data: r.data }; }),
      timestamp: new Date().toISOString()
    };

    var result = await window.supabase.from('services_backups').insert({
      sheet_id: current.sheet.id,
      name: name || ('Backup ' + new Date().toLocaleString('en-PH')),
      snapshot: snapshot,
      row_count: current.rows.length
    });
    var error = result && result.error;

    if (!error) notify('success', 'Backup Created', name);
    return !error;
  }

  function renderBackupList(items) {
    if (!backupListEl) return;
    if (!items || !items.length) {
      backupListEl.innerHTML = '<div style="padding:14px;color:#94a3b8;">No backups yet.</div>';
      return;
    }
    backupListEl.innerHTML = items.map(function (b) {
      var dt = b.created_at ? new Date(b.created_at).toLocaleString() : 'Unknown';
      return '<div style=\"padding:10px 0;border-bottom:1px solid rgba(30,41,59,.6);display:flex;justify-content:space-between;gap:12px;align-items:center;\">' +
        '<div><div style=\"color:#e2e8f0;font-size:13px;font-weight:600;\">' + (b.name || 'Backup') + '</div>' +
        '<div style=\"color:#94a3b8;font-size:12px;\">' + dt + ' · ' + (b.row_count || 0) + ' rows</div></div>' +
        '<button class=\"svc-btn ghost\" data-restore-id=\"' + b.id + '\">Restore</button></div>';
    }).join('');
    backupListEl.querySelectorAll('button[data-restore-id]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          var payload = await window.BackupManager.restore(btn.dataset.restoreId);
          if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.columns)) throw new Error('Invalid backup payload');
          current.sheet.column_defs = payload.columns;
          current.rows = payload.rows;
          await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
          await window.servicesDB.bulkUpsertRows(current.sheet.id, current.rows.map(function (r) {
            return { row_index: r.row_index, data: r.data || {} };
          }));
          render();
          notify('success', 'Backup Restored', 'Sheet restored from backup.');
          backupModal.hidden = true;
        } catch (err) {
          notify('error', 'Restore Failed', err.message || 'Try again.');
        }
      });
    });
  }

  async function openBackupModal() {
    if (!current || !window.BackupManager) {
      notify('warning', 'Backup', 'Open a sheet first.');
      return;
    }
    backupModal.hidden = false;
    var out = await window.BackupManager.list(current.sheet.id);
    if (out && out.error) throw out.error;
    renderBackupList((out && out.data) || []);
  }

  function countUnresolvedLinkedCells(state) {
    if (!state || !state.sheet || !Array.isArray(state.rows)) return 0;
    var cols = state.sheet.column_defs || [];
    var linkedCols = cols.filter(function (c) { return c && c.qbLookup && c.qbLookup.fieldId; });
    if (!linkedCols.length) return 0;
    var caseCol = cols.find(function (c) {
      var label = String(c && c.label || '').trim().toLowerCase();
      return label === 'case#' || label === 'case #' || label === 'case number' || label === 'case no' || label === 'case id' || label === 'case';
    }) || cols.find(function (c) { return String(c && c.label || '').toLowerCase().indexOf('case') !== -1; }) || cols[0];
    if (!caseCol) return 0;

    var unresolved = 0;
    state.rows.forEach(function (row) {
      if (!row || !row.data) return;
      var caseVal = String(row.data[caseCol.key] || '').trim();
      if (!caseVal) return;
      linkedCols.forEach(function (c) {
        var v = row.data[c.key];
        // '---' is display-only placeholder — not stored in row.data, but guard just in case
        if (v == null || String(v).trim() === '' || String(v).trim() === '—' || String(v).trim() === '---') unresolved++;
      });
    });
    return unresolved;
  }

  if (saveBtn) saveBtn.addEventListener('click', saveAllRows);

  if (columnsBtn) {
    columnsBtn.onclick = function (e) {
      e && e.stopPropagation && e.stopPropagation();
      if (!current || !current.sheet || !Array.isArray(current.sheet.column_defs)) {
        notify('warning', 'Columns', 'Open a sheet first.');
        return;
      }
      var pop = document.querySelector('.col-pop');
      if (pop) { pop.remove(); return; }
      pop = document.createElement('div');
      pop.className = 'col-pop';
      pop.style.cssText = 'position:fixed;top:60px;right:20px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;z-index:9999;min-width:200px;max-height:300px;overflow:auto';
      current.sheet.column_defs.forEach(function (col) {
        var div = document.createElement('div');
        div.style.cssText = 'padding:6px;cursor:pointer;display:flex;align-items:center;gap:8px';
        div.innerHTML = '<input type="checkbox" ' + (!col.hidden ? 'checked' : '') + '><span>' + (col.label || 'Unnamed') + '</span>';
        div.onclick = function () {
          var nextHidden = !col.hidden;
          toggleColumnVisibility(col.key, nextHidden);
          var cb = div.querySelector('input[type="checkbox"]');
          var lbl = div.querySelector('span');
          if (cb) cb.checked = !nextHidden;
          if (lbl) lbl.style.color = nextHidden ? '#64748b' : '#e2e8f0';
          setTimeout(function () { pop.remove(); }, 100);
        };
        pop.appendChild(div);
      });
      document.body.appendChild(pop);
      setTimeout(function () {
        document.addEventListener('click', function c(ev) {
          if (!pop.contains(ev.target) && ev.target !== columnsBtn) {
            pop.remove();
            document.removeEventListener('click', c);
          }
        });
      }, 100);
    };
  }

  if (backupBtn) {
    backupBtn.addEventListener('click', async function () {
      if (!current) { notify('warning', 'Backup', 'Open a sheet first.'); return; }
      var backupName = prompt('Backup name:', 'Backup ' + new Date().toLocaleString('en-PH'));
      if (backupName === null) return;
      var ok = await createBackup(backupName);
      if (!ok) notify('error', 'Backup Failed', 'Could not create backup.');
    });
  }
  if (backupClose) backupClose.addEventListener('click', function () { backupModal.hidden = true; });
  if (backupModal) {
    backupModal.addEventListener('click', function (e) { if (e.target === backupModal) backupModal.hidden = true; });
  }
  if (backupSaveBtn) {
    backupSaveBtn.addEventListener('click', async function () {
      if (!current || !window.BackupManager) return;
      try {
        var payload = {
          id: current.sheet.id,
          rows: current.rows || [],
          column_defs: current.sheet.column_defs || []
        };
        var out = await window.BackupManager.save(payload, (backupNameEl && backupNameEl.value) || '');
        if (out && out.error) throw out.error;
        notify('success', 'Backup Saved', ((current.rows && current.rows.length) || 0) + ' rows captured.');
        if (backupNameEl) backupNameEl.value = '';
        await openBackupModal();
      } catch (err) {
        notify('error', 'Backup Save Failed', err && err.message ? err.message : 'Try again.');
      }
    });
  }

  // ── Refresh button — reloads sheet list + active sheet data ───────────────
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function () {
      refreshBtn.disabled   = true;
      var origText          = refreshBtn.textContent;
      refreshBtn.textContent = '⏳';
      refreshBtn.classList.add('svc-refresh-btn--loading');
      setStatus('saving', 'Refreshing…');
      try {
        if (window.updateTimer) window.updateTimer.reset();
        // 1. Reload sheet list in sidebar
        if (window.servicesSheetManager && window.servicesSheetManager.refresh) {
          await window.servicesSheetManager.refresh();
        }
        // 2. Reload active sheet rows from DB
        if (current && current.sheet && window.servicesApp && window.servicesApp.openSheet) {
          await window.servicesApp.openSheet(current.sheet);
        }
        // 3. Re-render treeview counts
        if (current && current.sheet && window.servicesTreeview) {
          window.servicesTreeview.refreshCounts(current.sheet.id);
        }
        setStatus('saved', '✓ Refreshed');
        notify('success', 'Refresh', 'Sheet data reloaded.');
      } catch (err) {
        setStatus('error', '✕ Refresh failed');
        notify('error', 'Refresh Failed', err && err.message ? err.message : 'Try again.');
      } finally {
        refreshBtn.disabled    = false;
        refreshBtn.textContent  = origText;
        refreshBtn.classList.remove('svc-refresh-btn--loading');
      }
    });
    // Keyboard shortcut: Ctrl+Shift+R (avoid conflict with hard-reload Ctrl+R)
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        refreshBtn.click();
      }
    });
  }

  if (qbUpdateBtn) {
    qbUpdateBtn.addEventListener('click', async function () {
      if (!current || !window.svcQbLookup) return;
      var targetSheetId = current.sheet && current.sheet.id;
      qbUpdateBtn.disabled = true;
      var originalText = qbUpdateBtn.textContent;
      qbUpdateBtn.textContent = '⏳ Updating…';
      setStatus('saving', 'Updating lookup…');
      // Suspend CF paint during bulk update — fires one final paint when done
      document.dispatchEvent(new CustomEvent('svc:qb-update-start'));
      try {
        if (window.updateTimer) window.updateTimer.reset();
        await window.svcQbLookup.refreshAllLinkedColumns(current, grid);
        var unresolved = countUnresolvedLinkedCells(current);
        if (unresolved > 0) {
          // second pass for transient misses on large sheets
          await window.svcQbLookup.refreshAllLinkedColumns(current, grid);
        }
        if (!current || !current.sheet || current.sheet.id !== targetSheetId) {
          throw new Error('Sheet changed while updating. Please click Update again on the selected sheet.');
        }
        await saveAllRows();
        // BUG1 FIX: Re-render grid immediately so all QB values + '---' placeholders
        // are visible without requiring a browser refresh
        render();
        setStatus('saved', '✓ Lookup updated');
        notify('success', 'Lookup Updated', 'All linked QB values refreshed.');
      } catch (err) {
        setStatus('error', '✕ Lookup update failed');
        notify('error', 'Lookup Update Failed', err && err.message ? err.message : 'Try again.');
      } finally {
        qbUpdateBtn.disabled = false;
        qbUpdateBtn.textContent = originalText;
        // Always resume CF paint and trigger final repaint
        document.dispatchEvent(new CustomEvent('svc:qb-update-complete'));
      }
    });
  }

  // ── TreeView filter hook ─────────────────────────────────────────────────────
  // setTreeFilter(fn) — fn receives a row object {row_index, data}, returns bool.
  // Pass null to remove filter (show all rows).
  var _treeFilter = null;
  var _columnFilters = {}; // NEW: per-column filters
  // FIX: Flag that render() checks to skip autoResizeColumns + refreshCounts
  // during folder switches. These are the two main sources of folder-switch lag.
  var _renderIsFilterSwitch = false;
  function setTreeFilter(fn) {
    _treeFilter = fn || null;
    _renderIsFilterSwitch = true;
    try {
      render();
    } finally {
      _renderIsFilterSwitch = false;
    }
  }

  // Patch render() to honour _treeFilter —————————————————————————————————————
  // We intercept current.rows at render time; original rows stay intact so that
  // swapping filters does NOT lose data.
  var _origRender = render;
  render = function renderFiltered() {
    if (!current || !_treeFilter) {
      if (current) delete current.__treeFilteredRows;
      _origRender();
      return;
    }
    current.__treeFilteredRows = (current.rows || []).filter(_treeFilter);
    _origRender();
  };

  // Block leave navigation when unresolved duplicate CASE warnings exist
  window.addEventListener('beforeunload', function (e) {
    var dupCount = DuplicateDetector.duplicateRowCount();
    if (dupCount > 0) {
      e.preventDefault();
      e.returnValue = 'May ' + dupCount + ' duplicate CASE# na hindi pa naayos. Sigurado ka?';
    }
  });

  function clearColumnFilters() {
    _columnFilters = {};
    var inputs = document.querySelectorAll('.column-filter-input');
    inputs.forEach(function(input) { input.value = ''; });
    render();
  }

  // Export for toolbar
  window.clearColumnFilters = clearColumnFilters;

  function getState() { return current; }
  window.servicesGrid = { load: load, clear: clear, render: render, getState: getState, saveAllRows: saveAllRows, setTreeFilter: setTreeFilter, saveColumnState: saveColumnState, toggleColumnVisibility: toggleColumnVisibility, clearColumnFilters: clearColumnFilters };
})();


// ===== SEARCH WITHIN CURRENT SHEET ONLY =====
class ServicesSheetSearch {
  constructor() {
    this.init();
  }

  init() {
    const input = document.getElementById('svcGlobalSearch');
    if (!input) return;

    let timeout;
    input.addEventListener('input', (e) => {
      clearTimeout(timeout);
      const q = e.target.value.trim();
      if (q.length < 2) {
        this.hideResults();
        this.clearHighlight();
        return;
      }
      timeout = setTimeout(() => this.search(q), 150);
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        input.focus();
        input.select();
      }
      if (e.key === 'Escape') {
        this.hideResults();
        input.value = '';
        this.clearHighlight();
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.global-search-wrapper')) {
        this.hideResults();
      }
    });
  }

  search(query) {
    const table = window.__tabulatorInstance;
    if (!table) return;

    const q = query.toLowerCase();
    const results = [];
    const allData = table.getData();

    // Search through ALL rows in current sheet
    for (const row of allData) {
      // Skip internal fields
      const searchableData = { ...row };
      delete searchableData.id;
      delete searchableData._rowId;
      delete searchableData._sheetId;
      delete searchableData.row_index;

      const rowText = JSON.stringify(searchableData).toLowerCase();

      if (rowText.includes(q)) {
        // Find which field matched
        const match = Object.entries(searchableData).find(([key, val]) =>
          String(val).toLowerCase().includes(q)
        );

        if (match) {
          results.push({
            rowId: row.id || row._rowId,
            rowIndex: row.row_index,
            field: match[0],
            value: match[1],
            preview: this.getRowPreview(searchableData),
            rowData: row
          });
        }
      }

      if (results.length >= 15) break; // Limit results
    }

    this.showResults(results, query);
    this.highlightMatches(query);
  }

  getRowPreview(data) {
    // Get first 3 non-empty values
    const values = Object.values(data)
      .filter(v => v && String(v).trim())
      .slice(0, 3);
    return values.join(' • ').substring(0, 80);
  }

  showResults(results, query) {
    let dropdown = document.getElementById('svcSearchDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'svcSearchDropdown';
      dropdown.className = 'search-dropdown';
      document.querySelector('.global-search-wrapper').appendChild(dropdown);
    }

    const sheet = window.servicesSheetManager?.getActive();
    const sheetName = sheet?.title || 'Current Sheet';

    if (results.length === 0) {
      dropdown.innerHTML = `
        <div class="search-empty">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <div>No matches in "${sheetName}"</div>
          <small>Try a different term</small>
        </div>
      `;
    } else {
      dropdown.innerHTML = `
        <div class="search-header">
          <span>${results.length} matches in ${sheetName}</span>
          <span class="search-query">"${query}"</span>
        </div>
        ${results.map(r => `
          <div class="search-item" onclick="window.servicesSheetSearch.jumpToRow('${r.rowId}')">
            <div class="search-item-main">
              <div class="search-item-row">Row ${(Number(r.rowIndex) || 0) + 1}</div>
              <div class="search-item-field">
                <span class="field-name">${r.field}:</span>
                <span class="field-value">${this.highlightText(String(r.value), query)}</span>
              </div>
            </div>
            <div class="search-item-preview">${r.preview}</div>
          </div>
        `).join('')}
      `;
    }

    dropdown.classList.add('active');
  }

  hideResults() {
    document.getElementById('svcSearchDropdown')?.classList.remove('active');
  }

  jumpToRow(rowId) {
    this.hideResults();

    const table = window.__tabulatorInstance;
    if (!table) return;

    // Scroll to row and highlight
    table.scrollToRow(rowId, 'center', true);
    table.deselectRow();
    table.selectRow(rowId);

    const rowEl = table.getRow(rowId)?.getElement();
    if (rowEl) {
      rowEl.classList.add('search-target');
      setTimeout(() => rowEl.classList.remove('search-target'), 3000);
    }

    // Clear search input after jump
    setTimeout(() => {
      const input = document.getElementById('svcGlobalSearch');
      if (input) input.value = '';
    }, 500);
  }

  highlightMatches(query) {
    const table = window.__tabulatorInstance;
    if (!table) return;

    // Remove previous highlights
    this.clearHighlight();

    const q = query.toLowerCase();

    // Add highlight class to matching cells
    table.getRows().forEach(row => {
      const data = row.getData();
      let hasMatch = false;

      Object.entries(data).forEach(([key, val]) => {
        if (key.startsWith('_') || key === 'id' || key === 'row_index') return;

        if (String(val).toLowerCase().includes(q)) {
          hasMatch = true;
          const cell = row.getCell(key);
          if (cell) {
            const cellEl = cell.getElement();
            cellEl.classList.add('cell-match');

            // Highlight text inside cell
            const originalText = cellEl.textContent;
            const regex = new RegExp(`(${query})`, 'gi');
            cellEl.innerHTML = originalText.replace(regex, '<mark>$1</mark>');
          }
        }
      });

      if (hasMatch) {
        row.getElement().classList.add('row-has-match');
      }
    });
  }

  clearHighlight() {
    const table = window.__tabulatorInstance;
    if (!table) return;

    table.getRows().forEach(row => {
      row.getElement().classList.remove('row-has-match', 'search-target');
      row.getCells().forEach(cell => {
        const el = cell.getElement();
        el.classList.remove('cell-match');
        // Restore original text (remove marks)
        if (el.querySelector('mark')) {
          el.textContent = cell.getValue();
        }
      });
    });
  }

  highlightText(text, query) {
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.servicesSheetSearch = new ServicesSheetSearch();
});

// Update search placeholder to be clear
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('svcGlobalSearch');
  if (input) {
    input.placeholder = 'Search in current sheet...';
    input.title = 'Search all columns in this sheet only (⌘K)';
  }
});

// Add clear filters button if not exists
setTimeout(function() {
  var toolbar = document.querySelector('.svc-toolbar-actions');
  if (toolbar && !document.getElementById('clearColumnFiltersBtn')) {
    var btn = document.createElement('button');
    btn.id = 'clearColumnFiltersBtn';
    btn.className = 'svc-btn';
    btn.innerHTML = '✕ Clear Filters';
    btn.title = 'Clear all column filters';
    btn.style.marginLeft = '8px';
    btn.style.background = '#1e293b';
    btn.style.borderColor = '#334155';
    btn.onclick = function() { if (window.clearColumnFilters) window.clearColumnFilters(); };
    toolbar.appendChild(btn);
  }
}, 500);

// ===== SEARCH FOR CURRENT TABLE (NO TABULATOR NEEDED) =====
(function() {
  // Wait for grid to load
  const initSearch = () => {
    const toolbar = document.querySelector('.svc-toolbar-actions');
    if (!toolbar || document.getElementById('svcGlobalSearch')) return;

    // Add search box
    const searchWrap = document.createElement('div');
    searchWrap.className = 'global-search-wrapper';
    searchWrap.innerHTML = `
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#64748b;pointer-events:none;z-index:2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input id="svcGlobalSearch" type="text" placeholder="Search this sheet..." style="width:280px;height:32px;padding:0 36px 0 32px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:13px;" />
      <kbd style="position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:2px 5px;background:#1e293b;border:1px solid #334155;border-radius:4px;font-size:10px;color:#94a3b8;">⌘K</kbd>
      <div id="svcSearchDropdown" style="position:absolute;top:calc(100% + 6px);left:0;width:420px;max-height:380px;background:#0f172a;border:1px solid #334155;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.5);overflow-y:auto;display:none;z-index:1000;"></div>
    `;
    searchWrap.style.position = 'relative';
    searchWrap.style.display = 'flex';
    searchWrap.style.alignItems = 'center';

    toolbar.insertBefore(searchWrap, toolbar.firstChild);

    const input = document.getElementById('svcGlobalSearch');
    const dropdown = document.getElementById('svcSearchDropdown');
    let searchTimeout;

    // Search function
    const doSearch = (query) => {
      const q = query.toLowerCase();
      const table = document.getElementById('svcGrid');
      if (!table) return;

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const results = [];
      let matchCount = 0;

      // Clear previous highlights
      rows.forEach(row => {
        row.style.background = '';
        row.querySelectorAll('td').forEach(td => {
          td.innerHTML = td.textContent; // Remove marks
          td.style.background = '';
        });
      });

      if (!q || q.length < 2) {
        dropdown.style.display = 'none';
        return;
      }

      // Search all rows
      rows.forEach((row, idx) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const rowText = cells.map(c => c.textContent).join(' ').toLowerCase();

        if (rowText.includes(q)) {
          matchCount++;

          // Highlight matching cells
          cells.forEach(td => {
            const text = td.textContent;
            if (text.toLowerCase().includes(q)) {
              const regex = new RegExp(`(${query})`, 'gi');
              td.innerHTML = text.replace(regex, '<mark style="background:rgba(251,191,36,0.3);color:#fde047;padding:1px 2px;border-radius:2px;">$1</mark>');
              td.style.background = 'rgba(59,130,246,0.1)';
            }
          });

          row.style.background = 'rgba(59,130,246,0.05)';

          // Add to results (max 10)
          if (results.length < 10) {
            const caseNum = cells[1]?.textContent || '';
            const site = cells[2]?.textContent || '';
            results.push({ idx, caseNum, site, row });
          }
        }
      });

      // Show dropdown
      if (results.length > 0) {
        dropdown.innerHTML = `
          <div style="padding:10px 14px;border-bottom:1px solid #1e293b;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">
            ${matchCount} matches
          </div>
          ${results.map(r => `
            <div class="search-result" data-idx="${r.idx}" style="padding:10px 14px;border-bottom:1px solid #1e293b;cursor:pointer;display:flex;gap:10px;align-items:center;">
              <div style="font-size:11px;color:#3b82f6;background:rgba(59,130,246,0.15);padding:2px 6px;border-radius:4px;min-width:40px;text-align:center;">${r.idx + 1}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.caseNum}</div>
                <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.site.substring(0, 60)}</div>
              </div>
            </div>
          `).join('')}
        `;
        dropdown.style.display = 'block';

        // Click handlers
        dropdown.querySelectorAll('.search-result').forEach(el => {
          el.onclick = () => {
            const idx = parseInt(el.dataset.idx);
            const targetRow = rows[idx];
            if (targetRow) {
              targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
              targetRow.style.background = 'rgba(59,130,246,0.25)';
              targetRow.style.boxShadow = 'inset 3px 0 0 #3b82f6';
              setTimeout(() => {
                targetRow.style.background = 'rgba(59,130,246,0.05)';
                targetRow.style.boxShadow = '';
              }, 2000);
            }
            dropdown.style.display = 'none';
            input.value = '';
          };
          el.onmouseenter = () => el.style.background = '#1e293b';
          el.onmouseleave = () => el.style.background = '';
        });
      } else {
        dropdown.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b;font-size:13px;">No matches</div>`;
        dropdown.style.display = 'block';
      }
    };

    input.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => doSearch(e.target.value), 150);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        doSearch('');
        dropdown.style.display = 'none';
      }
    });

    // ⌘K shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.global-search-wrapper')) {
        dropdown.style.display = 'none';
      }
    });

    console.log('[Search] Initialized for current sheet');
  };

  // Try init now and on load
  if (document.readyState === 'complete') {
    setTimeout(initSearch, 1000);
  } else {
    window.addEventListener('load', () => setTimeout(initSearch, 1000));
  }

  // Re-init on sheet change
  const observer = new MutationObserver(() => {
    setTimeout(initSearch, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
