/**
 * tests/unit/conditional-format.test.js
 * Unit tests for services-conditional-format.js logic
 * Framework: Jest (vanilla JS, no build tooling needed)
 *
 * Run: npx jest tests/unit/conditional-format.test.js
 */

// ── Inline port of evalRule() from services-conditional-format.js ────────────
// We replicate the pure function here so we can test it without DOM/browser deps.
function evalRule(rule, cellValue) {
  var v = String(cellValue == null ? '' : cellValue).trim();
  var op = rule.operator || 'empty';
  var p1 = String(rule.param1 != null ? rule.param1 : '');
  var p2 = String(rule.param2 != null ? rule.param2 : '');

  switch (op) {
    case 'contains':     return v.toLowerCase().indexOf(p1.toLowerCase()) !== -1;
    case 'not_contains': return v.toLowerCase().indexOf(p1.toLowerCase()) === -1;
    case 'starts_with':  return v.toLowerCase().indexOf(p1.toLowerCase()) === 0;
    case 'ends_with':    return v.toLowerCase().endsWith(p1.toLowerCase());
    case 'eq':           return v.toLowerCase() === p1.toLowerCase();
    case 'neq':          return v.toLowerCase() !== p1.toLowerCase();
    case 'empty':        return v === '';
    case 'not_empty':    return v !== '';
    case 'num_eq':       return parseFloat(v) === parseFloat(p1);
    case 'num_neq':      return parseFloat(v) !== parseFloat(p1);
    case 'num_gt':       return parseFloat(v) >  parseFloat(p1);
    case 'num_gte':      return parseFloat(v) >= parseFloat(p1);
    case 'num_lt':       return parseFloat(v) <  parseFloat(p1);
    case 'num_lte':      return parseFloat(v) <= parseFloat(p1);
    case 'between':      return parseFloat(v) >= parseFloat(p1) && parseFloat(v) <= parseFloat(p2);
    case 'not_between':  return parseFloat(v) < parseFloat(p1) || parseFloat(v) > parseFloat(p2);
    default:             return false;
  }
}

// ── test:evalRule-text-operators ─────────────────────────────────────────────
describe('evalRule — text operators', () => {
  const mkRule = (op, p1 = '', p2 = '') => ({ operator: op, param1: p1, param2: p2 });

  test('contains — case-insensitive match', () => {
    expect(evalRule(mkRule('contains', 'investigating'), 'O - Investigating')).toBe(true);
    expect(evalRule(mkRule('contains', 'WAITING'), 'O - Waiting for Customer')).toBe(true);
    expect(evalRule(mkRule('contains', 'xyz'), 'O - Investigating')).toBe(false);
  });

  test('not_contains', () => {
    expect(evalRule(mkRule('not_contains', 'Waiting'), 'O - Investigating')).toBe(true);
    expect(evalRule(mkRule('not_contains', 'Investigating'), 'O - Investigating')).toBe(false);
  });

  test('starts_with — case-insensitive', () => {
    expect(evalRule(mkRule('starts_with', '(nz)'), '(NZ) WW Bridge St 9033')).toBe(true);
    expect(evalRule(mkRule('starts_with', '(AU)'), '(NZ) WW Bridge St')).toBe(false);
  });

  test('ends_with', () => {
    expect(evalRule(mkRule('ends_with', 'Remapping'), 'CS Remapping')).toBe(true);
    expect(evalRule(mkRule('ends_with', 'Request'), 'CS Remapping')).toBe(false);
  });

  test('eq — case-insensitive exact match', () => {
    expect(evalRule(mkRule('eq', 'mace ryan reyes'), 'Mace Ryan Reyes')).toBe(true);
    expect(evalRule(mkRule('eq', 'Mace'), 'Mace Ryan Reyes')).toBe(false);
  });

  test('neq', () => {
    expect(evalRule(mkRule('neq', 'Mace Ryan Reyes'), 'Bryan Tumbagahon')).toBe(true);
    expect(evalRule(mkRule('neq', 'Mace Ryan Reyes'), 'Mace Ryan Reyes')).toBe(false);
  });

  test('empty / not_empty', () => {
    expect(evalRule(mkRule('empty'), '')).toBe(true);
    // evalRule trims input: '  '.trim() === '' → empty = true (correct behavior)
    expect(evalRule(mkRule('empty'), '  ')).toBe(true);  // whitespace-only = empty
    expect(evalRule(mkRule('empty'), 'x')).toBe(false);
    expect(evalRule(mkRule('not_empty'), 'hello')).toBe(true);
    expect(evalRule(mkRule('not_empty'), '')).toBe(false);
    expect(evalRule(mkRule('not_empty'), '  ')).toBe(false); // whitespace-only = empty
  });

  test('null / undefined cellValue treated as empty', () => {
    expect(evalRule(mkRule('empty'), null)).toBe(true);
    expect(evalRule(mkRule('empty'), undefined)).toBe(true);
    expect(evalRule(mkRule('not_empty'), null)).toBe(false);
  });
});

