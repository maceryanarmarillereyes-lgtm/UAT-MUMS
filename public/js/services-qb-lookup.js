(function () {
  'use strict';
  // ─────────────────────────────────────────────────────────────────────────────
  // services-qb-lookup.js  v2.0 — QB Field Selector + Batch Auto-populate Engine
  // ─────────────────────────────────────────────────────────────────────────────
  // BATCH REFACTOR (MACE CLEARED 2026-04-19):
  //   v1.0: 1 HTTP request per row → 500+ concurrent QB hits → mass 500 errors
  //   v2.0: Collect ALL unique Case #s → chunk 100/req → 2 concurrent batches
  //         ~6 total requests for 522 rows instead of 522 individual requests.
  //
  // Public API (window.svcQbLookup) — unchanged interface:
  //   .openFieldPicker({ colIdx, cols, onSelect })
  //   .autofillLinkedColumns(current, gridEl)
  //   .clearCache()
  // ─────────────────────────────────────────────────────────────────────────────

  // ── JWT helper ────────────────────────────────────────────────────────────────
  function getJwt() {
    var LS = 'mums_supabase_session';
    var sources = [
      function () { return localStorage.getItem(LS); },
      function () { return sessionStorage.getItem(LS); },
      function () {
        var m = document.cookie.match('(?:^|;)\\s*' + LS + '=([^;]*)');
        return m ? decodeURIComponent(m[1]) : null;
      }
    ];
    for (var i = 0; i < sources.length; i++) {
      try {
        var raw = sources[i]();
        if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      } catch (_) {}
    }
    return '';
  }

  function apiHeaders() {
    var jwt = getJwt();
    return jwt ? { Authorization: 'Bearer ' + jwt } : {};
  }

  // ── Fields cache (client-side 5 min) ─────────────────────────────────────────
  var _fieldsCache = null;
  var _FIELDS_TTL  = 5 * 60 * 1000;

  function loadFields(forceRefresh) {
    if (!forceRefresh && _fieldsCache && (Date.now() - _fieldsCache.at) < _FIELDS_TTL) {
      return Promise.resolve(_fieldsCache.fields);
    }
    var url = '/api/studio/qb_fields' + (forceRefresh ? '?forceRefresh=1' : '');
    return fetch(url, { headers: apiHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          if (data.warning === 'studio_qb_not_configured') return [];
          throw new Error(data.message || 'Failed to load QB fields');
        }
        _fieldsCache = { fields: data.fields || [], at: Date.now() };
        return _fieldsCache.fields;
      });
  }

  // ── Per-record client cache ───────────────────────────────────────────────────
  var _recordCache  = {};  // caseNum → { fields, columnMap, at }
  var _notFound     = {};  // caseNum → timestamp
  var _RECORD_TTL   = 5 * 60 * 1000;
  // Keep not-found cache short so backend fixes / QB sync do not stay stale
  // in the browser for long periods.
  var _NOT_FOUND_TTL = 60 * 1000;

  // ── Batch fetch engine ────────────────────────────────────────────────────────
  var _BATCH_SIZE        = 100;
  var _BATCH_CONCURRENCY = 2;
  var _batchInFlight = {};

  function _chunkArray(arr, size) {
    var chunks = [];
    for (var i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  function _fetchBatch(ids) {
    var key = ids.slice().sort().join(',');
    if (_batchInFlight[key]) return _batchInFlight[key];

    var p = fetch('/api/studio/qb_data?recordIds=' + encodeURIComponent(ids.join(',')), { headers: apiHeaders() })
      .then(function (r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) return {};
        var recs = data.records || {};
        var hasTransientError = !!(data.transientError || data.error);
        Object.keys(recs).forEach(function (caseNum) {
          var rec = { fields: recs[caseNum].fields || {}, columnMap: recs[caseNum].columnMap || {}, at: Date.now() };
          _recordCache[caseNum] = rec;
          delete _notFound[caseNum];
        });
        if (!hasTransientError) {
          (data.notFound || []).forEach(function (caseNum) {
            _notFound[caseNum] = Date.now();
          });
        }
        return recs;
      })
      .catch(function () { return {}; })
      .finally(function () { delete _batchInFlight[key]; });

    _batchInFlight[key] = p;
    return p;
  }

  function _runBatchesWithConcurrency(chunks, onChunkDone) {
    if (!chunks.length) return Promise.resolve();
    var idx     = 0;
    var running = 0;
    return new Promise(function (resolve) {
      function next() {
        while (running < _BATCH_CONCURRENCY && idx < chunks.length) {
          var chunk = chunks[idx++];
          running++;
          _fetchBatch(chunk).then(function (result) {
            if (onChunkDone) onChunkDone(result);
            running--;
            if (idx >= chunks.length && running === 0) resolve();
            else next();
          });
        }
      }
      next();
    });
  }

  function fetchManyRecords(caseNums, onProgress) {
    var toFetch = caseNums.filter(function (k) {
      if (!k) return false;
      var cached = _recordCache[k];
      if (cached && (Date.now() - cached.at) < _RECORD_TTL) return false;
      var nf = _notFound[k];
      if (nf && (Date.now() - nf) < _NOT_FOUND_TTL) return false;
      return true;
    });

    var seen = {};
    toFetch = toFetch.filter(function (k) { if (seen[k]) return false; seen[k] = true; return true; });

    if (!toFetch.length) return Promise.resolve();
    var chunks = _chunkArray(toFetch, _BATCH_SIZE);
    return _runBatchesWithConcurrency(chunks, onProgress);
  }

  // ── Auto-fill engine ──────────────────────────────────────────────────────────
  var _autofillTimer = null;
  var _autofillAbort = null;

  function autofillLinkedColumns(current, gridEl) {
    if (!current || !gridEl) return;
    var cols = current.sheet.column_defs || [];

    var linkedCols = cols.filter(function (c) { return c.qbLookup && c.qbLookup.fieldId; });
    if (!linkedCols.length) return;

    var caseCol = cols[0];
    if (!caseCol) return;

    var rowsWithCase = current.rows.filter(function (r) {
      return r.data && r.data[caseCol.key] && String(r.data[caseCol.key]).trim();
    });
    if (!rowsWithCase.length) return;

    var runToken = {};
    _autofillAbort = runToken;
    clearTimeout(_autofillTimer);

    _autofillTimer = setTimeout(function () {
      if (_autofillAbort !== runToken) return;

      // Phase 1: mark uncached cells as pending
      rowsWithCase.forEach(function (row) {
        linkedCols.forEach(function (col) {
          var inp = gridEl.querySelector('input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]');
          if (!inp || inp.classList.contains('cell-qb-linked')) return;
          var caseNum = String(row.data[caseCol.key] || '').trim();
          var cached  = _recordCache[caseNum];
          if (cached && (Date.now() - cached.at) < _RECORD_TTL) return;
          inp.classList.add('cell-qb-pending');
          inp.readOnly    = true;
          inp.placeholder = '⋯';
        });
      });

      // Phase 2: split rows into visible / offscreen
      var gridWrap    = document.getElementById('svcGridWrap') || gridEl.parentElement;
      var wrapRect    = gridWrap ? gridWrap.getBoundingClientRect() : null;
      var visibleRows = [];
      var deferredRows = [];

      rowsWithCase.forEach(function (row) {
        var anyInp = gridEl.querySelector('input.cell[data-row="' + row.row_index + '"]');
        if (anyInp && wrapRect) {
          var r = anyInp.getBoundingClientRect();
          if (r.bottom >= wrapRect.top && r.top <= wrapRect.bottom) visibleRows.push(row);
          else deferredRows.push(row);
        } else {
          visibleRows.push(row);
        }
      });

      // Paint helper
      function paintRow(row) {
        if (_autofillAbort !== runToken) return;
        var caseNum = String(row.data[caseCol.key] || '').trim();
        if (!caseNum) return;

        var rec = _recordCache[caseNum];
        linkedCols.forEach(function (col) {
          var inp = gridEl.querySelector('input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]');
          if (!inp || inp === document.activeElement) return;

          if (!rec) {
            if (_notFound[caseNum] && (Date.now() - _notFound[caseNum]) < _NOT_FOUND_TTL) {
              inp.value       = '—';
              inp.readOnly    = true;
              inp.title       = '⚠ Not found in QB (Case #' + caseNum + ')';
              inp.classList.add('cell-qb-not-found');
              inp.classList.remove('cell-qb-pending', 'cell-qb-linked');
            } else {
              inp.classList.remove('cell-qb-pending');
              inp.readOnly    = false;
              inp.placeholder = '';
            }
            return;
          }

          var fid       = String(col.qbLookup.fieldId);
          var fieldCell = rec.fields[fid];
          var value     = fieldCell ? String(fieldCell.value != null ? fieldCell.value : '') : '';

          inp.value    = value;
          inp.readOnly = true;
          inp.title    = '🔗 QB: ' + col.qbLookup.fieldLabel + ' (Case #' + caseNum + ')';
          inp.classList.add('cell-qb-linked');
          inp.classList.remove('cell-qb-pending', 'cell-qb-not-found');
        });
      }

      // Phase 3: fetch visible first, defer offscreen
      var visibleIds  = visibleRows.map(function (r) { return String(r.data[caseCol.key] || '').trim(); });
      var deferredIds = deferredRows.map(function (r) { return String(r.data[caseCol.key] || '').trim(); });

      fetchManyRecords(visibleIds, function () {
        if (_autofillAbort !== runToken) return;
        visibleRows.forEach(paintRow);
      }).then(function () {
        if (_autofillAbort !== runToken) return;
        visibleRows.forEach(paintRow);

        if (!deferredRows.length) return;
        setTimeout(function () {
          if (_autofillAbort !== runToken) return;
          fetchManyRecords(deferredIds, function () {
            if (_autofillAbort !== runToken) return;
            deferredRows.forEach(paintRow);
          }).then(function () {
            if (_autofillAbort !== runToken) return;
            deferredRows.forEach(paintRow);
          });
        }, 400);
      });

    }, 120);
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────────
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function closeFieldPicker() {
    var ov = document.getElementById('svcQbFieldOverlay');
    if (ov) {
      ov.classList.add('qb-fp-leaving');
      setTimeout(function () { if (ov.parentNode) ov.remove(); }, 180);
    }
  }

  // ── Field Picker Modal ────────────────────────────────────────────────────────
  function openFieldPicker(opts) {
    closeFieldPicker();

    var col            = opts.cols && opts.cols[opts.colIdx];
    var colLabel       = col ? col.label : 'Column';
    var currentFieldId = col && col.qbLookup ? String(col.qbLookup.fieldId) : null;
    var currentLabel   = col && col.qbLookup ? col.qbLookup.fieldLabel : null;

    var overlay = el('div', 'qb-fp-overlay');
    overlay.id  = 'svcQbFieldOverlay';

    var panel = el('div', 'qb-fp-panel');
    overlay.appendChild(panel);

    var hdr    = el('div', 'qb-fp-header');
    var htitle = el('div', 'qb-fp-title');
    htitle.textContent = '🔗 Link QB Field → ' + colLabel;
    var hclose = el('button', 'qb-fp-close');
    hclose.textContent = '✕';
    hclose.onclick = closeFieldPicker;
    hdr.appendChild(htitle);
    hdr.appendChild(hclose);
    panel.appendChild(hdr);

    if (currentLabel) {
      var cur = el('div', 'qb-fp-current');
      cur.innerHTML = '✅ Currently linked: <strong>' + currentLabel + '</strong> (field ' + currentFieldId + ')';
      panel.appendChild(cur);
    }

    if (col && col.qbLookup) {
      var removeBtn = el('button', 'qb-fp-remove-btn');
      removeBtn.textContent = '🔗✕ Remove QB link';
      removeBtn.onclick = function () {
        opts.onSelect(null);
        closeFieldPicker();
      };
      panel.appendChild(removeBtn);
    }

    var searchWrap = el('div', 'qb-fp-search-wrap');
    var searchInp  = el('input', 'qb-fp-search');
    searchInp.type        = 'text';
    searchInp.placeholder = 'Search fields…';
    searchWrap.appendChild(searchInp);
    panel.appendChild(searchWrap);

    var listEl = el('div', 'qb-fp-list');
    panel.appendChild(listEl);

    var statusEl = el('div', 'qb-fp-status');
    statusEl.textContent = 'Loading QB fields…';
    panel.appendChild(statusEl);

    document.body.appendChild(overlay);
    searchInp.focus();

    requestAnimationFrame(function () { overlay.classList.add('qb-fp-open'); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFieldPicker(); });

    loadFields(false).then(function (fields) {
      statusEl.textContent = '';
      if (!fields || !fields.length) {
        statusEl.textContent = '⚠ No QB fields found. Check Studio QB settings.';
        return;
      }

      function renderList(filter) {
        listEl.innerHTML = '';
        var filtered = filter
          ? fields.filter(function (f) { return String(f.label || f.id || '').toLowerCase().includes(filter.toLowerCase()); })
          : fields;

        if (!filtered.length) {
          var empty = el('div', 'qb-fp-empty');
          empty.textContent = 'No fields match "' + filter + '"';
          listEl.appendChild(empty);
          return;
        }

        filtered.forEach(function (f) {
          var fid      = String(f.id);
          var isActive = fid === currentFieldId;
          var item     = el('div', 'qb-fp-item' + (isActive ? ' qb-fp-item-active' : ''));
          var iLabel   = el('span', 'qb-fp-item-label');
          iLabel.textContent = f.label || '(unnamed)';
          var iId = el('span', 'qb-fp-item-id');
          iId.textContent = 'Field ' + fid;
          item.appendChild(iLabel);
          item.appendChild(iId);
          if (isActive) {
            var tick = el('span', 'qb-fp-item-tick');
            tick.textContent = '✓';
            item.appendChild(tick);
          }
          item.onclick = function () {
            opts.onSelect({ fieldId: fid, fieldLabel: f.label || fid });
            closeFieldPicker();
          };
          listEl.appendChild(item);
        });
      }

      renderList('');
      searchInp.addEventListener('input', function () { renderList(searchInp.value.trim()); });

    }).catch(function (err) {
      statusEl.textContent = '⚠ Failed to load fields: ' + (err && err.message ? err.message : String(err));
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.svcQbLookup = {
    openFieldPicker: openFieldPicker,
    autofillLinkedColumns: autofillLinkedColumns,
    clearCache: function () {
      _recordCache   = {};
      _notFound      = {};
      _fieldsCache   = null;
      _batchInFlight = {};
    }
  };

})();
