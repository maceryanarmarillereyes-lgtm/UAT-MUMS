// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms).
//   2. QB row number click: opens Case Detail View.
//   3. Deep search card click: _qbsOpenDeepResult + [data-action] fallback.
//   4. Banner dismissal memory: banner stays hidden after dismiss (sessionStorage).
//   5. Deep search card: remove Case View Details button + improve Assigned To.
//
// v3.0 FIX — Three permanent bug fixes:
//
//   BUG 1 — Case Detail modal shows all dashes:
//   ROOT CAUSE: _snapFromRecord built snap.columnMap as {} because the raw
//   QB records from __studioQbDeepRecords had fields data but no columnMap.
//   FIX: qb_search.js now attaches columnMap to every record. _snapFromRecord
//   reads r.columnMap directly. Also __studioQbDeepColumns is stored globally
//   so _findInCache can build columnMap from the columns array as a fallback.
//
//   BUG 2 — QB Records section shows 'No records match' for deep search result:
//   ROOT CAUSE: The Main Report search box does a CLIENT-SIDE filter only on the
//   already-loaded records (~500). When you click a deep search result card,
//   the QB Records section does NOT fire a new API call with that case# as a
//   filter — it just filters the existing 500 locally.
//   FIX: patchDeepSearchCards now injects the case# into #qbHeaderSearch input
//   and fires an 'input' event so the existing debounce-search mechanism in
//   my_quickbase.js triggers a live QB API search for that exact case#.
//
//   BUG 3 — stampCard ran before __studioQbDeepMap had full snap data:
//   ROOT CAUSE: The MutationObserver fired stampCard immediately when cards
//   appeared, but __studioQbDeepMap was populated AFTER rendering. Cards got
//   stamped with empty fields {}.
//   FIX: _rebuildDeepMap now schedules a re-stamp of all cards after the map
//   is populated. MutationObserver also re-stamps on every mutation.

