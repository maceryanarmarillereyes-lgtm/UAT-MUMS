(function () {
  'use strict';
  // ─────────────────────────────────────────────────────────────────────────────
  // services-search.js — Command Palette Search  v1.0
  //
  // Scope: Current active sheet only (not cross-sheet).
  // Searches:
  //   1. All row data (every column value)
  //   2. TreeView folder names + condition field/value
  //
  // Results:
  //   • ROW results  → scrolls grid to that row and highlights the cell(s)
  //   • FOLDER results → activates the treeview folder filter
  //
  // Triggered by:
  //   • Ctrl+F / Ctrl+K
  //   • Clicking the "Search" button in the toolbar
  //
  // CONSTRAINTS:
  //   • NO auth/realtime/RLS touched
  //   • NO existing module APIs modified
  //   • Reads servicesGrid.getState() for rows + column defs
  //   • Reads servicesTreeview.getFolders() for folder data
  // ─────────────────────────────────────────────────────────────────────────────

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  var palette     = document.getElementById('svcSearchPalette');
  var backdrop    = document.getElementById('svcSearchBackdrop');
  var input       = document.getElementById('svcSearchInput');
  var clearBtn    = document.getElementById('svcSearchClear');
  var scopeBadge  = document.getElementById('svcSearchScopeBadge');
  var meta        = document.getElementById('svcSearchMeta');
  var body        = document.getElementById('svcSearchBody');
  var idleEl      = document.getElementById('svcSearchIdle');
  var resultsEl   = document.getElementById('svcSearchResults');
  var emptyEl     = document.getElementById('svcSearchEmpty');
  var emptySub    = document.getElementById('svcSearchEmptySub');
  var footerCount = document.getElementById('svcSearchFooterCount');
  var triggerBtn  = document.getElementById('svcSearchTriggerBtn');

  if (!palette || !input) return; // Guard if HTML not updated yet

  // ── State ─────────────────────────────────────────────────────────────────────
  var _open        = false;
  var _query       = '';
  var _results     = [];   // [{type, ...}]
  var _activeIdx   = -1;
  var _debounceTimer = null;
  var _DEBOUNCE_MS = 120;
  var MAX_RESULTS  = 200;

  // ── Open / Close ──────────────────────────────────────────────────────────────
  function open() {
    if (_open) { input.select(); return; }
    _open = true;
    palette.classList.add('svc-search-open');
    palette.setAttribute('aria-hidden', 'false');
    // Update scope badge
    var state = window.servicesGrid && window.servicesGrid.getState();
    scopeBadge.textContent = (state && state.sheet && state.sheet.title) ? state.sheet.title : 'No sheet';
    // Reset UI
    showIdle();
    input.value = '';
    _query = '';
    _results = [];
    _activeIdx = -1;
    footerCount.textContent = '';
    setTimeout(function () { input.focus(); }, 60);
  }

  function close() {
    if (!_open) return;
    _open = false;
    palette.classList.remove('svc-search-open');
    palette.setAttribute('aria-hidden', 'true');
    input.blur();
  }

  function showIdle() {
    idleEl.style.display  = '';
    resultsEl.style.display = 'none';
    emptyEl.style.display = 'none';
  }

  function showResults() {
    idleEl.style.display  = 'none';
    resultsEl.style.display = '';
    emptyEl.style.display = 'none';
  }

  function showEmpty(q) {
    idleEl.style.display  = 'none';
    resultsEl.style.display = 'none';
    emptyEl.style.display = '';
    emptySub.textContent  = 'No matches for "' + q + '"';
  }

  // ── Highlight matching text ───────────────────────────────────────────────────
  function highlight(text, query) {
    if (!query || !text) return eh(String(text || ''));
    var str = String(text);
    var q   = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex
    try {
      return str.replace(
        new RegExp('(' + q + ')', 'gi'),
        function (m) { return '<mark class="svc-search-hl">' + eh(m) + '</mark>'; }
      );
    } catch (_) { return eh(str); }
  }

  // ── Search engine ─────────────────────────────────────────────────────────────
  function runSearch(q) {
    var state = window.servicesGrid && window.servicesGrid.getState();
    if (!state || !state.sheet) {
      showEmpty(q);
      meta.textContent = 'Open a sheet first';
      return;
    }

    var ql    = q.toLowerCase();
    var cols  = state.sheet.column_defs || [];
    var rows  = state.rows || [];
    var sheetId = state.sheet.id;
    var folders = (window.servicesTreeview && window.servicesTreeview.getFolders(sheetId)) || [];

    var hits = [];

    // ── 1. Search folders ─────────────────────────────────────────────────────
    folders.forEach(function (f) {
      var name  = String(f.name || '');
      var field = String(f.condition_field || '');
      var val   = String(f.condition_value || '');
      var op    = String(f.condition_op || '');

      var nameMatch  = name.toLowerCase().includes(ql);
      var fieldMatch = field.toLowerCase().includes(ql);
      var valMatch   = val.toLowerCase().includes(ql);

      if (nameMatch || fieldMatch || valMatch) {
        // Build readable condition string for subtitle
        var condStr = field
          ? (field + ' ' + op + (val ? ' "' + val + '"' : ''))
          : 'No filter';

        hits.push({
          type:    'folder',
          id:      f.id,
          sheetId: sheetId,
          name:    name,
          icon:    f.icon || '📁',
          cond:    condStr,
          score:   nameMatch ? 2 : 1,
          _nameMatch:  nameMatch,
          _fieldMatch: fieldMatch,
          _valMatch:   valMatch,
          _ql: ql
        });
      }
    });

    // ── 2. Search rows ────────────────────────────────────────────────────────
    var rowHits = [];
    rows.forEach(function (row) {
      if (!row.data) return;
      var matchedCols = [];

      cols.forEach(function (col) {
        if (col.hidden) return;
        var cellVal = row.data[col.key];
        if (cellVal == null || cellVal === '') return;
        var str = String(cellVal);
        if (str.toLowerCase().includes(ql)) {
          matchedCols.push({ key: col.key, label: col.label || col.key, value: str });
        }
      });

      if (matchedCols.length) {
        rowHits.push({
          type:       'row',
          rowIndex:   row.row_index,
          rowNum:     row.row_index + 1,
          matchedCols: matchedCols,
          sheetId:    sheetId,
          _ql: ql
        });
      }
    });

    // Sort rows: exact match in first column first
    rowHits.sort(function (a, b) {
      return a.rowNum - b.rowNum;
    });

    hits = hits.concat(rowHits.slice(0, MAX_RESULTS));
    _results   = hits;
    _activeIdx = hits.length ? 0 : -1;

    // Update meta
    var fCount = hits.filter(function (h) { return h.type === 'folder'; }).length;
    var rCount = hits.filter(function (h) { return h.type === 'row'; }).length;
    var total  = fCount + rCount;

    if (!total) {
      showEmpty(q);
      footerCount.textContent = '';
      meta.textContent = '';
      return;
    }

    var metaParts = [];
    if (fCount) metaParts.push(fCount + ' folder' + (fCount > 1 ? 's' : ''));
    if (rCount) metaParts.push(rCount + ' row' + (rCount > 1 ? 's' : ''));
    meta.textContent = metaParts.join(' · ');
    footerCount.textContent = total + ' result' + (total > 1 ? 's' : '');

    renderResults(hits, q);
    showResults();
  }

  // ── Render result list ────────────────────────────────────────────────────────
  function renderResults(hits, q) {
    resultsEl.innerHTML = '';

    var hasFolders = hits.some(function (h) { return h.type === 'folder'; });
    var hasRows    = hits.some(function (h) { return h.type === 'row'; });

    if (hasFolders) {
      var fHeader = document.createElement('div');
      fHeader.className = 'svc-search-group-header';
      fHeader.innerHTML = '<span class="svc-search-group-icon">📂</span>Folders';
      resultsEl.appendChild(fHeader);

      hits.filter(function (h) { return h.type === 'folder'; }).forEach(function (h, i) {
        var item = buildFolderResult(h, i, q);
        resultsEl.appendChild(item);
      });
    }

    if (hasRows) {
      var rHeader = document.createElement('div');
      rHeader.className = 'svc-search-group-header';
      rHeader.innerHTML = '<span class="svc-search-group-icon">📄</span>Rows';
      resultsEl.appendChild(rHeader);

      var folderCount = hits.filter(function (h) { return h.type === 'folder'; }).length;
      hits.filter(function (h) { return h.type === 'row'; }).forEach(function (h, i) {
        var item = buildRowResult(h, folderCount + i, q);
        resultsEl.appendChild(item);
      });
    }

    // Highlight first item
    if (_activeIdx >= 0) activateItem(_activeIdx);
  }

  function buildFolderResult(h, globalIdx, q) {
    var item = document.createElement('div');
    item.className = 'svc-search-result-item';
    item.dataset.idx = globalIdx;
    item.dataset.type = 'folder';

    var icon = document.createElement('div');
    icon.className = 'svc-search-result-icon svc-search-result-icon--folder';
    icon.textContent = h.icon;

    var body = document.createElement('div');
    body.className = 'svc-search-result-body';

    var title = document.createElement('div');
    title.className = 'svc-search-result-title';
    title.innerHTML = highlight(h.name, q);

    var sub = document.createElement('div');
    sub.className = 'svc-search-result-sub';
    sub.innerHTML = '<span class="svc-search-result-cond">' + eh(h.cond) + '</span>';

    body.appendChild(title);
    body.appendChild(sub);

    var badge = document.createElement('div');
    badge.className = 'svc-search-result-badge svc-search-result-badge--folder';
    badge.textContent = 'Filter';

    item.appendChild(icon);
    item.appendChild(body);
    item.appendChild(badge);

    item.addEventListener('click', function () { selectResult(globalIdx); });
    item.addEventListener('mouseenter', function () { setActive(globalIdx); });

    return item;
  }

  function buildRowResult(h, globalIdx, q) {
    var item = document.createElement('div');
    item.className = 'svc-search-result-item';
    item.dataset.idx = globalIdx;
    item.dataset.type = 'row';

    var icon = document.createElement('div');
    icon.className = 'svc-search-result-icon svc-search-result-icon--row';
    icon.textContent = '#' + h.rowNum;

    var body = document.createElement('div');
    body.className = 'svc-search-result-body';

    var title = document.createElement('div');
    title.className = 'svc-search-result-title';
    // Show first matched column value as title
    var firstMatch = h.matchedCols[0];
    title.innerHTML = highlight(firstMatch.value, q);

    var sub = document.createElement('div');
    sub.className = 'svc-search-result-sub';
    // Show all matched columns
    sub.innerHTML = h.matchedCols.map(function (mc) {
      return '<span class="svc-search-col-tag">' + eh(mc.label) + '</span>' +
             '<span class="svc-search-col-val">' + highlight(mc.value, q) + '</span>';
    }).join('<span class="svc-search-sep">·</span>');

    body.appendChild(title);
    body.appendChild(sub);

    var badge = document.createElement('div');
    badge.className = 'svc-search-result-badge svc-search-result-badge--row';
    badge.textContent = 'Row ' + h.rowNum;

    item.appendChild(icon);
    item.appendChild(body);
    item.appendChild(badge);

    item.addEventListener('click', function () { selectResult(globalIdx); });
    item.addEventListener('mouseenter', function () { setActive(globalIdx); });

    return item;
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────────
  function setActive(idx) {
    _activeIdx = idx;
    activateItem(idx);
  }

  function activateItem(idx) {
    var items = resultsEl.querySelectorAll('.svc-search-result-item');
    items.forEach(function (el, i) {
      el.classList.toggle('svc-search-result-active', i === idx);
    });
    // Scroll into view
    var active = items[idx];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function selectResult(idx) {
    var result = _results[idx];
    if (!result) return;

    if (result.type === 'folder') {
      close();
      // Activate this folder in treeview
      if (window.servicesTreeview && result.id) {
        // Use the public selectFolder by clicking the node
        var node = document.querySelector('.svc-tv-node[data-folder-id="' + result.id + '"]');
        if (node) {
          node.click();
        } else {
          // Fallback: call onSheetOpened to reset then trigger filter
          window.servicesGrid && window.servicesGrid.setTreeFilter(null);
        }
      }
    } else if (result.type === 'row') {
      close();
      scrollToRow(result.rowIndex, result.matchedCols);
    }
  }

  // ── Scroll grid to a specific row and highlight matched cells ─────────────────
  function scrollToRow(rowIndex, matchedCols) {
    var gridWrap = document.getElementById('svcGridWrap');
    var tr       = document.querySelector('tbody tr[data-row="' + rowIndex + '"]');

    if (!tr || !gridWrap) return;

    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // Flash highlight on matched cells
    matchedCols.forEach(function (mc) {
      var inp = tr.querySelector('input.cell[data-key="' + mc.key + '"]');
      if (!inp) return;
      inp.classList.add('svc-search-row-flash');
      setTimeout(function () { inp.classList.remove('svc-search-row-flash'); }, 2000);
    });

    // Also flash the row-num cell
    var rnTd = tr.querySelector('td.row-num');
    if (rnTd) {
      rnTd.classList.add('svc-search-row-flash-rn');
      setTimeout(function () { rnTd.classList.remove('svc-search-row-flash-rn'); }, 2000);
    }
  }

  // ── Input handler ──────────────────────────────────────────────────────────────
  input.addEventListener('input', function () {
    var q = input.value.trim();
    _query = q;
    clearTimeout(_debounceTimer);
    clearBtn.style.display = q ? '' : 'none';

    if (!q) { showIdle(); footerCount.textContent = ''; meta.textContent = ''; return; }

    _debounceTimer = setTimeout(function () { runSearch(q); }, _DEBOUNCE_MS);
  });

  input.addEventListener('keydown', function (e) {
    if (!_results.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var next = Math.min(_activeIdx + 1, _results.length - 1);
      setActive(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = Math.max(_activeIdx - 1, 0);
      setActive(prev);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_activeIdx >= 0) selectResult(_activeIdx);
    }
  });

  // ── Clear button ──────────────────────────────────────────────────────────────
  clearBtn.style.display = 'none';
  clearBtn.addEventListener('click', function () {
    input.value = '';
    _query = '';
    clearBtn.style.display = 'none';
    showIdle();
    footerCount.textContent = '';
    meta.textContent = '';
    input.focus();
  });

  // ── Backdrop click closes ─────────────────────────────────────────────────────
  backdrop.addEventListener('click', close);

  // ── Escape key ────────────────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _open) {
      close();
      return;
    }
    // Ctrl+F / Ctrl+K → open
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) {
      // Only intercept if services page is active (no active text-editor focused elsewhere)
      var tag = document.activeElement && document.activeElement.tagName;
      // Allow Ctrl+F to open palette even when grid cells are focused
      if (tag === 'INPUT' && document.activeElement.id === 'svcSearchInput') return;
      // Prevent browser find if palette opens
      e.preventDefault();
      open();
    }
  });

  // ── Trigger button ────────────────────────────────────────────────────────────
  if (triggerBtn) triggerBtn.addEventListener('click', open);

  // ── Helper ────────────────────────────────────────────────────────────────────
  function eh(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.svcSearch = { open: open, close: close };
})();
