(function () {
  'use strict';
  // ─────────────────────────────────────────────────────────────────────────────
  // services-qb-lookup.js  v1.0 — QB Field Selector + Auto-populate Engine
  // ─────────────────────────────────────────────────────────────────────────────
  // Public API (window.svcQbLookup):
  //   .openFieldPicker({ colIdx, cols, onSelect })
  //   .autofillLinkedColumns(current, gridEl)
  //   .clearCache()
  // ─────────────────────────────────────────────────────────────────────────────

  // ── JWT helper — reads the MUMS session the same way servicesDB does ─────────
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

  // ── Fields cache (client-side 5 min) ─────────────────────────────────────────
  var _fieldsCache    = null; // { fields: [...], at: number }
  var _FIELDS_TTL     = 5 * 60 * 1000;

  function loadFields(forceRefresh) {
    if (!forceRefresh && _fieldsCache && (Date.now() - _fieldsCache.at) < _FIELDS_TTL) {
      return Promise.resolve(_fieldsCache.fields);
    }
    var url = '/api/studio/qb_fields' + (forceRefresh ? '?forceRefresh=1' : '');
    return fetch(url, { headers: apiHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          if (data.warning === 'studio_qb_not_configured') {
            return []; // not an error, just not set up
          }
          throw new Error(data.message || 'Failed to load QB fields');
        }
        _fieldsCache = { fields: data.fields || [], at: Date.now() };
        return _fieldsCache.fields;
      });
  }

  // ── QB single-record cache ────────────────────────────────────────────────────
  var _recordCache  = {}; // caseNum → { fields, columnMap, at }
  var _RECORD_TTL   = 5 * 60 * 1000; // 5 min cache — reduce repeat hits
  var _pending      = {}; // caseNum → Promise
  var _notFound     = {}; // caseNum → timestamp — suppress retrying known 404s

  // ── Concurrency-limited fetch queue ──────────────────────────────────────────
  // ROOT CAUSE FIX: The old code fired ALL rows concurrently (500+ requests at once)
  // → server overload → mass 500 errors. New queue: max 3 in-flight at a time.
  var _QUEUE_CONCURRENCY = 3;
  var _queueRunning      = 0;
  var _queue             = []; // Array of { key, resolve, reject }

  function _drainQueue() {
    while (_queueRunning < _QUEUE_CONCURRENCY && _queue.length > 0) {
      var item = _queue.shift();
      _queueRunning++;
      _doFetch(item.key)
        .then(function (result) { item.resolve(result); })
        .catch(function (err)   { item.reject(err); })
        .finally(function ()    { _queueRunning--; _drainQueue(); });
    }
  }

  function _doFetch(key) {
    return fetch('/api/studio/qb_data?recordId=' + encodeURIComponent(key), { headers: apiHeaders() })
      .then(function (r) {
        // Silently handle 404 (record not in QB) and 500 (server error) — no console flood
        if (r.status === 404) { _notFound[key] = Date.now(); return null; }
        if (!r.ok) { return null; } // 500, 502, etc — fail silently, retry next load
        return r.json();
      })
      .then(function (data) {
        if (!data) return null;
        if (!data.ok) {
          if (data.error === 'record_not_found') { _notFound[key] = Date.now(); }
          return null;
        }
        var rec = { fields: data.fields || {}, columnMap: data.columnMap || {}, at: Date.now() };
        _recordCache[key] = rec;
        delete _pending[key];
        return rec;
      })
      .catch(function () { delete _pending[key]; return null; });
  }

  var _NOT_FOUND_TTL = 10 * 60 * 1000; // don't retry 404s for 10 min

  function fetchCaseRecord(caseNum) {
    var key = String(caseNum || '').trim();
    if (!key) return Promise.resolve(null);

    // Return cache hit immediately
    var cached = _recordCache[key];
    if (cached && (Date.now() - cached.at) < _RECORD_TTL) return Promise.resolve(cached);

    // Don't retry known-not-found records
    var nf = _notFound[key];
    if (nf && (Date.now() - nf) < _NOT_FOUND_TTL) return Promise.resolve(null);

    // Return in-flight promise if already queued/running
    if (_pending[key]) return _pending[key];

    // Enqueue — concurrency-limited
    var p = new Promise(function (resolve, reject) {
      _queue.push({ key: key, resolve: resolve, reject: reject });
      _drainQueue();
    }).then(function (result) {
      delete _pending[key];
      return result;
    }).catch(function () {
      delete _pending[key];
      return null;
    });

    _pending[key] = p;
    return p;
  }

  // ── Auto-fill engine ──────────────────────────────────────────────────────────
  // Scans column_defs for qbLookup. For each row with a Case # in col[0],
  // fetches the QB record via a THROTTLED QUEUE and paints the linked field.
  // Read-only paint only — does NOT write to Supabase.
  // Priority: visible rows first, off-screen rows deferred by 400ms.

  var _autofillTimer    = null;
  var _autofillAbort    = null; // token to cancel stale runs on re-render

  function autofillLinkedColumns(current, gridEl) {
    if (!current || !gridEl) return;
    var cols = current.sheet.column_defs || [];

    var linkedCols = cols.filter(function (c) {
      return c.qbLookup && c.qbLookup.fieldId;
    });
    if (!linkedCols.length) return;

    // Col[0] is always the Case Number source column
    var caseCol = cols[0];
    if (!caseCol) return;

    var rowsWithCase = current.rows.filter(function (r) {
      return r.data && r.data[caseCol.key] && String(r.data[caseCol.key]).trim();
    });
    if (!rowsWithCase.length) return;

    // Cancel any previous pending autofill run for this grid
    var runToken = {};
    _autofillAbort = runToken;

    clearTimeout(_autofillTimer);
    _autofillTimer = setTimeout(function () {
      if (_autofillAbort !== runToken) return; // stale run — grid was re-rendered

      // ── Phase 1: mark ALL linked cells as pending immediately ──────────────
      rowsWithCase.forEach(function (row) {
        linkedCols.forEach(function (col) {
          var inp = gridEl.querySelector(
            'input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]'
          );
          if (!inp || inp.classList.contains('cell-qb-linked')) return;
          // Only mark pending if not already cached
          var caseNum = String(row.data[caseCol.key] || '').trim();
          var cached  = _recordCache[caseNum];
          if (cached && (Date.now() - cached.at) < _RECORD_TTL) return; // will paint instantly
          inp.classList.add('cell-qb-pending');
          inp.readOnly    = true;
          inp.placeholder = '⋯';
        });
      });

      // ── Phase 2: detect which rows are currently in the viewport ───────────
      var gridWrap      = document.getElementById('svcGridWrap') || gridEl.parentElement;
      var wrapRect      = gridWrap ? gridWrap.getBoundingClientRect() : null;
      var visibleRows   = [];
      var offscreenRows = [];

      rowsWithCase.forEach(function (row) {
        var anyInp = gridEl.querySelector('input.cell[data-row="' + row.row_index + '"]');
        if (anyInp && wrapRect) {
          var r = anyInp.getBoundingClientRect();
          if (r.bottom >= wrapRect.top && r.top <= wrapRect.bottom) {
            visibleRows.push(row);
          } else {
            offscreenRows.push(row);
          }
        } else {
          visibleRows.push(row); // fallback: treat as visible
        }
      });

      // ── Paint helper ───────────────────────────────────────────────────────
      function paintRow(row) {
        var caseNum = String(row.data[caseCol.key] || '').trim();
        if (!caseNum) return;

        fetchCaseRecord(caseNum).then(function (rec) {
          if (_autofillAbort !== runToken) return; // grid changed — discard paint
          if (!rec) {
            // Record not found: clear pending state gracefully
            linkedCols.forEach(function (col) {
              var inp = gridEl.querySelector(
                'input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]'
              );
              if (!inp) return;
              inp.classList.remove('cell-qb-pending');
              inp.readOnly    = false;
              inp.placeholder = '';
            });
            return;
          }
          linkedCols.forEach(function (col) {
            var fid       = String(col.qbLookup.fieldId);
            var fieldCell = rec.fields[fid];
            var value     = fieldCell ? String(fieldCell.value != null ? fieldCell.value : '') : '';

            var inp = gridEl.querySelector(
              'input.cell[data-row="' + row.row_index + '"][data-key="' + col.key + '"]'
            );
            if (!inp || inp === document.activeElement) return;

            inp.value    = value;
            inp.readOnly = true;
            inp.title    = '🔗 QB: ' + col.qbLookup.fieldLabel + ' (Case #' + caseNum + ')';
            inp.classList.add('cell-qb-linked');
            inp.classList.remove('cell-qb-pending');
          });
        });
      }

      // ── Phase 3: fetch visible rows immediately, offscreen rows deferred ───
      visibleRows.forEach(function (row) { paintRow(row); });

      // Defer offscreen rows so visible rows get queue priority
      if (offscreenRows.length) {
        setTimeout(function () {
          if (_autofillAbort !== runToken) return;
          offscreenRows.forEach(function (row) { paintRow(row); });
        }, 400);
      }
    }, 120); // slight debounce so rapid re-renders don't stack
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
    // opts: { colIdx, cols, onSelect }
    closeFieldPicker();

    var col            = opts.cols && opts.cols[opts.colIdx];
    var colLabel       = col ? col.label : 'Column';
    var currentFieldId = col && col.qbLookup ? String(col.qbLookup.fieldId) : null;
    var currentLabel   = col && col.qbLookup ? col.qbLookup.fieldLabel : null;

    // ── Overlay ──
    var overlay = el('div', 'qb-fp-overlay');
    overlay.id  = 'svcQbFieldOverlay';

    // ── Panel ──
    var panel = el('div', 'qb-fp-panel');
    overlay.appendChild(panel);

    // ── Header ──
    var header = el('div', 'qb-fp-header');
    panel.appendChild(header);

    var headerLeft = el('div', 'qb-fp-header-left');
    header.appendChild(headerLeft);

    // QB icon
    var iconWrap = el('div', 'qb-fp-icon');
    iconWrap.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    headerLeft.appendChild(iconWrap);

    var titleGroup = el('div', 'qb-fp-title-group');
    headerLeft.appendChild(titleGroup);

    var titleEl = el('h3', 'qb-fp-title');
    titleEl.textContent = 'Select Quickbase Field';
    titleGroup.appendChild(titleEl);

    var subtitleEl = el('p', 'qb-fp-subtitle');
    subtitleEl.textContent = 'Linking to column "' + colLabel + '" · Looks up by Case # (col 1)';
    titleGroup.appendChild(subtitleEl);

    var closeBtn = el('button', 'qb-fp-close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', closeFieldPicker);
    header.appendChild(closeBtn);

    // ── Current link banner ──
    if (currentFieldId) {
      var currentBanner = el('div', 'qb-fp-current-banner');
      currentBanner.innerHTML = '<span class="qb-fp-linked-dot"></span><span>Currently linked: <strong>' + (currentLabel || '#' + currentFieldId) + '</strong></span>';
      var unlinkBtn = el('button', 'qb-fp-unlink-btn');
      unlinkBtn.type        = 'button';
      unlinkBtn.textContent = 'Unlink';
      unlinkBtn.addEventListener('click', function () {
        opts.onSelect && opts.onSelect(null, null);
        closeFieldPicker();
      });
      currentBanner.appendChild(unlinkBtn);
      panel.appendChild(currentBanner);
    }

    // ── Search bar ──
    var searchWrap = el('div', 'qb-fp-search-wrap');
    panel.appendChild(searchWrap);

    var searchIcon = el('span', 'qb-fp-search-icon');
    searchIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    searchWrap.appendChild(searchIcon);

    var searchInp = el('input', 'qb-fp-search');
    searchInp.type        = 'text';
    searchInp.placeholder = 'Filter available fields…';
    searchInp.autocomplete = 'off';
    searchInp.spellcheck  = false;
    searchWrap.appendChild(searchInp);

    var clearSearchBtn = el('button', 'qb-fp-search-clear');
    clearSearchBtn.type      = 'button';
    clearSearchBtn.innerHTML = '✕';
    clearSearchBtn.title     = 'Clear filter';
    clearSearchBtn.style.display = 'none';
    searchWrap.appendChild(clearSearchBtn);

    // ── Status bar ──
    var statusBar = el('div', 'qb-fp-status-bar');
    panel.appendChild(statusBar);

    var statusText  = el('span', 'qb-fp-status-text');
    statusText.textContent = 'Loading fields from Studio Quickbase…';
    statusBar.appendChild(statusText);

    var refreshBtn = el('button', 'qb-fp-refresh-btn');
    refreshBtn.type        = 'button';
    refreshBtn.title       = 'Reload fields from QB';
    refreshBtn.innerHTML   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh';
    statusBar.appendChild(refreshBtn);

    // ── Fields container ──
    var fieldsContainer = el('div', 'qb-fp-fields-container');
    panel.appendChild(fieldsContainer);

    var fieldsGrid = el('div', 'qb-fp-fields-grid');
    fieldsContainer.appendChild(fieldsGrid);

    // ── Footer ──
    var footer = el('div', 'qb-fp-footer');
    footer.innerHTML = '<span class="qb-fp-footer-tip">🔗 Selected field will auto-populate from QB using Case # in column 1</span>';
    panel.appendChild(footer);

    document.body.appendChild(overlay);

    // Auto-focus search after animation frame
    requestAnimationFrame(function () { searchInp.focus(); });

    // ── ESC close ──
    function onEsc(e) {
      if (e.key === 'Escape') {
        closeFieldPicker();
        document.removeEventListener('keydown', onEsc);
      }
    }
    document.addEventListener('keydown', onEsc);

    // ── Click outside ──
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closeFieldPicker();
    });

    // ── Field rendering ───────────────────────────────────────────────────────
    var _allFields  = [];
    var _filterTerm = '';

    function renderFields() {
      var q    = _filterTerm.trim().toLowerCase();
      var list = q
        ? _allFields.filter(function (f) {
            return f.label.toLowerCase().includes(q) || String(f.id).includes(q) || (f.type || '').toLowerCase().includes(q);
          })
        : _allFields;

      fieldsGrid.innerHTML = '';

      // Status
      if (q) {
        statusText.textContent = list.length + ' field' + (list.length !== 1 ? 's' : '') + ' matching "' + _filterTerm.trim() + '"';
      } else {
        statusText.textContent = _allFields.length + ' field' + (_allFields.length !== 1 ? 's' : '') + ' available';
      }

      if (!list.length) {
        var emptyEl = el('div', 'qb-fp-empty');
        emptyEl.innerHTML = q
          ? '<span>🔍</span><p>No fields match <em>"' + _filterTerm.trim() + '"</em></p><small>Try a shorter search term</small>'
          : '<span>📭</span><p>No fields found. Check Studio QB Settings.</p>';
        fieldsGrid.appendChild(emptyEl);
        return;
      }

      var frag = document.createDocumentFragment();
      list.forEach(function (f) {
        var card     = el('button', 'qb-fp-card' + (currentFieldId && String(f.id) === currentFieldId ? ' qb-fp-card--selected' : ''));
        card.type    = 'button';
        card.dataset.fieldId = f.id;

        var cardTop  = el('div', 'qb-fp-card-top');
        card.appendChild(cardTop);

        var cardLabel = el('span', 'qb-fp-card-label');
        if (q) {
          // Highlight matching text
          var labelText = f.label;
          var idx       = labelText.toLowerCase().indexOf(q);
          if (idx >= 0) {
            cardLabel.innerHTML =
              escHtml(labelText.slice(0, idx)) +
              '<mark>' + escHtml(labelText.slice(idx, idx + q.length)) + '</mark>' +
              escHtml(labelText.slice(idx + q.length));
          } else {
            cardLabel.textContent = labelText;
          }
        } else {
          cardLabel.textContent = f.label;
        }
        cardTop.appendChild(cardLabel);

        if (currentFieldId && String(f.id) === currentFieldId) {
          var linkedBadge = el('span', 'qb-fp-card-linked-badge');
          linkedBadge.textContent = 'Linked';
          cardTop.appendChild(linkedBadge);
        }

        var cardMeta = el('div', 'qb-fp-card-meta');
        var metaId   = el('span', 'qb-fp-card-id');
        metaId.textContent = '#' + f.id;
        cardMeta.appendChild(metaId);
        if (f.type) {
          var metaType = el('span', 'qb-fp-card-type');
          metaType.textContent = f.type;
          cardMeta.appendChild(metaType);
        }
        card.appendChild(cardMeta);

        card.addEventListener('click', function () {
          // Animate selection
          fieldsGrid.querySelectorAll('.qb-fp-card').forEach(function (c) { c.classList.remove('qb-fp-card--selecting'); });
          card.classList.add('qb-fp-card--selecting');
          card.classList.add('qb-fp-card--selected');
          setTimeout(function () {
            opts.onSelect && opts.onSelect(f.id, f.label);
            closeFieldPicker();
          }, 180);
        });

        frag.appendChild(card);
      });
      fieldsGrid.appendChild(frag);
    }

    function escHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showLoading() {
      fieldsGrid.innerHTML = '';
      var loadEl  = el('div', 'qb-fp-loading');
      var spinner = el('div', 'qb-fp-spinner');
      loadEl.appendChild(spinner);
      var loadText = el('span');
      loadText.textContent = 'Fetching fields from Studio Quickbase…';
      loadEl.appendChild(loadText);
      fieldsGrid.appendChild(loadEl);
      statusText.textContent = 'Loading…';
    }

    function showError(msg, retry) {
      fieldsGrid.innerHTML = '';
      var errEl = el('div', 'qb-fp-error');
      errEl.innerHTML = '<div class="qb-fp-error-icon">⚠</div><p>' + escHtml(msg) + '</p>';
      var retryBtn = el('button', 'qb-fp-retry-btn');
      retryBtn.type        = 'button';
      retryBtn.textContent = '↻ Try Again';
      retryBtn.addEventListener('click', function () { retry && retry(); });
      errEl.appendChild(retryBtn);
      fieldsGrid.appendChild(errEl);
      statusText.textContent = 'Error — check Studio QB Settings';
    }

    function doLoad(force) {
      showLoading();
      loadFields(!!force).then(function (fields) {
        _allFields = fields;
        renderFields();
      }).catch(function (err) {
        showError(err.message || 'Could not load fields.', function () { doLoad(true); });
      });
    }

    // ── Wire events ──
    searchInp.addEventListener('input', function () {
      _filterTerm              = searchInp.value;
      clearSearchBtn.style.display = _filterTerm ? '' : 'none';
      renderFields();
    });

    clearSearchBtn.addEventListener('click', function () {
      searchInp.value          = '';
      _filterTerm              = '';
      clearSearchBtn.style.display = 'none';
      renderFields();
      searchInp.focus();
    });

    refreshBtn.addEventListener('click', function () {
      _fieldsCache = null;
      doLoad(true);
    });

    // ── Initial load ──
    doLoad(false);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.svcQbLookup = {
    openFieldPicker      : openFieldPicker,
    closeFieldPicker     : closeFieldPicker,
    autofillLinkedColumns: autofillLinkedColumns,
    clearCache: function () {
      _fieldsCache = null;
      _recordCache = {};
      _notFound    = {};
      _queue       = [];
      _queueRunning = 0;
    },
  };
})();
