(function () {
  'use strict';
  /**
   * services-qb-lookup.js  v3.0  — FULL REWRITE  (MACE CLEARED)
   * ─────────────────────────────────────────────────────────────────
   * Strategy:
   *   PRIMARY  — /api/studio/qb_search?q=<caseNum>&top=5
   *              Same Deep Search endpoint used by the working QB panel.
   *              Finds the exact record by case number.
   *
   *   FALLBACK — /api/studio/qb_data?recordId=<caseNum>
   *              Fires only when the user-selected field is not present
   *              in the Deep Search results (non-priority / rare field).
   *              Returns ALL QB fields for that record.
   *
   *   CACHE    — Per-case 5-min TTL so repeated renders never re-hit QB.
   *
   * Public API (unchanged surface — required by services-grid.js):
   *   window.svcQbLookup.openFieldPicker(opts)
   *   window.svcQbLookup.autofillLinkedColumns(current, gridEl)
   *   window.svcQbLookup.clearCache()
   */

  // ── Auth ──────────────────────────────────────────────────────────────────────
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

  // ── Case key normalization ─────────────────────────────────────────────────────
  // "436,860.0", "Case# 436860", "436860" → "436860"
  function normalizeCaseKey(v) {
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    var noPrefix = raw.replace(/^\s*case(?:\s*(?:#|no\.?|number|id))?\s*[:\-]?\s*/i, '').trim();
    var compact = noPrefix.replace(/,/g, '');
    if (/^\d+(?:\.0+)?$/.test(compact)) return String(Number(compact));
    var tok = compact.match(/\b(\d{3,})(?:\.0+)?\b/);
    if (tok && tok[1]) return String(Number(tok[1]));
    return compact;
  }

  // ── Resolve Case Column ────────────────────────────────────────────────────────
  // Basis per spec: case number is in Column 1 (index 0).
  // Priority order: exact label → 'case' fuzzy → first column.
  function resolveCaseColumn(cols) {
    var list = Array.isArray(cols) ? cols : [];
    if (!list.length) return null;
    function norm(v) { return String(v || '').trim().toLowerCase(); }
    var EXACT_LABELS = ['case#', 'case #', 'case number', 'case no', 'case id', 'case'];
    var byExact = list.find(function (c) { return EXACT_LABELS.indexOf(norm(c.label)) !== -1; });
    if (byExact) return byExact;
    var byFuzzy = list.find(function (c) { return norm(c.label).indexOf('case') !== -1; });
    if (byFuzzy) return byFuzzy;
    return list[0] || null; // Default: first column = Column 1
  }

  // ── Per-case record cache ─────────────────────────────────────────────────────
  // { fields: { "fid": { value: "..." } }, columnMap: { "fid": "Label" }, at: ts }
  var _cache        = {};
  var _notFound     = {};
  var _CACHE_TTL     = 5 * 60 * 1000;
  var _NOT_FOUND_TTL = 30 * 1000;

  // ── PRIMARY: Deep Search  ─────────────────────────────────────────────────────
  function _deepSearch(nk) {
    return fetch(
      '/api/studio/qb_search?q=' + encodeURIComponent(nk) + '&top=5',
      { headers: apiHeaders() }
    )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok || !Array.isArray(data.records) || !data.records.length) return null;

      // Find exact record: prefer qbRecordId match, then field value scan
      var match = null;
      var i;
      for (i = 0; i < data.records.length; i++) {
        if (normalizeCaseKey(data.records[i].qbRecordId) === nk) {
          match = data.records[i]; break;
        }
      }
      if (!match) {
        for (i = 0; i < data.records.length; i++) {
          var rec = data.records[i];
          var flds = rec.fields || {};
          var hit = Object.keys(flds).some(function (fid) {
            return normalizeCaseKey(String(
              flds[fid] && flds[fid].value != null ? flds[fid].value : ''
            )) === nk;
          });
          if (hit) { match = rec; break; }
        }
      }
      if (!match) return null;

      return {
        fields: match.fields || {},
        columnMap: Object.assign({}, data.columnMap || {}, match.columnMap || {})
      };
    })
    .catch(function () { return null; });
  }

  // ── FALLBACK: Full single-record fetch ────────────────────────────────────────
  // Returns ALL QB fields — used when needed field not in Deep Search result set.
  function _fullFetch(nk) {
    return fetch(
      '/api/studio/qb_data?recordId=' + encodeURIComponent(nk),
      { headers: apiHeaders() }
    )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok || !data.fields) return null;
      return { fields: data.fields || {}, columnMap: data.columnMap || {} };
    })
    .catch(function () { return null; });
  }

  // ── Check if record has the needed field ──────────────────────────────────────
  function _hasField(rec, fieldId, fieldLabel) {
    if (!rec) return false;
    var flds   = rec.fields    || {};
    var colMap = rec.columnMap || {};
    if (fieldId && flds[String(fieldId)] != null) return true;
    if (fieldLabel) {
      var target = String(fieldLabel).trim().toLowerCase();
      return Object.keys(colMap).some(function (fid) {
        return String(colMap[fid] || '').trim().toLowerCase() === target
            && flds[fid] != null;
      });
    }
    return false;
  }

  // ── Main lookup: Deep Search → fallback if field missing ─────────────────────
  function lookupCase(caseNum, neededFieldId, neededFieldLabel) {
    var nk = normalizeCaseKey(caseNum);
    if (!nk) return Promise.resolve(null);

    // Cache hit
    var cached = _cache[nk];
    if (cached && (Date.now() - cached.at) < _CACHE_TTL) {
      if (_hasField(cached, neededFieldId, neededFieldLabel)) {
        return Promise.resolve(cached);
      }
      // Partial hit: field missing — upgrade with full fetch
      return _fullFetch(nk).then(function (fr) {
        if (fr) {
          _cache[nk] = {
            fields:    Object.assign({}, cached.fields,    fr.fields),
            columnMap: Object.assign({}, cached.columnMap, fr.columnMap),
            at: Date.now()
          };
        }
        return _cache[nk] || null;
      });
    }

    // Known not-found (short TTL)
    if (_notFound[nk] && (Date.now() - _notFound[nk]) < _NOT_FOUND_TTL) {
      return Promise.resolve(null);
    }

    // Step 1: Deep Search (same endpoint as working QB panel)
    return _deepSearch(nk).then(function (ds) {
      if (!ds) {
        // Deep Search found nothing — try full fetch before marking not-found
        return _fullFetch(nk).then(function (fr) {
          if (!fr) { _notFound[nk] = Date.now(); return null; }
          _cache[nk] = Object.assign({ at: Date.now() }, fr);
          delete _notFound[nk];
          return _cache[nk];
        });
      }

      // Step 2: Field present in Deep Search result? → done
      if (_hasField(ds, neededFieldId, neededFieldLabel)) {
        _cache[nk] = Object.assign({ at: Date.now() }, ds);
        delete _notFound[nk];
        return _cache[nk];
      }

      // Step 3: Record found but field not in result — upgrade to full fetch
      return _fullFetch(nk).then(function (fr) {
        _cache[nk] = {
          fields:    Object.assign({}, ds.fields,    (fr || {}).fields    || {}),
          columnMap: Object.assign({}, ds.columnMap, (fr || {}).columnMap || {}),
          at: Date.now()
        };
        delete _notFound[nk];
        return _cache[nk];
      });
    });
  }

  // ── Extract value from cached record ─────────────────────────────────────────
  function getFieldValue(rec, fieldId, fieldLabel) {
    if (!rec) return null;
    var flds   = rec.fields    || {};
    var colMap = rec.columnMap || {};

    // Direct field ID
    if (fieldId) {
      var fid = String(fieldId).trim();
      if (flds[fid] != null) {
        var cell = flds[fid];
        var raw  = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
        return raw != null ? String(raw) : '';
      }
    }

    // Label scan via columnMap
    if (fieldLabel) {
      var target = String(fieldLabel).trim().toLowerCase();
      var mFid   = null;
      Object.keys(colMap).some(function (fid) {
        if (String(colMap[fid] || '').trim().toLowerCase() === target) {
          mFid = fid; return true;
        }
        return false;
      });
      if (mFid && flds[mFid] != null) {
        var cell2 = flds[mFid];
        var raw2  = (cell2 && typeof cell2 === 'object' && 'value' in cell2) ? cell2.value : cell2;
        return raw2 != null ? String(raw2) : '';
      }
    }

    return null; // Field not in this snapshot
  }

  // ── Concurrency queue ─────────────────────────────────────────────────────────
  function runWithConcurrency(items, fn, concurrency) {
    if (!items || !items.length) return Promise.resolve();
    var idx = 0, running = 0;
    return new Promise(function (resolve) {
      function next() {
        while (running < concurrency && idx < items.length) {
          /* eslint-disable no-loop-func */
          (function (item) {
            running++;
            var done = function () {
              running--;
              if (idx >= items.length && running === 0) resolve();
              else next();
            };
            try { fn(item).then(done, done); } catch (_) { done(); }
          })(items[idx++]);
          /* eslint-enable no-loop-func */
        }
        if (idx >= items.length && running === 0) resolve();
      }
      next();
    });
  }

  // ── QB Field list for picker (5-min cache) ────────────────────────────────────
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

  // ── autofillLinkedColumns ─────────────────────────────────────────────────────
  var _autofillToken = null;
  var _autofillTimer = null;

  function autofillLinkedColumns(current, gridEl) {
    if (!current || !gridEl) return;
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

    // Debounce
    var token = {};
    _autofillToken = token;
    clearTimeout(_autofillTimer);

    _autofillTimer = setTimeout(function () {
      if (_autofillToken !== token) return;

      // Phase 1 — mark uncached cells as pending (spinner placeholder)
      rowsWithCase.forEach(function (row) {
        var nk = normalizeCaseKey(row.data[caseCol.key]);
        if (_cache[nk]    && (Date.now() - _cache[nk].at)    < _CACHE_TTL)     return;
        if (_notFound[nk] && (Date.now() - _notFound[nk])    < _NOT_FOUND_TTL) return;
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

      // Phase 2 — split visible vs off-screen rows
      var gridWrap = document.getElementById('svcGridWrap') || gridEl.parentElement;
      var wrapRect = gridWrap ? gridWrap.getBoundingClientRect() : null;
      var visibleRows = [], deferredRows = [];
      rowsWithCase.forEach(function (row) {
        var anyInp = gridEl.querySelector('input.cell[data-row="' + row.row_index + '"]');
        if (anyInp && wrapRect) {
          var r = anyInp.getBoundingClientRect();
          (r.bottom >= wrapRect.top && r.top <= wrapRect.bottom)
            ? visibleRows.push(row) : deferredRows.push(row);
        } else {
          visibleRows.push(row);
        }
      });

      // Paint a single row (reads from cache, does not fetch)
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
          if (!inp || inp === document.activeElement) return;

          var fid   = String(col.qbLookup.fieldId   || '').trim();
          var label = String(col.qbLookup.fieldLabel || '').trim();

          if (!rec) {
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
            return;
          }

          var value = getFieldValue(rec, fid, label);
          if (value === null) {
            inp.value       = '';
            inp.readOnly    = true;
            inp.title       = '⚠ Field "' + label + '" not available for Case #' + rawCase;
            inp.classList.add('cell-qb-linked');
            inp.classList.remove('cell-qb-pending', 'cell-qb-not-found');
          } else {
            inp.value       = value;
            inp.readOnly    = true;
            inp.title       = '🔗 QB: ' + label + ' (Case #' + rawCase + ')';
            inp.classList.add('cell-qb-linked');
            inp.classList.remove('cell-qb-pending', 'cell-qb-not-found');
          }
        });
      }

      // Lookup + paint one row
      function processRow(row) {
        if (_autofillToken !== token) return Promise.resolve();
        var rawCase   = String(row.data[caseCol.key] || '').trim();
        var firstCol  = linkedCols[0];
        var neededFid = String(firstCol.qbLookup.fieldId   || '').trim();
        var neededLbl = String(firstCol.qbLookup.fieldLabel || '').trim();
        return lookupCase(rawCase, neededFid, neededLbl).then(function () {
          paintRow(row);
        });
      }

      // Phase 3 — visible rows first, concurrency 4
      runWithConcurrency(visibleRows, processRow, 4).then(function () {
        if (_autofillToken !== token || !deferredRows.length) return;
        // Phase 4 — off-screen rows after 400 ms delay
        setTimeout(function () {
          if (_autofillToken !== token) return;
          runWithConcurrency(deferredRows, processRow, 4);
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
    clearCache: function () {
      _cache       = {};
      _notFound    = {};
      _fieldsCache = null;
    }
  };

})();
