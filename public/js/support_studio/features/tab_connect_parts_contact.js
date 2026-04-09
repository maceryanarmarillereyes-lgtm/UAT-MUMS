/* ═══════════════════════════════════════════════════════════════════
   PARTS NUMBER TAB — Tab logic for the Parts Number tab
   ═══════════════════════════════════════════════════════════════════
   Reads:  window._pnCsvUrl       (set by Part Number Settings)
           window._pnSearchCols   (set by Part Number Settings)
           window.StudioCache     (IndexedDB cache layer)

   Exposes:
   - window._pnInit()          → entry point (called by activateTab)
   - window._pnRefresh()       → force reload from network
   - window._pnOnSearch(q)     → search handler (sidebar + main search)
   - window._pnApplyFilters()  → category filter change
   - window._pnSort(col)       → sort by column key
   - window._pnChangePage(dir) → pagination
   - window._pnExportCsv()     → export filtered data as CSV
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var _allData     = [];   // full parsed dataset
  var _filtered    = [];   // after search + filter
  var _columns     = [];   // detected column keys (lowercase-normalized)
  var _colLabels   = {};   // { key: 'Original Header' }
  var _sortKey     = '';
  var _sortDir     = 1;    // 1=asc, -1=desc
  var _query       = '';
  var _catFilter   = '';
  var _page        = 1;
  var _perPage     = 100;
  var _initialized = false;
  var _loading     = false;

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function el(id)  { return document.getElementById(id); }

  /* ── Init ──────────────────────────────────────────────────── */
  window._pnInit = function() {
    if (_initialized && _allData.length) {
      _render();
      return;
    }
    _loadData();
  };

  window._pnRefresh = function() {
    _initialized = false;
    _allData     = [];
    _filtered    = [];
    _columns     = [];
    _colLabels   = {};
    _loadData();
  };

  /* ── Load data (cache-first, then network) ─────────────────── */
  function _loadData() {
    if (_loading) return;
    _loading = true;
    _setBodyLoading('Loading Parts Number data…');

    // 1. Try StudioCache first
    var cacheAvailable = typeof window.StudioCache !== 'undefined';
    var cachePromise = cacheAvailable
      ? window.StudioCache.getBundle('parts_number')
      : Promise.resolve(null);

    cachePromise.then(function(cached) {
      if (cached && cached.data && cached.data.length) {
        _parseData(cached.data, true);
        return;
      }
      // 2. Fall back to network
      return _fetchFromNetwork();
    }).catch(function() {
      return _fetchFromNetwork();
    }).catch(function(e) {
      _loading = false;
      _setBodyError(e.message);
    });
  }

  function _fetchFromNetwork() {
    function _loadSettingsIfNeeded() {
      if (window._pnCsvUrl) return Promise.resolve();
      var tok = '';
      try {
        var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.access_token) tok = p.access_token;
        }
        if (!tok && window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') tok = window.CloudAuth.accessToken();
      } catch(_) {}
      if (!tok) return Promise.resolve(); // no token yet — caller will handle empty url
      return fetch('/api/studio/csv_settings?type=parts_number', {
        headers: { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-cache' }
      }).then(function(resp) { return resp.ok ? resp.json().catch(function(){ return null; }) : null; })
        .then(function(d) {
          if (d && d.ok && d.settings && d.settings.csvUrl) {
            window._pnCsvUrl = d.settings.csvUrl;
            window._pnSearchCols = (Array.isArray(d.settings.searchColumns) && d.settings.searchColumns.length > 0)
              ? d.settings.searchColumns : null;
          }
        })
        .catch(function() {});
    }

    return _loadSettingsIfNeeded().then(function() {
      var url = window._pnCsvUrl;
      if (!url) {
        // Try to read from localStorage
        try {
          var s = localStorage.getItem('ss_parts_number_settings');
          if (s) { var p = JSON.parse(s); url = p.csvUrl || ''; }
        } catch(_) {}
      }
      if (!url) {
        _loading = false;
        _setBodyEmpty();
        return Promise.resolve();
      }
      return fetch(url).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' — check if sheet is published as CSV');
        return r.text();
      }).then(function(text) {
        var data = _parseCsv(text);
        if (typeof window.StudioCache !== 'undefined') {
          window.StudioCache.setBundle('parts_number', data, '', data.length).catch(function() {});
        }
        _parseData(data, false);
      });
    });
  }

  /* ── CSV Parser ─────────────────────────────────────────────── */
  function _parseCsv(text) {
    var lines   = text.split('\n');
    var headers = [];
    var rows    = [];

    function parseLine(line) {
      var result = [], cur = '', inQ = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      result.push(cur.trim());
      return result;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\r/,'').trim();
      if (!line) continue;
      var cells = parseLine(line);
      if (i === 0) { headers = cells; continue; }
      var row = {};
      headers.forEach(function(h, idx) { row[h] = cells[idx] || ''; });
      rows.push(row);
    }
    return rows;
  }

  /* ── Parse + store data ────────────────────────────────────── */
  function _parseData(rows, fromCache) {
    _loading    = false;
    _initialized = true;
    _allData    = rows;
    window.__studioPnRecords = Array.isArray(rows) ? rows.slice() : [];

    if (rows.length) {
      var firstRow = rows[0];
      _columns  = Object.keys(firstRow);
      _colLabels = {};
      _columns.forEach(function(k) { _colLabels[k] = k; });

      // Try to load configured search cols from settings
      try {
        var s = localStorage.getItem('ss_parts_number_settings');
        if (s) {
          var p = JSON.parse(s);
          window._pnCsvUrl    = p.csvUrl || window._pnCsvUrl || '';
          window._pnSearchCols = (Array.isArray(p.searchColumns) && p.searchColumns.length)
            ? p.searchColumns : null;
        }
      } catch(_) {}
    }

    _buildCategoryFilter();
    _buildTableHeader();
    _applySearchAndFilter();
  }

  /* ── Build dynamic category filter ─────────────────────────── */
  function _buildCategoryFilter() {
    var catEl = el('pn-cat-filter');
    if (!catEl || !_columns.length) return;

    // Look for a 'category' or 'type' column (case-insensitive)
    var catCol = _columns.find(function(c) {
      return /category|type|group|class/i.test(c);
    });

    catEl.innerHTML = '<option value="">All Categories</option>';
    if (!catCol) return;

    var cats = {};
    _allData.forEach(function(row) {
      var v = (row[catCol] || '').trim();
      if (v) cats[v] = (cats[v] || 0) + 1;
    });

    Object.keys(cats).sort().forEach(function(cat) {
      var opt = document.createElement('option');
      opt.value       = cat;
      opt.textContent = cat + ' (' + cats[cat] + ')';
      catEl.appendChild(opt);
    });

    catEl._catCol = catCol;
  }

  /* ── Build dynamic table header ─────────────────────────────── */
  function _buildTableHeader() {
    var thead = el('pn-thead-row');
    if (!thead) return;
    var displayCols = _columns.slice(0, 8);
    thead.innerHTML = '<th style="width:38px;">#</th>' +
      displayCols.map(function(col) {
        var iconId = 'pn-sort-' + col.replace(/\W/g,'_');
        return '<th onclick="window._pnSort(\'' + col.replace(/'/g,"\\'") + '\')" style="white-space:nowrap;cursor:pointer;">' +
          esc(col) + ' <i class="fas fa-sort" id="' + iconId + '" style="opacity:.3;font-size:8px;"></i></th>';
      }).join('') +
      (_columns.some(function(c) { return /url|link|href/i.test(c); }) ?
        '<th>Link</th>' : '');
    _displayCols = displayCols;
  }

  var _displayCols = [];
  var _ctiSidebarCat = '';

  /* ── Apply search + filter ──────────────────────────────────── */
  function _applySearchAndFilter() {
    var q       = (_query || '').trim().toLowerCase();
    var catCol  = el('pn-cat-filter') ? el('pn-cat-filter')._catCol : null;
    var catVal  = (_catFilter || '').trim();
    var searchCols = window._pnSearchCols || null;

    _filtered = _allData.filter(function(row) {
      // Category filter
      if (catVal && catCol && (row[catCol] || '').trim() !== catVal) return false;
      // Text search
      if (q) {
        var cols = searchCols || _columns;
        return cols.some(function(col) {
          return (row[col] || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      return true;
    });

    // Sort
    if (_sortKey) {
      var sk = _sortKey, sd = _sortDir;
      _filtered.sort(function(a, b) {
        var av = (a[sk] || '').toLowerCase();
        var bv = (b[sk] || '').toLowerCase();
        return av < bv ? -sd : av > bv ? sd : 0;
      });
    }

    _page = 1;
    _render();
  }

  /* ── Render table ───────────────────────────────────────────── */
  function _render() {
    var body     = el('pn-table-body');
    var pageInfo = el('pn-page-info');
    var pageBtns = el('pn-page-btns');
    var prevBtn  = el('pn-prev-btn');
    var nextBtn  = el('pn-next-btn');
    var recCnt   = el('pn-record-count');
    var schCnt   = el('pn-search-count');

    var total    = _filtered.length;
    var pages    = Math.max(1, Math.ceil(total / _perPage));
    _page        = Math.max(1, Math.min(_page, pages));
    var start    = (_page - 1) * _perPage;
    var end      = Math.min(start + _perPage, total);
    var slice    = _filtered.slice(start, end);

    // Record count badge — HD
    if (recCnt) {
      recCnt.innerHTML =
        '<span style="font-weight:700;margin-right:3px;">' + total.toLocaleString() + '</span>' +
        '<span style="font-size:10px;font-weight:400;color:var(--ss-muted);">of ' + _allData.length.toLocaleString() + ' total</span>';
    }
    if (schCnt) schCnt.textContent = total.toLocaleString() + ' total';

    var statusEl = el('pn-status');
    if (statusEl) statusEl.textContent = total.toLocaleString() + ' result' + (total !== 1 ? 's' : '');

    _renderSidebarList(slice, start);

    if (!body) return;
    if (!slice.length) {
      body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--ss-muted);">' +
        '<i class="fas fa-barcode" style="font-size:26px;opacity:.2;"></i>' +
        '<div style="font-size:12px;opacity:.5;">No results found</div>' +
        '<div style="font-size:10px;opacity:.4;">' + (_query ? 'Try a different search term' : 'No data loaded') + '</div></div>';
    } else {
      var linkCol = _columns.find(function(c) { return /url|link|href/i.test(c); });
      var html = '<table class="prem-table orange" style="width:100%;min-width:700px;">';
      slice.forEach(function(row, i) {
        var rowNum = start + i + 1;
        var rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)';
        html += '<tr style="background:' + rowBg + ';" ' +
          'onmouseover="this.querySelectorAll(\'td\').forEach(function(t){t.style.background=\'rgba(251,146,60,.03)\'})" ' +
          'onmouseout="this.querySelectorAll(\'td\').forEach(function(t){t.style.background=\'\'});">' +
          '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);font-size:10px;color:var(--ss-muted);width:38px;">' + rowNum + '</td>';
        (_displayCols.length ? _displayCols : _columns.slice(0,8)).forEach(function(col, ci) {
          var val = row[col] || '';
          // First col = brand badge, second = type text, third = part number, rest = description
          var cellContent;
          if (ci === 0) cellContent = '<span class="pn-brand-badge">' + esc(val) + '</span>';
          else if (ci === 2) cellContent = '<span class="pn-partno">' + esc(val) + '</span>';
          else if (ci === 3) cellContent = '<span class="pn-desc">' + esc(val) + '</span>';
          else cellContent = '<span style="color:var(--ss-muted);font-size:11px;">' + esc(val) + '</span>';
          html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;" title="' + esc(val) + '">' + cellContent + '</td>';
        });
        if (linkCol && row[linkCol]) {
          html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);"><a href="' + esc(row[linkCol]) + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;background:rgba(251,146,60,.08);border:1px solid rgba(251,146,60,.22);color:#fb923c;font-size:9px;font-weight:700;text-decoration:none;">' +
            '<i class="fas fa-external-link-alt" style="font-size:8px;"></i> Open</a></td>';
        } else if (_columns.some(function(c) { return /url|link|href/i.test(c); })) {
          html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);font-size:10px;color:var(--ss-muted);">—</td>';
        }
        html += '</tr>';
      });
      html += '</table>';
      body.innerHTML = html;
    }

    // Pagination HD
    if (pageInfo) pageInfo.textContent = 'Showing ' + (total ? (start+1).toLocaleString() : 0) + '–' + end.toLocaleString() + ' of ' + total.toLocaleString() + ' entries';
    if (prevBtn) { prevBtn.disabled = _page <= 1; prevBtn.style.opacity = _page <= 1 ? '.35' : '1'; }
    if (nextBtn) { nextBtn.disabled = _page >= pages; nextBtn.style.opacity = _page >= pages ? '.35' : '1'; }
    if (pageBtns) {
      var btnHtml = '';
      var lo = Math.max(1, _page-2), hi = Math.min(pages, _page+2);
      for (var p = lo; p <= hi; p++) {
        var isActive = p === _page;
        btnHtml += '<button onclick="window._pnGoPage(' + p + ')" class="prem-page-num ' + (isActive ? 'orange' : '') + '" ' +
          (!isActive ? 'style="border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--ss-muted);"' : '') +
          '>' + p + '</button>';
      }
      pageBtns.innerHTML = btnHtml;
    }
  }

  /* ── Sidebar list ───────────────────────────────────────────── */
  function _renderSidebarList(slice, startIdx) {
    var listEl = el('pn-results-list');
    if (!listEl) return;
    if (!slice.length) {
      listEl.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--ss-muted);">' +
        '<i class="fas fa-search" style="font-size:18px;opacity:.2;display:block;margin-bottom:8px;"></i>' +
        '<div style="font-size:11px;">No results</div></div>';
      return;
    }
    var firstCol  = _displayCols[0] || _columns[0] || '';
    var secondCol = _displayCols[1] || _columns[1] || '';
    listEl.innerHTML = slice.slice(0, 50).map(function(row, i) {
      var num   = startIdx + i + 1;
      var title = esc(row[firstCol] || '—');
      var sub   = secondCol ? esc(row[secondCol] || '') : '';
      return '<div style="padding:9px 12px;border-bottom:1px solid var(--ss-border2);cursor:default;transition:background .12s;" ' +
        'onmouseover="this.style.background=\'rgba(251,146,60,.06)\'" onmouseout="this.style.background=\'\'">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        '<span style="font-size:9px;color:var(--ss-muted);min-width:22px;">' + num + '</span>' +
        '<div style="min-width:0;">' +
        '<div style="font-size:11px;font-weight:700;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + title + '</div>' +
        (sub ? '<div style="font-size:9px;color:var(--ss-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>' : '') +
        '</div></div></div>';
    }).join('');
  }

  /* ── Loading / empty / error states ────────────────────────── */
  function _setBodyLoading(msg) {
    var body = el('pn-table-body');
    if (body) body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--ss-muted);">' +
      '<i class="fas fa-spinner fa-spin" style="font-size:20px;opacity:.4;"></i>' +
      '<span style="font-size:13px;opacity:.5;">' + esc(msg) + '</span></div>';
    var list = el('pn-results-list');
    if (list) list.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--ss-muted);">' +
      '<i class="fas fa-spinner fa-spin" style="font-size:18px;opacity:.3;display:block;margin-bottom:8px;"></i>' +
      '<div style="font-size:11px;">' + esc(msg) + '</div></div>';
  }

  function _setBodyEmpty() {
    var body = el('pn-table-body');
    if (body) body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--ss-muted);">' +
      '<i class="fas fa-link-slash" style="font-size:28px;opacity:.4;"></i>' +
      '<div style="font-size:13px;">No CSV URL configured</div>' +
      '<div style="font-size:11px;opacity:.6;">Go to General Settings → Part Number Settings</div></div>';
    var list = el('pn-results-list');
    if (list) list.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--ss-muted);">' +
      '<i class="fas fa-barcode" style="font-size:20px;opacity:.2;display:block;margin-bottom:8px;"></i>' +
      '<div style="font-size:11px;opacity:.7;">No CSV URL configured.<br><span style="opacity:.6;">General Settings → Part Number Settings</span></div></div>';
  }

  function _setBodyError(msg) {
    var body = el('pn-table-body');
    if (body) body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:#f85149;">' +
      '<i class="fas fa-exclamation-triangle" style="font-size:28px;opacity:.6;"></i>' +
      '<div style="font-size:13px;">Failed to load Parts Number data</div>' +
      '<div style="font-size:11px;opacity:.6;">' + esc(msg) + '</div>' +
      '<button onclick="window._pnRefresh()" style="margin-top:8px;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);color:#f85149;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:700;font-family:var(--ss-font);cursor:pointer;">' +
      '<i class="fas fa-redo"></i> Retry</button></div>';
  }

  /* ── Public handlers ────────────────────────────────────────── */
  window._pnOnSearch = function(q) {
    _query = q || '';
    // Sync both search inputs
    var si = el('pn-search-input'), mi = el('pn-main-search');
    if (si && si.value !== _query) si.value = _query;
    if (mi && mi.value !== _query) mi.value = _query;
    _applySearchAndFilter();
  };

  window._pnApplyFilters = function() {
    var cf = el('pn-cat-filter');
    _catFilter = cf ? cf.value : '';
    _applySearchAndFilter();
  };

  window._pnSort = function(col) {
    if (_sortKey === col) { _sortDir = -_sortDir; }
    else { _sortKey = col; _sortDir = 1; }
    // Update sort icons
    document.querySelectorAll('[id^="pn-sort-"]').forEach(function(ic) {
      ic.className = 'fas fa-sort'; ic.style.opacity = '.3';
    });
    var iconId = 'pn-sort-' + col.replace(/\W/g,'_');
    var icon = el(iconId);
    if (icon) { icon.className = 'fas fa-sort-' + (_sortDir > 0 ? 'up' : 'down'); icon.style.opacity = '1'; }
    _applySearchAndFilter();
  };

  window._pnChangePage = function(dir) {
    var pages = Math.max(1, Math.ceil(_filtered.length / _perPage));
    _page = Math.max(1, Math.min(_page + dir, pages));
    _render();
  };

  window._pnGoPage = function(p) {
    _page = p;
    _render();
  };

  window._pnExportCsv = function() {
    if (!_filtered.length || !_columns.length) return;
    var rows = [_columns.join(',')].concat(_filtered.map(function(row) {
      return _columns.map(function(c) {
        var v = String(row[c] || '');
        return /[,"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
      }).join(',');
    }));
    var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    var a    = document.createElement('a');
    a.href   = URL.createObjectURL(blob);
    a.download = 'parts_number_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

})();