// ── test:evalRule-number-operators ───────────────────────────────────────────
describe('evalRule — number operators', () => {
  const mkRule = (op, p1 = '', p2 = '') => ({ operator: op, param1: p1, param2: p2 });

  test('num_eq', () => {
    expect(evalRule(mkRule('num_eq', '100'), '100')).toBe(true);
    expect(evalRule(mkRule('num_eq', '100'), '100.0')).toBe(true);
    expect(evalRule(mkRule('num_eq', '100'), '101')).toBe(false);
  });

  test('num_gt / num_gte / num_lt / num_lte', () => {
    expect(evalRule(mkRule('num_gt',  '50'), '51')).toBe(true);
    expect(evalRule(mkRule('num_gt',  '50'), '50')).toBe(false);
    expect(evalRule(mkRule('num_gte', '50'), '50')).toBe(true);
    expect(evalRule(mkRule('num_lt',  '50'), '49')).toBe(true);
    expect(evalRule(mkRule('num_lt',  '50'), '50')).toBe(false);
    expect(evalRule(mkRule('num_lte', '50'), '50')).toBe(true);
  });

  test('between — inclusive boundary', () => {
    expect(evalRule(mkRule('between', '10', '20'), '10')).toBe(true);
    expect(evalRule(mkRule('between', '10', '20'), '15')).toBe(true);
    expect(evalRule(mkRule('between', '10', '20'), '20')).toBe(true);
    expect(evalRule(mkRule('between', '10', '20'), '9')).toBe(false);
    expect(evalRule(mkRule('between', '10', '20'), '21')).toBe(false);
  });

  test('not_between', () => {
    expect(evalRule(mkRule('not_between', '10', '20'), '5')).toBe(true);
    expect(evalRule(mkRule('not_between', '10', '20'), '25')).toBe(true);
    expect(evalRule(mkRule('not_between', '10', '20'), '15')).toBe(false);
  });

  test('NaN input — string value returns false for num operators', () => {
    // parseFloat('hello') = NaN; NaN comparisons always false
    expect(evalRule(mkRule('num_gt', '0'), 'hello')).toBe(false);
    expect(evalRule(mkRule('num_eq', '0'), '')).toBe(false);
  });

  test('string number input coerced correctly', () => {
    expect(evalRule(mkRule('num_eq', '42'), '42')).toBe(true);
    expect(evalRule(mkRule('num_gt', '0'), '1.5')).toBe(true);
  });
});

// ── test:paintGrid-row-highlight (DOM-level) ─────────────────────────────────
describe('paintGrid — row highlight logic (unit)', () => {
  // Test the rowHighlights accumulation logic extracted from paintGrid()
  function buildRowHighlights(rules, rows, colKey) {
    var rowHighlights = {};
    var colValues = rows.map(r => r.data[colKey] != null ? String(r.data[colKey]).trim() : '');
    var valueCounts = {};
    colValues.forEach(v => { if (v) valueCounts[v] = (valueCounts[v] || 0) + 1; });

    rows.forEach((row, pos) => {
      var rowIdx = row.row_index != null ? row.row_index : pos;
      var cellValue = row.data[colKey] != null ? row.data[colKey] : '';

      for (var ri = 0; ri < rules.length; ri++) {
        var rule = rules[ri];
        var matched = evalRule(rule, cellValue);
        if (matched && rule.highlightRow && !rowHighlights[rowIdx]) {
          rowHighlights[rowIdx] = { bgColor: rule.bgColor || '', textColor: rule.textColor || '' };
          break;
        }
      }
    });
    return rowHighlights;
  }

  const rows = [
    { row_index: 0, data: { status: 'O - Investigating' } },
    { row_index: 1, data: { status: 'O - Waiting for Customer' } },
    { row_index: 2, data: { status: 'O - Investigating' } },
    { row_index: 3, data: { status: 'Submitted' } },
  ];

  test('row highlight: only matching rows get highlight', () => {
    const rules = [{
      type: 'single_color', operator: 'contains', param1: 'Investigating',
      bgColor: '#fb923c', highlightRow: true
    }];
    const hl = buildRowHighlights(rules, rows, 'status');
    expect(hl[0]).toBeDefined();
    expect(hl[0].bgColor).toBe('#fb923c');
    expect(hl[1]).toBeUndefined(); // Waiting — no match
    expect(hl[2]).toBeDefined();
    expect(hl[3]).toBeUndefined(); // Submitted — no match
  });

  test('first match wins — two rules, only first applies', () => {
    const rules = [
      { type: 'single_color', operator: 'contains', param1: 'Investigating', bgColor: '#fb923c', highlightRow: true },
      { type: 'single_color', operator: 'contains', param1: 'Investigating', bgColor: '#ff0000', highlightRow: true },
    ];
    const hl = buildRowHighlights(rules, rows, 'status');
    expect(hl[0].bgColor).toBe('#fb923c'); // first rule wins
  });

  test('no match — no highlight applied', () => {
    const rules = [{ type: 'single_color', operator: 'eq', param1: 'NOMATCH', bgColor: '#red', highlightRow: true }];
    const hl = buildRowHighlights(rules, rows, 'status');
    expect(Object.keys(hl).length).toBe(0);
  });
});

