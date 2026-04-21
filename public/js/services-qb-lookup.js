(function () {
  'use strict';
  /**
   * services-qb-lookup.js  v4.3  — BATCH + SAFE FALLBACK  (MACE CLEARED)
   * ─────────────────────────────────────────────────────────────────────────
   * Free-Tier Safe Strategy:
   *
   *   BATCH FIRST — /api/studio/qb_data?recordIds=<id1>,<id2>,...
   *     Groups up to 50 case numbers per HTTP call.
   *     1 batch = up to 50 row lookups. 98% fewer requests vs v3.0.
   *
   *   SMART FALLBACK — /api/studio/qb_search?q=<caseNum>&top=5
   *     Only fires when:
   *       a) batch returns transientError (QB API hiccup)
   *       b) batch returns warning (QB not configured for this user)
   *       c) individual lookupCase() for a single row
   *     Falls back to the proven v3.0 path — no regressions.
   *
   *   SAFE NOT-FOUND CACHE — Only poisons _notFound[nk] when QB API
   *     confirmed "this record does not exist". Transient failures
   *     (network, QB API error, unconfigured) do NOT poison the cache,
   *     so the next scroll/render retries correctly.
   *
   *   IN-FLIGHT DEDUP — Promise map prevents duplicate concurrent fetches
   *     for the same case number across scroll/render cycles.
   *
   *   RATE GATE — 200ms min gap between consecutive API calls.
   *
   * Free-Tier Impact (30 users/day × 520 rows):
   *   v3.0: 520 qb_search calls per load  = ~15,600 CF hits/day
   *   v4.1: ~11 batch calls per load       = ~330   CF hits/day
   *   Reduction: 98% (with safe fallback for error cases)
   *
   * Public API surface (UNCHANGED — required by services-grid.js):
   *   window.svcQbLookup.openFieldPicker(opts)
   *   window.svcQbLookup.autofillLinkedColumns(current, gridEl)
   *   window.svcQbLookup.clearCache()
   */

  // ── Auth ──────────────────────────────────────────────────────────────────────
  function getJwt() {
    var LS = 'mums_supabase_session';
    var sources = [
      function () { try { return localStorage.getItem(LS); } catch(_) { return null; } },
      function () { try { return sessionStorage.getItem(LS); } catch(_) { return null; } },
      function () {
        try {
          var m = document.cookie.match('(?:^|;)\\s*' + LS + '=([^;]*)');
          return m ? decodeURIComponent(m[1]) : null;
        } catch(_) { return null; }
      }
    ];
    for (var i = 0; i < sources.length; i++) {
      try {
        var raw = sources[i]();
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.access_token) return p.access_token;
        }
      } catch (_) {}
    }
    return '';
  }

  function apiHeaders() {
    var jwt = getJwt();
    return jwt ? { Authorization: 'Bearer ' + jwt } : {};
  }

  function apiHeadersAsync() {
    var direct = apiHeaders();
    if (direct.Authorization) return Promise.resolve(direct);

    var sb = (window.servicesDB && window.servicesDB.client) || window.__MUMS_SB_CLIENT;
    if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') {
      return Promise.resolve({});
    }

    return sb.auth.getSession()
      .then(function (out) {
        var token = out && out.data && out.data.session && out.data.session.access_token;
        return token ? { Authorization: 'Bearer ' + token } : {};
      })
      .catch(function () { return {}; });
  }

  // ── Case key normalization ─────────────────────────────────────────────────────
  // "436,860.0", "Case# 436860", "436860" → "436860"
  function normalizeCaseKey(v) {
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    var noPrefix = raw.replace(/^\s*case(?:\s*(?:#|no\.?|number|id))?\s*[:\-]?\s*/i, '').trim();
    var compact  = noPrefix.replace(/,/g, '');
    if (/^\d+(?:\.0+)?$/.test(compact)) return String(Number(compact));
    var tok = compact.match(/\b(\d{3,})(?:\.0+)?\b/);
    if (tok && tok[1]) return String(Number(tok[1]));
    return compact;
  }

  // ── Resolve Case Column ────────────────────────────────────────────────────────
  function resolveCaseColumn(cols) {
    var list = Array.isArray(cols) ? cols : [];
    if (!list.length) return null;
    function norm(v) { return String(v || '').trim().toLowerCase(); }
    var EXACT = ['case#', 'case #', 'case number', 'case no', 'case id', 'case'];
    var byExact = list.find(function (c) { return EXACT.indexOf(norm(c.label)) !== -1; });
    if (byExact) return byExact;
    var byFuzzy = list.find(function (c) { return norm(c.label).indexOf('case') !== -1; });
    if (byFuzzy) return byFuzzy;
    return list[0] || null;
  }

  // ── Caches ─────────────────────────────────────────────────────────────────────
  var _cache         = {};   // nk → { fields, columnMap, at }
  var _notFound      = {};   // nk → timestamp  (only genuine misses)
  var _inFlight      = {};   // nk → Promise     (dedup concurrent fetches)
  var _reportIdx     = null; // { byNk, at } one-shot fallback index from qb_data report mode
  var _rowCaseSeen   = {};   // row_index -> normalized case key last painted
  var _qbSchemaCache = null; // schema cache buster hook for dynamic linked columns
  var _CACHE_TTL     = 5 * 60 * 1000;
  var _NOT_FOUND_TTL = 30 * 1000;
  var _REPORT_TTL    = 2 * 60 * 1000;
  var _BATCH_SIZE    = 50;

  // ── Rate limiter ──────────────────────────────────────────────────────────────
  var _lastApiAt    = 0;
  var _MIN_API_GAP  = 200; // ms between any consecutive API calls
  var _urgentMode   = false; // true during refreshAllLinkedColumns (Update button)

  function _waitForGap() {
    var now     = Date.now();
    var elapsed = now - _lastApiAt;
    var gap     = _urgentMode ? 50 : _MIN_API_GAP;
    var wait    = elapsed < gap ? gap - elapsed : 0;
    _lastApiAt  = now + wait;
    return wait > 0
      ? new Promise(function (res) { setTimeout(res, wait); })
      : Promise.resolve();
  }

  // ── _batchFetch ───────────────────────────────────────────────────────────────
  // Returns { found: { nk: rec, ... }, notFound: { nk:true }, transient: bool }
  //   found.transient = true  → QB API error / QB not configured / network fail
  //                             → DO NOT write _notFound (will retry on next scroll)
  //   found.transient = false → QB responded; any missing IDs are genuine not-found
  function _batchFetch(nks) {
    if (!nks || !nks.length) return Promise.resolve({ found: {}, notFound: {}, transient: false });
    var ids = nks.slice(0, _BATCH_SIZE);

    return apiHeadersAsync()
      .then(function (headers) {
        return _waitForGap().then(function () {
          return fetch(
            '/api/studio/qb_data?recordIds=' + ids.map(encodeURIComponent).join(',') + (_urgentMode ? '&bust=1' : ''),
            { headers: headers }
          );
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // QB not configured for this user — transient (not a real miss)
        if (data.warning === 'studio_qb_not_configured') {
          return { found: {}, notFound: {}, transient: true };
        }

        // Server-side QB API error — transient
        if (data.transientError) {
          return { found: {}, notFound: {}, transient: true };
        }

        // Non-ok (auth, settings read fail, etc.) — transient
        if (!data.ok) {
          return { found: {}, notFound: {}, transient: true };
        }

        // ok:true but records is an Array (misconfigured path) — transient
        var recs = data.records;
        if (!recs || Array.isArray(recs)) {
          return { found: {}, notFound: {}, transient: true };
        }

        // Valid batch response — parse results
        var found    = {};
        var normIdx  = {};
        var notFound = {};
        Object.keys(recs).forEach(function (rawKey) {
          var nk  = normalizeCaseKey(rawKey);
          var rec = recs[rawKey];
          if (nk && rec && rec.fields) {
            normIdx[nk] = { fields: rec.fields, columnMap: rec.columnMap || {} };
          }
        });
        ids.forEach(function (id) {
          if (normIdx[id]) found[id] = normIdx[id];
        });

        var nf = Array.isArray(data.notFound) ? data.notFound : [];
        nf.forEach(function (rawId) {
          var nk = normalizeCaseKey(rawId);
          if (nk) notFound[nk] = true;
        });

        // Guard: if backend returned an ambiguous empty payload
        // (no found and no explicit notFound), treat as transient so
        // pipeline can recover using qb_search fallback.
        if (!Object.keys(found).length && !Object.keys(notFound).length && ids.length) {
          return { found: {}, notFound: {}, transient: true };
        }

        return { found: found, notFound: notFound, transient: false };
      })
      .catch(function () {
        // Network failure or parse error — transient, never poison cache
        return { found: {}, notFound: {}, transient: true };
      });
  }

  // ── _searchFallback ───────────────────────────────────────────────────────────
  // Proven v3.0 path: qb_search per case number.
  // Used when batch returns transient=true for a group of keys.
  // Concurrency limited to 2 to protect free tier.
  function _searchFallback(nks) {
    if (!nks || !nks.length) return Promise.resolve();

    var running = 0;
    var idx     = 0;

    function fetchOne(nk) {
      return apiHeadersAsync()
        .then(function (headers) {
          return _waitForGap().then(function () {
            return fetch(
              '/api/studio/qb_search?q=' + encodeURIComponent(nk) + '&top=5',
              { headers: headers }
            );
          });
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok || !Array.isArray(data.records) || !data.records.length) {
            // Not found or QB issue — do NOT write _notFound (could be transient)
            return;
          }
          // Find exact record
          var match = null;
          var i;
          for (i = 0; i < data.records.length; i++) {
            if (normalizeCaseKey(data.records[i].qbRecordId) === nk) {
              match = data.records[i]; break;
            }
          }
          if (!match) {
            for (i = 0; i < data.records.length; i++) {
              var flds = data.records[i].fields || {};
              var hit = Object.keys(flds).some(function (fid) {
                return normalizeCaseKey(String(
                  flds[fid] && flds[fid].value != null ? flds[fid].value : ''
                )) === nk;
              });
              if (hit) { match = data.records[i]; break; }
            }
          }
          if (!match) return; // Not found — don't mark, may retry

          var cm = Object.assign({}, data.columnMap || {}, match.columnMap || {});
          _cache[nk] = { fields: match.fields || {}, columnMap: cm, at: Date.now() };
          delete _notFound[nk];
        })
        .catch(function () { /* network error — silent, will retry */ });
    }

    return new Promise(function (resolve) {
      function next() {
        while (running < 2 && idx < nks.length) {
          /* eslint-disable no-loop-func */
          (function (nk) {
            running++;
            var done = function () {
              running--;
              delete _inFlight[nk];
              if (idx >= nks.length && running === 0) resolve();
              else next();
            };
            try { fetchOne(nk).then(done, done); } catch (_) { done(); }
          })(nks[idx++]);
          /* eslint-enable no-loop-func */
        }
        if (idx >= nks.length && running === 0) resolve();
      }
      next();
    });
  }

  // ── _reportFallback ───────────────────────────────────────────────────────────
  // Safety net when batch path reports "not found" for an entire chunk.
  // Pulls one report snapshot (max 1000 rows on backend) and builds a local index.
  // This avoids per-row overload while recovering from batch case-field mismatch.
  function _reportFallback(nks) {
    if (!nks || !nks.length) return Promise.resolve();
    var now = Date.now();
    if (_reportIdx && (now - _reportIdx.at) < _REPORT_TTL) {
      nks.forEach(function (nk) {
        if (_reportIdx.byNk[nk]) _cache[nk] = Object.assign({ at: now }, _reportIdx.byNk[nk]);
      });
      return Promise.resolve();
    }

    return apiHeadersAsync()
      .then(function (headers) {
        return _waitForGap().then(function () {
          return fetch('/api/studio/qb_data', { headers: headers });
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.records) || !data.records.length) return;

        var byNk = {};
        var columns = Array.isArray(data.columns) ? data.columns : [];
        var colMap = {};
        columns.forEach(function (c) {
          var id = String(c && c.id != null ? c.id : '').trim();
          if (!id) return;
          colMap[id] = String(c && c.label != null ? c.label : '').trim();
        });

        data.records.forEach(function (row) {
          if (!row || typeof row !== 'object') return;
          var rec = { fields: row, columnMap: colMap };
          var keys = new Set();
          Object.keys(row).forEach(function (fid) {
            var cell = row[fid];
            var val = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
            var nk = normalizeCaseKey(val);
            var label = String(colMap[fid] || '').toLowerCase();
            if (!nk) return;
            if (label.indexOf('case') !== -1) keys.add(nk);
          });
          // fallback if no labeled-case field found in this row
          if (!keys.size) {
            Object.keys(row).forEach(function (fid) {
              var cell = row[fid];
              var val = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
              var nk = normalizeCaseKey(val);
              if (nk) keys.add(nk);
            });
          }
          keys.forEach(function (nk) {
            if (!byNk[nk]) byNk[nk] = rec;
          });
        });

        _reportIdx = { byNk: byNk, at: Date.now() };
        nks.forEach(function (nk) {
          if (byNk[nk]) _cache[nk] = Object.assign({ at: Date.now() }, byNk[nk]);
        });
      })
      .catch(function () { /* silent: keeps original flow */ });
  }

  // ── _bulkFetchAll ─────────────────────────────────────────────────────────────
  // Issue 4 FIX: Single-call bulk fetch via /api/studio/qb_bulk.
  // Fetches the ENTIRE QB report in ONE HTTP request (up to 1000 records).
  // ~10x faster than the batch pipeline for 500+ row sheets:
  //   Before: 11 batches × 50 records × 50ms gap = 2-4s
  //   After:  1 call → 1-2s (matches Google Sheets Apps Script speed)
  //
  // Returns: { ok: bool, caseMap: { nk: { fields, columnMap } }, total: int }
  function _bulkFetchAll(allNks, linkedCols) {
    var fieldIds = [3]; // Case#
    linkedCols.forEach(function (col) {
      var fid = parseInt(col.qbLookup.fieldId);
      if (fid && fieldIds.indexOf(fid) === -1) fieldIds.push(fid);
    });

    console.log('[QB Bulk] fieldIds:', fieldIds);

    return fetch('/api/quickbase/bulk-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cases: allNks, fieldIds: fieldIds })
    })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json.ok) return { ok: false, reason: json.error };
        Object.keys(json.data || {}).forEach(function (caseNum) {
          _cache[caseNum] = json.data[caseNum];
        });
        return { ok: true };
      }).catch(function (e) {
        return { ok: false, reason: e.message };
      });
  }


  // ── _processBatchPipeline ──────────────────────────────────────────────────────
  // Main pipeline: batch-fetch all nks in chunks of _BATCH_SIZE.
  // On transient failure: falls back to qb_search for that chunk.
  // Only marks _notFound when QB confirmed the record doesn't exist.
  // ── _processOneChunk ──────────────────────────────────────────────────────────
  // Handles a single batch chunk: fetch → reconcile → cache-write.
  function _processOneChunk(chunk) {
    return _batchFetch(chunk).then(function (result) {
      var now = Date.now();

      if (result.transient) {
        // CRITICAL: In urgent mode (Update button) use _reportFallback (1 QB bulk call).
        // _searchFallback fires 50 individual qb_search calls per chunk — at 520 rows
        // that takes 13-15 minutes. _reportFallback fetches all records in 1 call.
        // In normal scroll mode, _searchFallback is fine for small chunks.
        return _urgentMode ? _reportFallback(chunk) : _searchFallback(chunk);
      }

      var unresolved = chunk.filter(function (nk) {
        return !(result.found && result.found[nk]);
      });
      var reconcile = Promise.resolve();
      if (unresolved.length) {
        reconcile = _reportFallback(unresolved).then(function () {
          var probeNow = Date.now();
          unresolved.forEach(function (nk) {
            if (_cache[nk] && (probeNow - _cache[nk].at) < _CACHE_TTL) {
              delete result.notFound[nk];
            }
          });
          var stillMissing = unresolved.filter(function (nk) {
            return !(_cache[nk] && (probeNow - _cache[nk].at) < _CACHE_TTL);
          });
          if (!stillMissing.length) return;
          // In urgent mode (Update button), skip per-record search — _reportFallback
          // already ran above and would have found them. Avoid 50+ extra QB calls.
          if (_urgentMode) return;
          return _searchFallback(stillMissing).then(function () {
            var afterSearch = Date.now();
            stillMissing.forEach(function (nk) {
              if (_cache[nk] && (afterSearch - _cache[nk].at) < _CACHE_TTL) {
                delete result.notFound[nk];
              }
            });
          });
        });
      }

      return reconcile.then(function () {
        chunk.forEach(function (nk) {
          var rec = result.found[nk] || _cache[nk];
          if (rec) {
            _cache[nk]    = Object.assign({ at: now }, rec);
            delete _notFound[nk];
          } else if (result.notFound && result.notFound[nk]) {
            _notFound[nk] = now;
          } else {
            delete _notFound[nk];
          }
          delete _inFlight[nk];
        });
      });
    });
  }

  // ── _processBatchPipeline ──────────────────────────────────────────────────────
  // Parallel pipeline: runs up to 3 chunks concurrently for 1-2 second load.
  // Falls back to sequential on transient errors (qb_search path).
  // Replaced sequential reduce() — no regressions to cache/notFound logic.
  function _processBatchPipeline(nks) {
    if (!nks || !nks.length) return Promise.resolve();

    var chunks = [];
    for (var i = 0; i < nks.length; i += _BATCH_SIZE) {
      chunks.push(nks.slice(i, i + _BATCH_SIZE));
    }

    // Parallel with max 3 concurrent batches (free-tier safe: still only ~11 total)
    var MAX_CONCURRENT = 3;
    var idx = 0;
    var running = 0;

    return new Promise(function (resolve) {
      function next() {
        while (running < MAX_CONCURRENT && idx < chunks.length) {
          /* eslint-disable no-loop-func */
          (function (chunk) {
            running++;
            _processOneChunk(chunk).then(function () {
              running--;
              if (idx < chunks.length) next();
              else if (running === 0) resolve();
            }, function () {
              running--;
              if (idx < chunks.length) next();
              else if (running === 0) resolve();
            });
          })(chunks[idx++]);
          /* eslint-enable no-loop-func */
        }
        if (idx >= chunks.length && running === 0) resolve();
      }
      next();
    });
  }

  // ── lookupCase ─────────────────────────────────────────────────────────────────
  // Public helper: Returns Promise<record | null>.
  function lookupCase(caseNum) {
    var nk = normalizeCaseKey(caseNum);
    if (!nk) return Promise.resolve(null);

    if (_cache[nk] && (Date.now() - _cache[nk].at) < _CACHE_TTL) {
      return Promise.resolve(_cache[nk]);
    }
    if (_notFound[nk] && (Date.now() - _notFound[nk]) < _NOT_FOUND_TTL) {
      return Promise.resolve(null);
    }
    if (_inFlight[nk]) {
      return _inFlight[nk].then(function () { return _cache[nk] || null; });
    }

    // Single-key batch with search fallback
    var p = _batchFetch([nk]).then(function (result) {
      delete _inFlight[nk];
      if (result.transient) {
        // Batch failed — try qb_search fallback directly
        return _searchFallback([nk]).then(function () { return _cache[nk] || null; });
      }
      var rec = result.found[nk];
      if (rec) {
        _cache[nk] = Object.assign({ at: Date.now() }, rec);
        delete _notFound[nk];
        return _cache[nk];
      }
      _notFound[nk] = Date.now();
      return null;
    }).catch(function () {
      delete _inFlight[nk];
      return null;
    });

    _inFlight[nk] = p;
    return p;
  }

  // ── Extract value from cached record ─────────────────────────────────────────
  function getFieldValue(rec, fieldId, fieldLabel) {
    if (!rec) return null;
    var flds   = rec.fields    || {};
    var colMap = rec.columnMap || {};

    if (fieldId) {
      var fid = String(fieldId).trim();
      if (flds[fid] != null) {
        var cell = flds[fid];
        var raw  = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
        return raw != null ? String(raw) : '';
      }
    }

    if (fieldLabel) {
      var target = String(fieldLabel).trim().toLowerCase();
      var mFid   = null;
      Object.keys(colMap).some(function (f) {
        if (String(colMap[f] || '').trim().toLowerCase() === target) {
          mFid = f; return true;
        }
        return false;
      });
      if (mFid && flds[mFid] != null) {
        var cell2 = flds[mFid];
        var raw2  = (cell2 && typeof cell2 === 'object' && 'value' in cell2) ? cell2.value : cell2;
        return raw2 != null ? String(raw2) : '';
      }
    }
    return null;
  }

  // ── QB Field list for picker (5-min cache) ────────────────────────────────────
  var _fieldsCache = null;
  var _FIELDS_TTL  = 5 * 60 * 1000;
  var _persistTimer = null;
  var _persistRows  = new Map(); // row_index -> { sheetId, rowIndex, data }

  function queuePersistRow(sheetId, row) {
    if (!sheetId || !row || typeof row.row_index !== 'number' || !row.data) return;
    _persistRows.set(String(sheetId) + ':' + String(row.row_index), {
      sheetId: String(sheetId),
      rowIndex: row.row_index,
      data: JSON.parse(JSON.stringify(row.data))
    });
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(function () {
      var jobs = Array.from(_persistRows.values());
      _persistRows.clear();
      if (!jobs.length || !window.servicesDB || !window.servicesDB.bulkUpsertRows) return;
      var grouped = {};
      jobs.forEach(function (j) {
        if (!grouped[j.sheetId]) grouped[j.sheetId] = [];
        grouped[j.sheetId].push({ row_index: j.rowIndex, data: j.data });
      });
      Object.keys(grouped).forEach(function (sid) {
        window.servicesDB.bulkUpsertRows(sid, grouped[sid]).catch(function () {});
      });
    }, 900);
  }

  function isBlankValue(v) {
    return v == null || String(v).trim() === '';
  }

  function loadFields(forceRefresh) {
    if (!forceRefresh && _fieldsCache && (Date.now() - _fieldsCache.at) < _FIELDS_TTL) {
      return Promise.resolve(_fieldsCache.fields);
    }
    var url = '/api/studio/qb_fields' + (forceRefresh ? '?forceRefresh=1' : '');
    return apiHeadersAsync()
      .then(function (headers) { return fetch(url, { headers: headers }); })
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

  // ── autofillLinkedColumns ─────────────────────────────────────────────────────
  var _autofillToken = null;
  var _autofillTimer = null;

  function autofillLinkedColumns(current, gridEl, opts) {
    if (!current || !gridEl) return;
    opts = opts || {};
    var force = !!opts.force;
    var allRowsMode = !!opts.allRows;
    if (opts.refreshCache) {
      _cache = {};
      _notFound = {};
      _inFlight = {};
      _reportIdx = null;
      _rowCaseSeen = {}; // Clear paint state so force re-fetches all rows
    }
    // Set urgent mode for the duration of this call (disables 200ms rate gap)
    _urgentMode = !!force;
    var cols = current.sheet.column_defs || [];

    var linkedCols = cols.filter(function (c) {
      return c.qbLookup && String(c.qbLookup.fieldId || '').trim();
    });
    if (!linkedCols.length) return;

    var caseCol = resolveCaseColumn(cols);
    if (!caseCol) return;

    var rowsWithCase = current.rows.filter(function (r) {
      return r.data && r.data[caseCol.key] && String(r.data[caseCol.key]).trim();
    });
    if (!rowsWithCase.length) return;

    function rowNeedsLookup(row, nk) {
      if (force) return true;
      if (!Object.prototype.hasOwnProperty.call(_rowCaseSeen, row.row_index)) {
        _rowCaseSeen[row.row_index] = nk; // bootstrap on first paint after reload
      }
      var caseChanged = _rowCaseSeen[row.row_index] !== nk;
      if (caseChanged) return true; // new/changed case number in this session
      return linkedCols.some(function (col) { return isBlankValue(row.data[col.key]); });
    }

    // Debounce
    var token = {};
    _autofillToken = token;
    clearTimeout(_autofillTimer);

    _autofillTimer = setTimeout(function () {
      _autofillTimer = null;
      if (_autofillToken !== token) return;

      var now = Date.now();

      // Phase 1: Spinner on uncached/unfetched cells
      rowsWithCase.forEach(function (row) {
        var nk = normalizeCaseKey(row.data[caseCol.key]);
        if (!nk) return;
        if (!rowNeedsLookup(row, nk)) return;
        var resolved = !force && ((_cache[nk]    && (now - _cache[nk].at)    < _CACHE_TTL)
                    || (_notFound[nk] && (now - _notFound[nk])    < _NOT_FOUND_TTL)
                    || !!_inFlight[nk]);
        if (resolved) return;
        linkedCols.forEach(function (col) {
          var inp = gridEl.querySelector(
            'input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]'
          );
          if (!inp || inp.classList.contains('cell-qb-linked')) return;
          inp.classList.add('cell-qb-pending');
          inp.readOnly    = true;
          inp.placeholder = '⋯';
        });
      });

      // Phase 2: Categorize unique uncached keys → visible vs deferred
      var gridWrap = document.getElementById('svcGridWrap') || gridEl.parentElement;
      var wrapRect = gridWrap ? gridWrap.getBoundingClientRect() : null;

      var visibleNks  = [];
      var deferredNks = [];
      var seenNks     = new Set();

      rowsWithCase.forEach(function (row) {
        var nk = normalizeCaseKey(row.data[caseCol.key]);
        if (!nk || seenNks.has(nk)) return;
        if (!rowNeedsLookup(row, nk)) return;
        seenNks.add(nk);

        if (!force) {
          if (_cache[nk]    && (Date.now() - _cache[nk].at)    < _CACHE_TTL) return;
          if (_notFound[nk] && (Date.now() - _notFound[nk])    < _NOT_FOUND_TTL) return;
          if (_inFlight[nk]) return;
        }

        var anyInp  = gridEl.querySelector('input.cell[data-row="' + row.row_index + '"]');
        var visible = true;
        if (anyInp && wrapRect) {
          var r = anyInp.getBoundingClientRect();
          visible = r.bottom >= wrapRect.top && r.top <= wrapRect.bottom;
        }
        (allRowsMode || visible ? visibleNks : deferredNks).push(nk);
      });

      // paintRow: reads _cache, updates DOM
      function paintRow(row) {
        if (_autofillToken !== token) return;
        var rawCase = String(row.data[caseCol.key] || '').trim();
        if (!rawCase) return;
        var nk  = normalizeCaseKey(rawCase);
        var rec = _cache[nk];

        linkedCols.forEach(function (col) {
          var inp = gridEl.querySelector(
            'input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]'
          );
          // inp === null when row is off-DOM (filtered out by TreeView, e.g. COMPLETED folder).
          // ALWAYS update row.data + persist first (fixes COMPLETED view missing data after Update).
          // Then update DOM only if inp exists and is not focused.

          var fid   = String(col.qbLookup.fieldId   || '').trim();
          var label = String(col.qbLookup.fieldLabel || '').trim();

          if (!rec) {
            // No QB record — only touch DOM, don't write blank over existing good data
            if (inp && inp !== document.activeElement) {
              if (_notFound[nk] && (Date.now() - _notFound[nk]) < _NOT_FOUND_TTL) {
                inp.value       = '—';
                inp.readOnly    = true;
                inp.title       = '⚠ Case #' + rawCase + ' not found in QB';
                inp.classList.add('cell-qb-not-found');
                inp.classList.remove('cell-qb-pending', 'cell-qb-linked');
              } else {
                inp.classList.remove('cell-qb-pending');
                inp.readOnly    = false;
                inp.placeholder = '';
              }
            }
            return;
          }

          var value = getFieldValue(rec, fid, label);
          var caseChanged = _rowCaseSeen[row.row_index] !== nk;
          var shouldWrite = force || caseChanged || isBlankValue(row.data[col.key]);

          if (value === null) {
            if (shouldWrite) {
              row.data[col.key] = '';
            }
            if (inp && inp !== document.activeElement) {
              inp.value       = shouldWrite ? '' : (row.data[col.key] != null ? String(row.data[col.key]) : '');
              inp.readOnly    = true;
              inp.title       = '⚠ Field "' + label + '" not available for Case #' + rawCase;
              inp.classList.add('cell-qb-linked');
              inp.classList.remove('cell-qb-pending', 'cell-qb-not-found');
            }
          } else {
            if (shouldWrite) {
              row.data[col.key] = value;
            }
            if (inp && inp !== document.activeElement) {
              var displayVal = shouldWrite ? value : (row.data[col.key] != null ? String(row.data[col.key]) : value);
              if (displayVal && typeof displayVal === 'object') {
                displayVal = displayVal.name || displayVal.email || '';
              }
              inp.value       = displayVal || '';
              inp.readOnly    = true;
              inp.title       = '🔗 QB: ' + label + ' (Case #' + rawCase + ')';
              inp.classList.add('cell-qb-linked');
              inp.classList.remove('cell-qb-pending', 'cell-qb-not-found');
            }
          }
        });
        _rowCaseSeen[row.row_index] = nk;
      }

      // Phase 3: Instant paint for already-cached rows (zero API calls)
      rowsWithCase.forEach(function (row) {
        var nk = normalizeCaseKey(row.data[caseCol.key]);
        if (_cache[nk] && (Date.now() - _cache[nk].at) < _CACHE_TTL) paintRow(row);
      });

      if (!visibleNks.length && !deferredNks.length) return;

      // Phase 4: Batch-fetch visible rows → paint
      var placeholder = Promise.resolve();
      visibleNks.forEach(function (nk) {
        if (!_inFlight[nk]) _inFlight[nk] = placeholder;
      });

      _processBatchPipeline(visibleNks).then(function () {
        if (_autofillToken !== token) return;
        rowsWithCase.forEach(function (row) {
          var nk = normalizeCaseKey(row.data[caseCol.key]);
          if (visibleNks.indexOf(nk) !== -1) paintRow(row);
        });

        if (!deferredNks.length || allRowsMode) return;

        // Phase 5: Deferred rows after 400ms
        setTimeout(function () {
          if (_autofillToken !== token) return;
          deferredNks.forEach(function (nk) {
            if (!_inFlight[nk]) _inFlight[nk] = placeholder;
          });
          _processBatchPipeline(deferredNks).then(function () {
            if (_autofillToken !== token) return;
            rowsWithCase.forEach(function (row) {
              var nk = normalizeCaseKey(row.data[caseCol.key]);
              if (deferredNks.indexOf(nk) !== -1) paintRow(row);
            });
          });
        }, 400);
      });

    }, 150);
  }

  // ── DOM helper ────────────────────────────────────────────────────────────────
  function mkEl(tag, cls) {
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

  // ── Field Picker UI ───────────────────────────────────────────────────────────
  function openFieldPicker(opts) {
    closeFieldPicker();

    var col        = opts.cols && opts.cols[opts.colIdx];
    var colLabel   = col ? col.label : 'Column';
    var curFieldId = (col && col.qbLookup) ? String(col.qbLookup.fieldId   || '') : null;
    var curLabel   = (col && col.qbLookup) ? String(col.qbLookup.fieldLabel || '') : null;

    var overlay = mkEl('div', 'qb-fp-overlay'); overlay.id = 'svcQbFieldOverlay';
    var panel   = mkEl('div', 'qb-fp-panel');   overlay.appendChild(panel);

    var hdr    = mkEl('div', 'qb-fp-header');
    var htitle = mkEl('div', 'qb-fp-title');
    htitle.textContent = '🔗 Link QB Field → ' + colLabel;
    var hclose = mkEl('button', 'qb-fp-close');
    hclose.textContent = '✕';
    hclose.onclick = closeFieldPicker;
    hdr.appendChild(htitle); hdr.appendChild(hclose); panel.appendChild(hdr);

    if (curLabel) {
      var cur = mkEl('div', 'qb-fp-current');
      cur.innerHTML = '✅ Currently linked: <strong>' + curLabel + '</strong>';
      panel.appendChild(cur);
    }

    if (col && col.qbLookup) {
      var removeBtn = mkEl('button', 'qb-fp-remove-btn');
      removeBtn.textContent = '🔗✕ Remove QB link';
      removeBtn.onclick = function () { opts.onSelect(null); closeFieldPicker(); };
      panel.appendChild(removeBtn);
    }

    var searchWrap = mkEl('div', 'qb-fp-search-wrap');
    var searchInp  = mkEl('input', 'qb-fp-search');
    searchInp.type        = 'text';
    searchInp.placeholder = 'Search fields…';
    searchWrap.appendChild(searchInp);
    panel.appendChild(searchWrap);

    var listEl   = mkEl('div', 'qb-fp-list');   panel.appendChild(listEl);
    var statusEl = mkEl('div', 'qb-fp-status');
    statusEl.textContent = 'Loading QB fields…';
    panel.appendChild(statusEl);

    document.body.appendChild(overlay);
    searchInp.focus();
    requestAnimationFrame(function () { overlay.classList.add('qb-fp-open'); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeFieldPicker();
    });

    loadFields(false)
      .then(function (fields) {
        statusEl.textContent = '';
        if (!fields || !fields.length) {
          statusEl.textContent = '⚠ No QB fields found. Check Studio QB settings.';
          return;
        }

        function renderList(filter) {
          listEl.innerHTML = '';
          var lf = filter ? filter.toLowerCase() : '';
          var filtered = lf
            ? fields.filter(function (fd) {
                return String(fd.label || fd.id || '').toLowerCase().indexOf(lf) !== -1;
              })
            : fields;

          if (!filtered.length) {
            var empty = mkEl('div', 'qb-fp-empty');
            empty.textContent = 'No fields match "' + filter + '"';
            listEl.appendChild(empty);
            return;
          }

          filtered.forEach(function (fd) {
            var fid      = String(fd.id);
            var isActive = fid === curFieldId;
            var item     = mkEl('div', 'qb-fp-item' + (isActive ? ' qb-fp-item-active' : ''));
            var iLabel   = mkEl('span', 'qb-fp-item-label');
            iLabel.textContent = fd.label || '(unnamed)';
            var iId = mkEl('span', 'qb-fp-item-id');
            iId.textContent = 'Field ' + fid;
            item.appendChild(iLabel); item.appendChild(iId);
            if (isActive) {
              var tick = mkEl('span', 'qb-fp-item-tick');
              tick.textContent = '✓';
              item.appendChild(tick);
            }
            item.onclick = function () {
              opts.onSelect({ fieldId: fid, fieldLabel: fd.label || fid });
              closeFieldPicker();
            };
            listEl.appendChild(item);
          });
        }

        renderList('');
        searchInp.addEventListener('input', function () {
          renderList(searchInp.value.trim());
        });
      })
      .catch(function (err) {
        statusEl.textContent = '⚠ Failed to load fields: ' +
          (err && err.message ? err.message : String(err));
      });
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.svcQbLookup = {
    openFieldPicker:       openFieldPicker,
    autofillLinkedColumns: autofillLinkedColumns,
    // fetchCaseRecord: Direct MODE A single-record fetch for Case Detail modal.
    // Independent of the batch pipeline — never blocked by in-flight 520-row Update.
    // Cache-first: if record already in _cache, returns instantly.
    fetchCaseRecord: function (caseNum) {
      var nk = normalizeCaseKey(caseNum);
      if (!nk) return Promise.resolve(null);
      // Cache hit
      if (_cache[nk] && (Date.now() - _cache[nk].at) < _CACHE_TTL) {
        return Promise.resolve(_cache[nk]);
      }
      // Direct single-record fetch (MODE A: ?recordId=X)
      return apiHeadersAsync()
        .then(function (headers) {
          return _waitForGap().then(function () {
            return fetch(
              '/api/studio/qb_data?recordId=' + encodeURIComponent(nk),
              { headers: headers }
            );
          });
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.ok || !data.fields) return null;
          var rec = { fields: data.fields, columnMap: data.columnMap || {}, at: Date.now() };
          _cache[nk] = rec;
          delete _notFound[nk];
          return rec;
        })
        .catch(function () { return null; });
    },
    refreshAllLinkedColumns: async function (current, gridEl) {
      if (!current ||!gridEl) return;

      const cols = current.sheet.column_defs || [];
      const linkedCols = cols.filter(c => c.qbLookup && c.qbLookup.fieldId);
      if (!linkedCols.length) return;

      // BUG2 ROOT FIX: Use resolveCaseColumn (label-based, same as autofill) instead of c.name
      const caseCol = resolveCaseColumn(cols);
      if (!caseCol) return;

      const rowsWithCase = current.rows.filter(r => r.data && r.data[caseCol.key] && String(r.data[caseCol.key]).trim() !== '');
      if (!rowsWithCase.length) return;

      // 1. Collect all unique cases
      const allCases = [...new Set(rowsWithCase.map(r => String(r.data[caseCol.key]).trim()).filter(Boolean))];
      console.log('[DEBUG-QB] Cases to lookup:', allCases.length, allCases.slice(0,5));

      // 2. Auto-detect ALL field IDs (including new DUE DATE)
      const fieldIds = [3]; // Case#
      linkedCols.forEach(col => {
        const fid = parseInt(col.qbLookup.fieldId);
        if (fid &&!fieldIds.includes(fid)) fieldIds.push(fid);
      });

      // 3. Show spinner
      rowsWithCase.forEach(row => {
        linkedCols.forEach(col => {
          const inp = gridEl.querySelector(`input.cell[data-row="${row.row_index}"][data-key="${col.key}"]`);
          if (inp) { inp.classList.add('cell-qb-pending'); inp.placeholder = '⋯'; }
        });
      });

      try {
        // 4. ONE Quickbase call for ALL fields
        const qbRes = await fetch('/api/quickbase/bulk-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cases: allCases, fieldIds })
        });
        const qbJson = await qbRes.json();

        if (!qbJson.ok) throw new Error(qbJson.error || 'QB fetch failed');

        const qbData = qbJson.data || {};
        console.log('[DEBUG-QB] QB returned:', Object.keys(qbData).length, 'records');
        // Log first 3 cases with DUE DATE field
        Object.entries(qbData).slice(0,3).forEach(([caseNum, data]) => {
          console.log(`[DEBUG-QB] Case ${caseNum}:`, data);
        });

        // 5. Update ALL rows in memory
        const updates = [];
        rowsWithCase.forEach(row => {
          const caseNum = String(row.data[caseCol.key]).trim();
          const qbRec = qbData[caseNum];
          if (!qbRec) return;

          let changed = false;
          linkedCols.forEach(col => {
            const fid = col.qbLookup.fieldId.toString();
            let val = qbRec[fid];
            if (col.key.includes('date') || col.key.includes('qa')) {
              console.log(`[DEBUG-QB] Processing ${caseNum} -> ${col.key}:`,
                'QB raw:', qbRec[fid],
                'Type:', typeof qbRec[fid],
                'Final val:', val);
            }

            // Fix [object Object] for user fields
            if (val && typeof val === 'object') {
              val = val.name || val.email || val.display || '';
            }

            if (row.data[col.key] !== val) {
              row.data[col.key] = val || '';
              changed = true;
              if (col.key.includes('date')) {
                console.log(`[DEBUG-QB] SAVING to row ${row.row_index}:`,
                  col.key, '=', JSON.stringify(val || ''));
              }
            }
          });

          if (changed) {
            updates.push({
              id: row.id,
              sheet_id: current.sheet.id,
              row_index: row.row_index,
              data: row.data,
              updated_at: new Date().toISOString()
            });
          }
        });

        // 6. ONE Supabase upsert (this is the fix for minutes → seconds)
        if (updates.length > 0) {
          console.log('[DEBUG-SAVE] About to upsert', updates.length, 'rows');
          updates.slice(0,3).forEach(u => {
            console.log('[DEBUG-SAVE] Row', u.row_index, 'data:', JSON.stringify(u.data));
          });
          const { error } = await window.supabase
           .from('services_rows')
           .upsert(updates, { onConflict: 'sheet_id,row_index' });

          if (error) {
            console.error('[DEBUG-SAVE] UPSERT FAILED:', error);
            throw error;
          } else {
            console.log('[DEBUG-SAVE] UPSERT SUCCESS');
          }
        }

        // 7. Paint UI once
        rowsWithCase.forEach(row => {
          linkedCols.forEach(col => {
            const inp = gridEl.querySelector(`input.cell[data-row="${row.row_index}"][data-key="${col.key}"]`);
            if (inp && inp !== document.activeElement) {
              // BUG2 FIX: date cols with no value = '---', others = '' 
              const val = row.data[col.key];
              const isDateCol = col.key.includes('date') || col.format === 'date';
              const hasVal = val && String(val).trim() !== '';
              if (isDateCol) {
                inp.value = hasVal ? val : '---';
                if (!hasVal) {
                  inp.style.color = '#64748b';
                  inp.style.textAlign = 'center';
                } else {
                  inp.style.removeProperty('color');
                  inp.style.removeProperty('text-align');
                }
              } else {
                inp.value = val || '';
              }
              inp.classList.remove('cell-qb-pending', 'cell-qb-linked'); // BUG1 FIX: no QB styling
            }
          });
        });

        console.log(`[QB] Bulk complete: ${allCases.length} cases, ${updates.length} updated in ${qbJson.duration_ms}ms`);

      } catch (err) {
        console.error('[QB] Bulk failed:', err);
        throw err;
      }
    },

    hydrateLinkedColumnsForExport: function (current, gridEl) {
      autofillLinkedColumns(current, gridEl, { force: false, allRows: true });
      return waitForLookupIdle(90000);
    },
    clearCache: function () {
      _cache       = {};
      _notFound    = {};
      _inFlight    = {};
      _fieldsCache = null;
      _reportIdx   = null;
      _rowCaseSeen = {};
    }
  };

  function waitForLookupIdle(timeoutMs) {
    timeoutMs = Number(timeoutMs || 90000);
    return new Promise(function (resolve) {
      var started = Date.now();
      var lastBusyAt = Date.now();
      (function probe() {
        var busy = !!_autofillTimer || Object.keys(_inFlight).length > 0;
        if (busy) lastBusyAt = Date.now();
        var idleFor = Date.now() - lastBusyAt;
        if (!busy && idleFor >= 250) { resolve(); return; }
        if ((Date.now() - started) > timeoutMs) { resolve(); return; }
        setTimeout(probe, 120);
      })();
    });
  }

})();