/* ═══════════════════════════════════════════════════════════════════
   CONTACT INFORMATION TAB — Tab logic for the Contact Information tab
   ═══════════════════════════════════════════════════════════════════
   Reads:  window._ctiCsvUrl       (set by Contact Information Settings)
           window._ctiSearchCols   (set by Contact Information Settings)
           window.StudioCache     (IndexedDB cache layer)

   Exposes:
   - window._ctiInit()          → entry point (called by activateTab)
   - window._ctiRefresh()       → force reload from network
   - window._ctiOnSearch(q)     → search handler (sidebar + main search)
   - window._ctiApplyFilters()  → category filter change
   - window._ctiSort(col)       → sort by column key
   - window._ctiChangePage(dir) → pagination
   - window._ctiExportCsv()     → export filtered data as CSV
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var _allData     = [];   // full parsed dataset
  var _filtered    = [];   // after search + filter
  var _columns     = [];   // detected column keys (lowercase-normalized)
  var _colLabels   = {};   // { key: 'Original Header' }
  var _sortKey     = '';
  var _sortDir     = 1;    // 1=asc, -1=desc
  var _query       = '';
  var _catFilter   = '';
  var _page        = 1;
  var _perPage     = 100;
  var _initialized = false;
  var _loading     = false;
  var _ctiSidebarCat = '';

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function el(id)  { return document.getElementById(id); }

  /* ── Init ──────────────────────────────────────────────────── */
  window._ctiInit = function() {
    if (_initialized && _allData.length) {
      _render();
      return;
    }
    _loadData();
  };

  window._ctiRefresh = function() {
    _initialized = false;
    _allData     = [];
    _filtered    = [];
    _columns     = [];
    _colLabels   = {};
    _loadData();
  };

  /* ── Load data (cache-first, then network) ─────────────────── */
  function _loadData() {
    if (_loading) return;
    _loading = true;
    _setBodyLoading('Loading Contact Information data…');

    // 1. Try StudioCache first
    var cacheAvailable = typeof window.StudioCache !== 'undefined';
    var cachePromise = cacheAvailable
      ? window.StudioCache.getBundle('contact_information')
      : Promise.resolve(null);

    cachePromise.then(function(cached) {
      if (cached && cached.data && cached.data.length) {
        _parseData(cached.data, true);
        return;
      }
      // 2. Fall back to network
      return _fetchFromNetwork();
    }).catch(function() {
      return _fetchFromNetwork();
    }).catch(function(e) {
      _loading = false;
      _setBodyError(e.message);
    });
  }

  function _fetchFromNetwork() {
    function _loadSettingsIfNeeded() {
      if (window._ctiCsvUrl) return Promise.resolve();
      var tok = '';
      try {
        var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.access_token) tok = p.access_token;
        }
        if (!tok && window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') tok = window.CloudAuth.accessToken();
      } catch(_) {}
      if (!tok) return Promise.resolve(); // no token yet — caller will handle empty url
      return fetch('/api/studio/csv_settings?type=contact_information', {
        headers: { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-cache' }
      }).then(function(resp) { return resp.ok ? resp.json().catch(function(){ return null; }) : null; })
        .then(function(d) {
          if (d && d.ok && d.settings && d.settings.csvUrl) {
            window._ctiCsvUrl = d.settings.csvUrl;
            window._ctiSearchCols = (Array.isArray(d.settings.searchColumns) && d.settings.searchColumns.length > 0)
              ? d.settings.searchColumns : null;
          }
        })
        .catch(function() {});
    }

    return _loadSettingsIfNeeded().then(function() {
      var url = window._ctiCsvUrl;
      if (!url) {
        // Try to read from localStorage
        try {
          var s = localStorage.getItem('ss_contact_information_settings');
          if (s) { var p = JSON.parse(s); url = p.csvUrl || ''; }
        } catch(_) {}
      }
      if (!url) {
        _loading = false;
        _setBodyEmpty();
        return Promise.resolve();
      }
      return fetch(url).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' — check if sheet is published as CSV');
        return r.text();
      }).then(function(text) {
        var data = _parseCsv(text);
        if (typeof window.StudioCache !== 'undefined') {
          window.StudioCache.setBundle('contact_information', data, '', data.length).catch(function() {});
        }
        _parseData(data, false);
      });
    });
  }

  /* ── CSV Parser ─────────────────────────────────────────────── */
  function _parseCsv(text) {
    var lines   = text.split('\n');
    var headers = [];
    var rows    = [];

    function parseLine(line) {
      var result = [], cur = '', inQ = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      result.push(cur.trim());
      return result;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\r/,'').trim();
      if (!line) continue;
      var cells = parseLine(line);
      if (i === 0) { headers = cells; continue; }
      var row = {};
      headers.forEach(function(h, idx) { row[h] = cells[idx] || ''; });
      rows.push(row);
    }
    return rows;
  }

  /* ── Parse + store data ────────────────────────────────────── */
  function _parseData(rows, fromCache) {
    _loading    = false;
    _initialized = true;
    _allData    = rows;
    window.__studioCiRecords = Array.isArray(rows) ? rows.slice() : [];

    if (rows.length) {
      var firstRow = rows[0];
      _columns  = Object.keys(firstRow);
      _colLabels = {};
      _columns.forEach(function(k) { _colLabels[k] = k; });

      // Try to load configured search cols from settings
      try {
        var s = localStorage.getItem('ss_contact_information_settings');
        if (s) {
          var p = JSON.parse(s);
          window._ctiCsvUrl    = p.csvUrl || window._ctiCsvUrl || '';
          window._ctiSearchCols = (Array.isArray(p.searchColumns) && p.searchColumns.length)
            ? p.searchColumns : null;
        }
      } catch(_) {}
    }

    _buildCategoryFilter();
    _buildTableHeader();
    _applySearchAndFilter();
  }

  /* ── Build dynamic category filter ─────────────────────────── */
  function _buildCategoryFilter() {
    var catEl = el('cti-cat-filter');
    if (!catEl || !_columns.length) return;

    // Look for a 'category' or 'type' column (case-insensitive)
    var catCol = _columns.find(function(c) {
      return /category|type|group|class/i.test(c);
    });

    catEl.innerHTML = '<option value="">All End Users</option>';
    if (!catCol) return;

    var cats = {};
    _allData.forEach(function(row) {
      var v = (row[catCol] || '').trim();
      if (v) cats[v] = (cats[v] || 0) + 1;
    });

    Object.keys(cats).sort().forEach(function(cat) {
      var opt = document.createElement('option');
      opt.value       = cat;
      opt.textContent = cat + ' (' + cats[cat] + ')';
      catEl.appendChild(opt);
    });

    catEl._catCol = catCol;
    _ctiPopulateSidebarList();
  }

  function _ctiPopulateSidebarList() {
    var container = el('cti-sidebar-cat-list');
    var catEl = el('cti-cat-filter');
    if (!container || !catEl) return;
    var total = (_allData || []).length;
    var html = '';
    html += '<button class="prem-filter-btn ov' + (_ctiSidebarCat ? '' : ' active') + '" onclick="window._ctiSetSidebarFilter(\'\')">' +
      '<span class="prem-filter-inner"><span class="prem-filter-ico active"><i class="fas fa-users"></i></span><span class="prem-filter-lbl">All End Users</span></span>' +
      '<span class="prem-filter-cnt">' + total.toLocaleString() + '</span></button>';
    for (var i = 0; i < catEl.options.length; i++) {
      var opt = catEl.options[i];
      if (!opt.value) continue;
      var isActive = _ctiSidebarCat === opt.value;
      var lbl = opt.textContent.trim();
      var m = lbl.match(/^(.+?)\s*\((\d+)\)$/);
      var clean = m ? m[1] : lbl;
      var cnt = m ? m[2] : '';
      html += '<button class="prem-filter-btn ov' + (isActive ? ' active' : '') + '" onclick="window._ctiSetSidebarFilter(\'' + opt.value.replace(/'/g,"\\'") + '\')">' +
        '<span class="prem-filter-inner"><span class="prem-filter-ico ' + (isActive ? 'active' : 'idle') + '"><i class="fas fa-user"></i></span><span class="prem-filter-lbl">' + esc(clean) + '</span></span>' +
        '<span class="prem-filter-cnt">' + cnt + '</span></button>';
    }
    container.innerHTML = html;
  }

  function _ctiUpdateFilterBadge(val) {
    var badge = el('cti-active-filter');
    var label = el('cti-filter-label');
    if (!badge || !label) return;
    if (val) {
      label.textContent = val;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function _updateSidebarStats() {
    var totalEl = el('cti-stats-total');
    var endUsersEl = el('cti-stats-cats');
    if (totalEl) totalEl.textContent = (_filtered || []).length.toLocaleString();
    if (!endUsersEl) return;

    var catCol = el('cti-cat-filter') ? el('cti-cat-filter')._catCol : null;
    if (!catCol) {
      endUsersEl.textContent = '—';
      return;
    }

    var unique = Object.create(null);
    (_filtered || []).forEach(function(row) {
      var key = String(row[catCol] || '').trim();
      if (key) unique[key] = true;
    });
    endUsersEl.textContent = Object.keys(unique).length.toLocaleString();
  }

  /* ── Build dynamic table header ─────────────────────────────── */
  function _buildTableHeader() {
    var thead = el('cti-thead-row');
    if (!thead) return;
    var displayCols = _columns.slice(0, 8);
    thead.innerHTML = '<th style="width:38px;">#</th>' +
      displayCols.map(function(col) {
        var iconId = 'cti-sort-' + col.replace(/\W/g,'_');
        return '<th onclick="window._ctiSort(\'' + col.replace(/'/g,"\\'") + '\')" style="white-space:nowrap;cursor:pointer;">' +
          esc(col) + ' <i class="fas fa-sort" id="' + iconId + '" style="opacity:.3;font-size:8px;"></i></th>';
      }).join('') +
      (_columns.some(function(c) { return /url|link|href/i.test(c); }) ?
        '<th>Link</th>' : '');
    _displayCols = displayCols;
  }

  var _displayCols = [];

  /* ── Apply search + filter ──────────────────────────────────── */
  function _applySearchAndFilter() {
    var q       = (_query || '').trim().toLowerCase();
    var catCol  = el('cti-cat-filter') ? el('cti-cat-filter')._catCol : null;
    var catVal  = (_catFilter || '').trim();
    var searchCols = window._ctiSearchCols || null;

    _filtered = _allData.filter(function(row) {
      // Category filter
      if (catVal && catCol && (row[catCol] || '').trim() !== catVal) return false;
      // Text search
      if (q) {
        var cols = searchCols || _columns;
        return cols.some(function(col) {
          return (row[col] || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      return true;
    });

    // De-duplicate exact search hits:
    // If user search term is an exact match for a field value and multiple rows are 100% identical,
    // show only one copy of the same row to prevent duplicate clutter.
    if (q) {
      var colsForSearch = (searchCols && searchCols.length) ? searchCols : _columns;
      var exactHitKeys = Object.create(null);
      _filtered = _filtered.filter(function(row) {
        if (!_ctiRowHasExactMatch(row, q, colsForSearch)) return true;
        var sig = _ctiRenderSignature(row);
        if (exactHitKeys[sig]) return false;
        exactHitKeys[sig] = true;
        return true;
      });
    }

    // Sort
    if (_sortKey) {
      var sk = _sortKey, sd = _sortDir;
      _filtered.sort(function(a, b) {
        var av = (a[sk] || '').toLowerCase();
        var bv = (b[sk] || '').toLowerCase();
        return av < bv ? -sd : av > bv ? sd : 0;
      });
    }

    _page = 1;
    _render();
  }

  function _ctiNormalize(val) {
    return String(val || '')
      .toLowerCase()
      // Keep only alphanumerics so phone formats like
      // "+52 (818) 186–5323" and "52(818)186-5323" compare equal.
      .replace(/[^a-z0-9]/g, '');
  }

  function _ctiRowHasExactMatch(row, query, cols) {
    var nq = _ctiNormalize(query);
    if (!nq) return false;
    return (cols || []).some(function(col) {
      return _ctiNormalize(row[col]) === nq;
    });
  }

  function _ctiRenderSignature(row) {
    var cols = (_displayCols && _displayCols.length) ? _displayCols : (_columns || []).slice(0, 8);
    return cols.map(function(col) {
      return String(row[col] || '').trim();
    }).join('\u241F');
  }

  /* ── Render table ───────────────────────────────────────────── */
  function _render() {
    var body     = el('cti-table-body');
    var pageInfo = el('cti-page-info');
    var pageBtns = el('cti-page-btns');
    var prevBtn  = el('cti-prev-btn');
    var nextBtn  = el('cti-next-btn');
    var recCnt   = el('cti-record-count');
    var schCnt   = el('cti-search-count');

    var total    = _filtered.length;
    var pages    = Math.max(1, Math.ceil(total / _perPage));
    _page        = Math.max(1, Math.min(_page, pages));
    var start    = (_page - 1) * _perPage;
    var end      = Math.min(start + _perPage, total);
    var slice    = _filtered.slice(start, end);

    // Record count badge — HD
    if (recCnt) {
      recCnt.innerHTML =
        '<span style="font-weight:700;margin-right:3px;">' + total.toLocaleString() + '</span>' +
        '<span style="font-size:10px;font-weight:400;color:var(--ss-muted);">of ' + _allData.length.toLocaleString() + ' total</span>';
    }
    if (schCnt) schCnt.textContent = total.toLocaleString() + ' total';

    var statusEl = el('cti-status');
    if (statusEl) statusEl.textContent = total.toLocaleString() + ' result' + (total !== 1 ? 's' : '');

    _renderSidebarList(slice, start);
    _updateSidebarStats();

    if (!body) return;
    if (!slice.length) {
      body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--ss-muted);">' +
        '<i class="fas fa-barcode" style="font-size:26px;opacity:.2;"></i>' +
        '<div style="font-size:12px;opacity:.5;">No results found</div>' +
        '<div style="font-size:10px;opacity:.4;">' + (_query ? 'Try a different search term' : 'No data loaded') + '</div></div>';
    } else {
      var linkCol = _columns.find(function(c) { return /url|link|href/i.test(c); });
      var html = '<table class="prem-table cyan" style="width:100%;min-width:700px;">';
      slice.forEach(function(row, i) {
        var rowNum = start + i + 1;
        var rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)';
        html += '<tr style="background:' + rowBg + ';" ' +
          'onmouseover="this.querySelectorAll(\'td\').forEach(function(t){t.style.background=\'rgba(20,184,166,.08)\'})" ' +
          'onmouseout="this.querySelectorAll(\'td\').forEach(function(t){t.style.background=\'\'});">' +
          '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);font-size:10px;color:var(--ss-muted);width:38px;">' + rowNum + '</td>';
        (_displayCols.length ? _displayCols : _columns.slice(0,8)).forEach(function(col, ci) {
          var val = row[col] || '';
          // First col = brand badge, second = type text, third = part number, rest = description
          var cellContent;
          if (ci === 0) cellContent = '<span class="pn-brand-badge">' + esc(val) + '</span>';
          else if (ci === 2) cellContent = '<span class="pn-partno">' + esc(val) + '</span>';
          else if (ci === 3) cellContent = '<span class="pn-desc">' + esc(val) + '</span>';
          else cellContent = '<span style="color:var(--ss-muted);font-size:11px;">' + esc(val) + '</span>';
          html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;" title="' + esc(val) + '">' + cellContent + '</td>';
        });
        if (linkCol && row[linkCol]) {
          html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);"><a href="' + esc(row[linkCol]) + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;background:rgba(20,184,166,.1);border:1px solid rgba(20,184,166,.26);color:#14b8a6;font-size:9px;font-weight:700;text-decoration:none;">' +
            '<i class="fas fa-external-link-alt" style="font-size:8px;"></i> Open</a></td>';
        } else if (_columns.some(function(c) { return /url|link|href/i.test(c); })) {
          html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);font-size:10px;color:var(--ss-muted);">—</td>';
        }
        html += '</tr>';
      });
      html += '</table>';
      body.innerHTML = html;
    }

    // Pagination HD
    if (pageInfo) pageInfo.textContent = 'Showing ' + (total ? (start+1).toLocaleString() : 0) + '–' + end.toLocaleString() + ' of ' + total.toLocaleString() + ' entries';
    if (prevBtn) { prevBtn.disabled = _page <= 1; prevBtn.style.opacity = _page <= 1 ? '.35' : '1'; }
    if (nextBtn) { nextBtn.disabled = _page >= pages; nextBtn.style.opacity = _page >= pages ? '.35' : '1'; }
    if (pageBtns) {
      var btnHtml = '';
      var lo = Math.max(1, _page-2), hi = Math.min(pages, _page+2);
      for (var p = lo; p <= hi; p++) {
        var isActive = p === _page;
        btnHtml += '<button onclick="window._ctiGoPage(' + p + ')" class="prem-page-num ' + (isActive ? 'cyan' : '') + '" ' +
          (!isActive ? 'style="border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--ss-muted);"' : '') +
          '>' + p + '</button>';
      }
      pageBtns.innerHTML = btnHtml;
    }
  }

  /* ── Sidebar list ───────────────────────────────────────────── */
  function _renderSidebarList(slice, startIdx) {
    var listEl = el('cti-results-list');
    if (!listEl) return;
    if (!slice.length) {
      listEl.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--ss-muted);">' +
        '<i class="fas fa-search" style="font-size:18px;opacity:.2;display:block;margin-bottom:8px;"></i>' +
        '<div style="font-size:11px;">No results</div></div>';
      return;
    }
    var firstCol  = _displayCols[0] || _columns[0] || '';
    var secondCol = _displayCols[1] || _columns[1] || '';
    listEl.innerHTML = slice.slice(0, 50).map(function(row, i) {
      var num   = startIdx + i + 1;
      var title = esc(row[firstCol] || '—');
      var sub   = secondCol ? esc(row[secondCol] || '') : '';
      return '<div style="padding:9px 12px;border-bottom:1px solid var(--ss-border2);cursor:default;transition:background .12s;" ' +
        'onmouseover="this.style.background=\'rgba(20,184,166,.08)\'" onmouseout="this.style.background=\'\'">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        '<span style="font-size:9px;color:var(--ss-muted);min-width:22px;">' + num + '</span>' +
        '<div style="min-width:0;">' +
        '<div style="font-size:11px;font-weight:700;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + title + '</div>' +
        (sub ? '<div style="font-size:9px;color:var(--ss-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>' : '') +
        '</div></div></div>';
    }).join('');
  }

  /* ── Loading / empty / error states ────────────────────────── */
  function _setBodyLoading(msg) {
    var body = el('cti-table-body');
    if (body) body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--ss-muted);">' +
      '<i class="fas fa-spinner fa-spin" style="font-size:20px;opacity:.4;"></i>' +
      '<span style="font-size:13px;opacity:.5;">' + esc(msg) + '</span></div>';
    var list = el('cti-results-list');
    if (list) list.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--ss-muted);">' +
      '<i class="fas fa-spinner fa-spin" style="font-size:18px;opacity:.3;display:block;margin-bottom:8px;"></i>' +
      '<div style="font-size:11px;">' + esc(msg) + '</div></div>';
  }

  function _setBodyEmpty() {
    var body = el('cti-table-body');
    if (body) body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--ss-muted);">' +
      '<i class="fas fa-link-slash" style="font-size:28px;opacity:.4;"></i>' +
      '<div style="font-size:13px;">No CSV URL configured</div>' +
      '<div style="font-size:11px;opacity:.6;">Go to General Settings → Contact Information Settings</div></div>';
    var list = el('cti-results-list');
    if (list) list.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--ss-muted);">' +
      '<i class="fas fa-barcode" style="font-size:20px;opacity:.2;display:block;margin-bottom:8px;"></i>' +
      '<div style="font-size:11px;opacity:.7;">No CSV URL configured.<br><span style="opacity:.6;">General Settings → Contact Information Settings</span></div></div>';
  }

  function _setBodyError(msg) {
    var body = el('cti-table-body');
    if (body) body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:#f85149;">' +
      '<i class="fas fa-exclamation-triangle" style="font-size:28px;opacity:.6;"></i>' +
      '<div style="font-size:13px;">Failed to load Contact Information data</div>' +
      '<div style="font-size:11px;opacity:.6;">' + esc(msg) + '</div>' +
      '<button onclick="window._ctiRefresh()" style="margin-top:8px;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);color:#f85149;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:700;font-family:var(--ss-font);cursor:pointer;">' +
      '<i class="fas fa-redo"></i> Retry</button></div>';
  }

  /* ── Public handlers ────────────────────────────────────────── */
  window._ctiOnSearch = function(q) {
    _query = q || '';
    // Sync both search inputs
    var si = el('cti-search-input'), mi = el('cti-main-search');
    if (si && si.value !== _query) si.value = _query;
    if (mi && mi.value !== _query) mi.value = _query;
    _applySearchAndFilter();
  };

  window._ctiApplyFilters = function() {
    var cf = el('cti-cat-filter');
    _catFilter = cf ? cf.value : '';
    _ctiSidebarCat = _catFilter || '';
    _ctiPopulateSidebarList();
    _ctiUpdateFilterBadge(_ctiSidebarCat);
    _applySearchAndFilter();
  };

  window._ctiSort = function(col) {
    if (_sortKey === col) { _sortDir = -_sortDir; }
    else { _sortKey = col; _sortDir = 1; }
    // Update sort icons
    document.querySelectorAll('[id^="cti-sort-"]').forEach(function(ic) {
      ic.className = 'fas fa-sort'; ic.style.opacity = '.3';
    });
    var iconId = 'cti-sort-' + col.replace(/\W/g,'_');
    var icon = el(iconId);
    if (icon) { icon.className = 'fas fa-sort-' + (_sortDir > 0 ? 'up' : 'down'); icon.style.opacity = '1'; }
    _applySearchAndFilter();
  };

  window._ctiChangePage = function(dir) {
    var pages = Math.max(1, Math.ceil(_filtered.length / _perPage));
    _page = Math.max(1, Math.min(_page + dir, pages));
    _render();
  };

  window._ctiGoPage = function(p) {
    _page = p;
    _render();
  };

  window._ctiExportCsv = function() {
    if (!_filtered.length || !_columns.length) return;
    var rows = [_columns.join(',')].concat(_filtered.map(function(row) {
      return _columns.map(function(c) {
        var v = String(row[c] || '');
        return /[,"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
      }).join(',');
    }));
    var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    var a    = document.createElement('a');
    a.href   = URL.createObjectURL(blob);
    a.download = 'contact_information_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  window._ctiSetSidebarFilter = function(val) {
    _ctiSidebarCat = val || '';
    var cf = el('cti-cat-filter');
    if (cf) cf.value = _ctiSidebarCat;
    _ctiUpdateFilterBadge(_ctiSidebarCat);
    _ctiPopulateSidebarList();
    window._ctiApplyFilters();
  };

  window._ctiClearSidebarFilter = function() {
    window._ctiSetSidebarFilter('');
  };

  window._ctiToggleSection = function() {
    var list = el('cti-sidebar-cat-list');
    var btn  = el('cti-cat-toggle-btn');
    if (!list) return;
    var hidden = list.style.display === 'none';
    list.style.display = hidden ? 'flex' : 'none';
    if (btn) btn.textContent = hidden ? '▾' : '▸';
  };

})();

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR FILTER BRIDGE — Connect+ & Parts Number
   Monkey-patches _buildFilterOptions (CP) and _buildCategoryFilter (PN)
   to also populate the new premium sidebar filter lists.
   All existing JS logic untouched — this only ADDS behavior.