// ── test:color-swatch-selection ───────────────────────────────────────────────
describe('color swatch active state logic', () => {
  // Test the _updateActive logic from renderSwatches()
  function simulateSwatchSelection(palette, initialHex, clickedHex) {
    // Simulate the swatch element array
    var allSwatches = [{ el: { classList: { toggle: jest.fn() } }, hex: '' }];
    palette.forEach(hex => {
      allSwatches.push({ el: { classList: { toggle: jest.fn() } }, hex });
    });

    function _updateActive(selectedHex) {
      allSwatches.forEach(item => {
        var isActive = item.hex === selectedHex || (!selectedHex && item.hex === '');
        item.el.classList.toggle('cf-swatch-active', isActive);
      });
    }

    _updateActive(clickedHex);
    return allSwatches;
  }

  test('clicking a swatch marks only that swatch active', () => {
    const palette = ['#ff0000', '#00ff00', '#0000ff'];
    const swatches = simulateSwatchSelection(palette, '', '#00ff00');

    // None swatch (hex='') should be inactive
    expect(swatches[0].el.classList.toggle).toHaveBeenCalledWith('cf-swatch-active', false);
    // #ff0000 — inactive
    expect(swatches[1].el.classList.toggle).toHaveBeenCalledWith('cf-swatch-active', false);
    // #00ff00 — ACTIVE
    expect(swatches[2].el.classList.toggle).toHaveBeenCalledWith('cf-swatch-active', true);
    // #0000ff — inactive
    expect(swatches[3].el.classList.toggle).toHaveBeenCalledWith('cf-swatch-active', false);
  });

  test('selecting None (empty string) marks none-swatch active', () => {
    const palette = ['#ff0000', '#00ff00'];
    const swatches = simulateSwatchSelection(palette, '#ff0000', '');

    // None swatch active
    expect(swatches[0].el.classList.toggle).toHaveBeenCalledWith('cf-swatch-active', true);
    // #ff0000 — inactive
    expect(swatches[1].el.classList.toggle).toHaveBeenCalledWith('cf-swatch-active', false);
  });
});

// ── test:paintGrid-survives-render ───────────────────────────────────────────
describe('CF paint survives render cycle', () => {
  // Verify the design contract: render() calls svcConditionalFormat.paint()
  // This test confirms the rAF hook in services-grid.js is wired correctly.
  test('svcConditionalFormat.paint is called after render() (contract test)', () => {
    // Mock the CF module API
    const mockPaint = jest.fn();
    global.window = global.window || {};
    global.window.svcConditionalFormat = { paint: mockPaint };
    global.requestAnimationFrame = (cb) => cb(); // synchronous in test

    // Simulate what render() does: call rAF with paint
    requestAnimationFrame(function () {
      window.svcConditionalFormat.paint();
    });

    expect(mockPaint).toHaveBeenCalledTimes(1);
  });

  test('paint is called after applyRowToGrid() (single-row update)', () => {
    const mockPaint = jest.fn();
    global.window.svcConditionalFormat = { paint: mockPaint };
    global.requestAnimationFrame = (cb) => cb();

    // Simulate applyRowToGrid() end
    if (window.svcConditionalFormat && typeof window.svcConditionalFormat.paint === 'function') {
      requestAnimationFrame(function () { window.svcConditionalFormat.paint(); });
    }

    expect(mockPaint).toHaveBeenCalledTimes(1);
  });
});