(function () {
  'use strict';

  // ── DEEP RECORD MAP — O(1) lookup by recordId ────────────────────────────
  // Rebuilt every time window.__studioQbDeepRecords is populated.
  // Keyed by String(recordId).
  window.__studioQbDeepMap     = window.__studioQbDeepMap     || {};
  // FIX v3.0: Also store the columns array from the last deep search response.
  // This allows _snapFromRecord to build columnMap even when r.columnMap is absent.
  window.__studioQbDeepColumns = window.__studioQbDeepColumns || [];

  function _restampAllCards() {
    var container = document.getElementById('qbs-search-results');
    if (!container) return;
    container.querySelectorAll(
      '.qbs-result-card, .ds-result-card, .qbs-deep-card, ' +
      '[class*="result-card"], [class*="deep-card"], ' +
      '[data-case-num], [data-record-id]'
    ).forEach(function(card) {
      // Force re-stamp by clearing the old stamp
      card.removeAttribute('data-snap-json');
      delete card.dataset.snapStamped;
      stampCard(card);
    });
  }

  function _rebuildDeepMap(records) {
    var map = {};
    if (!Array.isArray(records)) return map;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r) continue;
      var id = String(r.qbRecordId || r['Case #'] || r['3'] || r.recordId || r.id || '');
      if (id) map[id] = r;
    }
    return map;
  }

  // Intercept writes to window.__studioQbDeepRecords so the Map stays fresh.
  // FIX v3.0: After rebuilding the map, schedule a re-stamp of all rendered
  // cards so they get the fresh fields+columnMap data.
  (function _interceptDeepRecords() {
    var _raw = window.__studioQbDeepRecords || [];
    window.__studioQbDeepMap = _rebuildDeepMap(_raw);
    try {
      Object.defineProperty(window, '__studioQbDeepRecords', {
        configurable: true,
        get: function () { return _raw; },
        set: function (v) {
          _raw = v;
          window.__studioQbDeepMap = _rebuildDeepMap(v);
          // FIX v3.0: Re-stamp cards with fresh snap data after map rebuild.
          // Use setTimeout(0) so card rendering completes first.
          setTimeout(_restampAllCards, 0);
        }
      });
    } catch (_) {}
  })();

  // ── HELPER: build a snap object from a raw QB record ────────────────────
  // FIX v3.0: columnMap is now read from r.columnMap (attached by qb_search.js
  // v2.1) or built from window.__studioQbDeepColumns as a fallback.
  // This is the permanent fix for the Case Detail modal showing all dashes.
  function _snapFromRecord(r, rid) {
    if (!r) return { rowNum: 0, recordId: String(rid), fields: {}, columnMap: {} };

    // If this is already a pre-built snap from deep-search, keep it as-is.
    if (r && r.fields && r.columnMap && (r.recordId || r.qbRecordId)) {
      return {
        rowNum: Number(r.rowNum || 0),
        recordId: String(r.recordId || r.qbRecordId || rid || ''),
        fields: r.fields,
        columnMap: r.columnMap
      };
    }

    // Build columnMap: prefer r.columnMap (set by qb_search.js v2.1),
    // then fall back to building from __studioQbDeepColumns.
    var columnMap = {};
    if (r.columnMap && typeof r.columnMap === 'object' && Object.keys(r.columnMap).length) {
      columnMap = r.columnMap;
    } else if (Array.isArray(window.__studioQbDeepColumns) && window.__studioQbDeepColumns.length) {
      window.__studioQbDeepColumns.forEach(function(col) {
        if (col && col.id) columnMap[String(col.id)] = String(col.label || col.id);
      });
    }

    // Normalise fields: handle both {fid:{value:...}} and flat {fid: rawVal} formats
    var rawFields = r.fields && typeof r.fields === 'object' ? r.fields : r;
    var fields = {};
    Object.keys(rawFields).forEach(function(fid) {
      var cell = rawFields[fid];
      if (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value')) {
        fields[fid] = cell;
      } else {
        fields[fid] = { value: cell == null ? '' : String(cell) };
      }
    });

    return {
      rowNum:    Number(r.rowNum || 0),
      recordId:  String(r.qbRecordId || r.recordId || rid),
      fields:    fields,
      columnMap: columnMap
    };
  }

  // ── HELPER: find record in any available cache — Map-first, then array ──
  function _findInCache(rid) {
    var key = String(rid);

    // 0. Deep-search snaps rendered in the current results panel
    var resultsEl = document.getElementById('qbs-search-results');
    if (resultsEl && Array.isArray(resultsEl._qbsDeepSearchSnaps)) {
      var snapMatch = resultsEl._qbsDeepSearchSnaps.find(function(s) {
        return s && String(s.recordId || s.qbRecordId || '') === key;
      });
      if (snapMatch) return snapMatch;
    }

    // 1. Fast O(1) Map lookup (deep search results)
    if (window.__studioQbDeepMap && window.__studioQbDeepMap[key]) {
      return window.__studioQbDeepMap[key];
    }

    // 2. Main QB records array (main table rows)
    if (Array.isArray(window.__studioQbRecords)) {
      for (var i = 0; i < window.__studioQbRecords.length; i++) {
        var r = window.__studioQbRecords[i];
        if (!r) continue;
        var id = String(r.qbRecordId || r['Case #'] || r['3'] || r.id || '');
        if (id === key) return r;
      }
    }

    // 3. _qbRowSnaps on qbDataBody (rendered main table snaps)
    var bodyEl = document.getElementById('qbDataBody');
    if (bodyEl && Array.isArray(bodyEl._qbRowSnaps)) {
      for (var j = 0; j < bodyEl._qbRowSnaps.length; j++) {
        var snap = bodyEl._qbRowSnaps[j];
        if (snap && String(snap.recordId || '') === key) return snap;
      }
    }

    return null;
  }

  // ── HELPER: open Case Detail modal ──────────────────────────────────────
  function _callCdOpen(snap) {
    if (!snap || !snap.recordId) return false;
    if (typeof window.__studioQbCdOpen === 'function') {
      window.__studioQbCdOpen(snap);
      return true;
    }
    var rootEl = document.querySelector('[data-page="quickbase_s"]');
    if (rootEl && typeof rootEl._qbcdOpen === 'function') {
      rootEl._qbcdOpen(snap, [snap]);
      return true;
    }
    var ids = ['qbPageShell', 'qbs-root', 'qbDataBody'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) {
        var p = el;
        while (p && p !== document.body) {
          if (typeof p._qbcdOpen === 'function') { p._qbcdOpen(snap, [snap]); return true; }
          p = p.parentElement;
        }
      }
    }
    if (window.MQ && typeof window.MQ.openCaseDetailModal === 'function') {
      window.MQ.openCaseDetailModal({ qbRecordId: snap.recordId || '', fields: snap.fields || {} });
      return true;
    }
    // Timing guard: if opener is still mounting, retry briefly.
    var attempts = 0;
    var maxAttempts = 10;
    var timer = setInterval(function() {
      attempts++;
      var rootRetry = document.querySelector('[data-page="quickbase_s"]') || document.getElementById('qbs-root');
      if (rootRetry && typeof rootRetry._qbcdOpen === 'function') {
        clearInterval(timer);
        rootRetry._qbcdOpen(snap, [snap]);
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        console.warn('[SupportStudioPatch] _callCdOpen: no opener found after retry', snap);
      }
    }, 120);
    return false;
  }

  // ── PATCH 1: Deep search auto-input ─────────────────────────────────────
  function patchDeepSearch() {
    var inputEl = document.getElementById('qbs-search-input');
    if (!inputEl) { setTimeout(patchDeepSearch, 800); return; }
    if (inputEl.dataset.autoSearchPatched) return;
    inputEl.dataset.autoSearchPatched = 'true';
    var debounceTimer = null;
    inputEl.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var val = String(this.value || '').trim();
      debounceTimer = setTimeout(function () {
        if (typeof window._qbsDeepSearch === 'function') { window._qbsDeepSearch(val, 0); return; }
        var btn = document.getElementById('qbs-search-btn');
        if (btn) btn.click();
      }, 500);
    });
    console.log('[SupportStudioPatch] Deep search auto-input patch applied.');
  }

  // ── PATCH 2: QB Records row number badge click ───────────────────────────
  function patchQbRowClick() {
    var bodyEl = document.getElementById('qbDataBody');
    if (!bodyEl) { setTimeout(patchQbRowClick, 800); return; }
    if (bodyEl.dataset.rowClickPatched) return;
    bodyEl.dataset.rowClickPatched = 'true';
    bodyEl.addEventListener('click', function (e) {
      var badge = e.target && e.target.closest && e.target.closest('.qb-row-detail-btn');
      if (!badge) return;
      var rowIndex = parseInt(badge.getAttribute('data-qb-snap-idx') || '', 10);
      if (isNaN(rowIndex)) return;
      var snap = bodyEl._qbRowSnaps && bodyEl._qbRowSnaps[rowIndex];
      if (!snap) return;
      _callCdOpen(snap);
    }, false);
    console.log('[SupportStudioPatch] QB row click safety-net patch applied.');
  }

  // ── PATCH 3: window._qbsOpenDeepResult ───────────────────────────────────
  // FIX v3.0: reads snap from card DOM (data-snap-json) first — no cache needed.
  // Falls back to Map lookup, then array scan, then bare recordId-only snap.
  function defineQbsOpenDeepResult() {
    window._qbsOpenDeepResult = function (caseNum, cardEl) {
      if (!caseNum || String(caseNum) === '—') return;
      var rid = String(caseNum);
      var snap = null;

      // Path 0: when caller sends deep-search result index (legacy inline onclick path)
      if (typeof cardEl === 'number' || (typeof cardEl === 'string' && /^[0-9]+$/.test(cardEl))) {
        var idx = Number(cardEl);
        var resultsEl = document.getElementById('qbs-search-results');
        var snaps = resultsEl && Array.isArray(resultsEl._qbsDeepSearchSnaps) ? resultsEl._qbsDeepSearchSnaps : [];
        if (!isNaN(idx) && snaps[idx]) {
          snap = snaps[idx];
          rid = String(snap.recordId || rid);
        }
      }

      // Path A: card element passed directly → read data-snap-json (most reliable)
      if (!snap && cardEl && cardEl.getAttribute) {
        var rawSnap = cardEl.getAttribute('data-snap-json');
        if (rawSnap) {
          try {
            var parsed = JSON.parse(rawSnap);
            if (parsed && parsed.recordId) {
              snap = parsed;
              rid = String(parsed.recordId || rid);
            }
          } catch (_) {}
        }
        var cardRid = cardEl.getAttribute('data-record-id') || rid;
        rid = String(cardRid);
      }

      // Path B: Map / array cache lookup
      if (!snap) {
        var cached = _findInCache(rid);
        snap = _snapFromRecord(cached, rid);
      }
      if (!snap || !snap.recordId) return;
      _callCdOpen(snap);
    };
    console.log('[SupportStudioPatch] window._qbsOpenDeepResult v3.0 defined.');
  }

  // ── PATCH 4: [data-action="ds-case-view-details"] fallback ───────────────
  function patchDeepSearchActionBtn() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest &&
        e.target.closest('[data-action="ds-case-view-details"]');
      if (!btn) return;
      setTimeout(function () {
        var modal = document.getElementById('qbCaseDetailModal');
        if (modal && (modal.classList.contains('open') ||
            modal.style.display === 'flex' || modal.style.display === 'block')) return;
        var rid = btn.getAttribute('data-rid') || '';
        var rowData = {};
        try { rowData = JSON.parse(btn.getAttribute('data-row') || '{}'); } catch (_) {}
        if (!rid) rid = String(rowData.qbRecordId || rowData.recordId || '');
        if (!rid) return;

        var cardEl = btn.closest('[data-snap-json]') || btn;
        var rawSnap = cardEl && cardEl.getAttribute && cardEl.getAttribute('data-snap-json');
        if (rawSnap) {
          try {
            var parsed = JSON.parse(rawSnap);
            if (parsed && parsed.recordId) { _callCdOpen(parsed); return; }
          } catch (_) {}
        }

        var cached = _findInCache(rid);
        var snap = _snapFromRecord(cached, rid);
        if (!snap.fields || Object.keys(snap.fields).length === 0) {
          snap.fields = rowData.fields || rowData;
        }
        _callCdOpen(snap);
      }, 80);
    }, false);
    console.log('[SupportStudioPatch] ds-case-view-details fallback patch applied.');
  }

  // ── PATCH 5: Banner dismissal memory (sessionStorage) ────────────────────
  function patchBannerDismissal() {
    var SS_KEY = 'ss_cache_banner_dismissed';

    function hookCacheUI() {
      if (!window._cacheUI) { setTimeout(hookCacheUI, 300); return; }
      var ui = window._cacheUI;

      if (!ui._origDismissBanner) {
        ui._origDismissBanner = ui.dismissBanner.bind(ui);
        ui.dismissBanner = function () {
          sessionStorage.setItem(SS_KEY, '1');
          ui._origDismissBanner();
        };
      }

      ['showBanner', 'showBannerSoft', 'showUpdateBanner'].forEach(function (m) {
        if (typeof ui[m] === 'function' && !ui['_orig_' + m]) {
          ui['_orig_' + m] = ui[m].bind(ui);
          ui[m] = function () {
            if (sessionStorage.getItem(SS_KEY) === '1') return;
            ui['_orig_' + m].apply(ui, arguments);
          };
        }
      });

      if (sessionStorage.getItem(SS_KEY) === '1') {
        ['ss-cache-banner', 'ss-cache-banner-soft'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      }

      console.log('[SupportStudioPatch] Banner dismissal memory patch applied.');
    }

    window.addEventListener('studiocache:update', function () {
      sessionStorage.removeItem(SS_KEY);
    }, false);
    window.addEventListener('studiocache:critical', function () {
      sessionStorage.removeItem(SS_KEY);
    }, false);
    window.addEventListener('studiocache:fresh', function () {
      ['ss-cache-banner', 'ss-cache-banner-soft'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }, false);

    hookCacheUI();
  }

  // ── stampCard — forward declaration so _restampAllCards can call it ──────
  // (defined below in patchDeepSearchCards; hoisted via var)
  var stampCard;

  // ── PATCH 6: Deep search cards — stamp data-snap-json + delegated click ──
  // v3.0 CORE FIX:
  //   a) __studioQbDeepColumns is stored globally after every search so
  //      _snapFromRecord can build columnMap without an extra API call.
  //   b) stampCard now always has access to fresh columnMap via _snapFromRecord.
  //   c) _restampAllCards is called after __studioQbDeepRecords is set so
  //      cards stamped before the map was ready get refreshed immediately.
  //   d) FIX v3.0 (Bug 2): When a deep search card is clicked, the case# is
  //      also injected into #qbHeaderSearch and an 'input' event fired so the
  //      QB Records section runs a live API search for that exact case#.
  function patchDeepSearchCards() {

    // ── Stamp data-snap-json on a single card element ──────────────────────
    stampCard = function(card) {
      // --- Resolve the record ID from the card DOM ---
      var rid = card.getAttribute('data-record-id')
             || card.getAttribute('data-case-num')
             || card.getAttribute('data-rid')
             || card.getAttribute('data-id')
             || '';

      if (!rid) {
        var numEl = card.querySelector('[data-case-num], [data-record-id], .qbs-case-num, .ds-case-num, .qb-case-id');
        if (numEl) {
          rid = numEl.getAttribute('data-case-num')
             || numEl.getAttribute('data-record-id')
             || numEl.textContent.trim().replace(/[^0-9]/g, '');
        }
      }

      if (!rid) {
        var allText = card.textContent || '';
        var numMatch = allText.match(/\b(\d{5,8})\b/);
        if (numMatch) rid = numMatch[1];
      }

      if (!rid) return;

      rid = String(rid);
      card.setAttribute('data-record-id', rid);

      // --- Build the snap from cache if available ---
      var cached = _findInCache(rid);
      var snap = _snapFromRecord(cached, rid);

      try {
        card.setAttribute('data-snap-json', JSON.stringify(snap));
      } catch (_) {}
      card.dataset.snapStamped = 'true';
    };

    // ── Process all cards in a container ──────────────────────────────────
    function processCards(container) {
      container.querySelectorAll(
        '.qbs-result-card, .ds-result-card, .qbs-deep-card, ' +
        '[class*="result-card"], [class*="deep-card"], ' +
        '[data-case-num], [data-record-id]'
      ).forEach(stampCard);

      // ── Cosmetic: remove "Case View Details" buttons ──────────────────
      container.querySelectorAll(
        '[data-action="ds-case-view-details"], .ds-view-details-btn, .qbs-case-view-btn'
      ).forEach(function (b) { b.remove(); });

      container.querySelectorAll('button, a, span, div').forEach(function (el) {
        var txt = (el.textContent || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (txt === 'CASE VIEW DETAILS' && el.children.length === 0) {
          var parent = el.parentElement;
          if (parent && (parent.textContent || '').trim().toUpperCase().replace(/\s+/g, ' ') === 'CASE VIEW DETAILS') {
            parent.remove();
          } else {
            el.remove();
          }
        }
      });

      // ── Cosmetic: Assigned To label + value styling ───────────────────
      container.querySelectorAll(
        '.ds-field-label, .qbs-label, .ss-field-label, [class*="label"], [class*="meta"]'
      ).forEach(function (labelEl) {
        if (labelEl.children.length > 0) return;
        var txt = (labelEl.textContent || '').trim().toUpperCase().replace(/[:\s]+$/, '');
        if (txt !== 'ASSIGNED TO') return;
        styleAssignedToLabel(labelEl);
        var valueEl = labelEl.nextElementSibling;
        if (valueEl) styleAssignedToValue(valueEl);
      });

      container.querySelectorAll(
        '.qbs-result-card, .ds-result-card, .qbs-deep-card, [class*="result"], [class*="card"]'
      ).forEach(function (card) {
        card.querySelectorAll('span, div, p').forEach(function (el) {
          if (el.children.length > 0) return;
          var t = (el.textContent || '').trim().toUpperCase().replace(/[:\s]+$/, '');
          if (t !== 'ASSIGNED TO') return;
          styleAssignedToLabel(el);
          var next = el.nextElementSibling;
          if (next && next.children.length === 0) styleAssignedToValue(next);
        });
      });
    }

    function styleAssignedToLabel(el) {
      el.style.cssText += ';font-size:9px !important;text-transform:uppercase;color:#8b949e !important;letter-spacing:.07em;font-weight:700 !important;';
    }

    function styleAssignedToValue(el) {
      var name = (el.textContent || '').trim();
      if (!name || name === '—' || name === '-') {
        el.style.cssText += ';color:#484f58 !important;font-weight:600 !important;font-size:11px !important;';
        if (el.textContent.trim() === '-') el.textContent = '—';
      } else {
        el.style.cssText += ';color:#e6edf3 !important;font-weight:700 !important;font-size:11px !important;';
        if (!el.querySelector('.fa-user')) {
          var ico = document.createElement('i');
          ico.className = 'fas fa-user';
          ico.style.cssText = 'font-size:9px;color:#8b949e;margin-right:4px;flex-shrink:0;';
          el.insertBefore(ico, el.firstChild);
        }
      }
    }

    // ── Delegated click handler on the results container ─────────────────
    // FIX v3.0 (Bug 2): When a card is clicked, also inject the case# into
    // #qbHeaderSearch and fire 'input' event so the QB Records section
    // triggers a live API search for that case# (searches all 22k+ records).
    function _injectSearchTerm(caseNum) {
      if (!caseNum) return;
      var searchInput = document.getElementById('qbHeaderSearch');
      if (!searchInput) return;
      searchInput.value = String(caseNum);
      // Fire native 'input' event to trigger the existing debounce handler
      // in my_quickbase.js (applySearchAndRender / loadQuickbaseData).
      var evt;
      try { evt = new Event('input', { bubbles: true, cancelable: true }); } catch(_) {
        evt = document.createEvent('Event');
        evt.initEvent('input', true, true);
      }
      searchInput.dispatchEvent(evt);
    }

    function attachDelegatedClick(container) {
      if (container.dataset.delegatedClickAttached) return;
      container.dataset.delegatedClickAttached = 'true';

      container.addEventListener('click', function (e) {
        var card = e.target && e.target.closest && e.target.closest('[data-snap-json]');
        if (!card) {
          var rawCard = e.target && e.target.closest && e.target.closest(
            '.qbs-result-card, .ds-result-card, .qbs-deep-card, [data-case-num], [data-record-id]'
          );
          if (rawCard) { stampCard(rawCard); card = rawCard; }
        }
        if (!card) return;

        var clickedBtn = e.target && e.target.closest && e.target.closest('button, a');
        if (clickedBtn) {
          var action = clickedBtn.getAttribute('data-action') || '';
          if (action && action !== 'ds-case-view-details' && action !== 'case-view-details') return;
        }

        var rawSnap = card.getAttribute('data-snap-json');
        var snapObj = null;
        if (rawSnap) {
          try {
            var parsedSnap = JSON.parse(rawSnap);
            if (parsedSnap && parsedSnap.recordId) snapObj = parsedSnap;
          } catch (_) {}
        }

        if (!snapObj) {
          var rid = card.getAttribute('data-record-id') || '';
          if (!rid) return;
          var cached = _findInCache(rid);
          snapObj = _snapFromRecord(cached, rid);
        }

        if (!snapObj) return;
        e.stopPropagation();

        // FIX v3.0 (Bug 2): Inject case# into QB Records search box so the
        // main QB Records section also shows the matching record via API search.
        _injectSearchTerm(snapObj.recordId);

        _callCdOpen(snapObj);
      }, true);

      console.log('[SupportStudioPatch] Delegated click handler v3.0 attached to results container.');
    }

    // ── Watch #qbs-search-results for card renders ────────────────────────
    function watchResults() {
      var container = document.getElementById('qbs-search-results');
      if (!container) { setTimeout(watchResults, 800); return; }
      if (container.dataset.cardPatchApplied) return;
      container.dataset.cardPatchApplied = 'true';

      processCards(container);
      attachDelegatedClick(container);

      var obs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches(
              '.qbs-result-card, .ds-result-card, .qbs-deep-card, [data-case-num], [data-record-id]'
            )) {
              stampCard(node);
            }
            processCards(node.querySelectorAll ? node : container);
          });
        });
        // FIX v3.0: Always re-stamp the whole container so cards populated
        // before __studioQbDeepMap was ready get refreshed with correct snap.
        processCards(container);
      });
      obs.observe(container, { childList: true, subtree: true });
      console.log('[SupportStudioPatch] Deep search card patch v3.0 observer active.');
    }

    watchResults();
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────
  function boot() {
    defineQbsOpenDeepResult();
    patchDeepSearch();
    patchQbRowClick();
    patchDeepSearchActionBtn();
    patchBannerDismissal();
    patchDeepSearchCards();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
