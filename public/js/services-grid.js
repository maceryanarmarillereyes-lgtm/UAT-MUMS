(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-grid.js  — v3 (+ SAVE button, toast, getState)
  //
  // ALL ORIGINAL FIXES PRESERVED:
  //   FIX-5: Realtime deltas in-memory — no listRows() on remote change
  //   FIX-6: 800ms save debounce
  // NEW in v3:
  //   NEW-1: saveAllRows() — manual SAVE button bulk upsert
  //   NEW-2: setStatus()   — colour-coded status bar
  //   NEW-3: svcToast.pulse() on auto-save
  //   NEW-4: getState()    — for import module
  // ─────────────────────────────────────────────────────────────────────────────

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

  var SAVE_DEBOUNCE_MS = 800; // FIX-6

  var current      = null;
  var subscription = null;
  var saveTimers   = new Map();
  var undoStack    = [];
  var redoStack    = [];

  // NEW-2: colour-coded status
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

    // FIX-5: in-memory delta — no full re-fetch
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

  function render() {
    if (!current) { clear(); return; }
    empty.style.display = 'none';
    grid.hidden = false;
    var cols      = current.sheet.column_defs || [];
    var totalRows = Math.max(current.rows.length + 2, 10);

    var html = '<thead><tr><th class="row-num">#</th>';
    cols.forEach(function (c) {
      html += '<th data-key="' + ea(c.key) + '" contenteditable="true" spellcheck="false" style="min-width:' + (c.width || 160) + 'px">' + eh(c.label) + '</th>';
    });
    html += '</tr></thead><tbody>';
    for (var i = 0; i < totalRows; i++) {
      var row = current.rows.find(function (r) { return r.row_index === i; }) || { data: {} };
      html += '<tr data-row="' + i + '"><td class="row-num">' + (i + 1) + '</td>';
      cols.forEach(function (c) {
        html += '<td><input class="cell" data-row="' + i + '" data-key="' + ea(c.key) + '" value="' + ea((row.data[c.key] != null ? row.data[c.key] : '').toString()) + '" autocomplete="off" spellcheck="false"/></td>';
      });
      html += '</tr>';
    }
    html += '</tbody>';
    grid.innerHTML = html;
    attachCellHandlers();
    attachHeaderHandlers();
    updateStatusBar();
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
        var key = th.dataset.key;
        var newLabel = th.innerText.trim();
        var col = current.sheet.column_defs.find(function (c) { return c.key === key; });
        if (!col || col.label === newLabel) return;
        col.label = newLabel;
        await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
      });
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); th.blur(); } });
    });
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

    // FIX-6: 800ms debounce
    var tKey = rowIdx + ':' + key;
    clearTimeout(saveTimers.get(tKey));
    saveTimers.set(tKey, setTimeout(async function () {
      setStatus('saving', 'Saving…');
      await window.servicesDB.upsertRow(current.sheet.id, rowIdx, rowObj.data);
      setStatus('saved', '✓ Saved');
      window.svcToast && window.svcToast.pulse(); // NEW-3: subtle chip pulse
      window.servicesDashboard && window.servicesDashboard.update(current);
    }, SAVE_DEBOUNCE_MS));
  }

  function onCellKey(e) {
    var row  = +e.target.dataset.row;
    var key  = e.target.dataset.key;
    var cols = current.sheet.column_defs.map(function (c) { return c.key; });
    var idx  = cols.indexOf(key);
    var nextRow = row, nextKey = key;
    if      (e.key === 'Enter' || e.key === 'ArrowDown')  nextRow = row + 1;
    else if (e.key === 'ArrowUp')                          nextRow = Math.max(0, row - 1);
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
        return cols.map(function (c) { return JSON.stringify(r.data[c.key] != null ? r.data[c.key] : ''); }).join(',');
      });
    var blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
    var a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: current.sheet.title + '.csv' });
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
  function ea(s) { return String(s).replace(/"/g,'&quot;'); }

  // ── NEW-1: Manual SAVE ────────────────────────────────────────────────────────
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
      setStatus('saved', '✓ Saved');
      window.svcToast && window.svcToast.show(
        'success', '✓ Saved to Supabase',
        nonEmpty.length + ' row' + (nonEmpty.length !== 1 ? 's' : '') + ' saved successfully.'
      );
      window.servicesDashboard && window.servicesDashboard.update(current);
    } catch (err) {
      setStatus('error', '✕ Save Error');
      window.svcToast && window.svcToast.show('error', 'Save Failed', err.message || 'Check your connection.');
      console.error('[services-grid] saveAllRows:', err);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 SAVE'; }
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', saveAllRows);

  window.servicesGrid = {
    load,
    clear,
    saveAllRows,
    getState: function () { return current; }  // NEW-4: import module reads column_defs here
  };
})();
