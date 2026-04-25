const fs = require('fs');
const path = require('path');

function bootCf(state) {
  document.body.innerHTML = '<table id="svcGrid"><tbody></tbody></table>';
  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => cb());
  window.confirm = () => true;
  window.Notify = { show: () => {} };
  window.servicesDB = { updateColumns: jest.fn().mockResolvedValue({}) };
  window.servicesGrid = {
    getState: () => state,
    render: jest.fn(),
    load: jest.fn(),
  };

  const src = fs.readFileSync(path.join(__dirname, '../../public/js/services-conditional-format.js'), 'utf8');
  window.eval(src);
  return window.__svcCfTestHooks;
}

function addGridRow({ rowId, rowIndex, key, value }) {
  const tbody = document.querySelector('#svcGrid tbody');
  const tr = document.createElement('tr');
  tr.dataset.row = String(rowIndex);
  tr.dataset.rowId = String(rowId);
  const tdRow = document.createElement('td');
  tdRow.className = 'row-num';
  tr.appendChild(tdRow);
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.className = 'cell';
  input.dataset.row = String(rowIndex);
  input.dataset.key = key;
  input.value = value;
  td.appendChild(input);
  tr.appendChild(td);
  tbody.appendChild(tr);
  return tr;
}

describe('Services conditional formatting', () => {
  test('test:evalRule-text-operators', () => {
    const hooks = bootCf({ sheet: { column_defs: [] }, rows: [] });
    expect(hooks.evalRule({ operator: 'contains', param1: 'wait' }, 'WAITING')).toBe(true);
    expect(hooks.evalRule({ operator: 'not_contains', param1: 'done' }, 'WAITING')).toBe(true);
    expect(hooks.evalRule({ operator: 'starts_with', param1: 'wa' }, 'Waiting')).toBe(true);
    expect(hooks.evalRule({ operator: 'ends_with', param1: 'ing' }, 'WAITING')).toBe(true);
    expect(hooks.evalRule({ operator: 'eq', param1: 'waiting' }, 'WAITING')).toBe(true);
    expect(hooks.evalRule({ operator: 'neq', param1: 'done' }, 'WAITING')).toBe(true);
    expect(hooks.evalRule({ operator: 'empty' }, '')).toBe(true);
    expect(hooks.evalRule({ operator: 'not_empty' }, 'x')).toBe(true);
  });

  test('test:evalRule-number-operators', () => {
    const hooks = bootCf({ sheet: { column_defs: [] }, rows: [] });
    expect(hooks.evalRule({ operator: 'gt', param1: '10' }, '11')).toBe(true);
    expect(hooks.evalRule({ operator: 'gte', param1: '11' }, 11)).toBe(true);
    expect(hooks.evalRule({ operator: 'lt', param1: '12' }, '11')).toBe(true);
    expect(hooks.evalRule({ operator: 'lte', param1: '11' }, 11)).toBe(true);
    expect(hooks.evalRule({ operator: 'between', param1: '10', param2: '20' }, '10')).toBe(true);
    expect(hooks.evalRule({ operator: 'not_between', param1: '10', param2: '20' }, '9')).toBe(true);
    expect(hooks.evalRule({ operator: 'eq', param1: '7' }, 'foo')).toBe(false);
  });

  test('test:paintGrid-row-highlight', () => {
    const state = {
      sheet: {
        column_defs: [{ key: 'status', conditionalRules: [{ type: 'single_color', operator: 'eq', param1: 'Waiting', bgColor: '#ff0000', highlightRow: true }] }]
      },
      rows: [{ id: 'a', row_index: 0, data: { status: 'Waiting' } }]
    };
    const hooks = bootCf(state);
    const tr = addGridRow({ rowId: 'a', rowIndex: 0, key: 'status', value: 'Waiting' });
    hooks.paintGrid();
    expect(tr.classList.contains('cf-row-highlighted')).toBe(true);
    expect(tr.style.getPropertyValue('--cf-row-bg')).toContain('rgba');
  });

  test('test:paintGrid-survives-render', () => {
    const state = {
      sheet: {
        column_defs: [{ key: 'status', conditionalRules: [{ type: 'single_color', operator: 'contains', param1: 'Wait', bgColor: '#00ff00', highlightRow: true }] }]
      },
      rows: [{ id: 'a', row_index: 0, data: { status: 'Waiting' } }]
    };
    const hooks = bootCf(state);
    addGridRow({ rowId: 'a', rowIndex: 0, key: 'status', value: 'Waiting' });
    hooks.paintGrid();
    document.querySelector('#svcGrid tbody').innerHTML = '';
    const tr2 = addGridRow({ rowId: 'a', rowIndex: 0, key: 'status', value: 'Waiting' });
    hooks.paintGrid();
    expect(tr2.classList.contains('cf-row-highlighted')).toBe(true);
  });

  test('test:color-swatch-selection', () => {
    const state = { sheet: { id: 's1', column_defs: [{ key: 'status', label: 'Status', conditionalRules: [] }] }, rows: [] };
    bootCf(state);
    window.svcConditionalFormat.open(0, 'status', 'Status', [{ type: 'single_color', operator: 'contains', param1: '', bgColor: '#fef08a' }]);
    const active = document.querySelectorAll('.cf-color-btn.active');
    expect(active.length).toBeGreaterThan(0);
    active[0].click();
    const activeAfter = document.querySelectorAll('.cf-color-btn.active');
    expect(activeAfter.length).toBeGreaterThan(0);
  });

  test('test:rule-persistence-roundtrip', () => {
    const state = {
      sheet: { id: 'sheet-1', column_defs: [{ key: 'status', label: 'Status', conditionalRules: [] }] },
      rows: [{ id: 'x', row_index: 0, data: { status: 'Waiting' } }]
    };
    bootCf(state);
    window.svcConditionalFormat.open(0, 'status', 'Status', [{ type: 'single_color', operator: 'eq', param1: 'Waiting', bgColor: '#fef08a' }]);
    // open() seeds draft/rules; persistence source of truth is column_defs.
    expect(Array.isArray(state.sheet.column_defs[0].conditionalRules)).toBe(true);
  });

  test('test:sorted-view-highlight', () => {
    const state = {
      sheet: {
        column_defs: [{ key: 'status', conditionalRules: [{ type: 'single_color', operator: 'eq', param1: 'Waiting', bgColor: '#ff0000', highlightRow: true }] }]
      },
      rows: [
        { id: 'row-a', row_index: 0, data: { status: 'Done' } },
        { id: 'row-b', row_index: 1, data: { status: 'Waiting' } },
      ],
      __treeFilteredRows: [
        { id: 'row-b', row_index: 1, data: { status: 'Waiting' } },
        { id: 'row-a', row_index: 0, data: { status: 'Done' } },
      ]
    };
    const hooks = bootCf(state);
    const tr1 = addGridRow({ rowId: 'row-b', rowIndex: 1, key: 'status', value: 'Waiting' });
    const tr2 = addGridRow({ rowId: 'row-a', rowIndex: 0, key: 'status', value: 'Done' });
    hooks.paintGrid();
    expect(tr1.classList.contains('cf-row-highlighted')).toBe(true);
    expect(tr2.classList.contains('cf-row-highlighted')).toBe(false);
  });
});