═══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  /* ── Helpers ───────────────────────────────────────────────── */
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function $(id) { return document.getElementById(id); }

  /* ── CONNECT+ SIDEBAR BRIDGE ─────────────────────────────── */

  // State for sidebar active filter
  var _cpSidebarCountry = '';
  var _cpSidebarDir     = '';

  // Read total sites count from cp-search-count DOM text: "36,251 total" → 36251
  function _cpParseTotalSites() {
    var sc = $('cp-search-count');
    if (!sc) return 0;
    var m = sc.textContent.match(/([\d,]+)\s+(?:total|of)/);
    if (m) return parseInt(m[1].replace(/,/g,'')) || 0;
    // Also try cp-record-count: "36,251 sites"
    var rc = $('cp-record-count');
    if (!rc) return 0;
    var m2 = rc.textContent.match(/([\d,]+)/);
    return m2 ? (parseInt(m2[1].replace(/,/g,'')) || 0) : 0;
  }

  // Called after _buildFilterOptions populates the hidden selects
  function _cpPopulateSidebarLists() {
    var cSel = $('cp-country-filter');
    var dSel = $('cp-dir-filter');
    if (!cSel || !dSel) return;

    var totalSites   = _cpParseTotalSites();
    var numCountries = Math.max(0, cSel.options.length - 1); // minus "All Countries"

    var miniEl = $('cp-stats-mini');
    if (miniEl && (totalSites > 0 || numCountries > 0)) {
      miniEl.innerHTML =
        '<div style="background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.15);border-radius:6px;padding:6px 8px;text-align:center;">' +
          '<div style="font-size:13px;font-weight:800;color:#22d3ee;">' + (totalSites > 0 ? totalSites.toLocaleString() : numCountries > 0 ? '36K+' : '—') + '</div>' +
          '<div style="font-size:9px;color:rgba(255,255,255,.35);margin-top:1px;">Sites</div>' +
        '</div>' +
        '<div style="background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.15);border-radius:6px;padding:6px 8px;text-align:center;">' +
          '<div style="font-size:13px;font-weight:800;color:#3fb950;">' + (numCountries > 0 ? numCountries : '—') + '</div>' +
          '<div style="font-size:9px;color:rgba(255,255,255,.35);margin-top:1px;">Countries</div>' +
        '</div>';
    }

    // Build country list
    _cpBuildFilterList(
      'cp-sidebar-country-list',
      cSel,
      'fa-globe',
      '#22d3ee',
      'country',
      _cpSidebarCountry,
      totalSites
    );

    // Build directory list
    _cpBuildFilterList(
      'cp-sidebar-dir-list',
      dSel,
      'fa-folder',
      '#22d3ee',
      'directory',
      _cpSidebarDir,
      totalSites
    );
  }

  function _cpBuildFilterList(containerId, selectEl, icon, color, type, activeVal, totalCount) {
    var container = $(containerId);
    if (!container) return;
    var options = [];
    for (var i = 0; i < selectEl.options.length; i++) {
      var opt = selectEl.options[i];
      if (opt.value !== '') {
        var label = opt.textContent.trim();
        var m = label.match(/^(.+?)\s*\((\d+)\)$/);
        options.push({ value: opt.value, label: m ? m[1] : label, count: m ? parseInt(m[2]) : '' });
      }
    }
    var allIsActive = (activeVal === '');
    var html = '';
    // "All" button — uses prem CSS classes
    html += '<button class="prem-filter-btn cv' + (allIsActive ? ' active' : '') + '" ' +
      'onclick="window._cpSidebarFilter(\'' + type + '\',\'\')">' +
      '<span class="prem-filter-inner">' +
        '<span class="prem-filter-ico ' + (allIsActive ? 'active' : 'idle') + '"><i class="fas ' + icon + '"></i></span>' +
        '<span class="prem-filter-lbl">All ' + (type === 'country' ? 'Countries' : 'Directories') + '</span>' +
      '</span>' +
      '<span class="prem-filter-cnt">' + (totalCount ? totalCount.toLocaleString() : '') + '</span>' +
    '</button>';
    options.forEach(function(opt) {
      var isActive = (activeVal === opt.value);
      html += '<button class="prem-filter-btn cv' + (isActive ? ' active' : '') + '" ' +
        'onclick="window._cpSidebarFilter(\'' + type + '\',\'' + opt.value.replace(/'/g,"\\'") + '\')">' +
        '<span class="prem-filter-inner">' +
          '<span class="prem-filter-ico idle"><i class="fas ' + icon + '"></i></span>' +
          '<span class="prem-filter-lbl">' + esc(opt.label) + '</span>' +
        '</span>' +
        '<span class="prem-filter-cnt">' + (opt.count !== '' ? opt.count.toLocaleString() : '') + '</span>' +
      '</button>';
    });
    container.innerHTML = html;
  }

  // Sidebar filter click handler
  window._cpSidebarFilter = function(type, val) {
    var cSel = $('cp-country-filter');
    var dSel = $('cp-dir-filter');
    if (type === 'country') {
      _cpSidebarCountry = val;
      if (cSel) cSel.value = val;
    } else {
      _cpSidebarDir = val;
      if (dSel) dSel.value = val;
    }
    // Update active filter badge
    _cpUpdateFilterBadge();
    // Rebuild lists to reflect active state
    _cpPopulateSidebarLists();
    // Trigger filter
    if (typeof window._cpApplyFilters === 'function') window._cpApplyFilters();
  };

  window._cpClearSidebarFilter = function() {
    _cpSidebarCountry = '';
    _cpSidebarDir = '';
    var cSel = $('cp-country-filter');
    var dSel = $('cp-dir-filter');
    if (cSel) cSel.value = '';
    if (dSel) dSel.value = '';
    _cpUpdateFilterBadge();
    _cpPopulateSidebarLists();
    if (typeof window._cpApplyFilters === 'function') window._cpApplyFilters();
  };

  function _cpUpdateFilterBadge() {
    var badge  = $('cp-active-filter');
    var label  = $('cp-filter-label');
    if (!badge || !label) return;
    var parts = [];
    if (_cpSidebarCountry) parts.push(_cpSidebarCountry);
    if (_cpSidebarDir)     parts.push(_cpSidebarDir);
    if (parts.length) {
      label.textContent = parts.join(' · ');
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  window._cpToggleSection = function(section) {
    var listId = section === 'country' ? 'cp-sidebar-country-list' : 'cp-sidebar-dir-list';
    var btnId  = section === 'country' ? 'cp-country-toggle'       : 'cp-dir-toggle';
    var list   = $(listId);
    var btn    = $(btnId);
    if (!list) return;
    var hidden = list.style.display === 'none';
    list.style.display = hidden ? 'flex' : 'none';
    if (btn) btn.textContent = hidden ? '▾' : '▸';
  };

  /* ── PARTS NUMBER SIDEBAR BRIDGE ─────────────────────────── */

  var _pnSidebarCat     = '';

  // Parse total parts from pn-record-count DOM: innerHTML contains a span with number
  function _pnParseTotalParts() {
    var rc = $('pn-record-count');
    if (!rc) return 0;
    // innerHTML: "<span...>1,234</span> <span...>of 4,948 total</span>"
    var full = rc.textContent || '';
    var nums = full.match(/of\s+([\d,]+)/);
    if (nums) return parseInt(nums[1].replace(/,/g,'')) || 0;
    // Fallback: first number
    var m = full.match(/([\d,]+)/);
    return m ? (parseInt(m[1].replace(/,/g,'')) || 0) : 0;
  }

  function _pnPopulateSidebarList() {
    var catEl = $('pn-cat-filter');
    if (!catEl) return;

    var totalParts = _pnParseTotalParts();
    var catCount   = Math.max(0, catEl.options.length - 1);

    var statsTotal = $('pn-stats-total');
    var statsCats  = $('pn-stats-cats');
    if (statsTotal) statsTotal.textContent = totalParts > 0 ? totalParts.toLocaleString() : (catCount > 0 ? '—' : '—');
    if (statsCats  && catCount > 0) statsCats.textContent  = catCount;

    var container = $('pn-sidebar-cat-list');
    if (!container) return;

    var allIsActive = (_pnSidebarCat === '');
    var html = '';

    // "All" button — prem CSS classes
    html += '<button class="prem-filter-btn ov' + (allIsActive ? ' active' : '') + '" ' +
      'onclick="window._pnSidebarFilter(\'\')">' +
      '<span class="prem-filter-inner">' +
        '<span class="prem-filter-ico ' + (allIsActive ? 'active' : 'idle') + '"><i class="fas fa-th-large"></i></span>' +
        '<span class="prem-filter-lbl">All Categories</span>' +
      '</span>' +
      '<span class="prem-filter-cnt">' + (totalParts ? totalParts.toLocaleString() : '') + '</span>' +
    '</button>';

    for (var j = 0; j < catEl.options.length; j++) {
      var opt = catEl.options[j];
      if (!opt.value) continue;
      var isActive = (_pnSidebarCat === opt.value);
      var lbl = opt.textContent.trim();
      var match = lbl.match(/^(.+?)\s*\((\d+)\)$/);
      var labelClean = match ? match[1] : lbl;
      var cnt = match ? parseInt(match[2]) : '';

      var typeIcon = 'fa-cube';
      var lc = labelClean.toLowerCase();
      if (lc.includes('control') || lc.includes('xr') || lc.includes('cc')) typeIcon = 'fa-microchip';
      else if (lc.includes('stand alone') || lc.includes('standalone'))      typeIcon = 'fa-server';
      else if (lc.includes('network') || lc.includes('connect'))             typeIcon = 'fa-wifi';
      else if (lc.includes('sensor') || lc.includes('probe'))                typeIcon = 'fa-thermometer-half';
      else if (lc.includes('valve') || lc.includes('sporlan') || lc.includes('alco') || lc.includes('danfoss')) typeIcon = 'fa-cog';
      else if (lc.includes('license') || lc.includes('key'))                 typeIcon = 'fa-key';
      else if (lc.includes('rga') || lc.includes('warranty'))                typeIcon = 'fa-undo-alt';
      else if (lc.includes('display') || lc.includes('screen') || lc.includes('supervisor')) typeIcon = 'fa-desktop';
      else if (lc.includes('probe') || lc.includes('thermometer'))           typeIcon = 'fa-thermometer-half';
      else if (lc.includes('walmart') || lc.includes('job'))                 typeIcon = 'fa-briefcase';
      else if (lc.includes('inquiry') || lc.includes('part number'))         typeIcon = 'fa-search';
      else if (lc.includes('accessor'))                                       typeIcon = 'fa-puzzle-piece';

      html += '<button class="prem-filter-btn ov' + (isActive ? ' active' : '') + '" ' +
        'onclick="window._pnSidebarFilter(\'' + opt.value.replace(/'/g,"\\'") + '\')">' +
        '<span class="prem-filter-inner">' +
          '<span class="prem-filter-ico idle"><i class="fas ' + typeIcon + '"></i></span>' +
          '<span class="prem-filter-lbl">' + esc(labelClean) + '</span>' +
        '</span>' +
        '<span class="prem-filter-cnt">' + (cnt !== '' ? cnt.toLocaleString() : '') + '</span>' +
      '</button>';
    }

    container.innerHTML = html;
  }

  window._pnSidebarFilter = function(val) {
    _pnSidebarCat = val;
    var catEl = $('pn-cat-filter');
    if (catEl) catEl.value = val;
    // Update active filter badge
    _pnUpdateFilterBadge(val);
    // Rebuild list
    _pnPopulateSidebarList();
    // Trigger filter
    if (typeof window._pnApplyFilters === 'function') window._pnApplyFilters();
  };

  window._pnClearSidebarFilter = function() {
    _pnSidebarCat = '';
    var catEl = $('pn-cat-filter');
    if (catEl) catEl.value = '';
    _pnUpdateFilterBadge('');
    _pnPopulateSidebarList();
    if (typeof window._pnApplyFilters === 'function') window._pnApplyFilters();
  };

  function _pnUpdateFilterBadge(val) {
    var badge = $('pn-active-filter');
    var label = $('pn-filter-label');
    if (!badge || !label) return;
    if (val) {
      label.textContent = val;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  window._pnToggleSection = function() {
    var list = $('pn-sidebar-cat-list');
    var btn  = $('pn-cat-toggle-btn');
    if (!list) return;
    var hidden = list.style.display === 'none';
    list.style.display = hidden ? 'flex' : 'none';
    if (btn) btn.textContent = hidden ? '▾' : '▸';
  };

  /* ── Monkey-patch _cpApplyFilters to sync sidebar state ───── */
  function _patchCpApplyFilters() {
    var orig = window._cpApplyFilters;
    if (!orig || orig.__bridgePatched) return;
    window._cpApplyFilters = function() {
      orig.apply(this, arguments);
      var cEl = $('cp-country-filter');
      var dEl = $('cp-dir-filter');
      if (cEl) _cpSidebarCountry = cEl.value;
      if (dEl) _cpSidebarDir     = dEl.value;
      _cpUpdateFilterBadge();
      // Refresh stats after render (count will have updated in DOM)
      setTimeout(function() {
        var miniEl = $('cp-stats-mini');
        if (miniEl) {
          var cSel2 = $('cp-country-filter');
          var total2 = _cpParseTotalSites();
          var nc = cSel2 ? Math.max(0, cSel2.options.length - 1) : 0;
          if (total2 > 0 || nc > 0) {
            miniEl.querySelector('div:first-child div:first-child').textContent =
              total2 > 0 ? total2.toLocaleString() : '36K+';
          }
        }
      }, 120);
    };
    window._cpApplyFilters.__bridgePatched = true;
  }

  /* ── MutationObserver: watch hidden selects for options ───── */
  function _observeSelect(selectId, callback) {
    var sel = $(selectId);
    if (!sel) { setTimeout(function() { _observeSelect(selectId, callback); }, 600); return; }
    // Fire immediately if already populated
    if (sel.options.length > 1) { callback(); }
    // Watch for future changes
    var obs = new MutationObserver(function(muts) {
      var hasNew = muts.some(function(m) {
        return m.type === 'childList' && m.addedNodes.length > 0;
      });
      if (hasNew && sel.options.length > 1) callback();
    });
    obs.observe(sel, { childList: true });
  }

  // ── Also watch pn-record-count for PN total parts update ────
  function _observeRecordCount(rcId, callback) {
    var rc = $(rcId);
    if (!rc) { setTimeout(function() { _observeRecordCount(rcId, callback); }, 600); return; }
    var obs = new MutationObserver(function() { callback(); });
    obs.observe(rc, { childList: true, subtree: true, characterData: true });
  }

  // ── Bootstrap ───────────────────────────────────────────────
  function _boot() {
    // CP: watch country-filter for population
    _observeSelect('cp-country-filter', function() {
      _patchCpApplyFilters();
      _cpPopulateSidebarLists();
    });

    // CP: also watch cp-record-count to refresh stats after data loads
    _observeRecordCount('cp-record-count', function() {
      var miniEl = $('cp-stats-mini');
      if (!miniEl) return;
      var total = _cpParseTotalSites();
      var cSel  = $('cp-country-filter');
      var nc    = cSel ? Math.max(0, cSel.options.length - 1) : 0;
      if (total > 0) {
        var siteDiv = miniEl.querySelector('div');
        if (siteDiv) {
          var numDiv = siteDiv.querySelector('div');
          if (numDiv) numDiv.textContent = total.toLocaleString();
        }
      }
    });

    // PN: watch cat-filter for population
    _observeSelect('pn-cat-filter', function() {
      _pnPopulateSidebarList();
    });

    // PN: watch record count for total parts update
    _observeRecordCount('pn-record-count', function() {
      var total = _pnParseTotalParts();
      var statsTotal = $('pn-stats-total');
      if (statsTotal && total > 0) statsTotal.textContent = total.toLocaleString();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

  // Expose hooks (optional convenience)
  window._cpOnDataLoaded = function() { _cpPopulateSidebarLists(); };
  window._pnOnDataLoaded = function() { _pnPopulateSidebarList(); };

})();
