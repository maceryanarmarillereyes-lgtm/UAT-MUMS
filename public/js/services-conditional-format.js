/**
 * @file services-conditional-format.js
 * @description Services module: conditional formatting rules engine for service grid rows
 * @module MUMS/Services
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE â€” MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX Â· Realtime Sync Logic Â· Core State Management Â·
   Database/API Adapters Â· Tab Isolation Â· Virtual Column State Â·
   QuickBase Settings Persistence Â· Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt â€” STOP and REPORT. */

/**
 * services-conditional-format.js â€” v2.0
 * Conditional Formatting engine for Services Workspace (MUMS).
 *
 * v2.0 FIXES vs v1.0:
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * [FIX-ROW-1] BUG: `if (!td) return` inside rows.forEach caused early-exit
 *   before rowHighlights was populated. Hidden/scrolled-out columns killed
 *   the entire row highlight for that row.
 *   FIX: Split paintGrid into PASS 1 (pure data, zero DOM) and PASS 2 (DOM).
 *   Row highlight collection now runs purely against row.data â€” no DOM needed.
 *
 * [FIX-ROW-2] BUG: Row highlight used CSS class + CSS variable approach:
 *   `tr.cf-row-highlighted td { background-color: var(--cf-row-bg) !important }`
 *   Per-cell rules used `td.style.setProperty('background', color, 'important')`.
 *   Inline style !important ALWAYS beats CSS class !important in all browsers,
 *   creating "holes" in the row highlight wherever a per-cell rule also fired.
 *   FIX: Row highlight now applies bg directly via inline style.setProperty on
 *   EVERY td in the row (Pass 2A). Per-cell styles applied in Pass 2B naturally
 *   override specific cells (same inline specificity, applied later = wins).
 *
 * All other logic: constants, evalRule, modal, editor, save â€” UNCHANGED.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

(function () {
  'use strict';

  // FIX-CF-SUSPEND: While QB bulk update is running, suspend paintGrid() calls
  var _paintSuspended = false;

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     CONSTANTS & PALETTES
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  var BG_PALETTE = [
    '#fecaca','#fca5a5','#f87171','#ef4444','#dc2626',
    '#fed7aa','#fdba74','#fb923c','#f97316','#ea580c',
    '#fef08a','#fde047','#facc15','#eab308','#ca8a04',
    '#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a',
    '#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2',
    '#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb',
    '#e9d5ff','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed',
    '#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777',
    '#f1f5f9','#e2e8f0','#cbd5e1','#94a3b8','#64748b',
    '#1e293b','#0f172a','#020617','#1c1c1c','#000000',
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
      { value: 'num_neq',       label: '\u2260 Not equal to' },
      { value: 'num_gt',        label: '> Greater than' },
      { value: 'num_gte',       label: '\u2265 Greater than or equal' },
      { value: 'num_lt',        label: '< Less than' },
      { value: 'num_lte',       label: '\u2264 Less than or equal' },
      { value: 'between',       label: '\u2194 Between' },
      { value: 'not_between',   label: '\u21ae Not between' },
      { value: 'empty',         label: 'Is empty' },
      { value: 'not_empty',     label: 'Is not empty' }
    ],
    date: [
      { value: 'date_today',    label: '\uD83D\uDCC5 Is today' },
      { value: 'date_tomorrow', label: '\uD83D\uDCC5 Is tomorrow' },
      { value: 'date_yesterday','label': '\uD83D\uDCC5 Is yesterday' },
      { value: 'date_past_week','label': '\uD83D\uDCC5 In past week' },
      { value: 'date_past_month','label':'\uD83D\uDCC5 In past month' },
      { value: 'date_before',   label: '\uD83D\uDCC5 Date is before' },
      { value: 'date_after',    label: '\uD83D\uDCC5 Date is after' },
      { value: 'date_eq',       label: '\uD83D\uDCC5 Date is exactly' },
      { value: 'empty',         label: 'Is empty' },
      { value: 'not_empty',     label: 'Is not empty' }
    ],
    duplicate: [
      { value: 'is_duplicate',  label: 'Duplicate values' },
      { value: 'is_unique',     label: 'Unique values' }
    ]
  };

  var ICON_SETS = [
    { id: 'traffic',   icons: ['\uD83D\uDD34','\uD83D\uDFE1','\uD83D\uDFE2'],        name: 'Traffic Lights' },
    { id: 'arrows',    icons: ['\u2191','\u2192','\u2193'],                            name: 'Arrows' },
    { id: 'stars',     icons: ['\u2B50','\u2B50\u2B50','\u2B50\u2B50\u2B50'],         name: 'Stars' },
    { id: 'check',     icons: ['\u274C','\u26A0\uFE0F','\u2705'],                      name: 'Check Marks' },
    { id: 'flags',     icons: ['\uD83D\uDEA9','\uD83C\uDFF3\uFE0F','\uD83D\uDE80'],   name: 'Flags' },
    { id: 'numbers',   icons: ['\u2460','\u2461','\u2462'],                            name: 'Numbers' }
  ];

  var FORMAT_TYPES = [
    { id: 'single_color', label: '\uD83C\uDFA8 Single Color' },
    { id: 'color_scale',  label: '\uD83C\uDF08 Color Scale' },
    { id: 'data_bar',     label: '\uD83D\uDCCA Data Bar' },
    { id: 'icon_set',     label: '\uD83C\uDFF7 Icon Set' },
    { id: 'formula',      label: '\u0192x Custom Formula' }
  ];

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     STATE
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  var _state = {
    open: false,
    colIdx: -1,
    colKey: '',
    colLabel: '',
    rules: [],
    activeRuleIdx: -1,
    draft: null
  };

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     UTILS
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     EVALUATION ENGINE
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
      case 'is_duplicate':
      case 'is_unique':
        return false;
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

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     PAINT ENGINE v3.0 â€” DOM-walk architecture
     â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     v3.0 FIXES vs v2.0:
     [FIX-ROW-3] BUG: Pass 2A used querySelector('tr[data-row="X"]') to find rows.
       Padding/empty rows in render() share the same row_index value as real rows
       when viewRows is filtered/sorted (loop counter i collides with row.row_index).
       querySelector returns the FIRST match â€” often the WRONG tr.
       This caused "some rows highlight, others don't" â€” the exact symptom in screenshots.
       FIX: Pre-build domRowMap by walking tbody ONCE. Each tr appears exactly once.
       rowHighlights and cellStyles look up O(1) from the map. Zero collision.

     [FIX-ROW-4] BUG: Rules with no bgColor (only textColor) produced semiBg=''
       â†’ rowRef.__cfRowBg='' â†’ falsy â†’ render() re-stamp skipped cf-row-highlighted
       â†’ next render() lost the text color that paintGrid applied.
       FIX: Store 'cf-row-hl' sentinel when bgColor is absent so re-stamp always fires.

     [FIX-ROW-5] BUG: Pass 2B per-cell also used querySelector â€” same collision risk.
       FIX: Now uses domRowMap[rowIdxStr].inputs[colKey] â€” direct O(1) lookup.

     All other logic: evalRule, modal, editor, save â€” UNCHANGED.
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function paintGrid() {
    if (_paintSuspended) {
      console.log('[CF] paintGrid skipped — suspended, will retry in 500ms');
      setTimeout(function() { paintGrid(); }, 500);
      return;
    }

    var grid = document.getElementById('svcGrid');
    if (!grid || !window.servicesGrid) return;
    var state = window.servicesGrid.getState();
    if (!state || !state.sheet) return;

    var cols = state.sheet.column_defs || [];
    var rows = state.rows || [];
    if (state.__treeFilteredRows) rows = state.__treeFilteredRows;

    // Build label->key map for COL() formula function
    var colLabelMap = {};
    cols.forEach(function (c) {
      if (c && c.label && c.key) colLabelMap[c.label] = c.key;
    });

    /* =========================================================================
       PRE-BUILD DOM MAP â€” walk tbody once, build rowIndex(string)->DOM lookup
       [FIX-ROW-3] Each DOM tr appears exactly once. No collision possible.
       Map key = tr.dataset.row (= String(row.row_index) stamped in render()).
    ========================================================================= */
    var domRowMap = {}; // String(rowIndex) -> { tr, tds:[], inputs:{key->inp} }
    var tbody = grid.querySelector('tbody');
    if (tbody) {
      tbody.querySelectorAll('tr').forEach(function (tr) {
        var ri = tr.dataset.rowId || tr.getAttribute('data-row-id') || tr.dataset.row;
        if (ri == null || ri === '') return;
        var entry = { tr: tr, tds: [], inputs: {} };
        tr.querySelectorAll('td').forEach(function (td) {
          entry.tds.push(td);
          var inp = td.querySelector('input.cell');
          if (inp && inp.dataset.key) entry.inputs[inp.dataset.key] = inp;
        });
        domRowMap[ri] = entry;
      });
    }

    /* =========================================================================
       CLEAR â€” Remove all previous CF inline styles via domRowMap
    ========================================================================= */
    Object.keys(domRowMap).forEach(function (ri) {
      var entry = domRowMap[ri];
      var tr = entry.tr;

      tr.removeAttribute('data-cf-row');
      tr.classList.remove('cf-row-highlighted');
      tr.style.removeProperty('--cf-row-bg');
      tr.style.removeProperty('--cf-row-accent');

      entry.tds.forEach(function (td) {
        td.removeAttribute('data-cf-applied');
        td.removeAttribute('data-cf-row-bg');
        td.style.removeProperty('background');
        td.style.removeProperty('border-left');
        td.style.removeProperty('outline');
        td.style.removeProperty('position');
        td.style.removeProperty('padding-left');
        td.style.removeProperty('box-shadow');
        var badge = td.querySelector('.cf-icon-badge');
        if (badge) badge.remove();
      });

      Object.keys(entry.inputs).forEach(function (k) {
        var inp = entry.inputs[k];
        inp.style.removeProperty('color');
        inp.style.removeProperty('font-weight');
        inp.style.removeProperty('font-style');
        inp.style.removeProperty('text-decoration');
        inp.style.removeProperty('font-family');
        inp.dataset.cfIcon = '';
        inp.dataset.cfQbStripped = '';
      });
    });

    /* =========================================================================
       PASS 1 â€” PURE DATA EVALUATION (zero DOM access)
       Collect: rowHighlights{}, cellStyles{}, colorScales[], dataBars[], iconSets[].
       Key change from v2.0: rowHighlights keyed by String(row.row_index) = domRowMap key.
       [FIX-ROW-3-REVISED] Evaluate ALL rows in data, apply only to DOM in PASS 2.
    ========================================================================= */
    var rowHighlights = {}; // String(rowIdx) -> highlight info
    var cellStyles    = {}; // 'rowIdxStr:::colKey' -> {rowIdxStr, colKey, rule}
    var colorScales   = []; // [{rowIdxStr, colKey, color}]
    var dataBars      = []; // [{rowIdxStr, colKey, pct, barColor}]
    var iconSets      = []; // [{rowIdxStr, colKey, icon}]

    // Clear stale CF flags on ALL rows before re-evaluating
    rows.forEach(function(r){ if(r){ delete r.__cfRowBg; delete r.__cfTextColor; } });

    cols.forEach(function (col) {
      if (!col || !Array.isArray(col.conditionalRules) || !col.conditionalRules.length) return;

      var rules = col.conditionalRules.filter(function (r) { return r && !r.disabled; });
      if (!rules.length) return;

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

      // PERMANENT FIX 2026-05-04: Evaluate ALL rows (not just visible DOM)
    // Previous [FIX-ROW-3] caused highlights to disappear on scroll because
    // off-screen rows were never evaluated, so __cfRowBg was never set.
    rows.forEach(function (row, rowPos) {
        if (!row || !row.data) return;
        var rowDomKey = row && row.id != null ? String(row.id) : String(row.row_index != null ? row.row_index : rowPos);
        var rowIdxStr = rowDomKey;

        var cellValue = row.data[col.key] != null ? row.data[col.key] : '';
        var cellStr   = String(cellValue).trim();

        for (var ri = 0; ri < rules.length; ri++) {
          var rule = rules[ri];
          var matched = false;

          if (rule.type === 'single_color' || rule.type === 'formula') {
            if (rule.operator === 'is_duplicate') {
              matched = cellStr !== '' && (valueCounts[cellStr] || 0) > 1;
            } else if (rule.operator === 'is_unique') {
              matched = cellStr !== '' && (valueCounts[cellStr] || 0) === 1;
            } else if (rule.type === 'formula') {
              rule._evalRowData     = row.data;
              rule._evalColLabelMap = colLabelMap;
              matched = evalRule(rule, cellValue);
              delete rule._evalRowData;
              delete rule._evalColLabelMap;
            } else {
              matched = evalRule(rule, cellValue);
            }

            if (matched) {
              if (rule.highlightRow) {
                if (!rowHighlights[rowIdxStr]) {
                  rowHighlights[rowIdxStr] = {
                    rowIdx:       rowIdx,
                    bgColor:      rule.bgColor       || '',
                    textColor:    rule.textColor     || '',
                    bold:         !!rule.bold,
                    italic:       !!rule.italic,
                    strikethrough:!!rule.strikethrough,
                    underline:    !!rule.underline,
                    borderColor:  rule.rowBorderColor || ''
                  };
                }
              } else {
                var cellKey = rowIdxStr + ':::' + col.key;
                if (!cellStyles[cellKey]) {
                  cellStyles[cellKey] = { rowIdxStr: rowIdxStr, colKey: col.key, rule: rule };
                }
              }
              break; // first-match-wins
            }

          } else if (rule.type === 'color_scale') {
            var numV = parseFloat(cellStr);
            if (!isNaN(numV) && maxVal !== minVal) {
              var t = (numV - minVal) / (maxVal - minVal);
              var color = t <= 0.5
                ? interpolateHex(rule.scaleMin || '#f87171', rule.scaleMid || '#fde047', t * 2)
                : interpolateHex(rule.scaleMid || '#fde047', rule.scaleMax || '#4ade80', (t - 0.5) * 2);
              colorScales.push({ rowIdxStr: rowIdxStr, colKey: col.key, color: color });
            }
          } else if (rule.type === 'data_bar') {
            var numV2 = parseFloat(cellStr);
            if (!isNaN(numV2)) {
              var pct = maxVal !== minVal
                ? Math.max(0, Math.min(100, ((numV2 - minVal) / (maxVal - minVal)) * 100))
                : 50;
              dataBars.push({ rowIdxStr: rowIdxStr, colKey: col.key, pct: pct, barColor: rule.barColor || '#22d3ee' });
            }
          } else if (rule.type === 'icon_set') {
            var numV3 = parseFloat(cellStr);
            if (!isNaN(numV3)) {
              var iconSet = ICON_SETS.find(function (s) { return s.id === rule.iconSetId; }) || ICON_SETS[0];
              var icons   = iconSet.icons;
              var t3      = maxVal !== minVal ? (numV3 - minVal) / (maxVal - minVal) : 0.5;
              var iconIdx = t3 < 0.33 ? 0 : t3 < 0.67 ? 1 : 2;
              iconSets.push({ rowIdxStr: rowIdxStr, colKey: col.key, icon: icons[Math.min(iconIdx, icons.length - 1)] });
            }
          }
        }
  
    // PERMANENT FIX: Persist __cfRowBg for ALL rows (not just visible)
    // This ensures render() can re-stamp highlights when rows scroll into view
    Object.keys(rowHighlights).forEach(function(rowIdxStr){
      var hl = rowHighlights[rowIdxStr];
      var semiBg = '';
      if (hl.bgColor) {
        semiBg = hexToRgba(hl.bgColor, 0.28);
      } else if (hl.textColor) {
        semiBg = hexToRgba(hl.textColor, 0.12);
      } else {
        semiBg = 'rgba(99,102,241,0.12)';
      }
      var rowRef = rows.find(function(r){
        if (!r) return false;
        if (r.id != null && String(r.id) === rowIdxStr) return true;
        return r.row_index != null && String(r.row_index) === rowIdxStr;
      });
      if (rowRef) {
        rowRef.__cfRowBg = semiBg;
        rowRef.__cfTextColor = hl.textColor || '';
      }
    });
    });
    });

    /* =========================================================================
       PASS 2A â€” ROW HIGHLIGHTS (applied FIRST)
       [FIX-ROW-3] domRowMap[rowIdxStr] â€” O(1), zero collision.
       [FIX-ROW-2] Direct inline setProperty on EVERY td â€” no "holes".
       [FIX-ROW-4] textColor-only rules also persist across re-renders.
    ========================================================================= */
    Object.keys(rowHighlights).forEach(function (rowIdxStr) {
      var hl    = rowHighlights[rowIdxStr];
      var entry = domRowMap[rowIdxStr];
      if (!entry) return;

      var tr = entry.tr;
      tr.classList.add('cf-row-highlighted');
      tr.setAttribute('data-cf-row', '1');

      var semiBg = '';
      if (hl.bgColor) {
        semiBg = hexToRgba(hl.bgColor, 0.28);
      } else if (hl.textColor) {
        // FIX-SEMIBG: When no bgColor but textColor is set and highlightRow=true,
        // derive a faint tint from textColor so the row highlight is visible.
        // Without this, --cf-row-bg = transparent â†’ class exists but row looks unhighlighted.
        semiBg = hexToRgba(hl.textColor, 0.12);
      } else {
        // No color at all â€” use a neutral steel-blue tint as last resort
        semiBg = 'rgba(99,102,241,0.12)';
      }
      var accentColor = hl.borderColor || hl.bgColor || '';

      tr.style.setProperty('--cf-row-bg', semiBg || 'transparent');
      if (accentColor) tr.style.setProperty('--cf-row-accent', accentColor);

      // __cfRowBg already persisted for all rows above (PERMANENT FIX)

      // Apply bg to EVERY td via domRowMap â€” [FIX-ROW-3] no rescan, no collision
      // FIX-SEMIBG: semiBg is always non-empty for rowHighlight (fallback derived above).
      // No longer guarded by if(semiBg) â€” every highlighted row gets a visible bg.
      entry.tds.forEach(function (td) {
        td.style.setProperty('background', semiBg, 'important');
        td.setAttribute('data-cf-row-bg', '1');
        td.setAttribute('data-cf-applied', '1');
      });

      // Text style on all inputs
      var dec2 = [];
      if (hl.strikethrough) dec2.push('line-through');
      if (hl.underline)     dec2.push('underline');

      Object.keys(entry.inputs).forEach(function (k) {
        var inp = entry.inputs[k];
        if (hl.textColor) {
          inp.style.setProperty('color', hl.textColor, 'important');
        } else if (hl.bgColor) {
          var c2 = hl.bgColor.replace('#', '');
          if (c2.length === 3) c2 = c2[0]+c2[0]+c2[1]+c2[1]+c2[2]+c2[2];
          var rr = parseInt(c2.substr(0,2),16), gg = parseInt(c2.substr(2,2),16), bb = parseInt(c2.substr(4,2),16);
          var lum = (0.299*rr + 0.587*gg + 0.114*bb) / 255;
          inp.style.setProperty('color', lum > 0.55 ? '#1e293b' : '#f1f5f9', 'important');
        }
        inp.style.setProperty('font-weight',     hl.bold   ? '700'    : 'normal', 'important');
        inp.style.setProperty('font-style',      hl.italic ? 'italic' : 'normal', 'important');
        inp.style.setProperty('text-decoration', dec2.join(' ') || 'none',        'important');
      });
    });

    /* =========================================================================
       PASS 2B â€” PER-CELL STYLES (applied AFTER row highlights)
       [FIX-ROW-5] domRowMap lookup â€” no querySelector collision.
    ========================================================================= */
    Object.keys(cellStyles).forEach(function (key) {
      var cs    = cellStyles[key];
      var entry = domRowMap[cs.rowIdxStr];
      if (!entry) return;
      var inp = entry.inputs[cs.colKey];
      if (!inp) return;
      var td = inp.parentElement;
      if (!td) return;
      applyStyleToTd(td, cs.rule);
    });

    /* =========================================================================
       PASS 2C â€” COLOR SCALES
    ========================================================================= */
    colorScales.forEach(function (cs) {
      var entry = domRowMap[cs.rowIdxStr];
      if (!entry) return;
      var inp = entry.inputs[cs.colKey]; if (!inp) return;
      var td  = inp.parentElement;       if (!td)  return;
      td.style.background = cs.color;
      td.setAttribute('data-cf-applied', '1');
      inp.style.color = contrastColor(cs.color);
    });

    /* =========================================================================
       PASS 2D â€” DATA BARS
    ========================================================================= */
    dataBars.forEach(function (db) {
      var entry = domRowMap[db.rowIdxStr];
      if (!entry) return;
      var inp = entry.inputs[db.colKey]; if (!inp) return;
      var td  = inp.parentElement;       if (!td)  return;
      td.style.background = 'linear-gradient(to right, ' + hexToRgba(db.barColor, 0.45) + ' ' + db.pct + '%, transparent ' + db.pct + '%)';
      td.style.borderLeft = '3px solid ' + db.barColor;
      td.setAttribute('data-cf-applied', '1');
    });

    /* =========================================================================
       PASS 2E â€” ICON SETS
    ========================================================================= */
    iconSets.forEach(function (is) {
      var entry = domRowMap[is.rowIdxStr];
      if (!entry) return;
      var inp = entry.inputs[is.colKey]; if (!inp) return;
      var td  = inp.parentElement;       if (!td)  return;
      inp.dataset.cfIcon = is.icon;
      var existing = td.querySelector('.cf-icon-badge');
      if (existing) existing.remove();
      var badge = document.createElement('span');
      badge.className = 'cf-icon-badge';
      badge.textContent = is.icon;
      badge.style.cssText = 'position:absolute;left:4px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:12px;z-index:2;';
      td.style.position    = 'relative';
      td.style.paddingLeft = '24px';
      td.appendChild(badge);
      td.setAttribute('data-cf-applied', '1');
    });
  }


  function applyStyleToTd(td, rule) {
    var bgColor   = rule.bgColor   || '';
    var textColor = rule.textColor || '';
    var bold      = !!rule.bold;
    var italic    = !!rule.italic;
    var strike    = !!rule.strikethrough;
    var underline = !!rule.underline;

    if (bgColor) {
      td.style.setProperty('background', bgColor, 'important');
      td.style.setProperty('box-shadow', [
        'inset -1px 0 0 rgba(148,163,184,0.22)',
        'inset 0 -1px 0 rgba(148,163,184,0.22)'
      ].join(', '), 'important');
    }
    td.setAttribute('data-cf-applied', '1');

    var inp = td.querySelector('input.cell');
    if (inp) {
      var finalColor = textColor || (bgColor ? contrastColor(bgColor) : '');
      if (finalColor) inp.style.setProperty('color', finalColor, 'important');
      inp.style.setProperty('font-weight', bold   ? '700'     : 'normal', 'important');
      inp.style.setProperty('font-style',  italic ? 'italic'  : 'normal', 'important');
      var dec = [];
      if (strike)    dec.push('line-through');
      if (underline) dec.push('underline');
      inp.style.setProperty('text-decoration', dec.join(' ') || 'none', 'important');
    }
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     MODAL DOM BUILDING
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function buildModal() {
    if (document.getElementById('svcCfModal')) return;

    var overlay = mkEl('div', { id: 'svcCfModal' });
    var panel   = mkEl('div', { className: 'svc-cf-panel' }, overlay);
    mkEl('div', { className: 'svc-cf-accent-bar' }, panel);

    var header = mkEl('div', { className: 'svc-cf-header' }, panel);
    mkEl('div', { className: 'svc-cf-header-icon', textContent: '\uD83C\uDFA8' }, header);
    var htxt = mkEl('div', { className: 'svc-cf-header-text' }, header);
    mkEl('p', { className: 'svc-cf-header-title', textContent: 'Conditional Formatting' }, htxt);
    mkEl('p', { className: 'svc-cf-header-sub',   textContent: 'Format cells that meet defined criteria \u2014 like Google Sheets.' }, htxt);
    mkEl('span', { className: 'svc-cf-col-badge', id: 'cfColBadge', textContent: '' }, header);
    var closeBtn = mkEl('button', { className: 'svc-cf-close-btn', id: 'cfCloseBtn', textContent: '\u2715', title: 'Close' }, header);

    var body = mkEl('div', { className: 'svc-cf-body' }, panel);

    var listPane = mkEl('div', { className: 'svc-cf-list-pane' }, body);
    var listHdr  = mkEl('div', { className: 'svc-cf-list-header' }, listPane);
    mkEl('span', { className: 'svc-cf-list-label', textContent: 'Rules' }, listHdr);
    mkEl('button', { className: 'svc-cf-add-btn', id: 'cfAddRuleBtn', textContent: '+ Add rule' }, listHdr);
    mkEl('div', { className: 'svc-cf-rules-list', id: 'cfRulesList' }, listPane);

    mkEl('div', { className: 'svc-cf-editor-pane', id: 'cfEditorPane' }, body);

    var footer = mkEl('div', { className: 'svc-cf-footer' }, panel);
    mkEl('button', { className: 'svc-cf-btn svc-cf-btn-ghost', id: 'cfClearAllBtn', textContent: '\uD83D\uDDD1 Clear All' }, footer);
    mkEl('span', { style: 'flex:1' }, footer);
    mkEl('button', { className: 'svc-cf-btn svc-cf-btn-ghost', id: 'cfCancelBtn', textContent: 'Cancel' }, footer);
    mkEl('button', { className: 'svc-cf-btn svc-cf-btn-primary', id: 'cfSaveBtn', textContent: '\u2713 Done' }, footer);

    document.body.appendChild(overlay);

    closeBtn.addEventListener('click', closeModal);
    document.getElementById('cfCancelBtn').addEventListener('click', closeModal);
    document.getElementById('cfSaveBtn').addEventListener('click', saveRules);
    document.getElementById('cfClearAllBtn').addEventListener('click', clearAllRules);
    document.getElementById('cfAddRuleBtn').addEventListener('click', addNewRule);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _state.open) closeModal(); });
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     RULES LIST
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderRulesList() {
    var container = document.getElementById('cfRulesList');
    if (!container) return;
    container.innerHTML = '';

    if (!_state.rules.length) {
      var empty = mkEl('div', { className: 'svc-cf-rules-empty' }, container);
      mkEl('div', { className: 'svc-cf-rules-empty-icon', textContent: '\uD83C\uDFA8' }, empty);
      mkEl('div', { className: 'svc-cf-rules-empty-text', textContent: 'No rules yet. Click "+ Add rule" to start.' }, empty);
      renderEditor(null);
      return;
    }

    _state.rules.forEach(function (rule, idx) {
      var card = mkEl('div', { className: 'cf-rule-card' + (idx === _state.activeRuleIdx ? ' cf-rule-active' : '') }, container);
      card.dataset.idx = idx;

      var swatch = mkEl('div', { className: 'cf-rule-swatch' }, card);
      var swatchInner = mkEl('div', { className: 'cf-rule-swatch-inner' }, swatch);
      if (rule.type === 'color_scale') {
        swatch.style.background = 'linear-gradient(to right, '+(rule.scaleMin||'#f87171')+', '+(rule.scaleMid||'#fde047')+', '+(rule.scaleMax||'#4ade80')+')';
        swatchInner.textContent = '';
      } else if (rule.type === 'data_bar') {
        swatch.style.background = rule.barColor ? hexToRgba(rule.barColor, 0.3) : 'rgba(34,211,238,0.2)';
        swatch.style.borderColor = rule.barColor || '#22d3ee';
        swatchInner.textContent = '\u25AC';
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

      var meta = mkEl('div', { className: 'cf-rule-meta' }, card);
      mkEl('div', { className: 'cf-rule-cond',    textContent: getRuleLabel(rule) }, meta);
      mkEl('div', { className: 'cf-rule-preview', textContent: getRulePreview(rule) }, meta);

      var actionWrap = mkEl('div', { className: 'cf-rule-actions' }, card);
      var orderWrap  = mkEl('div', { className: 'cf-rule-order-btns' }, actionWrap);
      var upBtn = mkEl('button', { className: 'cf-rule-order-btn', textContent: '\u25B2', title: 'Move up' }, orderWrap);
      var dnBtn = mkEl('button', { className: 'cf-rule-order-btn', textContent: '\u25BC', title: 'Move down' }, orderWrap);
      upBtn.disabled = idx === 0;
      dnBtn.disabled = idx === _state.rules.length - 1;
      var delBtn = mkEl('button', { className: 'cf-rule-del-btn', textContent: '\u2715', title: 'Delete rule' }, actionWrap);

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
    if (!rule) return '\u2014';
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
      if (rule.bgColor)    parts.push('BG: ' + rule.bgColor);
      if (rule.textColor)  parts.push('Text: ' + rule.textColor);
      if (rule.bold)       parts.push('Bold');
      if (rule.italic)     parts.push('Italic');
      return parts.join(' \u00B7 ') || 'Style set';
    }
    if (rule.type === 'color_scale') return (rule.scaleMin||'#f87171') + ' \u2192 ' + (rule.scaleMax||'#4ade80');
    if (rule.type === 'data_bar')    return 'Bar: ' + (rule.barColor || '#22d3ee');
    if (rule.type === 'icon_set') {
      var is = ICON_SETS.find(function (s) { return s.id === rule.iconSetId; }) || ICON_SETS[0];
      return is.icons.join(' ');
    }
    return '';
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     EDITOR PANE
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderEditor(rule) {
    var pane = document.getElementById('cfEditorPane');
    if (!pane) return;
    pane.innerHTML = '';

    if (!rule) {
      var noRule = mkEl('div', { className: 'svc-cf-no-rule' }, pane);
      mkEl('div', { className: 'svc-cf-no-rule-icon', textContent: '\uD83C\uDFA8' }, noRule);
      mkEl('div', { className: 'svc-cf-no-rule-text', textContent: 'Select a rule to edit, or add a new one.' }, noRule);
      return;
    }

    var editor = mkEl('div', { className: 'svc-cf-editor' }, pane);

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
        if (ft.id === 'single_color') _state.draft.operator = _state.draft.operator || 'contains';
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });

    var rangeSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Apply To Column' }, rangeSection);
    var rangeChips = mkEl('div', { className: 'svc-cf-range-chips' }, rangeSection);
    mkEl('span', { className: 'svc-cf-range-chip', textContent: '\uD83D\uDCCB ' + _state.colLabel }, rangeChips);

    var ruleSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Format Rules' }, ruleSection);

    if (rule.type === 'single_color')  renderSingleColorCondition(ruleSection, rule);
    else if (rule.type === 'color_scale') renderColorScale(ruleSection, rule);
    else if (rule.type === 'data_bar')    renderDataBar(ruleSection, rule);
    else if (rule.type === 'icon_set')    renderIconSet(ruleSection, rule);
    else if (rule.type === 'formula')     renderFormula(ruleSection, rule);

    if (rule.type === 'single_color' || rule.type === 'formula') {
      var styleSection = mkEl('div', { className: 'svc-cf-section' }, editor);
      mkEl('div', { className: 'svc-cf-section-title', textContent: 'Formatting Style' }, styleSection);
      renderStylePicker(styleSection, rule);

      if (rule.type === 'single_color') {
        var rowHlSection = mkEl('div', { className: 'svc-cf-section' }, editor);
        mkEl('div', { className: 'svc-cf-section-title', textContent: 'Row Highlight' }, rowHlSection);
        var rowToggleWrapSC = mkEl('div', { className: 'svc-cf-row-toggle-wrap' }, rowHlSection);
        var rowToggleSC = mkEl('label', { className: 'svc-cf-row-toggle-label' }, rowToggleWrapSC);
        var rowChkSC = mkEl('input', { type: 'checkbox', className: 'svc-cf-row-chk', checked: !!rule.highlightRow }, rowToggleSC);
        mkEl('span', { className: 'svc-cf-toggle-slider' }, rowToggleSC);
        mkEl('span', { className: 'svc-cf-toggle-text', textContent: '\uD83C\uDF08 Highlight the entire row when condition is met' }, rowToggleSC);
        rowChkSC.addEventListener('change', function () {
          _state.draft.highlightRow = rowChkSC.checked;
          syncDraftToRule();
        });
      }
    }

    var previewSection = mkEl('div', { className: 'svc-cf-section' }, editor);
    mkEl('div', { className: 'svc-cf-section-title', textContent: 'Preview' }, previewSection);
    renderPreview(previewSection, rule);
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     SINGLE COLOR CONDITION
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderSingleColorCondition(parent, rule) {
    var catTabs = mkEl('div', { className: 'svc-cf-type-tabs', style: 'margin-bottom:10px;' }, parent);
    var categories = [
      { id: 'text',      label: '\uD83D\uDD24 Text' },
      { id: 'number',    label: '\uD83D\uDD22 Number' },
      { id: 'date',      label: '\uD83D\uDCC5 Date' },
      { id: 'duplicate', label: '\uD83D\uDD01 Duplicate' }
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
        _state.draft._opCat   = cat.id;
        _state.draft.operator = OPERATORS[cat.id][0].value;
        _state.draft.param1   = '';
        _state.draft.param2   = '';
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });

    var condRow = mkEl('div', { className: 'svc-cf-condition-row' }, parent);
    var opSel   = mkEl('select', { className: 'svc-cf-select svc-cf-operator-sel' }, condRow);
    var opList  = OPERATORS[activeCat] || OPERATORS.text;
    opList.forEach(function (op) {
      var o = mkEl('option', { value: op.value, textContent: op.label }, opSel);
      if (op.value === rule.operator) o.selected = true;
    });
    opSel.addEventListener('change', function () {
      _state.draft.operator = opSel.value;
      syncDraftToRule();
      renderEditor(_state.draft);
    });

    var op      = rule.operator;
    var noValue = ['empty','not_empty','date_today','date_tomorrow','date_yesterday','date_past_week','date_past_month','is_duplicate','is_unique'];
    var needsTwo = ['between','not_between'];

    if (noValue.indexOf(op) === -1) {
      var inputType = (activeCat === 'date' || op === 'date_before' || op === 'date_after' || op === 'date_eq') ? 'date' : 'text';
      var v1 = mkEl('input', { className: 'svc-cf-input svc-cf-value-input', type: inputType, placeholder: 'Value\u2026', value: rule.param1 || '' }, condRow);
      v1.addEventListener('input', function () { _state.draft.param1 = v1.value; syncDraftToRule(); updatePreview(); });
      if (needsTwo.indexOf(op) !== -1) {
        mkEl('span', { className: 'svc-cf-between-sep', textContent: 'and' }, condRow);
        var v2 = mkEl('input', { className: 'svc-cf-input svc-cf-value-input2', type: 'text', placeholder: 'Value\u2026', value: rule.param2 || '' }, condRow);
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

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     COLOR SCALE
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderColorScale(parent, rule) {
    var row = mkEl('div', { className: 'svc-cf-scale-row' }, parent);
    [
      { key: 'scaleMin', label: '\u25BC Minimum', def: '#f87171' },
      { key: 'scaleMid', label: '\u2014 Midpoint', def: '#fde047' },
      { key: 'scaleMax', label: '\u25B2 Maximum', def: '#4ade80' }
    ].forEach(function (stop) {
      var col = mkEl('div', { className: 'svc-cf-scale-stop' }, row);
      mkEl('div', { className: 'svc-cf-scale-stop-label', textContent: stop.label }, col);
      var sw = mkEl('div', { className: 'svc-cf-scale-swatch-wrap' }, col);
      var picker = mkEl('input', { type: 'color', className: 'svc-cf-scale-swatch', value: rule[stop.key] || stop.def, title: stop.label }, sw);
      picker.addEventListener('input', function () {
        _state.draft[stop.key] = picker.value;
        syncDraftToRule();
        updateScaleGradient(parent, rule);
        updatePreview();
      });
    });
    mkEl('div', { className: 'svc-cf-scale-gradient', id: 'cfScaleGradBar' }, parent);
    updateScaleGradient(parent, rule);
  }

  function updateScaleGradient(parent, rule) {
    var bar = parent.querySelector('#cfScaleGradBar') || document.getElementById('cfScaleGradBar');
    if (!bar) return;
    var d = _state.draft || rule;
    bar.style.background = 'linear-gradient(to right, '+(d.scaleMin||'#f87171')+', '+(d.scaleMid||'#fde047')+', '+(d.scaleMax||'#4ade80')+')';
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     DATA BAR
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderDataBar(parent, rule) {
    var colorRow = mkEl('div', { className: 'svc-cf-color-row' }, parent);
    mkEl('div', { className: 'svc-cf-color-label', textContent: 'Bar Color' }, colorRow);
    var palette = mkEl('div', { className: 'svc-cf-palette' }, colorRow);
    renderSwatches(palette, BG_PALETTE, rule.barColor || '#22d3ee', function (hex) {
      _state.draft.barColor = hex;
      syncDraftToRule();
      updatePreview();
      renderDataBar(parent, _state.draft);
    });
    var prevWrap = mkEl('div', { className: 'svc-cf-databar-preview', style: 'margin-top:10px;' }, parent);
    var fill = mkEl('div', { className: 'svc-cf-databar-fill' }, prevWrap);
    fill.style.background = rule.barColor || '#22d3ee';
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     ICON SET
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderIconSet(parent, rule) {
    var gridEl = mkEl('div', { className: 'svc-cf-iconset-grid' }, parent);
    ICON_SETS.forEach(function (is) {
      var opt = mkEl('div', {
        className: 'svc-cf-iconset-option' + (rule.iconSetId === is.id ? ' cf-iconset-active' : '')
      }, gridEl);
      mkEl('div', { className: 'svc-cf-iconset-icons', textContent: is.icons.join(' ') }, opt);
      mkEl('div', { className: 'svc-cf-iconset-name',  textContent: is.name }, opt);
      opt.addEventListener('click', function () {
        _state.draft.iconSetId = is.id;
        syncDraftToRule();
        renderEditor(_state.draft);
      });
    });
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     FORMULA
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderFormula(parent, rule) {
    var state2    = window.servicesGrid ? window.servicesGrid.getState() : null;
    var availCols = (state2 && state2.sheet && state2.sheet.column_defs) ? state2.sheet.column_defs : [];

    if (availCols.length) {
      var refSection = mkEl('div', { className: 'svc-cf-formula-ref-wrap' }, parent);
      mkEl('div', { className: 'svc-cf-formula-ref-label', textContent: '\uD83D\uDCCB Quick-insert column reference:' }, refSection);
      var chips = mkEl('div', { className: 'svc-cf-formula-ref-chips' }, refSection);
      availCols.forEach(function (col) {
        if (!col || !col.label) return;
        var chip = mkEl('button', { className: 'svc-cf-formula-ref-chip', textContent: col.label, title: 'Insert COL("' + col.label + '")' }, chips);
        chip.addEventListener('click', function () {
          var ta2 = parent.querySelector('.svc-cf-formula-input');
          if (!ta2) return;
          var ins = 'COL("' + col.label + '")';
          var start = ta2.selectionStart || 0, end = ta2.selectionEnd || 0;
          ta2.value = ta2.value.slice(0, start) + ins + ta2.value.slice(end);
          ta2.selectionStart = ta2.selectionEnd = start + ins.length;
          ta2.dispatchEvent(new Event('input'));
          ta2.focus();
        });
      });
    }

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

    var rowToggleWrap = mkEl('div', { className: 'svc-cf-row-toggle-wrap' }, parent);
    var rowToggle = mkEl('label', { className: 'svc-cf-row-toggle-label' }, rowToggleWrap);
    var rowChk = mkEl('input', { type: 'checkbox', className: 'svc-cf-row-chk', checked: !!rule.highlightRow }, rowToggle);
    mkEl('span', { className: 'svc-cf-toggle-slider' }, rowToggle);
    mkEl('span', { className: 'svc-cf-toggle-text', textContent: '\uD83C\uDF08 Highlight Entire Row (like Google Sheets row highlight)' }, rowToggle);

    var varsCard  = mkEl('div', { className: 'svc-cf-vars-card' }, parent);
    mkEl('div', { className: 'svc-cf-vars-title', textContent: '\uD83D\uDCD6 Available Variables' }, varsCard);
    var varsList = [
      { name: 'VALUE',           desc: 'Cell value (string or number)',            example: 'VALUE === "Active"' },
      { name: 'NUMVAL',          desc: 'Cell value as number (NaN if not numeric)', example: 'NUMVAL > 100' },
      { name: 'COL("ColName")',  desc: 'Value of another column in the same row',  example: 'COL("STATUS") === "Submitted"' },
      { name: 'ROW_DATA',        desc: 'Full row data object (access by key)',      example: 'ROW_DATA["col_key"]' }
    ];
    var varsTable = mkEl('div', { className: 'svc-cf-vars-table' }, varsCard);
    varsList.forEach(function (v) {
      var row2 = mkEl('div', { className: 'svc-cf-vars-row' }, varsTable);
      mkEl('code', { className: 'svc-cf-vars-name',    textContent: v.name }, row2);
      mkEl('span', { className: 'svc-cf-vars-desc',    textContent: v.desc }, row2);
      mkEl('code', { className: 'svc-cf-vars-example', textContent: v.example }, row2);
    });
    mkEl('div', { className: 'svc-cf-formula-hint', textContent: 'JS expression \u2014 returns true/false. No semicolons needed. Use COL("Column Name") to reference other columns in the same row.' }, parent);

    ta.addEventListener('input', function () { _state.draft.formula = ta.value; syncDraftToRule(); updatePreview(); });
    rowChk.addEventListener('change', function () { _state.draft.highlightRow = rowChk.checked; syncDraftToRule(); updatePreview(); });
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     STYLE PICKER
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function renderStylePicker(parent, rule) {
    var styleGrid = mkEl('div', { className: 'svc-cf-style-grid' }, parent);

    var bgRow = mkEl('div', { className: 'svc-cf-color-row' }, styleGrid);
    mkEl('div', { className: 'svc-cf-color-label', textContent: '\uD83D\uDFE5 Background Color' }, bgRow);
    var bgPal = mkEl('div', { className: 'svc-cf-palette' }, bgRow);
    renderSwatches(bgPal, BG_PALETTE, rule.bgColor || '', function (hex) {
      _state.draft.bgColor = hex; syncDraftToRule(); updatePreview();
    }, true);
    var bgCustom = mkEl('input', { type: 'color', className: 'svc-cf-custom-color', value: rule.bgColor || '#ffffff', title: 'Custom color' }, bgPal);
    bgCustom.addEventListener('input', function () { _state.draft.bgColor = bgCustom.value; syncDraftToRule(); updatePreview(); });

    var txRow = mkEl('div', { className: 'svc-cf-color-row' }, styleGrid);
    mkEl('div', { className: 'svc-cf-color-label', textContent: '\uD83D\uDD24 Text Color' }, txRow);
    var txPal = mkEl('div', { className: 'svc-cf-palette' }, txRow);
    renderSwatches(txPal, TEXT_PALETTE, rule.textColor || '', function (hex) {
      _state.draft.textColor = hex; syncDraftToRule(); updatePreview();
    }, true);
    var txCustom = mkEl('input', { type: 'color', className: 'svc-cf-custom-color', value: rule.textColor || '#ffffff', title: 'Custom text color' }, txPal);
    txCustom.addEventListener('input', function () { _state.draft.textColor = txCustom.value; syncDraftToRule(); updatePreview(); });

    var fontRow = mkEl('div', { className: 'svc-cf-font-row', style: 'grid-column:1/-1;' }, styleGrid);
    mkEl('div', { className: 'svc-cf-color-label', textContent: 'Font Style' }, fontRow);
    var fontToggles = mkEl('div', { className: 'svc-cf-font-toggles' }, fontRow);
    [
      { key: 'bold',          label: 'B', style: 'font-weight:700;',              title: 'Bold' },
      { key: 'italic',        label: 'I', style: 'font-style:italic;',            title: 'Italic' },
      { key: 'strikethrough', label: 'S', style: 'text-decoration:line-through;', title: 'Strikethrough' },
      { key: 'underline',     label: 'U', style: 'text-decoration:underline;',    title: 'Underline' }
    ].forEach(function (fb) {
      var btn = mkEl('button', {
        className: 'svc-cf-font-btn' + (rule[fb.key] ? ' cf-font-active' : ''),
        title: fb.title
      }, fontToggles);
      btn.innerHTML = '<span style="' + fb.style + '">' + fb.label + '</span>';
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
        className: 'svc-cf-swatch cf-color-btn' + (!currentHex ? ' cf-swatch-active active' : ''),
        title: 'None',
        style: 'background:transparent;border:1.5px dashed rgba(148,163,184,0.3);position:relative;'
      }, container);
      noneBtn.innerHTML = '<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:10px;color:#475569;">\u2205</span>';
      noneBtn.addEventListener('click', function () { onChange(''); });
    }
    palette.forEach(function (hex) {
      var sw = mkEl('div', {
        className: 'svc-cf-swatch cf-color-btn' + (hex === currentHex ? ' cf-swatch-active active' : ''),
        style: 'background:' + hex + ';',
        title: hex
      }, container);
      sw.addEventListener('click', function () { onChange(hex); });
    });
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     PREVIEW CELL
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  var _previewUpdateTimeout = null;

  function renderPreview(parent, rule) {
    var wrap = mkEl('div', { className: 'svc-cf-preview-wrap', id: 'cfPreviewWrap' }, parent);
    mkEl('div', { className: 'svc-cf-preview-label', textContent: 'PREVIEW' }, wrap);
    mkEl('div', { className: 'svc-cf-preview-cell', id: 'cfPreviewCell', textContent: 'Sample Text' }, wrap);
    applyPreviewStyle(rule);
  }

  function updatePreview() {
    clearTimeout(_previewUpdateTimeout);
    _previewUpdateTimeout = setTimeout(function () { if (_state.draft) applyPreviewStyle(_state.draft); }, 80);
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
      if (rule.bgColor)   cell.style.background = rule.bgColor;
      if (rule.textColor) { cell.style.color = rule.textColor; }
      else if (rule.bgColor) { cell.style.color = contrastColor(rule.bgColor); }
      if (rule.bold)   cell.style.fontWeight = '700';
      if (rule.italic) cell.style.fontStyle = 'italic';
      var dec = [];
      if (rule.strikethrough) dec.push('line-through');
      if (rule.underline)     dec.push('underline');
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

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     DRAFT SYNC
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function syncToColumnDefs() {
    if (!window.servicesGrid) return;
    var st = window.servicesGrid.getState();
    if (!st || !st.sheet || !Array.isArray(st.sheet.column_defs)) return;
    if (_state.colIdx < 0 || _state.colIdx >= st.sheet.column_defs.length) return;
    var liveCol = st.sheet.column_defs[_state.colIdx];
    if (liveCol) liveCol.conditionalRules = deepClone(_state.rules);
  }

  function syncDraftToRule() {
    if (_state.activeRuleIdx >= 0 && _state.draft) {
      _state.rules[_state.activeRuleIdx] = deepClone(_state.draft);
    }
    syncToColumnDefs();
    paintGrid();
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     OPEN / CLOSE / SAVE
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
    // FIX-CLOSE-REPAINT: Do NOT call paintGrid() synchronously here.
    // saveRules() already called paintGrid() right before closeModal().
    // A second synchronous paintGrid() causes a CLEAR phase that temporarily
    // strips all inline td backgrounds before re-applying them, creating a
    // visible flash where only the CF-target column td retains its bg
    // (because the CSS class --cf-row-bg var still applies to it via the
    // cf-row-highlighted class, but inline styles on other tds were cleared).
    // RAF-schedule so any CSS transition for modal close completes first.
    requestAnimationFrame(function () {
      if (window.svcConditionalFormat && typeof window.svcConditionalFormat.paint === 'function') {
        window.svcConditionalFormat.paint();
      }
    });
  }

  async function saveRules() {
    if (!window.servicesGrid) {
      window.Notify && window.Notify.show('error', 'Save Failed', 'Grid not ready. Please refresh.');
      return;
    }
    if (!window.servicesDB) {
      window.Notify && window.Notify.show('error', 'Save Failed', 'DB not ready. Please refresh.');
      return;
    }

    var state = window.servicesGrid.getState();
    if (!state || !state.sheet) { window.Notify && window.Notify.show('error', 'Save Failed', 'No sheet loaded.'); closeModal(); return; }

    var cols = state.sheet.column_defs || [];
    var col  = cols[_state.colIdx];
    if (!col) { window.Notify && window.Notify.show('error', 'Save Failed', 'Column not found.'); closeModal(); return; }

    if (_state.activeRuleIdx >= 0 && _state.draft) {
      _state.rules[_state.activeRuleIdx] = deepClone(_state.draft);
    }

    var rulesForSave = deepClone(_state.rules).map(function (r) {
      delete r._opCat;
      delete r._evalRowData;
      delete r._evalColLabelMap;
      return r;
    });

    col.conditionalRules = rulesForSave;

    try {
      await window.servicesDB.updateColumns(state.sheet.id, cols);
      window.Notify && window.Notify.show('success', 'Conditional Formatting', 'Rules saved \u2014 ' + rulesForSave.length + ' rule(s) active.');
    } catch (err) {
      window.Notify && window.Notify.show('error', 'CF Save Failed', err && err.message ? err.message : 'Try again.');
    }

    paintGrid();
    closeModal();
  }

  async function clearAllRules() {
    if (!confirm('Clear all conditional formatting rules for column "' + _state.colLabel + '"?')) return;
    _state.rules = [];
    _state.activeRuleIdx = -1;
    _state.draft = null;
    syncToColumnDefs();
    renderRulesList();
    renderEditor(null);
    document.querySelectorAll('#svcGrid tr[data-cf-applied]').forEach(function(tr) {
      tr.removeAttribute('data-cf-applied');
      tr.removeAttribute('data-cf-rule');
      tr.style.removeProperty('--cf-bg');
    });
    if (window.servicesGrid && window.servicesGrid.render) window.servicesGrid.render();
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
    syncToColumnDefs();
    paintGrid();
    renderRulesList();
    renderEditor(_state.draft);
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     HOOK INTO GRID RENDER
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function hookGridRender() {
    if (!window.servicesGrid) { setTimeout(hookGridRender, 200); return; }
    if (window.servicesGrid._cfHooked) return;
    window.servicesGrid._cfHooked = true;
  }

  // FIX-CF-SCROLL-v3: Use MutationObserver to re-paint whenever grid DOM changes
  // This catches ALL cases: render(), realtime updates, QB sync, cell edits
  (function bindGridObserver() {
    var gridEl = document.getElementById('svcGrid');
    if (!gridEl) return;
    var _repaintTimer = null;
    var observer = new MutationObserver(function () {
      clearTimeout(_repaintTimer);
      _repaintTimer = setTimeout(function () {
        if (typeof paintGrid === 'function') {
          try { paintGrid(); } catch (e) { console.warn('[CF-Observer] repaint error:', e); }
        }
      }, 100);
    });
    observer.observe(gridEl, { childList: true, subtree: true });
    console.log('[CF] MutationObserver bound to svcGrid for auto-repaint');
  })();

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     PUBLIC API
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  window.svcConditionalFormat = {
    open:  openModal,
    paint: paintGrid,
    close: closeModal
  };

  window.__svcCfTest = {
    evalRule:       evalRule,
    renderSwatches: renderSwatches
  };

  hookGridRender();

  document.addEventListener('svc:qb-paint-done', function () {
    if (_paintSuspended) return;
    setTimeout(paintGrid, 60);
  });

  document.addEventListener('svc:qb-update-start', function () {
    _paintSuspended = true;
  });

  document.addEventListener('svc:qb-update-complete', function () {
    _paintSuspended = false;
    setTimeout(paintGrid, 120);
  });

})();