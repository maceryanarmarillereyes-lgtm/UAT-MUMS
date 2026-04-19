(function () {
  // services-grid.js — v4 (DOM-safe render, context menu, auto-resize, getState)
  // FIX-5: Realtime deltas in-memory
  // FIX-6: 800ms save debounce
  // NEW-1: saveAllRows()
  // NEW-2: setStatus()
  // NEW-3: svcToast.pulse()
  // NEW-4: getState()
  // NEW-5: Right-click context menu on column headers
  // NEW-6: autoResizeColumns()

  var grid        = document.getElementById('svcGrid');
  var empty       = document.getElementById('svcEmptyState');
  var addRowBtn   = document.getElementById('svcAddRow');
  var addColBtn   = document.getElementById('svcAddCol');
  var exportBtn   = document.getElementById('svcExportCsv');
  var undoBtn     = document.getElementById('svcUndo');
  var redoBtn     = document.getElementById('svcRedo');
  var saveBtn     = document.getElementById('svcSaveBtn');
  var statusCells = document.getElementById('svcStatusCells');
  var statusSaved = document.getElementById('svcStatusSaved');

  var SAVE_DEBOUNCE_MS = 800;

  var current      = null;
  var subscription = null;
  var saveTimers   = new Map();
  var undoStack    = [];
  var redoStack    = [];

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

  // ── RENDER — pure DOM construction (no innerHTML for structure) ─────────────
  function render() {
    if (!current) { clear(); return; }
    empty.style.display = 'none';
    grid.hidden = false;

    var cols      = current.sheet.column_defs || [];
    var totalRows = Math.max(current.rows.length + 2, 10);

    // Build table using DOM API so no HTML escaping issues
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');

    // Row-number corner cell
    var thNum = document.createElement('th');
    thNum.className = 'row-num';
    thNum.textContent = '#';
    headRow.appendChild(thNum);

    cols.forEach(function (c) {
      var th = document.createElement('th');
      th.contentEditable = 'true';
      th.dataset.key = c.key;
      th.textContent = c.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < totalRows; i++) {
      var rowData = current.rows.find(function (r) { return r.row_index === i; }) || { data: {} };
      var tr = document.createElement('tr');

      var tdNum = document.createElement('td');
      tdNum.className = 'row-num';
      tdNum.textContent = (i + 1).toString();
      tr.appendChild(tdNum);

      cols.forEach(function (c) {
        var td = document.createElement('td');
        var inp = document.createElement('input');
        inp.className = 'cell';
        inp.dataset.row = i;
        inp.dataset.key = c.key;
        inp.value = (rowData.data[c.key] != null ? rowData.data[c.key] : '').toString();
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        td.appendChild(inp);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }

    // Clear and rebuild
    grid.innerHTML = '';
    grid.appendChild(thead);
    grid.appendChild(tbody);

    attachCellHandlers();
    attachHeaderHandlers();
    attachHeaderContextMenu();
    updateStatusBar();
    autoResizeColumns();
  }

  function attachCellHandlers() {
    grid.querySelectorAll('input.cell').forEach(function (inp) {
      inp.addEventListener('input', onCellInput);
      inp.addEventListener('keydown', onCellKey);
    });
  }

  function attachHeaderHandlers() {
    grid.querySelectorAll('thead th[data-key]').forEach(function (th) {
      th.addEventListener('blur', async function () {
        var key      = th.dataset.key;
        var newLabel = th.innerText.trim();
        var col      = current.sheet.column_defs.find(function (c) { return c.key === key; });
        if (!col || col.label === newLabel) return;
        col.label = newLabel;
        await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
      });
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); th.blur(); }
      });
    });
  }

  // ── NEW-5: Right-click context menu ─────────────────────────────────────────
  function attachHeaderContextMenu() {
    document.querySelectorAll('.svc-col-ctx-menu').forEach(function (m) { m.remove(); });

    grid.querySelectorAll('thead th[data-key]').forEach(function (th) {
      th.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        document.querySelectorAll('.svc-col-ctx-menu').forEach(function (m) { m.remove(); });

        var key    = th.dataset.key;
        var cols   = current.sheet.column_defs;
        var colIdx = cols.findIndex(function (c) { return c.key === key; });
        if (colIdx < 0) return;

        var menu = document.createElement('div');
        menu.className = 'svc-col-ctx-menu';

        function makeItem(icon, label, action, sub) {
          var item = document.createElement('div');
          item.className = 'ctx-item';
          if (action) item.dataset.action = action;
          item.innerHTML = '<span class="ctx-icon">' + icon + '</span><span class="ctx-label">' + label + '</span>';
          if (sub) {
            var arrow = document.createElement('span');
            arrow.className = 'ctx-arrow';
            arrow.textContent = '▶';
            item.appendChild(arrow);
            item.appendChild(sub);
          }
          return item;
        }

        function makeSub(items) {
          var sub = document.createElement('div');
          sub.className = 'ctx-sub';
          items.forEach(function (i) { sub.appendChild(i); });
          return sub;
        }

        function makeSep() {
          var s = document.createElement('div');
          s.className = 'ctx-separator';
          return s;
        }

        // Move sub
        var moveSub = makeSub([
          makeItem('⬅', 'To Left',  colIdx > 0               ? 'move-left'  : null),
          makeItem('➡', 'To Right', colIdx < cols.length - 1 ? 'move-right' : null)
        ]);

        // Quickbase sub
        var qbSub = makeSub([makeItem('📋', 'Select Quickbase Field', 'select-qb-field')]);
        var setProgramSub = makeSub([
          makeItem('🔗', 'Lookup to Global Quickbase', null, qbSub),
          makeItem('🎨', 'Conditional Formatting', 'conditional-format')
        ]);

        menu.appendChild(makeItem('✏️', 'Rename Column', 'rename'));
        menu.appendChild(makeSep());
        menu.appendChild(makeItem('⚙️', 'Set Program', null, setProgramSub));
        menu.appendChild(makeSep());
        menu.appendChild(makeItem('↔️', 'Move Column', null, moveSub));

        menu.style.left = e.clientX + 'px';
        menu.style.top  = e.clientY + 'px';
        document.body.appendChild(menu);

        // Viewport clamp
        var rect = menu.getBoundingClientRect();
        if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 8) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 8) + 'px';

        menu.addEventListener('click', async function (ev) {
          var item = ev.target.closest('[data-action]');
          if (!item) return;
          var action = item.dataset.action;

          if (action === 'rename') {
            var newName = prompt('Rename column:', cols[colIdx].label);
            if (newName && newName.trim()) {
              cols[colIdx].label = newName.trim();
              await window.servicesDB.updateColumns(current.sheet.id, cols);
              render();
            }
          } else if (action === 'move-left' && colIdx > 0) {
            var tmp = cols[colIdx]; cols[colIdx] = cols[colIdx - 1]; cols[colIdx - 1] = tmp;
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
          } else if (action === 'move-right' && colIdx < cols.length - 1) {
            var tmp2 = cols[colIdx]; cols[colIdx] = cols[colIdx + 1]; cols[colIdx + 1] = tmp2;
            await window.servicesDB.updateColumns(current.sheet.id, cols);
            render();
          } else if (action === 'select-qb-field') {
            window.svcQuickbaseFieldPicker
              ? window.svcQuickbaseFieldPicker.open(key)
              : window.svcToast && window.svcToast.show('info', 'Quickbase', 'Field picker coming soon.');
          } else if (action === 'conditional-format') {
            window.svcToast && window.svcToast.show('info', 'Formatting', 'Conditional formatting coming soon.');
          }
          menu.remove();
        });

        function closeMenu(ev2) {
          if (!menu.contains(ev2.target)) {
            menu.remove();
            document.removeEventListener('mousedown', closeMenu);
          }
        }
        setTimeout(function () { document.addEventListener('mousedown', closeMenu); }, 0);
      });
    });
  }

  // ── NEW-6: Auto-resize columns ───────────────────────────────────────────────
  function autoResizeColumns() {
    if (!current) return;
    var cols = current.sheet.column_defs || [];
    var measurer = document.createElement('span');
    measurer.style.cssText = 'visibility:hidden;position:absolute;white-space:nowrap;top:-9999px;left:-9999px;';
    document.body.appendChild(measurer);

    cols.forEach(function (c) {
      var maxW = 80;

      var th = grid.querySelector('thead th[data-key="' + c.key + '"]');
      if (th) {
        measurer.style.font = '600 11px/1 Inter,system-ui,sans-serif';
        measurer.style.letterSpacing = '0.05em';
        measurer.style.textTransform = 'uppercase';
        measurer.textContent = c.label;
        maxW = Math.max(maxW, measurer.offsetWidth + 32);
      }

      grid.querySelectorAll('input.cell[data-key="' + c.key + '"]').forEach(function (inp) {
        if (!inp.value) return;
        measurer.style.font = '13px/1 "JetBrains Mono","Fira Code",Consolas,monospace';
        measurer.style.letterSpacing = '';
        measurer.style.textTransform = '';
        measurer.textContent = inp.value;
        maxW = Math.max(maxW, measurer.offsetWidth + 32);
      });

      var finalW = Math.min(500, maxW);
      if (th) { th.style.width = finalW + 'px'; th.style.minWidth = finalW + 'px'; }
      grid.querySelectorAll('td input.cell[data-key="' + c.key + '"]').forEach(function (inp) {
        inp.parentElement.style.width = finalW + 'px';
        inp.parentElement.style.minWidth = finalW + 'px';
      });
    });

    measurer.remove();
  }

  function onCellInput(e) {
    var rowIdx = +e.target.dataset.row;
    var key    = e.target.dataset.key;
    var value  = e.target.value;
    var rowObj = current.rows.find(function (r) { return r.row_index === rowIdx; });
    if (!rowObj) { rowObj = { row_index: rowIdx, data: {} }; current.rows.push(rowObj); }
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
    current.sheet.column_defs.push({ key: key, label: label.trim(), type: 'text', width: 160 });
    await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
    render();
  });

  exportBtn.addEventListener('click', function () {
    if (!current) return;
    var cols   = current.sheet.column_defs;
    var header = cols.map(function (c) { return JSON.stringify(c.label); }).join(',');
    var lines  = current.rows
      .sort(function (a, b) { return a.row_index - b.row_index; })
      .map(function (r) {
        return cols.map(function (c) {
          return JSON.stringify(r.data[c.key] != null ? r.data[c.key] : '');
        }).join(',');
      });
    var blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
    var a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: current.sheet.title + '.csv'
    });
    document.body.appendChild(a); a.click(); a.remove();
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

  function eh(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // NEW-1: Manual SAVE
  async function saveAllRows() {
    if (!current) {
      window.svcToast && window.svcToast.show('warning', 'No Sheet Open', 'Open a sheet before saving.');
      return;
    }
    var nonEmpty = current.rows.filter(function (r) {
      return r.data && Object.values(r.data).some(function (v) { return v !== '' && v != null; });
    });
    if (nonEmpty.length === 0) {
      window.svcToast && window.svcToast.show('info', 'Nothing to Save', 'Sheet has no data yet.');
      return;
    }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
    setStatus('saving', 'Saving all…');
    try {
      var result = await window.servicesDB.bulkUpsertRows(
        current.sheet.id,
        nonEmpty.map(function (r) { return { row_index: r.row_index, data: r.data }; })
      );
      if (result && result.error) throw new Error(result.error.message || 'Write failed');
      setStatus('saved', '✓ All saved');
      window.svcToast && window.svcToast.show('success', 'Saved', nonEmpty.length + ' rows saved to Supabase.');
      window.servicesDashboard && window.servicesDashboard.update(current);
    } catch (err) {
      setStatus('error', '✕ Save failed');
      window.svcToast && window.svcToast.show('error', 'Save Failed', err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 SAVE'; }
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', saveAllRows);

  // NEW-4: getState
  function getState() { return current; }

  window.servicesGrid = { load, clear, render, getState, saveAllRows };
})();
