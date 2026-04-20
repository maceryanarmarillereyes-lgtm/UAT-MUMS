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
  var qbUpdateBtn = document.getElementById('svcQbUpdateBtn');
  var statusCells = document.getElementById('svcStatusCells');
  var statusSaved = document.getElementById('svcStatusSaved');
  var SAVE_DEBOUNCE_MS = 800;
  var current      = null;
  var subscription = null;
  var saveTimers   = new Map();
  var undoStack    = [];
  var redoStack    = [];
  var _columnRepairPromise = null;

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

  function clear() {
    current = null;
    if (subscription) { try { subscription.unsubscribe(); } catch (_) {} subscription = null; }
    grid.hidden = true;
    empty.style.display = '';
    window.servicesDashboard && window.servicesDashboard.reset();
  }

  async function load(sheet) {
    if (subscription) { try { subscription.unsubscribe(); } catch (_) {} subscription = null; }
    current   = { sheet: JSON.parse(JSON.stringify(sheet)), rows: [] };
    var colNorm = normalizeColumnDefs(current.sheet.column_defs);
    current.sheet.column_defs = colNorm.normalized;
    // One-time self-heal: persist sanitized labels so future loads stay clean
    if (colNorm.changed && !_columnRepairPromise) {
      _columnRepairPromise = window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs)
        .catch(function (err) { console.error('[services-grid] updateColumns repair failed:', err); })
        .finally(function () { _columnRepairPromise = null; });
    }
    undoStack = [];
    redoStack = [];
    current.rows = await window.servicesDB.listRows(sheet.id);
    render();
    window.servicesDashboard && window.servicesDashboard.update(current);
    subscription = window.servicesDB.subscribeToSheet(sheet.id, function (payload) {
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
      if (inp && document.activeElement !== inp)
        inp.value = (row.data[c.key] != null ? row.data[c.key] : '').toString();
    });
  }

  function mkEl(tag, props, parent) {
    var el = document.createElement(tag);
    if (props) Object.assign(el, props);
    if (parent) parent.appendChild(el);
    return el;
  }

  function render() {
    if (!current) { clear(); return; }
    empty.style.display = 'none';
    grid.hidden = false;
    var cols      = current.sheet.column_defs || [];
    var isFilteredView = Array.isArray(current.__treeFilteredRows);
    var viewRows = isFilteredView
      ? current.__treeFilteredRows.slice().sort(function (a, b) { return a.row_index - b.row_index; })
      : current.rows;
    var totalRows = isFilteredView ? Math.max(viewRows.length, 1) : Math.max(current.rows.length + 2, 10);

    var thead   = mkEl('thead');
    var headTr  = mkEl('tr', null, thead);
    var thCorner = mkEl('th', { className: 'row-num', textContent: '#' }, headTr);
    cols.forEach(function (c) {
      var th = mkEl('th', { textContent: sanitizeHeaderLabel(c.label, 0) }, headTr);
      th.dataset.key = c.key;
      th.tabIndex = 0;
      th.title = 'Right-click to rename column';
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
      var rowData = isFilteredView
        ? (viewRows[i] || { row_index: i, data: {} })
        : (current.rows.find(function (r) { return r.row_index === i; }) || { row_index: i, data: {} });
      var rowIndex = Number.isFinite(rowData.row_index) ? rowData.row_index : i;
      var tr = mkEl('tr', null, tbody);
      var rowNumTd = mkEl('td', { className: 'row-num', textContent: String(rowIndex + 1) }, tr);
      rowNumTd.dataset.rowIndex = rowIndex;
      rowNumTd.title = 'Click to view case details · Right-click to delete row';
      cols.forEach(function (c) {
        var td  = mkEl('td', null, tr);
        var inputType = (c.format === 'date') ? 'date' : 'text';
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
          value        : (rowData.data[c.key] != null ? rowData.data[c.key] : '').toString()
        }, td);
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
        if (c.format === 'number') inp.inputMode = 'numeric';
      });
    }

    grid.innerHTML = '';
    grid.appendChild(thead);
    grid.appendChild(tbody);

    attachCellHandlers();
    attachHeaderContextMenu();
    attachRowContextMenu();
    updateStatusBar();
    autoResizeColumns();
    if (window.servicesTreeview && typeof window.servicesTreeview.refreshCounts === 'function') {
      window.servicesTreeview.refreshCounts(current.sheet.id);
    }

    // QB auto-populate: paint linked column values from QB data (read-only)
    if (window.svcQbLookup) {
      window.svcQbLookup.autofillLinkedColumns(current, grid);
    }

    // ── Scroll-triggered re-autofill ─────────────────────────────────────────
    // When user scrolls down, newly visible rows get their QB data painted.
    (function attachScrollRepaint() {
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

          if (action === 'move-left' && colIdx > 0) {
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
            alert('Conditional Formatting — coming soon.');
            closeAllCtxMenus();
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
            window.svcToast && window.svcToast.show('success', 'Data Validation', opts.length ? ('Dropdown set (' + opts.length + ' options).') : 'Dropdown removed.');
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
              window.svcToast && window.svcToast.show('error', 'Delete Failed', err.message);
            }
            render();
            window.svcToast && window.svcToast.show('success', 'Column Deleted', '"' + colName + '" removed.');
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

      // Reset & show modal in loading state immediately
      _set('svcQbcdRowBadge', caseNum || String(rowIndex + 1));
      _set('svcQbcdCaseId',   caseNum || '—');
      _set('svcQbcdDesc',     '');
      _html('svcQbcdStatusBadge', '');
      _set('svcQbcdMeta', '');
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

      window.svcQbLookup.lookupCase(caseNum).then(function (rec) {
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
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(function () {
            copyBtn.textContent = 'Copied!';
            setTimeout(function () { copyBtn.textContent = 'Copy Case #'; }, 1800);
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
              window.svcToast && window.svcToast.show('error', 'Delete Failed', err.message || 'Could not delete row.');
              // Keep local update to avoid UX freeze; realtime/db sync will reconcile.
            }
          } else {
            // Empty/virtual row — no DB record, local render only
          }

          render();
          window.servicesDashboard && window.servicesDashboard.update(current);
          window.svcToast && window.svcToast.show('success', 'Row Deleted', 'Row ' + displayNum + ' removed.');
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

  function autoResizeColumns() {
    if (!current) return;
    var cols = current.sheet.column_defs || [];
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
      var w = Math.min(500, maxW) + 'px';
      if (th) { th.style.width = w; th.style.minWidth = w; }
      grid.querySelectorAll('td input.cell[data-key="' + c.key + '"]').forEach(function (inp) {
        inp.parentElement.style.width = w; inp.parentElement.style.minWidth = w;
      });
    });
    m.remove();
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
        window.svcToast && window.svcToast.show('warning', 'Invalid Value', 'Please select from the dropdown list.');
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
    undoStack.push({ rowIdx: rowIdx, key: key, prev: rowObj.data[key] != null ? rowObj.data[key] : '', next: value });
    redoStack = [];
    rowObj.data[key] = value;
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
    var cols = current.sheet.column_defs.map(function (c) { return c.key; });
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
    current.sheet.column_defs.push({ key: key, label: sanitizeHeaderLabel(label, current.sheet.column_defs.length), type: 'text', width: 160 });
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
      window.svcToast && window.svcToast.show('error', 'Export Failed', err && err.message ? err.message : 'Try again.');
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
    if (!current) { window.svcToast && window.svcToast.show('warning', 'No Sheet Open', 'Open a sheet first.'); return; }
    var nonEmpty = current.rows.filter(function (r) {
      return r.data && Object.values(r.data).some(function (v) { return v !== '' && v != null; });
    });
    if (nonEmpty.length === 0) { window.svcToast && window.svcToast.show('info', 'Nothing to Save', 'No data yet.'); return; }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
    setStatus('saving', 'Saving all…');
    try {
      var result = await window.servicesDB.bulkUpsertRows(current.sheet.id,
        nonEmpty.map(function (r) { return { row_index: r.row_index, data: r.data }; }));
      if (result && result.error) throw new Error(result.error.message || 'Write failed');
      setStatus('saved', '✓ All saved');
      window.svcToast && window.svcToast.show('success', 'Saved', nonEmpty.length + ' rows saved.');
      window.servicesDashboard && window.servicesDashboard.update(current);
    } catch (err) {
      setStatus('error', '✕ Save failed');
      window.svcToast && window.svcToast.show('error', 'Save Failed', err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 SAVE'; }
    }
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
        if (v == null || String(v).trim() === '' || String(v).trim() === '—') unresolved++;
      });
    });
    return unresolved;
  }

  if (saveBtn) saveBtn.addEventListener('click', saveAllRows);

  if (qbUpdateBtn) {
    qbUpdateBtn.addEventListener('click', async function () {
      if (!current || !window.svcQbLookup) return;
      var targetSheetId = current.sheet && current.sheet.id;
      qbUpdateBtn.disabled = true;
      var originalText = qbUpdateBtn.textContent;
      qbUpdateBtn.textContent = '⏳ Updating…';
      setStatus('saving', 'Updating lookup…');
      try {
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
        setStatus('saved', '✓ Lookup updated');
        window.svcToast && window.svcToast.show('success', 'Lookup Updated', 'All linked QB values refreshed.');
      } catch (err) {
        setStatus('error', '✕ Lookup update failed');
        window.svcToast && window.svcToast.show('error', 'Lookup Update Failed', err && err.message ? err.message : 'Try again.');
      } finally {
        qbUpdateBtn.disabled = false;
        qbUpdateBtn.textContent = originalText;
      }
    });
  }

  // ── TreeView filter hook ─────────────────────────────────────────────────────
  // setTreeFilter(fn) — fn receives a row object {row_index, data}, returns bool.
  // Pass null to remove filter (show all rows).
  var _treeFilter = null;
  function setTreeFilter(fn) {
    _treeFilter = fn || null;
    render();
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

  function getState() { return current; }
  window.servicesGrid = { load: load, clear: clear, render: render, getState: getState, saveAllRows: saveAllRows, setTreeFilter: setTreeFilter };
})();
