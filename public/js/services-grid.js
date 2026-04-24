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
  var _columnFilters = {}; // per-column filter values
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

    init: function (rows, key, forceRebuild) {
      var now = Date.now();
      // Allow forced rebuild (e.g. after +Row or render()) — skip throttle guard
      if (!forceRebuild && this.index && this.caseKey === key && (now - this.lastBuild < 5000)) return;

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
      if (!str || str.length < 3) return null;
      var set = this.index.get(str);
      if (!set || !set.size) return null;
      // Coerce to Number — dataset attributes are strings; strict !== would false-positive
      var numIdx = Number(currentIdx);
      var dupRows = [];
      set.forEach(function (idx) {
        if (idx !== numIdx) dupRows.push(idx);
      });
      return dupRows.length ? dupRows.sort(function (a, b) { return a - b; }) : null;
    },

    add: function (val, idx) {
      if (!this.index || !val) return;
      var str = String(val).trim();
      if (!str || str.length < 3) return;
      if (!this.index.has(str)) this.index.set(str, new Set());
      this.index.get(str).add(Number(idx));
    },

    remove: function (val, idx) {
      if (!this.index || !val) return;
      var str = String(val).trim();
      var set = this.index.get(str);
      if (!set) return;
      set.delete(Number(idx));
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
      var duplicates = DuplicateDetector.check(caseVal, Number(rowIdx));
      if (duplicates && duplicates.length) applyDuplicateStyles(input, caseVal, duplicates);
    }, 300);
  }

  function getCaseColumnDef() {
    if (!current || !current.sheet || !Array.isArray(current.sheet.column_defs)) return null;
    return current.sheet.column_defs.find(function (c) {
      return c && c.key && c.label && String(c.label).toUpperCase().includes('CASE');
    }) || null;
  }

  // ── DUP TOOLTIP ──────────────────────────────────────────────────────────────
  // Shows a hover tooltip on the red-highlighted cell. No floating bubble.
  // One singleton tooltip element reused across all cells.
  var _dupTooltipEl = null;
  var _dupTooltipTimer = null;

  function getDupTooltip() {
    if (!_dupTooltipEl) {
      _dupTooltipEl = document.createElement('div');
      _dupTooltipEl.id = 'svc-dup-tooltip';
      _dupTooltipEl.style.cssText = [
        'position:fixed',
        'z-index:99999',
        'background:#1e293b',
        'border:1px solid #ef4444',
        'border-radius:7px',
        'padding:7px 12px',
        'font-size:12px',
        'color:#f1f5f9',
        'box-shadow:0 4px 18px rgba(0,0,0,0.5)',
        'pointer-events:none',
        'display:none',
        'max-width:260px',
        'line-height:1.5',
        'white-space:nowrap'
      ].join(';');
      document.body.appendChild(_dupTooltipEl);
    }
    return _dupTooltipEl;
  }

  function showDupTooltip(inp, caseNum, dupRows) {
    var tt = getDupTooltip();
    tt.innerHTML =
      '<span style="color:#f87171;font-weight:700;">⚠ Duplicate CASE#</span><br>' +
      '<span style="color:#94a3b8;">Also in row</span> ' +
      '<b style="color:#fbbf24;">' + dupRows.map(function (r) { return r + 1; }).join(', ') + '</b>';
    tt.style.display = 'block';

    // Position relative to the input
    var rect = inp.getBoundingClientRect();
    var ttLeft = Math.min(rect.left, window.innerWidth - 270);
    var ttTop  = rect.bottom + 5;
    if (ttTop + 70 > window.innerHeight) ttTop = rect.top - 58;
    tt.style.left = ttLeft + 'px';
    tt.style.top  = ttTop  + 'px';
  }

  function hideDupTooltip() {
    clearTimeout(_dupTooltipTimer);
    var tt = getDupTooltip();
    tt.style.display = 'none';
  }

  function applyDuplicateStyles(inputEl, caseNum, duplicateRows) {
    inputEl.classList.add('cell-has-duplicate');
    inputEl.setAttribute('data-dup-case', String(caseNum));
    inputEl.setAttribute('data-dup-rows', duplicateRows.join(','));
    inputEl._dupCaseNum  = caseNum;
    inputEl._dupRowsList = duplicateRows;
  }

  function clearDuplicateStyles(inputEl) {
    inputEl.classList.remove('cell-has-duplicate');
    inputEl.removeAttribute('data-dup-case');
    inputEl.removeAttribute('data-dup-rows');
    delete inputEl._dupCaseNum;
    delete inputEl._dupRowsList;
    // Remove any legacy bubble reference
    if (inputEl._dupBubble) {
      try { inputEl._dupBubble.remove(); } catch (_) {}
      inputEl._dupBubble = null;
    }
    hideDupTooltip();
  }

  // Tooltip delegation on the grid wrapper (survives render() innerHTML replacements
  // because the wrapper div itself is never replaced, only its children are).
  (function attachDupTooltipDelegation() {
    var wrapper = document.getElementById('svcGridWrap') || document.getElementById('svcGridWrapper') || grid.parentElement;
    var target  = wrapper || document.body;

    target.addEventListener('mouseover', function (e) {
      var inp = e.target.closest ? e.target.closest('input.cell-has-duplicate') : null;
      if (!inp) { hideDupTooltip(); return; }
      var caseNum  = inp._dupCaseNum  || inp.getAttribute('data-dup-case') || '';
      var rowsList = inp._dupRowsList ||
        (inp.getAttribute('data-dup-rows') || '').split(',').map(Number).filter(function (n) { return !isNaN(n); });
      if (caseNum && rowsList.length) showDupTooltip(inp, caseNum, rowsList);
    });

    target.addEventListener('mouseout', function (e) {
      var related = e.relatedTarget;
      if (related && related.id === 'svc-dup-tooltip') return;
      if (related && related.closest && related.closest('#svc-dup-tooltip')) return;
      if (related && related.classList && related.classList.contains('cell-has-duplicate')) return;
      hideDupTooltip();
    });
  }());

  // ── Legacy showDuplicateBubble — replaced by tooltip, kept as no-op guard ──
  function showDuplicateBubble(inputEl, caseNum, duplicateRows) {
    // Replaced by hover tooltip. Apply styles only.
    applyDuplicateStyles(inputEl, caseNum, duplicateRows);
  }

  function refreshDuplicateIndicators() {
    var caseCol = getCaseColumnDef();
    if (!caseCol) return;
    grid.querySelectorAll('input.cell[data-key="' + caseCol.key + '"]').forEach(function (inp) {
      // CRITICAL: parse as Number — dataset.row is a string, check() uses !==
      // "520" !== 520 → every row falsely flagged as its own duplicate
      var rowIdx = Number(inp.dataset.row);
      var val = String(inp.value || '').trim();
      if (!val || val.length < 3) {
        clearDuplicateStyles(inp);
        return;
      }
      var duplicates = DuplicateDetector.check(val, rowIdx);
      if (duplicates && duplicates.length) {
        applyDuplicateStyles(inp, val, duplicates);
      } else {
        clearDuplicateStyles(inp);
      }
    });
  }

  function refreshDuplicateIndicatorsDebounced() {
    clearTimeout(dupPaintTimer);
    dupPaintTimer = setTimeout(refreshDuplicateIndicators, 120);
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

    // ── Row-num column: dynamic width based on max row number digits ─────────────
    // ISOLATED from user column resizes: never touched by _applyColumnWidths(),
    // resize handles, or table-layout:auto reflows. Width locks via colgroup +
    // inline styles on th/td (inline styles in fixed layout beat everything).
    var _totalRows = current.rows.length || 0;
    var _rnDigits  = String(Math.max(_totalRows, 1)).length;
    var _rnWidth   = Math.max(44, _rnDigits * 9 + 28);
    current.__rowNumWidth = _rnWidth; // cache for _applyColumnWidths

    var colgroup = mkEl('colgroup');
    var rowNumCol = document.createElement('col');
    rowNumCol.setAttribute('data-key', '__rownum__');
    rowNumCol.style.cssText = 'width:' + _rnWidth + 'px;min-width:' + _rnWidth + 'px;max-width:' + _rnWidth + 'px;';
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
    var thCorner = mkEl('th', { className: 'row-num row-header', textContent: '#' }, headTr);
    // Lock row-num header width via inline style so no resize/reflow can override it
    thCorner.style.cssText = 'width:' + _rnWidth + 'px;min-width:' + _rnWidth + 'px;max-width:' + _rnWidth + 'px;';
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

    // ===== ADD FILTER ROW (Excel-style) =====
    var filterTr = mkEl('tr', { className: 'filter-row' }, thead);
    filterTr.style.cssText = 'background:#0f172a;border-bottom:1px solid #1e293b;';

    // Filter cell for row number
    var filterCorner = mkEl('th', { className: 'row-num' }, filterTr);
    filterCorner.style.cssText = 'width:' + _rnWidth + 'px;min-width:' + _rnWidth + 'px;max-width:' + _rnWidth + 'px;';
    filterCorner.innerHTML = '<div style="text-align:center;color:#475569;font-size:9px;padding:2px;">▼</div>';
    filterCorner.style.cssText = 'background:#0f172a;padding:2px;position:sticky;top:32px;z-index:4;';

    // Filter cells for each column
    cols.forEach(function (c) {
      var filterTh = mkEl('th', null, filterTr);
      filterTh.dataset.key = c.key;
      if (_columnFilters[c.key]) filterTh.classList.add('has-filter');
      filterTh.style.cssText = 'padding:2px 3px;background:#0f172a;position:sticky;top:32px;z-index:4;';

      if (!c.hidden) {
        var filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.placeholder = 'Filter...';
        filterInput.className = 'col-filter-input';
        filterInput.dataset.columnKey = c.key;
        filterInput.value = _columnFilters[c.key] || '';

        filterInput.style.cssText = 'width:100%;height:20px;padding:0 4px;background:#020617;border:1px solid #334155;border-radius:3px;color:#cbd5e1;font-size:11px;outline:none;';

        // Prevent render loop - use filter switch flag
        filterInput.addEventListener('input', function (e) {
          e.stopPropagation();
          var key = this.dataset.columnKey;
          var val = this.value.trim().toLowerCase();

          if (val) {
            _columnFilters[key] = val;
          } else {
            delete _columnFilters[key];
          }

          // Trigger filtered render (uses _renderIsFilterSwitch)
          _renderIsFilterSwitch = true;
          try {
            render();
          } finally {
            _renderIsFilterSwitch = false;
          }

          // Restore focus after render
          setTimeout(function () {
            var newInput = document.querySelector('.col-filter-input[data-column-key="' + key + '"]');
            if (newInput) {
              newInput.focus();
              newInput.setSelectionRange(newInput.value.length, newInput.value.length);
            }
          }, 0);
        });

        filterInput.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        filterInput.addEventListener('click', function (e) { e.stopPropagation(); });

        filterTh.appendChild(filterInput);
      }

      if (c.hidden) filterTh.style.display = 'none';
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
        // BUG1 FIX: Display sequential position (i+1) not row_index+1.
        // row_index is the DB storage key and can have gaps after deletes.
        // Showing row_index+1 causes doubled numbers when padding rows share
        // the same value as existing rows. i is always 0,1,2,3... sequential.
        textContent: String(i + 1),
        title: 'Row ' + (i + 1)
      }, tr);
      // Lock per-row width — isolated from all column resize operations
      rowNumTd.style.cssText = 'width:' + _rnWidth + 'px;min-width:' + _rnWidth + 'px;max-width:' + _rnWidth + 'px;';
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
        td.setAttribute('data-key', c.key); // enables _applyColumnWidths key-based targeting
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
          // Duplicate check fires on blur (onCellCommit registered in attachCellHandlers)
          // and on focus (re-show tooltip if already flagged).
          inp.addEventListener('focus', function () {
            var val = String(inp.value || '').trim();
            if (!val || val.length < 3) return;
            var duplicates = DuplicateDetector.check(val, Number(inp.dataset.row));
            if (duplicates && duplicates.length) {
              applyDuplicateStyles(inp, val, duplicates);
              showDupTooltip(inp, val, duplicates);
            }
          });
          inp.addEventListener('blur', function () { hideDupTooltip(); });
        }

        // BUG2 FIX: Style '---' placeholder for date columns with no value
        if ((c.type === 'date' || c.format === 'date') && inp.value === '---') {
          inp.style.color = '#64748b';
          inp.style.textAlign = 'center';
        }
      });
    }

    grid.innerHTML = '';
    // ISOLATE FIX: Force fixed layout BEFORE appending children so browser
    // never runs table-layout:auto on any render cycle — row-num width is
    // determined solely by colgroup + inline styles, never by content reflow.
    grid.style.tableLayout = 'fixed';
    grid.appendChild(colgroup);
    grid.appendChild(thead);
    grid.appendChild(tbody);

    attachCellHandlers();
    attachHeaderContextMenu();
    attachRowContextMenu();
    updateStatusBar();

    // FIX-DUP-3: Always rebuild the DuplicateDetector after every render()
    // — covers +Row, filter switch, sort, resize, undo, restore.
    // Using forceRebuild=true bypasses the 5-second throttle guard so newly
    // added rows (row_index not yet in index) are registered immediately.
    var caseColAfterRender = getCaseColumnDef();
    if (caseColAfterRender && current && current.rows.length > 0) {
      DuplicateDetector.init(current.rows, caseColAfterRender.key, true);
    }

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
      // FIX-DUP-2: Commit final value to DuplicateDetector index on blur
      inp.addEventListener('blur', onCellCommit);
    });
  }

  function attachHeaderContextMenu() {
    document.querySelectorAll('.svc-col-ctx-menu').forEach(function (m) { m.remove(); });

    grid.querySelectorAll('thead th[data-key]').forEach(function (th) {
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

    // ── Re-lock row-num column first (idx=0) — never allow data col widths to bleed ──
    var rnWidth = (current.__rowNumWidth || 44) + 'px';
    var rnColEl = grid.querySelector('colgroup col[data-key="__rownum__"]');
    if (rnColEl) rnColEl.style.cssText = 'width:' + rnWidth + ';min-width:' + rnWidth + ';max-width:' + rnWidth + ';';
    grid.querySelectorAll('thead th.row-num').forEach(function (th) {
      th.style.width = rnWidth; th.style.minWidth = rnWidth; th.style.maxWidth = rnWidth;
    });
    grid.querySelectorAll('tbody td.row-num').forEach(function (td) {
      td.style.width = rnWidth; td.style.minWidth = rnWidth; td.style.maxWidth = rnWidth;
    });

    // ── Apply widths to DATA columns only (idx >= 1) ─────────────────────────────
    var headers = grid.querySelectorAll('thead th[data-key]'); // only th with data-key = real cols
    headers.forEach(function (th) {
      var colKey = th.dataset.key;
      if (!colKey) return;
      var col = (current.sheet.column_defs || []).find(function (c) { return c.key === colKey; });
      if (!col || !col.width) return;
      var w = col.width;
      th.style.width = w; th.style.minWidth = w; th.style.maxWidth = w;
      // Update colgroup col element
      var colEl = grid.querySelector('colgroup col[data-key="' + colKey + '"]');
      if (colEl) colEl.style.width = w;
      // Update all td cells in this column
      var tds = grid.querySelectorAll('tbody tr td[data-key="' + colKey + '"]');
      if (tds.length) {
        tds.forEach(function (td) { td.style.width = w; td.style.minWidth = w; td.style.maxWidth = w; });
      } else {
        // Fallback: nth-child (only for non-row-num columns)
        var colIdx = Array.from(grid.querySelectorAll('thead th')).indexOf(th);
        if (colIdx > 0) {
          grid.querySelectorAll('tbody tr td:nth-child(' + (colIdx + 1) + ')').forEach(function (td) {
            if (!td.classList.contains('row-num')) {
              td.style.width = w; td.style.minWidth = w; td.style.maxWidth = w;
            }
          });
        }
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
      // FIX-DUP-1: Remove the previous committed value from index.
      // Do NOT add the new (possibly still-typing) value here — partial keystrokes
      // like "1", "10", "103" would pollute the index. The add() happens on blur
      // (via onCellCommit) AFTER the user has finished typing the full case number.
      var prevStr = String(prevValue || '').trim();
      if (prevStr.length >= 3) {
        DuplicateDetector.remove(prevStr, rowIdx);
      }
      // Trigger duplicate check on the live value so the warning bubble appears
      // as the user types — but without corrupting the index with partial values.
      refreshDuplicateIndicatorsDebounced();
    }

    // ── FIX: Clear linked QB columns when CASE# is wiped ─────────────────────
    // When the user clears the CASE# cell, stale QB values (STATUS, TRACKING…)
    // must be erased from row.data immediately — otherwise they persist in
    // Supabase and reappear on every page reload even without a case number.
    var caseColDef = getCaseColumnDef();
    if (caseColDef && key === caseColDef.key && !String(value || '').trim()) {
      var linkedColDefs = (current.sheet.column_defs || []).filter(function (c) {
        return c && c.qbLookup && String(c.qbLookup.fieldId || '').trim();
      });
      linkedColDefs.forEach(function (lc) {
        // Clear from row.data
        rowObj.data[lc.key] = '';
        // Clear from DOM input if visible
        var linkedInp = grid.querySelector(
          'input.cell[data-row="' + rowIdx + '"][data-key="' + lc.key + '"]'
        );
        if (linkedInp) {
          linkedInp.value       = '';
          linkedInp.readOnly    = false;
          linkedInp.placeholder = '';
          linkedInp.title       = '';
          linkedInp.classList.remove('cell-qb-linked', 'cell-qb-pending', 'cell-qb-not-found');
        }
      });
    }
    // ── END FIX ───────────────────────────────────────────────────────────────
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

  // FIX-DUP-2: Commit final case# to the DuplicateDetector index ONLY after the
  // user finishes typing (blur). This prevents partial keystrokes from polluting
  // the index. Always Number() rowIdx to match the Set storage type.
  function onCellCommit(e) {
    var key = e.target.dataset.key;
    if (!DuplicateDetector.index || DuplicateDetector.caseKey !== key) return;
    var rowIdx   = Number(e.target.dataset.row);
    var finalVal = String(e.target.value || '').trim();
    if (finalVal.length >= 3) {
      DuplicateDetector.add(finalVal, rowIdx);
      // Immediately check: is this a duplicate of another row?
      var dups = DuplicateDetector.check(finalVal, rowIdx);
      if (dups && dups.length) {
        applyDuplicateStyles(e.target, finalVal, dups);
      } else {
        clearDuplicateStyles(e.target);
      }
    } else {
      clearDuplicateStyles(e.target);
    }
    // Also refresh all other cells — the newly-committed value might make
    // another existing row a duplicate too.
    refreshDuplicateIndicatorsDebounced();
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
    // FIX-DUP-5: Use the max row_index across ALL rows (not just length) to avoid
    // collision when rows have been deleted or loaded out of order.
    var maxIdx = current.rows.reduce(function (m, r) { return Math.max(m, r.row_index); }, -1);
    var newRowIdx = maxIdx + 1;
    // Guard: if this index already exists (shouldn't happen, but defensive), increment
    while (current.rows.some(function (r) { return r.row_index === newRowIdx; })) {
      newRowIdx++;
    }
    current.rows.push({ row_index: newRowIdx, data: {} });
    render();
    // render() now calls DuplicateDetector.init(forceRebuild=true) at end — new row registered
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

    // FIX-DUP-4: Deduplicate current.rows by row_index before sending to Supabase.
    // If two entries share the same row_index (e.g. a phantom row from +Row that never
    // got a unique index), PostgreSQL's ON CONFLICT fires twice on the same row →
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    // Strategy: last-writer-wins (keep the last occurrence in the array).
    var rowMap = new Map();
    current.rows.forEach(function (r) { rowMap.set(r.row_index, r); });
    var dedupedRows = Array.from(rowMap.values());

    var nonEmpty = dedupedRows.filter(function (r) {
      return r.data && Object.values(r.data).some(function (v) { return v !== '' && v != null; });
    });
    if (nonEmpty.length === 0) { notify('info', 'Nothing to Save', 'No data yet.'); return; }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
    setStatus('saving', 'Saving all…');
    try {
      var result = await window.servicesDB.bulkUpsertRows(current.sheet.id,
        nonEmpty.map(function (r) { return { row_index: r.row_index, data: r.data }; }));
      if (result && result.error) throw new Error(result.error.message || 'Write failed');
      // Sync current.rows to the deduped set so future saves are clean
      current.rows = dedupedRows;
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

  // ── Toolbar all-columns search query (ported from mumsold1) ────────────────
  var _searchAllQuery = ''; // toolbar all-columns query

  // Patch render() to honour _treeFilter + _columnFilters + _searchAllQuery ────
  // We intercept current.rows at render time; original rows stay intact so that
  // swapping filters does NOT lose data.
  var _origRender = render;
  render = function renderFiltered() {
    if (!current) {
      _origRender();
      return;
    }

    // Compose all filters: tree + column + toolbar all-columns search
    var hasTreeFilter    = !!_treeFilter;
    var hasColumnFilters = Object.keys(_columnFilters).length > 0;
    var hasSearchAll     = !!_searchAllQuery;

    if (!hasTreeFilter && !hasColumnFilters && !hasSearchAll) {
      delete current.__treeFilteredRows;
      _origRender();
      return;
    }

    // Apply all filters
    current.__treeFilteredRows = (current.rows || []).filter(function (row) {
      // 1. Tree filter — bypassed while all-columns search is active
      if (!hasSearchAll && hasTreeFilter && !_treeFilter(row)) return false;

      // 2. Column filters
      if (hasColumnFilters) {
        for (var key in _columnFilters) {
          var filterVal = _columnFilters[key];
          var cellVal = row.data && row.data[key] != null ? String(row.data[key]).toLowerCase() : '';
          if (cellVal.indexOf(filterVal) === -1) return false;
        }
      }

      // 3. Toolbar all-columns search (matches any cell in the row)
      if (hasSearchAll) {
        var rowData = row && row.data ? row.data : {};
        var hit = Object.keys(rowData).some(function (k) {
          return String(rowData[k] == null ? '' : rowData[k]).toLowerCase().indexOf(_searchAllQuery) !== -1;
        });
        if (!hit) return false;
      }

      return true;
    });

    _origRender();
  };

  // ── Toolbar Search All Columns — initSearchAll (ported from mumsold1) ───────
  // Wired to #searchAllColumns input in services.html.
  // Debounced 250ms; Escape clears; MutationObserver auto-clears on sheet switch.
  (function initSearchAll() {
    var input = document.getElementById('searchAllColumns');
    if (!input) return;
    var timer;
    var basePlaceholder = input.getAttribute('placeholder') || '🔍 Search all…';

    function doSearch() {
      _searchAllQuery = String(input.value || '').toLowerCase().trim();
      _renderIsFilterSwitch = true;
      try {
        render();
      } finally {
        _renderIsFilterSwitch = false;
      }
      input.placeholder = _searchAllQuery ? 'Searching all folders…' : basePlaceholder;
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(doSearch, 250);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        this.value = '';
        doSearch();
        this.blur();
      }
    });

    // Ctrl+F focuses the search input
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        var tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' && document.activeElement.id === 'searchAllColumns') return;
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    // Auto-clear when sheet switches (grid tbody emptied)
    var observer = new MutationObserver(function () {
      if (input.value && !document.querySelector('#svcGrid tbody tr')) {
        input.value        = '';
        _searchAllQuery    = '';
        input.placeholder  = basePlaceholder;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })();

  // Block leave navigation when unresolved duplicate CASE warnings exist
  window.addEventListener('beforeunload', function (e) {
    var dupCount = DuplicateDetector.duplicateRowCount();
    if (dupCount > 0) {
      e.preventDefault();
      e.returnValue = 'May ' + dupCount + ' duplicate CASE# na hindi pa naayos. Sigurado ka?';
    }
  });

  function getState() { return current; }

  window.servicesGrid = {
    load: load,
    clear: clear,
    render: render,
    getState: getState,
    saveAllRows: saveAllRows,
    setTreeFilter: setTreeFilter,
    saveColumnState: saveColumnState,
    toggleColumnVisibility: toggleColumnVisibility
  };
})();
