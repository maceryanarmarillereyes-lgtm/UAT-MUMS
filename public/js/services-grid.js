(function () {
  const grid    = document.getElementById('svcGrid');
  const empty   = document.getElementById('svcEmptyState');
  const addRowBtn = document.getElementById('svcAddRow');
  const addColBtn = document.getElementById('svcAddCol');
  const exportBtn = document.getElementById('svcExportCsv');
  const undoBtn   = document.getElementById('svcUndo');
  const redoBtn   = document.getElementById('svcRedo');
  const statusCells = document.getElementById('svcStatusCells');
  const statusSaved = document.getElementById('svcStatusSaved');

  let current = null; // { sheet, rows }
  let subscription = null;
  let saveTimers = new Map();
  let undoStack = [];
  let redoStack = [];

  function clear() {
    current = null;
    if (subscription) { try { subscription.unsubscribe(); } catch(e){} subscription = null; }
    grid.hidden = true;
    empty.style.display = '';
  }

  async function load(sheet) {
    if (subscription) { try { subscription.unsubscribe(); } catch(e){} subscription = null; }
    current = { sheet: JSON.parse(JSON.stringify(sheet)), rows: await window.servicesDB.listRows(sheet.id) };
    undoStack = []; redoStack = [];
    render();
    subscription = window.servicesDB.subscribeToSheet(sheet.id, async () => {
      const fresh = await window.servicesDB.listRows(sheet.id);
      current.rows = fresh;
      render();
      window.servicesDashboard?.update(current);
    });
    window.servicesDashboard?.update(current);
  }

  function render() {
    if (!current) { clear(); return; }
    empty.style.display = 'none';
    grid.hidden = false;

    const cols = current.sheet.column_defs || [];
    const totalRows = Math.max(current.rows.length + 2, 10);

    let html = '<thead><tr><th class="row-num">#</th>';
    cols.forEach(c => {
      html += `<th data-key="${escAttr(c.key)}" contenteditable="true" spellcheck="false" style="min-width:${c.width||160}px">${escHtml(c.label)}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let i = 0; i < totalRows; i++) {
      const row = current.rows.find(r => r.row_index === i) || { data: {} };
      html += `<tr data-row="${i}"><td class="row-num">${i + 1}</td>`;
      cols.forEach(c => {
        const v = escAttr((row.data[c.key] ?? '').toString());
        html += `<td><input class="cell" data-row="${i}" data-key="${escAttr(c.key)}" value="${v}" autocomplete="off" spellcheck="false" /></td>`;
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
    grid.querySelectorAll('input.cell').forEach(inp => {
      inp.addEventListener('input', onCellInput);
      inp.addEventListener('keydown', onCellKey);
    });
  }

  function attachHeaderHandlers() {
    grid.querySelectorAll('thead th[data-key]').forEach(th => {
      th.addEventListener('blur', async () => {
        const key = th.dataset.key;
        const newLabel = th.innerText.trim();
        const col = current.sheet.column_defs.find(c => c.key === key);
        if (!col || col.label === newLabel) return;
        col.label = newLabel;
        await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
      });
      th.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); th.blur(); } });
    });
  }

  function onCellInput(e) {
    const rowIdx = +e.target.dataset.row;
    const key    = e.target.dataset.key;
    const value  = e.target.value;

    let rowObj = current.rows.find(r => r.row_index === rowIdx);
    if (!rowObj) { rowObj = { row_index: rowIdx, data: {} }; current.rows.push(rowObj); }

    const prev = rowObj.data[key] ?? '';
    undoStack.push({ rowIdx, key, prev, next: value });
    redoStack = [];

    rowObj.data[key] = value;
    statusSaved.textContent = 'Unsaved';
    updateStatusBar();

    const tKey = `${rowIdx}:${key}`;
    clearTimeout(saveTimers.get(tKey));
    saveTimers.set(tKey, setTimeout(async () => {
      statusSaved.textContent = 'Saving…';
      await window.servicesDB.upsertRow(current.sheet.id, rowIdx, rowObj.data);
      statusSaved.textContent = 'Saved ✓';
      window.servicesDashboard?.update(current);
    }, 400));
  }

  function onCellKey(e) {
    const row  = +e.target.dataset.row;
    const key  = e.target.dataset.key;
    const cols = current.sheet.column_defs.map(c => c.key);
    const idx  = cols.indexOf(key);
    let nextRow = row, nextKey = key;

    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      nextRow = row + 1;
    } else if (e.key === 'ArrowUp') {
      nextRow = Math.max(0, row - 1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (idx > 0) nextKey = cols[idx - 1];
        else { nextKey = cols[cols.length - 1]; nextRow = Math.max(0, row - 1); }
      } else {
        if (idx + 1 < cols.length) nextKey = cols[idx + 1];
        else { nextKey = cols[0]; nextRow = row + 1; }
      }
    } else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) {
      nextKey = cols[Math.min(cols.length - 1, idx + 1)];
    } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) {
      nextKey = cols[Math.max(0, idx - 1)];
    } else {
      return;
    }

    const target = grid.querySelector(`input.cell[data-row="${nextRow}"][data-key="${nextKey}"]`);
    if (target) { e.preventDefault(); target.focus(); target.select(); }
  }

  function updateStatusBar() {
    if (!current) { statusCells.textContent = '0 cells'; return; }
    const cols = current.sheet.column_defs.length;
    const rows = current.rows.length;
    statusCells.textContent = `${rows} rows × ${cols} cols`;
  }

  addRowBtn.addEventListener('click', () => {
    if (!current) return;
    const maxIdx = current.rows.reduce((m, r) => Math.max(m, r.row_index), -1);
    current.rows.push({ row_index: maxIdx + 1, data: {} });
    render();
  });

  addColBtn.addEventListener('click', async () => {
    if (!current) return;
    const label = prompt('Column name:', 'New Column');
    if (!label || !label.trim()) return;
    const key = 'col_' + Math.random().toString(36).slice(2, 8);
    current.sheet.column_defs.push({ key, label: label.trim(), type: 'text', width: 160 });
    await window.servicesDB.updateColumns(current.sheet.id, current.sheet.column_defs);
    render();
  });

  exportBtn.addEventListener('click', () => {
    if (!current) return;
    const cols = current.sheet.column_defs;
    const header = cols.map(c => JSON.stringify(c.label)).join(',');
    const lines  = current.rows
      .sort((a, b) => a.row_index - b.row_index)
      .map(r => cols.map(c => JSON.stringify(r.data[c.key] ?? '')).join(','));
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${current.sheet.title}.csv`
    });
    document.body.appendChild(a); a.click(); a.remove();
  });

  undoBtn.addEventListener('click', () => {
    if (!undoStack.length || !current) return;
    const op = undoStack.pop();
    redoStack.push(op);
    applyOp(op.rowIdx, op.key, op.prev);
  });

  redoBtn.addEventListener('click', () => {
    if (!redoStack.length || !current) return;
    const op = redoStack.pop();
    undoStack.push(op);
    applyOp(op.rowIdx, op.key, op.next);
  });

  function applyOp(rowIdx, key, value) {
    const inp = grid.querySelector(`input.cell[data-row="${rowIdx}"][data-key="${key}"]`);
    if (inp) { inp.value = value; inp.dispatchEvent(new Event('input')); }
  }

  function escHtml(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function escAttr(s)  { return String(s).replace(/"/g,'&quot;'); }

  window.servicesGrid = { load, clear };
})();
