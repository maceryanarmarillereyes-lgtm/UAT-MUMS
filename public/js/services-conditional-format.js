/**
 * services-conditional-format.js — v1.0
 * Conditional Formatting engine for Services Workspace (MUMS).
 * Google Sheets-accurate feature parity — enterprise UI/UX.
 *
 * UNTOUCHABLES:
 *  - No auth/session logic modified
 *  - No realtime channel/topic names changed
 *  - No QB lookup logic touched
 *  - No treeview logic modified
 *
 * Storage: column_defs[colIdx].conditionalRules[] — persisted via servicesDB.updateColumns()
 * Render:  paint() re-applies styles to grid cells after every render()
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     CONSTANTS & PALETTES
  ───────────────────────────────────────────────────────────────────────── */

  var BG_PALETTE = [
    // Reds/Pinks
    '#fecaca','#fca5a5','#f87171','#ef4444','#dc2626',
    // Oranges
    '#fed7aa','#fdba74','#fb923c','#f97316','#ea580c',
    // Yellows
    '#fef08a','#fde047','#facc15','#eab308','#ca8a04',
    // Greens
    '#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a',
    // Cyans
    '#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2',
    // Blues
    '#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb',
    // Purples
    '#e9d5ff','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed',
    // Pinks
    '#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777',
    // Grays
    '#f1f5f9','#e2e8f0','#cbd5e1','#94a3b8','#64748b',
    // Darks
    '#1e293b','#0f172a','#020617','#1c1c1c','#000000',
    // White
    '#ffffff'
  ];

  var TEXT_PALETTE = [
    '#ffffff','#f1f5f9','#e5e7eb','#94a3b8','#64748b',
    '#ef4444','#f97316','#eab308','#22c55e','#22d3ee',
    '#3b82f6','#8b5cf6','#ec4899',
    '#000000','#1e293b','#0f172a'
  ];

  var OPERATORS = {
    text: [
      { value: 'contains',      label: 'Text contains' },
      { value: 'not_contains',  label: 'Text does not contain' },
      { value: 'starts_with',   label: 'Text starts with' },
      { value: 'ends_with',     label: 'Text ends with' },
      { value: 'eq',            label: 'Text is exactly' },
      { value: 'neq',           label: 'Text is not' },
      { value: 'empty',         label: 'Is empty' },
      { value: 'not_empty',     label: 'Is not empty' }
    ],
    number: [
      { value: 'num_eq',        label: '= Equal to' },
      { value: 'num_neq',       label: '≠ Not equal to' },
      { value: 'num_gt',        label: '> Greater than' },
      { value: 'num_gte',       label: '≥ Greater than or equal' },
      { value: 'num_lt',        label: '< Less than' },
      { value: 'num_lte',       label: '≤ Less than or equal' },
      { value: 'between',       label: '↔ Between' },
      { value: 'not_between',   label: '↮ Not between' },
      { value: 'empty',         label: 'Is empty' },
      { value: 'not_empty',     label: 'Is not empty' }
    ],
    date: [
      { value: 'date_today',    label: '📅 Is today' },
      { value: 'date_tomorrow', label: '📅 Is tomorrow' },
      { value: 'date_yesterday','label': '📅 Is yesterday' },
      { value: 'date_past_week','label': '📅 In past week' },
      { value: 'date_past_month','label':'📅 In past month' },
      { value: 'date_before',   label: '📅 Date is before' },
      { value: 'date_after',    label: '📅 Date is after' },
      { value: 'date_eq',       label: '📅 Date is exactly' },
      { value: 'empty',         label: 'Is empty' },
      { value: 'not_empty',     label: 'Is not empty' }
    ],
    duplicate: [
      { value: 'is_duplicate',  label: 'Duplicate values' },
      { value: 'is_unique',     label: 'Unique values' }
    ]
  };

  var ICON_SETS = [
    { id: 'traffic',   icons: ['🔴','🟡','🟢'],        name: 'Traffic Lights' },
    { id: 'arrows',    icons: ['↑','→','↓'],            name: 'Arrows' },
    { id: 'stars',     icons: ['⭐','⭐⭐','⭐⭐⭐'],  name: 'Stars' },
    { id: 'check',     icons: ['❌','⚠️','✅'],          name: 'Check Marks' },
    { id: 'flags',     icons: ['🚩','🏳️','🚀'],          name: 'Flags' },
    { id: 'numbers',   icons: ['①','②','③'],           name: 'Numbers' }
  ];

  var FORMAT_TYPES = [
    { id: 'single_color', label: '🎨 Single Color' },
    { id: 'color_scale',  label: '🌈 Color Scale' },
    { id: 'data_bar',     label: '📊 Data Bar' },
    { id: 'icon_set',     label: '🏷 Icon Set' },
    { id: 'formula',      label: 'ƒx Custom Formula' }
  ];

  /* ─────────────────────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────────────────────── */

  var _state = {
    open: false,
    colIdx: -1,
    colKey: '',
    colLabel: '',
    rules: [],           // current rules for the column being edited
    activeRuleIdx: -1,   // which rule card is selected in editor
    draft: null          // draft rule being edited
  };

  /* ─────────────────────────────────────────────────────────────────────────
     UTILS
  ───────────────────────────────────────────────────────────────────────── */

  function mkEl(tag, props, parent) {
    var el = document.createElement(tag);
    if (props) Object.assign(el, props);
    if (parent) parent.appendChild(el);
    return el;
  }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  function uid() {
    return 'cf_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  }

  function contrastColor(hex) {
    if (!hex || hex === 'transparent') return '#e5e7eb';
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    var r = parseInt(c.substr(0,2),16);
    var g = parseInt(c.substr(2,2),16);
    var b = parseInt(c.substr(4,2),16);
    var luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
    return luminance > 0.55 ? '#0f172a' : '#f1f5f9';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     EVALUATION ENGINE — matches Google Sheets operator semantics
  ───────────────────────────────────────────────────────────────────────── */

  function evalRule(rule, cellValue) {
    var v = String(cellValue == null ? '' : cellValue).trim();
    var op = rule.operator || 'empty';
    var p1 = String(rule.param1 != null ? rule.param1 : '');
    var p2 = String(rule.param2 != null ? rule.param2 : '');

    switch (op) {
      /* TEXT */
      case 'contains':     return v.toLowerCase().indexOf(p1.toLowerCase()) !== -1;
      case 'not_contains': return v.toLowerCase().indexOf(p1.toLowerCase()) === -1;
      case 'starts_with':  return v.toLowerCase().indexOf(p1.toLowerCase()) === 0;
      case 'ends_with':    return v.toLowerCase().endsWith(p1.toLowerCase());
      case 'eq':           return v.toLowerCase() === p1.toLowerCase();
      case 'neq':          return v.toLowerCase() !== p1.toLowerCase();
      case 'empty':        return v === '';
      case 'not_empty':    return v !== '';

      /* NUMBER */
      case 'num_eq':       return parseFloat(v) === parseFloat(p1);
      case 'num_neq':      return parseFloat(v) !== parseFloat(p1);
      case 'num_gt':       return parseFloat(v) >  parseFloat(p1);
      case 'num_gte':      return parseFloat(v) >= parseFloat(p1);
      case 'num_lt':       return parseFloat(v) <  parseFloat(p1);
      case 'num_lte':      return parseFloat(v) <= parseFloat(p1);
      case 'between':      return parseFloat(v) >= parseFloat(p1) && parseFloat(v) <= parseFloat(p2);
      case 'not_between':  return parseFloat(v) < parseFloat(p1) || parseFloat(v) > parseFloat(p2);

      /* DATES */
      case 'date_today': {
        var today = new Date(); today.setHours(0,0,0,0);
        var d = new Date(v); d.setHours(0,0,0,0);
        return d.getTime() === today.getTime();
      }
      case 'date_tomorrow': {
        var tom = new Date(); tom.setDate(tom.getDate()+1); tom.setHours(0,0,0,0);
        var d2 = new Date(v); d2.setHours(0,0,0,0);
        return d2.getTime() === tom.getTime();
      }
      case 'date_yesterday': {
        var yes = new Date(); yes.setDate(yes.getDate()-1); yes.setHours(0,0,0,0);
        var d3 = new Date(v); d3.setHours(0,0,0,0);
        return d3.getTime() === yes.getTime();
      }
      case 'date_past_week': {
        var now = new Date(); var pw = new Date(now); pw.setDate(pw.getDate()-7);
        var d4 = new Date(v);
        return d4 >= pw && d4 <= now;
      }
      case 'date_past_month': {
        var now2 = new Date(); var pm = new Date(now2); pm.setMonth(pm.getMonth()-1);
        var d5 = new Date(v);
        return d5 >= pm && d5 <= now2;
      }
      case 'date_before': return new Date(v) < new Date(p1);
      case 'date_after':  return new Date(v) > new Date(p1);
      case 'date_eq': {
        var a = new Date(v); a.setHours(0,0,0,0);
        var b = new Date(p1); b.setHours(0,0,0,0);
        return a.getTime() === b.getTime();
      }

      /* DUPLICATE / UNIQUE — evaluated at paint time with full column context */
      case 'is_duplicate':
      case 'is_unique':
        return false; // handled specially in paint()

      /* FORMULA — supports VALUE, NUMVAL, ROW_DATA{}, COL('colName') */
      case 'formula':
        try {
          var formula = rule.formula || '';
          if (!formula.trim()) return false;
          if (formula.startsWith('=')) formula = formula.slice(1);
          /* jshint evil:true */
          var fn = new Function(
            'VALUE', 'NUMVAL', 'ROW_DATA', 'COL',
            'try{return !!('+formula+')}catch(e){return false}'
          );
          var numValF = parseFloat(v);
          var rowDataF = rule._evalRowData || {};
          var colLabelMapF = rule._evalColLabelMap || {};
          var colFn = function (colName) {
            var key = colLabelMapF[colName] || colName;
            var raw = rowDataF[key];
            return raw != null ? String(raw).trim() : '';
          };
          return fn(isNaN(numValF) ? v : numValF, numValF, rowDataF, colFn);
        } catch (e) { return false; }

      default: return false;
    }
  }

  /* Color scale interpolation */
  function interpolateHex(hex1, hex2, t) {
    var r1=parseInt(hex1.slice(1,3),16), g1=parseInt(hex1.slice(3,5),16), b1=parseInt(hex1.slice(5,7),16);
    var r2=parseInt(hex2.slice(1,3),16), g2=parseInt(hex2.slice(3,5),16), b2=parseInt(hex2.slice(5,7),16);
    var r=Math.round(r1+(r2-r1)*t), g=Math.round(g1+(g2-g1)*t), b=Math.round(b1+(b2-b1)*t);
    return '#'+[r,g,b].map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  }

  function hexToRgba(hex, alpha) {
    var r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return 'rgba('+r+','+g+','+b+','+alpha+')';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     PAINT ENGINE — applies CF rules to the live grid DOM
     Supports:
       - Per-cell styling (single_color, color_scale, data_bar, icon_set)
       - ROW-LEVEL highlight: rule.highlightRow=true paints ALL tds in the row
       - Formula rules get full ROW_DATA + COL('colName') access
  ───────────────────────────────────────────────────────────────────────── */

  function paintGrid() {
    var grid = document.getElementById('svcGrid');
    if (!grid || !window.servicesGrid) return;
    var state = window.servicesGrid.getState();
    if (!state || !state.sheet) return;

    var cols = state.sheet.column_defs || [];
    var rows = state.rows || [];
    if (state.__treeFilteredRows) rows = state.__treeFilteredRows;

    // Build a label→key map for COL() formula function
    var colLabelMap = {};
    cols.forEach(function (c) {
      if (c && c.label && c.key) colLabelMap[c.label] = c.key;
    });

    // Clear ALL previous CF styles (cells + row-level)
    grid.querySelectorAll('td[data-cf-applied]').forEach(function (td) {
      td.removeAttribute('data-cf-applied');
      td.style.background = '';
      td.style.borderLeft = '';
      td.style.outline = '';
      td.style.position = '';
      td.style.paddingLeft = '';
      var inp = td.querySelector('input.cell');
      if (inp) {
        inp.style.color = '';
        inp.style.fontWeight = '';
        inp.style.fontStyle = '';
        inp.style.textDecoration = '';
        inp.style.fontFamily = '';
        inp.dataset.cfIcon = '';
      }
      var badge = td.querySelector('.cf-icon-badge');
      if (badge) badge.remove();
    });
    // Also clear row-level highlights set on <tr>
    grid.querySelectorAll('tr[data-cf-row]').forEach(function (tr) {
      tr.removeAttribute('data-cf-row');
      tr.querySelectorAll('td').forEach(function (td) {
        td.style.background = '';
        td.style.borderTop = '';
        td.style.borderBottom = '';
        var inp = td.querySelector('input.cell');
        if (inp) {
          inp.style.color = '';
          inp.style.fontWeight = '';
          inp.style.fontStyle = '';
          inp.style.textDecoration = '';
        }
      });
    });

    // ── Collect which rows need row-highlight so we can apply after per-cell pass
    // Map: rowIdx → {bgColor, textColor, bold, italic, strikethrough, underline, borderColor}
    var rowHighlights = {};

    cols.forEach(function (col) {
      if (!col || !Array.isArray(col.conditionalRules) || !col.conditionalRules.length) return;

      var rules = col.conditionalRules.filter(function (r) { return r && !r.disabled; });
      if (!rules.length) return;

      // Gather all values for this column (color scale / duplicate)
      var colValues = rows.map(function (row) {
        return row && row.data ? (row.data[col.key] != null ? String(row.data[col.key]).trim() : '') : '';
      });
      var numericValues = colValues.map(parseFloat).filter(function (n) { return !isNaN(n); });
      var minVal = numericValues.length ? Math.min.apply(null, numericValues) : 0;
      var maxVal = numericValues.length ? Math.max.apply(null, numericValues) : 1;

      var valueCounts = {};
      colValues.forEach(function (v) {
        if (v !== '') valueCounts[v] = (valueCounts[v] || 0) + 1;
      });

      rows.forEach(function (row, rowPos) {
        if (!row || !row.data) return;
        var rowIdx = row.row_index != null ? row.row_index : rowPos;
        var cellValue = row.data[col.key] != null ? row.data[col.key] : '';
        var cellStr = String(cellValue).trim();

        var td = grid.querySelector('td input.cell[data-row="'+rowIdx+'"][data-key="'+col.key+'"]');
        if (td) td = td.parentElement;
        if (!td) return;

        for (var ri = 0; ri < rules.length; ri++) {
          var rule = rules[ri];
          var matched = false;

          if (rule.type === 'single_color' || rule.type === 'formula') {
            if (rule.operator === 'is_duplicate') {
              matched = cellStr !== '' && (valueCounts[cellStr] || 0) > 1;
            } else if (rule.operator === 'is_unique') {
              matched = cellStr !== '' && (valueCounts[cellStr] || 0) === 1;
            } else if (rule.type === 'formula') {
              // Inject full row context for COL() and ROW_DATA access
              rule._evalRowData = row.data;
              rule._evalColLabelMap = colLabelMap;
              matched = evalRule(rule, cellValue);
              delete rule._evalRowData;
              delete rule._evalColLabelMap;
            } else {
              matched = evalRule(rule, cellValue);
            }

            if (matched) {
              if (rule.highlightRow) {
                // Queue row-level highlight — applied after per-cell loop
                if (!rowHighlights[rowIdx]) {
                  rowHighlights[rowIdx] = {
                    bgColor: rule.bgColor || '',
                    textColor: rule.textColor || '',
                    bold: !!rule.bold,
                    italic: !!rule.italic,
                    strikethrough: !!rule.strikethrough,
                    underline: !!rule.underline,
                    borderColor: rule.rowBorderColor || ''
                  };
                }
              } else {
                applyStyleToTd(td, rule);
              }
              break; // first match wins
            }

          } else if (rule.type === 'color_scale') {
            var numV = parseFloat(cellStr);
            if (!isNaN(numV) && maxVal !== minVal) {
              var t = (numV - minVal) / (maxVal - minVal);
              var minC = rule.scaleMin || '#f87171';
              var midC = rule.scaleMid || '#fde047';
              var maxC = rule.scaleMax || '#4ade80';
              var color = t <= 0.5
                ? interpolateHex(minC, midC, t * 2)
                : interpolateHex(midC, maxC, (t - 0.5) * 2);
              td.style.background = color;
              td.setAttribute('data-cf-applied', '1');
              var inp2 = td.querySelector('input.cell');
              if (inp2) inp2.style.color = contrastColor(color);
            }

          } else if (rule.type === 'data_bar') {
            var numV2 = parseFloat(cellStr);
            if (!isNaN(numV2)) {
              var pct = maxVal !== minVal
                ? Math.max(0, Math.min(100, ((numV2 - minVal) / (maxVal - minVal)) * 100))
                : 50;
              var barColor = rule.barColor || '#22d3ee';
              td.style.background = 'linear-gradient(to right, ' + hexToRgba(barColor, 0.45) + ' ' + pct + '%, transparent ' + pct + '%)';
              td.style.borderLeft = '3px solid ' + barColor;
              td.setAttribute('data-cf-applied', '1');
            }

          } else if (rule.type === 'icon_set') {
            var numV3 = parseFloat(cellStr);
            if (!isNaN(numV3)) {
              var iconSet = ICON_SETS.find(function (s) { return s.id === rule.iconSetId; }) || ICON_SETS[0];
              var icons = iconSet.icons;
              var t3 = maxVal !== minVal ? (numV3 - minVal) / (maxVal - minVal) : 0.5;
              var iconIdx = t3 < 0.33 ? 0 : t3 < 0.67 ? 1 : 2;
              var icon = icons[Math.min(iconIdx, icons.length - 1)];
              var inp3 = td.querySelector('input.cell');
              if (inp3) {
                inp3.dataset.cfIcon = icon;
                var existing = td.querySelector('.cf-icon-badge');
                if (existing) existing.remove();
                var badge = document.createElement('span');
                badge.className = 'cf-icon-badge';
                badge.textContent = icon;
                badge.style.cssText = 'position:absolute;left:4px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:12px;z-index:2;';
                td.style.position = 'relative';
                td.style.paddingLeft = '24px';
                td.appendChild(badge);
                td.setAttribute('data-cf-applied', '1');
              }
            }
          }
        }
      });
    });

    // ── Apply row-level highlights ──────────────────────────────────────────
    // Row highlights override per-cell styles for the whole tr
    Object.keys(rowHighlights).forEach(function (rowIdxStr) {
      var rowIdx = parseInt(rowIdxStr, 10);
      var hl = rowHighlights[rowIdx];

      // Find the <tr> that contains this row's cells
      var anyCell = grid.querySelector('td input.cell[data-row="'+rowIdx+'"]');
      if (!anyCell) return;
      var tr = anyCell.closest('tr');
      if (!tr) return;

      tr.setAttribute('data-cf-row', '1');

      // Paint ALL td in this row (skip row-num td)
      tr.querySelectorAll('td').forEach(function (td) {
        if (td.classList.contains('row-num')) {
          // Paint a left accent bar on row-num
          if (hl.borderColor || hl.bgColor) {
            td.style.borderLeft = '3px solid ' + (hl.borderColor || hl.bgColor);
          }
          return;
        }
        if (hl.bgColor) td.style.background = hl.bgColor;
        td.setAttribute('data-cf-applied', '1');

        var inp = td.querySelector('input.cell');
        if (inp) {
          if (hl.textColor) {
            inp.style.color = hl.textColor;
          } else if (hl.bgColor) {
            inp.style.color = contrastColor(hl.bgColor);
          }
          inp.style.fontWeight     = hl.bold        ? '700' : '';
          inp.style.fontStyle      = hl.italic      ? 'italic' : '';
          var dec2 = [];
          if (hl.strikethrough) dec2.push('line-through');
          if (hl.underline)     dec2.push('underline');
          inp.style.textDecoration = dec2.join(' ') || '';
        }
      });

      // Top+bottom border accent for the whole row
      if (hl.borderColor) {
        var tds = tr.querySelectorAll('td');
        tds.forEach(function (td, i) {
          td.style.borderTop    = '1px solid ' + hl.borderColor;
          td.style.borderBottom = '1px solid ' + hl.borderColor;
        });
      }
    });
  }

  function applyStyleToTd(td, rule) {
    var bgColor   = rule.bgColor   || '';
    var textColor = rule.textColor || '';
    var bold      = !!rule.bold;
    var italic    = !!rule.italic;
    var strike    = !!rule.strikethrough;
    var underline = !!rule.underline;

    if (bgColor) td.style.background = bgColor;
    td.setAttribute('data-cf-applied', '1');

    var inp = td.querySelector('input.cell');
    if (inp) {
      if (textColor) inp.style.color = textColor;
      else if (bgColor) inp.style.color = contrastColor(bgColor);
      inp.style.fontWeight     = bold    ? '700' : '';
      inp.style.fontStyle      = italic  ? 'italic' : '';
      var dec = [];
      if (strike)    dec.push('line-through');
      if (underline) dec.push('underline');
      inp.style.textDecoration = dec.join(' ') || '';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     MODAL DOM BUILDING
  ───────────────────────────────────────────────────────────────────────── */

  function buildModal() {
    if (document.getElementById('svcCfModal')) return;

    var overlay = mkEl('div', { id: 'svcCfModal' });
    var panel   = mkEl('div', { className: 'svc-cf-panel' }, overlay);
    mkEl('div', { className: 'svc-cf-accent-bar' }, panel);

    // Header
    var header = mkEl('div', { className: 'svc-cf-header' }, panel);
    var icon   = mkEl('div', { className: 'svc-cf-header-icon', textContent: '🎨' }, header);
    var htxt   = mkEl('div', { className: 'svc-cf-header-text' }, header);
    mkEl('p', { className: 'svc-cf-header-title', textContent: 'Conditional Formatting' }, htxt);
    mkEl('p', { className: 'svc-cf-header-sub',   textContent: 'Format cells that meet defined criteria — like Google Sheets.' }, htxt);
    mkEl('span', { className: 'svc-cf-col-badge', id: 'cfColBadge', textContent: '' }, header);
    var closeBtn = mkEl('button', { className: 'svc-cf-close-btn', id: 'cfCloseBtn', textContent: '✕', title: 'Close' }, header);

    // Body — 2 panes
    var body = mkEl('div', { className: 'svc-cf-body' }, panel);

    // LEFT: rule list
    var listPane = mkEl('div', { className: 'svc-cf-list-pane' }, body);
    var listHdr  = mkEl('div', { className: 'svc-cf-list-header' }, listPane);
    mkEl('span', { className: 'svc-cf-list-label', textContent: 'Rules' }, listHdr);
    var addBtn = mkEl('button', { className: 'svc-cf-add-btn', id: 'cfAddRuleBtn', textContent: '+ Add rule' }, listHdr);
    var rulesList = mkEl('div', { className: 'svc-cf-rules-list', id: 'cfRulesList' }, listPane);

    // RIGHT: editor
    var editorPane = mkEl('div', { className: 'svc-cf-editor-pane', id: 'cfEditorPane' }, body);

    // Footer
    var footer = mkEl('div', { className: 'svc-cf-footer' }, panel);
    mkEl('button', { className: 'svc-cf-btn svc-cf-btn-ghost', id: 'cfClearAllBtn', textContent: '🗑 Clear All' }, footer);
    var spacer = mkEl('span', { style: 'flex:1' }, footer);
    mkEl('button', { className: 'svc-cf-btn svc-cf-btn-ghost', id: 'cfCancelBtn', textContent: 'Cancel' }, footer);
    mkEl('button', { className: 'svc-cf-btn svc-cf-btn-primary', id: 'cfSaveBtn', textContent: '✓ Done' }, footer);

    document.body.appendChild(overlay);

    /* Events */
    closeBtn.addEventListener('click', closeModal);
    document.getElementById('cfCancelBtn').addEventListener('click', closeModal);
    document.getElementById('cfSaveBtn').addEventListener('click', saveRules);
    document.getElementById('cfClearAllBtn').addEventListener('click', clearAllRules);
    document.getElementById('cfAddRuleBtn').addEventListener('click', addNewRule);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _state.open) closeModal();
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     RULES LIST RENDER
  ───────────────────────────────────────────────────────────────────────── */

  function renderRulesList() {
    var container = document.getElementById('cfRulesList');
    if (!container) return;
    container.innerHTML = '';

    if (!_state.rules.length) {
      var empty = mkEl('div', { className: 'svc-cf-rules-empty' }, container);
      mkEl('div', { className: 'svc-cf-rules-empty-icon', textContent: '🎨' }, empty);
      mkEl('div', { className: 'svc-cf-rules-empty-text', textContent: 'No rules yet. Click "+ Add rule" to start.' }, empty);
      renderEditor(null);
      return;
    }

    _state.rules.forEach(function (rule, idx) {
      var card = mkEl('div', { className: 'cf-rule-card' + (idx === _state.activeRuleIdx ? ' cf-rule-active' : '') }, container);
      card.dataset.idx = idx;

      // Color swatch
      var swatch = mkEl('div', { className: 'cf-rule-swatch' }, card);
      var swatchInner = mkEl('div', { className: 'cf-rule-swatch-inner' }, swatch);
      if (rule.type === 'color_scale') {
        swatch.style.background = 'linear-gradient(to right, '+(rule.scaleMin||'#f87171')+', '+(rule.scaleMid||'#fde047')+', '+(rule.scaleMax||'#4ade80')+')';
        swatchInner.textContent = '';
      } else if (rule.type === 'data_bar') {
        swatch.style.background = rule.barColor ? hexToRgba(rule.barColor, 0.3) : 'rgba(34,211,238,0.2)';
        swatch.style.borderColor = rule.barColor || '#22d3ee';
        swatchInner.textContent = '▬';
        swatchInner.style.color = rule.barColor || '#22d3ee';
      } else if (rule.type === 'icon_set') {
        var is = ICON_SETS.find(function (s) { return s.id === rule.iconSetId; }) || ICON_SETS[0];
        swatchInner.textContent = is.icons[2];
        swatch.style.background = 'rgba(129,140,248,0.15)';
      } else if (rule.bgColor) {
        swatch.style.background = rule.bgColor;
      } else {
        swatch.style.background = 'rgba(255,255,255,0.06)';
        swatchInner.textContent = 'T';
        swatchInner.style.color = rule.textColor || '#94a3b8';
        swatchInner.style.fontWeight = rule.bold ? '700' : '400';
      }

      // Meta
      var meta = mkEl('div', { className: 'cf-rule-meta' }, card);
      mkEl('div', { className: 'cf-rule-cond', textContent: getRuleLabel(rule) }, meta);
      mkEl('div', { className: 'cf-rule-preview', textContent: getRulePreview(rule) }, meta);

      // Order buttons
      var orderWrap = mkEl('div', { className: 'cf-rule-order-btns' }, card);
      var upBtn = mkEl('button', { className: 'cf-rule-order-btn', textContent: '▲', title: 'Move up' }, orderWrap);
      var dnBtn = mkEl('button', { className: 'cf-rule-order-btn', textContent: '▼', title: 'Move down' }, orderWrap);
      upBtn.disabled = idx === 0;
      dnBtn.disabled = idx === _state.rules.length - 1;

      // Delete button
      var delBtn = mkEl('button', { className: 'cf-rule-del-btn', textContent: '✕', title: 'Delete rule' }, card);

      // Events
      card.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        _state.activeRuleIdx = idx;
        _state.draft = deepClone(_state.rules[idx]);
        renderRulesList();
        renderEditor(_state.draft);
      });
      upBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (idx > 0) {
          var tmp = _state.rules[idx]; _state.rules[idx] = _state.rules[idx-1]; _state.rules[idx-1] = tmp;
          if (_state.activeRuleIdx === idx) _state.activeRuleIdx = idx-1;
          else if (_state.activeRuleIdx === idx-1) _state.activeRuleIdx = idx;
          renderRulesList();
          if (_state.draft) renderEditor(_state.draft);
        }
      });
      dnBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (idx < _state.rules.length-1) {
          var tmp2 = _state.rules[idx]; _state.rules[idx] = _state.rules[idx+1]; _state.rules[idx+1] = tmp2;
          if (_state.activeRuleIdx === idx) _state.activeRuleIdx = idx+1;
          else if (_state.activeRuleIdx === idx+1) _state.activeRuleIdx = idx;
          renderRulesList();
          if (_state.draft) renderEditor(_state.draft);
        }
      });
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _state.rules.splice(idx, 1);
        if (_state.activeRuleIdx >= _state.rules.length) {
          _state.activeRuleIdx = _state.rules.length - 1;
          _state.draft = _state.rules[_state.activeRuleIdx] ? deepClone(_state.rules[_state.activeRuleIdx]) : null;
        }
        renderRulesList();
        renderEditor(_state.draft);
      });
    });
  }

  function getRuleLabel(rule) {
    if (!rule) return '—';
    var typeLabel = { single_color:'Single Color', color_scale:'Color Scale', data_bar:'Data Bar', icon_set:'Icon Set', formula:'Custom Formula' };
    var type = typeLabel[rule.type] || rule.type;
    if (rule.type === 'single_color' || rule.type === 'formula') {
      var ops = [].concat(OPERATORS.text, OPERATORS.number, OPERATORS.date, OPERATORS.duplicate);
      var opObj = ops.find(function (o) { return o.value === (rule.operator || rule.type); });
      return opObj ? opObj.label.replace(/^[^\w]*/,'').trim() : type;
    }
    return type;
  }

  function getRulePreview(rule) {
    if (!rule) return '';
    if (rule.type === 'single_color' || rule.type === 'formula') {
      var parts = [];
      if (rule.bgColor) parts.push('BG: ' + rule.bgColor);
      if (rule.textColor) parts.push('Text: ' + rule.textColor);
      if (rule.bold) parts.push('Bold');
      if (rule.italic) parts.push('Italic');
      return parts.join(' · ') || 'Style set';
    }
    if (rule.type === 'color_scale') return (rule.scaleMin||'#f87171') + ' → ' + (rule.scaleMax||'#4ade80');
    if (rule.type === 'data_bar') return 'Bar: ' + (rule.barColor || '#22d3ee');
    if (rule.type === 'icon_set') {
      var is = ICON_SETS.find(function (s) { return s.id === rule.iconSetId; }) || ICON_SETS[0];
      return is.icons.join(' ');
    }
    return '';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     EDITOR PANE RENDER
  ───────────────────────────────────────────────────────────────────────── */

  function renderEditor(rule) {
    var pane = document.getElementById('cfEditorPane');
    if (!pane) return;
    pane.innerHTML = '';

    if (!rule) {
      var noRule = mkEl('div', { className: 'svc-cf-no-rule' }, pane);
      mkEl('div', { className: 'svc-cf-no-rule-icon', textContent: '🎨' }, noRule);
      mkEl('div', { className: 'svc-cf-no-rule-text', textContent: 'Select a rule to edit, or add a new one.' }, noRule);
      return;
    }

    var editor = mkEl('div', { className: 'svc-cf-editor' }, pane);

    /* ── FORMAT TYPE TABS ── */
    var typeSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Format Type' }, typeSection);
    var typeTabs = mkEl('div', { className: 'svc-cf-type-tabs' }, typeSection);
    FORMAT_TYPES.forEach(function (ft) {
      var tab = mkEl('button', {
        className: 'svc-cf-type-tab' + (rule.type === ft.id ? ' cf-tab-active' : ''),
        textContent: ft.label
      }, typeTabs);
      tab.addEventListener('click', function () {
        _state.draft.type = ft.id;
        // Reset operator to first option of relevant type
        if (ft.id === 'single_color') _state.draft.operator = _state.draft.operator || 'contains';
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });

    /* ── SECTION: APPLY TO RANGE ── */
    var rangeSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Apply To Column' }, rangeSection);
    var rangeChips = mkEl('div', { className: 'svc-cf-range-chips' }, rangeSection);
    var chip = mkEl('span', { className: 'svc-cf-range-chip', textContent: '📋 ' + _state.colLabel }, rangeChips);

    /* ── SECTION: FORMAT RULES ── */
    var ruleSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Format Rules' }, ruleSection);

    if (rule.type === 'single_color') {
      renderSingleColorCondition(ruleSection, rule);
    } else if (rule.type === 'color_scale') {
      renderColorScale(ruleSection, rule);
    } else if (rule.type === 'data_bar') {
      renderDataBar(ruleSection, rule);
    } else if (rule.type === 'icon_set') {
      renderIconSet(ruleSection, rule);
    } else if (rule.type === 'formula') {
      renderFormula(ruleSection, rule);
    }

    /* ── SECTION: FORMATTING STYLE (for single_color & formula) ── */
    if (rule.type === 'single_color' || rule.type === 'formula') {
      var styleSection = mkEl('div', { className: 'svc-cf-section' }, editor);
      mkEl('div', { className: 'svc-cf-section-title', textContent: 'Formatting Style' }, styleSection);
      renderStylePicker(styleSection, rule);

      /* ── ROW HIGHLIGHT TOGGLE (single_color) ── */
      if (rule.type === 'single_color') {
        var rowHlSection = mkEl('div', { className: 'svc-cf-section' }, editor);
        mkEl('div', { className: 'svc-cf-section-title', textContent: 'Row Highlight' }, rowHlSection);
        var rowToggleWrapSC = mkEl('div', { className: 'svc-cf-row-toggle-wrap' }, rowHlSection);
        var rowToggleSC = mkEl('label', { className: 'svc-cf-row-toggle-label' }, rowToggleWrapSC);
        var rowChkSC = mkEl('input', {
          type: 'checkbox',
          className: 'svc-cf-row-chk',
          checked: !!rule.highlightRow
        }, rowToggleSC);
        mkEl('span', { className: 'svc-cf-toggle-slider' }, rowToggleSC);
        mkEl('span', {
          className: 'svc-cf-toggle-text',
          textContent: '🌈 Highlight the entire row when condition is met'
        }, rowToggleSC);
        rowChkSC.addEventListener('change', function () {
          _state.draft.highlightRow = rowChkSC.checked;
          syncDraftToRule();
        });
      }
    }

    /* ── PREVIEW ── */
    var previewSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Preview' }, previewSection);
    renderPreview(previewSection, rule);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     SINGLE COLOR CONDITION BUILDER
  ───────────────────────────────────────────────────────────────────────── */

  function renderSingleColorCondition(parent, rule) {
    // Operator category tabs
    var catTabs = mkEl('div', { className: 'svc-cf-type-tabs', style: 'margin-bottom:10px;' }, parent);
    var categories = [
      { id: 'text',      label: '🔤 Text' },
      { id: 'number',    label: '🔢 Number' },
      { id: 'date',      label: '📅 Date' },
      { id: 'duplicate', label: '🔁 Duplicate' }
    ];
    var activeCat = rule._opCat || guessOpCat(rule.operator);
    if (!activeCat) activeCat = 'text';

    categories.forEach(function (cat) {
      var tab = mkEl('button', {
        className: 'svc-cf-type-tab' + (activeCat === cat.id ? ' cf-tab-active' : ''),
        textContent: cat.label,
        style: 'font-size:11px;padding:5px 10px;'
      }, catTabs);
      tab.addEventListener('click', function () {
        _state.draft._opCat = cat.id;
        _state.draft.operator = OPERATORS[cat.id][0].value;
        _state.draft.param1 = '';
        _state.draft.param2 = '';
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });

    // Operator select
    var condRow = mkEl('div', { className: 'svc-cf-condition-row' }, parent);
    var opSel = mkEl('select', { className: 'svc-cf-select svc-cf-operator-sel' }, condRow);
    var opList = OPERATORS[activeCat] || OPERATORS.text;
    opList.forEach(function (op) {
      var o = mkEl('option', { value: op.value, textContent: op.label }, opSel);
      if (op.value === rule.operator) o.selected = true;
    });
    opSel.addEventListener('change', function () {
      _state.draft.operator = opSel.value;
      syncDraftToRule();
      renderEditor(_state.draft);
    });

    // Value inputs
    var op = rule.operator;
    var noValue = ['empty','not_empty','date_today','date_tomorrow','date_yesterday','date_past_week','date_past_month','is_duplicate','is_unique'];
    var needsTwo = ['between','not_between'];

    if (noValue.indexOf(op) === -1) {
      var inputType = (activeCat === 'date' || op === 'date_before' || op === 'date_after' || op === 'date_eq') ? 'date' : 'text';
      var v1 = mkEl('input', {
        className: 'svc-cf-input svc-cf-value-input',
        type: inputType,
        placeholder: 'Value…',
        value: rule.param1 || ''
      }, condRow);
      v1.addEventListener('input', function () { _state.draft.param1 = v1.value; syncDraftToRule(); updatePreview(); });

      if (needsTwo.indexOf(op) !== -1) {
        mkEl('span', { className: 'svc-cf-between-sep', textContent: 'and' }, condRow);
        var v2 = mkEl('input', {
          className: 'svc-cf-input svc-cf-value-input2',
          type: 'text',
          placeholder: 'Value…',
          value: rule.param2 || ''
        }, condRow);
        v2.addEventListener('input', function () { _state.draft.param2 = v2.value; syncDraftToRule(); updatePreview(); });
      }
    }
  }

  function guessOpCat(op) {
    if (!op) return 'text';
    for (var cat in OPERATORS) {
      if (OPERATORS[cat].some(function (o) { return o.value === op; })) return cat;
    }
    return 'text';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     COLOR SCALE
  ───────────────────────────────────────────────────────────────────────── */

  function renderColorScale(parent, rule) {
    var row = mkEl('div', { className: 'svc-cf-scale-row' }, parent);

    [
      { key: 'scaleMin', label: '▼ Minimum', def: '#f87171' },
      { key: 'scaleMid', label: '— Midpoint', def: '#fde047' },
      { key: 'scaleMax', label: '▲ Maximum', def: '#4ade80' }
    ].forEach(function (stop) {
      var col = mkEl('div', { className: 'svc-cf-scale-stop' }, row);
      mkEl('div', { className: 'svc-cf-scale-stop-label', textContent: stop.label }, col);
      var sw = mkEl('div', { className: 'svc-cf-scale-swatch-wrap' }, col);
      var picker = mkEl('input', {
        type: 'color',
        className: 'svc-cf-scale-swatch',
        value: rule[stop.key] || stop.def,
        title: stop.label
      }, sw);
      picker.addEventListener('input', function () {
        _state.draft[stop.key] = picker.value;
        syncDraftToRule();
        updateScaleGradient(parent, rule);
        updatePreview();
      });
    });

    // Gradient preview bar
    var gradBar = mkEl('div', { className: 'svc-cf-scale-gradient', id: 'cfScaleGradBar' }, parent);
    updateScaleGradient(parent, rule);
  }

  function updateScaleGradient(parent, rule) {
    var bar = parent.querySelector('#cfScaleGradBar') || document.getElementById('cfScaleGradBar');
    if (!bar) return;
    var d = _state.draft || rule;
    bar.style.background = 'linear-gradient(to right, '+(d.scaleMin||'#f87171')+', '+(d.scaleMid||'#fde047')+', '+(d.scaleMax||'#4ade80')+')';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     DATA BAR
  ───────────────────────────────────────────────────────────────────────── */

  function renderDataBar(parent, rule) {
    var colorRow = mkEl('div', { className: 'svc-cf-color-row' }, parent);
    mkEl('div', { className: 'svc-cf-color-label', textContent: 'Bar Color' }, colorRow);
    var palette = mkEl('div', { className: 'svc-cf-palette' }, colorRow);
    renderSwatches(palette, BG_PALETTE, rule.barColor || '#22d3ee', function (hex) {
      _state.draft.barColor = hex;
      syncDraftToRule();
      updatePreview();
      // Refresh swatch active states
      renderDataBar(parent, _state.draft);
    });

    // Data bar preview
    var prevWrap = mkEl('div', { className: 'svc-cf-databar-preview', style: 'margin-top:10px;' }, parent);
    var fill = mkEl('div', { className: 'svc-cf-databar-fill' }, prevWrap);
    fill.style.background = rule.barColor || '#22d3ee';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     ICON SET
  ───────────────────────────────────────────────────────────────────────── */

  function renderIconSet(parent, rule) {
    var grid = mkEl('div', { className: 'svc-cf-iconset-grid' }, parent);
    ICON_SETS.forEach(function (is) {
      var opt = mkEl('div', {
        className: 'svc-cf-iconset-option' + (rule.iconSetId === is.id ? ' cf-iconset-active' : '')
      }, grid);
      mkEl('div', { className: 'svc-cf-iconset-icons', textContent: is.icons.join(' ') }, opt);
      mkEl('div', { className: 'svc-cf-iconset-name', textContent: is.name }, opt);
      opt.addEventListener('click', function () {
        _state.draft.iconSetId = is.id;
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     FORMULA EDITOR — with ROW HIGHLIGHT toggle + column reference builder
  ───────────────────────────────────────────────────────────────────────── */

  function renderFormula(parent, rule) {
    // ── Column reference quick-insert ──────────────────────────────────────
    var state2 = window.servicesGrid ? window.servicesGrid.getState() : null;
    var availCols = (state2 && state2.sheet && state2.sheet.column_defs) ? state2.sheet.column_defs : [];

    if (availCols.length) {
      var refSection = mkEl('div', { className: 'svc-cf-formula-ref-wrap' }, parent);
      mkEl('div', { className: 'svc-cf-formula-ref-label', textContent: '📋 Quick-insert column reference:' }, refSection);
      var chips = mkEl('div', { className: 'svc-cf-formula-ref-chips' }, refSection);
      availCols.forEach(function (col) {
        if (!col || !col.label) return;
        var chip = mkEl('button', {
          className: 'svc-cf-formula-ref-chip',
          textContent: col.label,
          title: 'Insert COL("' + col.label + '")'
        }, chips);
        chip.addEventListener('click', function () {
          var ta2 = parent.querySelector('.svc-cf-formula-input');
          if (!ta2) return;
          var ins = 'COL("' + col.label + '")';
          var start = ta2.selectionStart || 0;
          var end   = ta2.selectionEnd   || 0;
          ta2.value = ta2.value.slice(0, start) + ins + ta2.value.slice(end);
          ta2.selectionStart = ta2.selectionEnd = start + ins.length;
          ta2.dispatchEvent(new Event('input'));
          ta2.focus();
        });
      });
    }

    // ── Formula textarea ───────────────────────────────────────────────────
    var wrap = mkEl('div', { className: 'svc-cf-formula-wrap' }, parent);
    var ta = mkEl('textarea', {
      className: 'svc-cf-formula-input',
      placeholder: [
        '// Match a specific value in this column:',
        'VALUE === "O - Investigating"',
        '',
        '// Match value in ANOTHER column (row-level):',
        'COL("STATUS") === "O - Waiting for Customer"',
        'COL("Assigned To").includes("Mace")',
        '',
        '// Number comparisons:',
        'NUMVAL > 100',
        'NUMVAL >= 50 && NUMVAL <= 200'
      ].join('\n'),
      value: rule.formula || ''
    }, wrap);

    // ── Highlight entire row toggle ────────────────────────────────────────
    var rowToggleWrap = mkEl('div', { className: 'svc-cf-row-toggle-wrap' }, parent);
    var rowToggle = mkEl('label', { className: 'svc-cf-row-toggle-label' }, rowToggleWrap);
    var rowChk = mkEl('input', {
      type: 'checkbox',
      className: 'svc-cf-row-chk',
      checked: !!rule.highlightRow
    }, rowToggle);
    var toggleSlider = mkEl('span', { className: 'svc-cf-toggle-slider' }, rowToggle);
    var toggleText = mkEl('span', {
      className: 'svc-cf-toggle-text',
      textContent: '🌈 Highlight Entire Row (like Google Sheets row highlight)'
    }, rowToggle);

    // ── Variables reference card ───────────────────────────────────────────
    var varsCard = mkEl('div', { className: 'svc-cf-vars-card' }, parent);
    mkEl('div', { className: 'svc-cf-vars-title', textContent: '📖 Available Variables' }, varsCard);
    var varsList = [
      { name: 'VALUE',            desc: 'Cell value (string or number)',                 example: 'VALUE === "Active"' },
      { name: 'NUMVAL',           desc: 'Cell value as number (NaN if not numeric)',      example: 'NUMVAL > 100' },
      { name: 'COL("ColName")',   desc: 'Value of another column in the same row',        example: 'COL("STATUS") === "Submitted"' },
      { name: 'ROW_DATA',         desc: 'Full row data object (access by column key)',    example: 'ROW_DATA["col_key"]' }
    ];
    var varsTable = mkEl('div', { className: 'svc-cf-vars-table' }, varsCard);
    varsList.forEach(function (v) {
      var row2 = mkEl('div', { className: 'svc-cf-vars-row' }, varsTable);
      mkEl('code', { className: 'svc-cf-vars-name', textContent: v.name }, row2);
      mkEl('span', { className: 'svc-cf-vars-desc', textContent: v.desc }, row2);
      mkEl('code', { className: 'svc-cf-vars-example', textContent: v.example }, row2);
    });

    // ── Hint ──────────────────────────────────────────────────────────────
    mkEl('div', {
      className: 'svc-cf-formula-hint',
      textContent: 'JS expression — returns true/false. No semicolons needed. Use COL("Column Name") to reference other columns in the same row.'
    }, parent);

    // ── Events ────────────────────────────────────────────────────────────
    ta.addEventListener('input', function () {
      _state.draft.formula = ta.value;
      syncDraftToRule();
      updatePreview();
    });
    rowChk.addEventListener('change', function () {
      _state.draft.highlightRow = rowChk.checked;
      syncDraftToRule();
      updatePreview();
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     STYLE PICKER (for single_color + formula)
  ───────────────────────────────────────────────────────────────────────── */

  function renderStylePicker(parent, rule) {
    var styleGrid = mkEl('div', { className: 'svc-cf-style-grid' }, parent);

    // BG Color
    var bgRow = mkEl('div', { className: 'svc-cf-color-row' }, styleGrid);
    mkEl('div', { className: 'svc-cf-color-label', textContent: '🟥 Background Color' }, bgRow);
    var bgPal = mkEl('div', { className: 'svc-cf-palette' }, bgRow);
    renderSwatches(bgPal, BG_PALETTE, rule.bgColor || '', function (hex) {
      _state.draft.bgColor = hex;
      syncDraftToRule();
      updatePreview();
    }, true);
    // Custom color
    var bgCustom = mkEl('input', { type: 'color', className: 'svc-cf-custom-color', value: rule.bgColor || '#ffffff', title: 'Custom color' }, bgPal);
    bgCustom.addEventListener('input', function () {
      _state.draft.bgColor = bgCustom.value;
      syncDraftToRule();
      updatePreview();
    });

    // Text Color
    var txRow = mkEl('div', { className: 'svc-cf-color-row' }, styleGrid);
    mkEl('div', { className: 'svc-cf-color-label', textContent: '🔤 Text Color' }, txRow);
    var txPal = mkEl('div', { className: 'svc-cf-palette' }, txRow);
    renderSwatches(txPal, TEXT_PALETTE, rule.textColor || '', function (hex) {
      _state.draft.textColor = hex;
      syncDraftToRule();
      updatePreview();
    }, true);
    var txCustom = mkEl('input', { type: 'color', className: 'svc-cf-custom-color', value: rule.textColor || '#ffffff', title: 'Custom text color' }, txPal);
    txCustom.addEventListener('input', function () {
      _state.draft.textColor = txCustom.value;
      syncDraftToRule();
      updatePreview();
    });

    // Font style
    var fontRow = mkEl('div', { className: 'svc-cf-font-row', style: 'grid-column:1/-1;' }, styleGrid);
    mkEl('div', { className: 'svc-cf-color-label', textContent: 'Font Style' }, fontRow);
    var fontToggles = mkEl('div', { className: 'svc-cf-font-toggles' }, fontRow);

    var fontBtns = [
      { key: 'bold',          label: 'B', style: 'font-weight:700;',              title: 'Bold' },
      { key: 'italic',        label: 'I', style: 'font-style:italic;',            title: 'Italic' },
      { key: 'strikethrough', label: 'S', style: 'text-decoration:line-through;', title: 'Strikethrough' },
      { key: 'underline',     label: 'U', style: 'text-decoration:underline;',    title: 'Underline' }
    ];
    fontBtns.forEach(function (fb) {
      var btn = mkEl('button', {
        className: 'svc-cf-font-btn' + (rule[fb.key] ? ' cf-font-active' : ''),
        title: fb.title
      }, fontToggles);
      btn.innerHTML = '<span style="'+fb.style+'">'+fb.label+'</span>';
      btn.addEventListener('click', function () {
        _state.draft[fb.key] = !_state.draft[fb.key];
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });
  }

  function renderSwatches(container, palette, currentHex, onChange, allowNone) {
    if (allowNone) {
      var noneBtn = mkEl('div', {
        className: 'svc-cf-swatch' + (!currentHex ? ' cf-swatch-active' : ''),
        title: 'None',
        style: 'background:transparent;border:1.5px dashed rgba(148,163,184,0.3);position:relative;'
      }, container);
      noneBtn.innerHTML = '<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:10px;color:#475569;">∅</span>';
      noneBtn.addEventListener('click', function () { onChange(''); });
    }
    palette.forEach(function (hex) {
      var sw = mkEl('div', {
        className: 'svc-cf-swatch' + (hex === currentHex ? ' cf-swatch-active' : ''),
        style: 'background:' + hex + ';',
        title: hex
      }, container);
      sw.addEventListener('click', function () { onChange(hex); });
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     PREVIEW CELL
  ───────────────────────────────────────────────────────────────────────── */

  var _previewUpdateTimeout = null;

  function renderPreview(parent, rule) {
    var wrap = mkEl('div', { className: 'svc-cf-preview-wrap', id: 'cfPreviewWrap' }, parent);
    mkEl('div', { className: 'svc-cf-preview-label', textContent: 'PREVIEW' }, wrap);
    var cell = mkEl('div', { className: 'svc-cf-preview-cell', id: 'cfPreviewCell', textContent: 'Sample Text' }, wrap);
    applyPreviewStyle(rule);
  }

  function updatePreview() {
    clearTimeout(_previewUpdateTimeout);
    _previewUpdateTimeout = setTimeout(function () {
      if (_state.draft) applyPreviewStyle(_state.draft);
    }, 80);
  }

  function applyPreviewStyle(rule) {
    var cell = document.getElementById('cfPreviewCell');
    if (!cell) return;
    cell.style.background = '';
    cell.style.color = '';
    cell.style.fontWeight = '';
    cell.style.fontStyle = '';
    cell.style.textDecoration = '';

    if (rule.type === 'single_color' || rule.type === 'formula') {
      if (rule.bgColor) cell.style.background = rule.bgColor;
      if (rule.textColor) {
        cell.style.color = rule.textColor;
      } else if (rule.bgColor) {
        cell.style.color = contrastColor(rule.bgColor);
      }
      if (rule.bold) cell.style.fontWeight = '700';
      if (rule.italic) cell.style.fontStyle = 'italic';
      var dec = [];
      if (rule.strikethrough) dec.push('line-through');
      if (rule.underline) dec.push('underline');
      cell.style.textDecoration = dec.join(' ');
    } else if (rule.type === 'color_scale') {
      var mid = rule.scaleMid || '#fde047';
      cell.style.background = mid;
      cell.style.color = contrastColor(mid);
      cell.textContent = 'Scaled Value';
    } else if (rule.type === 'data_bar') {
      var bc = rule.barColor || '#22d3ee';
      cell.style.background = 'linear-gradient(to right, '+hexToRgba(bc, 0.45)+' 65%, transparent 65%)';
      cell.style.borderLeft = '3px solid ' + bc;
      cell.textContent = '6,500';
    } else if (rule.type === 'icon_set') {
      var is = ICON_SETS.find(function (s) { return s.id === rule.iconSetId; }) || ICON_SETS[0];
      cell.textContent = is.icons[2] + ' High';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     DRAFT SYNC
  ───────────────────────────────────────────────────────────────────────── */

  function syncDraftToRule() {
    if (_state.activeRuleIdx >= 0 && _state.draft) {
      _state.rules[_state.activeRuleIdx] = deepClone(_state.draft);
    }
    paintGrid(); // live preview on the grid
  }

  /* ─────────────────────────────────────────────────────────────────────────
     OPEN / CLOSE / SAVE
  ───────────────────────────────────────────────────────────────────────── */

  function openModal(colIdx, colKey, colLabel, existingRules) {
    buildModal();

    _state.open = true;
    _state.colIdx = colIdx;
    _state.colKey = colKey;
    _state.colLabel = colLabel;
    _state.rules = deepClone(existingRules || []);
    _state.activeRuleIdx = _state.rules.length > 0 ? 0 : -1;
    _state.draft = _state.rules.length > 0 ? deepClone(_state.rules[0]) : null;

    var badge = document.getElementById('cfColBadge');
    if (badge) badge.textContent = colLabel;

    var overlay = document.getElementById('svcCfModal');
    overlay.classList.add('cf-open');

    renderRulesList();
    renderEditor(_state.draft);
  }

  function closeModal() {
    var overlay = document.getElementById('svcCfModal');
    if (overlay) overlay.classList.remove('cf-open');
    _state.open = false;
    // Repaint with latest saved rules from column_defs
    paintGrid();
  }

  async function saveRules() {
    if (!window.servicesGrid || !window.servicesDB) { closeModal(); return; }
    var state = window.servicesGrid.getState();
    if (!state || !state.sheet) { closeModal(); return; }

    var cols = state.sheet.column_defs || [];
    var col = cols[_state.colIdx];
    if (!col) { closeModal(); return; }

    // Commit draft
    if (_state.activeRuleIdx >= 0 && _state.draft) {
      _state.rules[_state.activeRuleIdx] = deepClone(_state.draft);
    }

    col.conditionalRules = deepClone(_state.rules);

    try {
      await window.servicesDB.updateColumns(state.sheet.id, cols);
      window.svcToast && window.svcToast.show('success', 'Conditional Formatting', 'Rules saved successfully.');
      paintGrid();
    } catch (err) {
      window.svcToast && window.svcToast.show('error', 'CF Save Failed', err && err.message ? err.message : 'Try again.');
    }
    closeModal();
  }

  async function clearAllRules() {
    if (!confirm('Clear all conditional formatting rules for column "' + _state.colLabel + '"?')) return;
    _state.rules = [];
    _state.activeRuleIdx = -1;
    _state.draft = null;
    renderRulesList();
    renderEditor(null);
    paintGrid();
  }

  function addNewRule() {
    var newRule = {
      id: uid(),
      type: 'single_color',
      operator: 'contains',
      param1: '',
      param2: '',
      bgColor: '#fef08a',
      textColor: '',
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      _opCat: 'text'
    };
    _state.rules.push(newRule);
    _state.activeRuleIdx = _state.rules.length - 1;
    _state.draft = deepClone(newRule);
    renderRulesList();
    renderEditor(_state.draft);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     HOOK INTO SERVICES-GRID RENDER
     We patch render() to repaint CF after every grid rebuild.
  ───────────────────────────────────────────────────────────────────────── */

  function hookGridRender() {
    if (!window.servicesGrid) {
      setTimeout(hookGridRender, 200);
      return;
    }
    // Guard: only hook once — prevents double-wrapping on hot reload
    if (window.servicesGrid._cfHooked) return;
    window.servicesGrid._cfHooked = true;

    var origLoad = window.servicesGrid.load;
    window.servicesGrid.load = async function (sheet) {
      try { await origLoad.call(this, sheet); } catch (e) { throw e; }
      setTimeout(paintGrid, 80); // allow DOM settle after async load
    };

    var origRender = window.servicesGrid.render;
    window.servicesGrid.render = function () {
      origRender.call(this);
      setTimeout(paintGrid, 50);
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────────────────────────────────────── */

  window.svcConditionalFormat = {
    open: openModal,
    paint: paintGrid,
    close: closeModal
  };

  // Hook in after grid is ready
  hookGridRender();

  // Also repaint on QB lookup autofill completion (data may have changed)
  document.addEventListener('svc:qb-paint-done', function () {
    setTimeout(paintGrid, 60);
  });

})();