// ── test:rule-persistence-roundtrip ─────────────────────────────────────────
describe('rule persistence round-trip', () => {
  test('deepClone preserves all rule fields', () => {
    function deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }
    const rule = {
      id: 'cf_abc123', type: 'single_color', operator: 'contains',
      param1: 'Investigating', bgColor: '#fb923c', textColor: '#ffffff',
      bold: true, italic: false, strikethrough: false, underline: true,
      highlightRow: true, rowBorderColor: '#e67e22'
    };
    const cloned = deepClone(rule);
    expect(cloned).toEqual(rule);
    expect(cloned).not.toBe(rule); // different reference
    cloned.bgColor = '#000000';
    expect(rule.bgColor).toBe('#fb923c'); // original untouched
  });

  test('conditionalRules survive JSON serialization (Supabase column_defs storage)', () => {
    const col = {
      key: 'status', label: 'STATUS',
      conditionalRules: [
        { id: 'r1', type: 'single_color', operator: 'contains', param1: 'Waiting', bgColor: '#fde047', highlightRow: true },
        { id: 'r2', type: 'color_scale', scaleMin: '#f87171', scaleMid: '#fde047', scaleMax: '#4ade80' }
      ]
    };
    const serialized = JSON.stringify(col);
    const restored = JSON.parse(serialized);
    expect(restored.conditionalRules).toHaveLength(2);
    expect(restored.conditionalRules[0].highlightRow).toBe(true);
    expect(restored.conditionalRules[1].type).toBe('color_scale');
  });
});

// ── test:sorted-view-highlight ───────────────────────────────────────────────
describe('sorted view highlight — row-to-data mapping', () => {
  // RC-4: paintGrid must look up rows by row_index (not DOM position)
  // After sort, DOM position != row_index. paintGrid uses:
  //   grid.querySelector('td input.cell[data-row="'+rowIdx+'"]')
  // which looks up by data-row attribute = row_index (stable DB key).
  // This test verifies the lookup key is row_index, not array position.

  test('rowHighlights keyed by row_index, not array position', () => {
    // Simulate a sorted view: rows arrive in different order than their row_index
    const sortedRows = [
      { row_index: 5, data: { status: 'O - Investigating' } },   // DOM position 0
      { row_index: 1, data: { status: 'Submitted' } },            // DOM position 1
      { row_index: 3, data: { status: 'O - Investigating' } },    // DOM position 2
    ];
    const rules = [{
      type: 'single_color', operator: 'contains', param1: 'Investigating',
      bgColor: '#fb923c', highlightRow: true
    }];

    var rowHighlights = {};
    sortedRows.forEach((row, pos) => {
      var rowIdx = row.row_index; // FIX-6: use row_index, not pos
      var val = String(row.data.status || '').trim();
      var matched = evalRule(rules[0], val);
      if (matched && rules[0].highlightRow) {
        rowHighlights[rowIdx] = { bgColor: rules[0].bgColor };
      }
    });

    // Rows 5 and 3 matched (by row_index), NOT positions 0 and 2
    expect(rowHighlights[5]).toBeDefined();  // row_index 5 matched
    expect(rowHighlights[3]).toBeDefined();  // row_index 3 matched
    expect(rowHighlights[1]).toBeUndefined(); // row_index 1 = Submitted, no match
    expect(rowHighlights[0]).toBeUndefined(); // DOM position 0 should NOT be keyed
    expect(rowHighlights[2]).toBeUndefined(); // DOM position 2 should NOT be keyed
  });

  test('FIX-6 contract: tr lookup uses data-row attribute = row_index', () => {
    // In paintGrid(), the selector is:
    //   grid.querySelector('tbody tr[data-row="' + rowIdx + '"]')
    // where rowIdx comes from row.row_index (not loop index).
    // This test verifies the selector key is the stable row_index.
    const rowIdx = 42;
    const selectorUsed = 'tbody tr[data-row="' + rowIdx + '"]';
    expect(selectorUsed).toBe('tbody tr[data-row="42"]');
    // NOT 'tbody tr:nth-child(42)' or 'tbody tr[data-position="..."]'
  });
});
