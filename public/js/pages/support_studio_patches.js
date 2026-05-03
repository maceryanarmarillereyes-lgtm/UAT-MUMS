/**
 * @file support_studio_patches.js
 * @description Page: Support Studio patches — hot-fix patch loader for Support Studio
 * @module MUMS/Studio
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms).
//   2. QB row number click: opens Case Detail View.
//   3. Deep search card click: _qbsOpenDeepResult + [data-action] fallback.
//   4. Banner dismissal memory: banner stays hidden after dismiss (sessionStorage).
//   5. Deep search card: remove Case View Details button + improve Assigned To.
//   7. Connect+ tab: column alignment fix — header-keyed mapping, permanent.
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
      if (!caseNum || String(caseNum) === '\u2014') return;
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
      if (!name || name === '\u2014' || name === '-') {
        el.style.cssText += ';color:#484f58 !important;font-weight:600 !important;font-size:11px !important;';
        if (el.textContent.trim() === '-') el.textContent = '\u2014';
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

  // ── PATCH 7: Connect+ tab — column alignment permanent fix ───────────────
  // ROOT CAUSE: The Connect+ table renderer uses positional index (data[0],
  // data[1]...) instead of named CSV header keys, causing misalignment when
  // the Google Sheet column order differs from the expected display order.
  //
  // FIX STRATEGY:
  //   1. Intercept window.__cpRawRows / window.__cpHeaderMap after CSV load.
  //   2. After the table renders, rebuild every <tr> using the DISPLAY_COLS map
  //      which reads values by header name (not position).
  //   3. Re-apply on every MutationObserver mutation (filter/sort/paginate).
  //   4. STRICTLY scoped to [data-tab="connect_plus"] — zero impact elsewhere.
  //
  // BUG-FIX (v3.9.x): window.__cpRawRows now receives named-field objects from
  // _cpLoad() (keys: site, directory, city, state, country, timezone,
  // storeNumber, endUser, systems, url).  _cpGetRawRowObject and _cpGetRawValue
  // handle both legacy Array rows and new named-field Object rows.
  // Also added storeNumber to the normalisation alias map so STORE NUMBER
  // column data is correctly resolved when the patch activates.
  // ─────────────────────────────────────────────────────────────────────────
  function patchConnectPlusColumns() {
    var _lastCpHeaderFingerprint = '';

    function _getCpRoot() {
      return document.querySelector('[data-tab="connect_plus"]')
          || document.querySelector('[data-page="connect_plus"]')
          || document.getElementById('cp-tab-panel')
          || document.getElementById('connectPlusPanel')
          || null;
    }

    function _getCpTable(root) {
      if (!root) return null;
      var bodyWrap = root.querySelector('#cp-table-body');
      if (bodyWrap) {
        var bodyTable = bodyWrap.querySelector('table');
        if (bodyTable) return bodyTable;
      }
      return root.querySelector('table')
          || root.querySelector('[class*="cp-table"]')
          || root.querySelector('[class*="connect-table"]')
          || root.querySelector('[id*="cp-table"]')
          || null;
    }

    function _getCpHeadTable(root) {
      if (!root) return null;
      var selectors = ['#cp-table-head table','#cp-table-head-wrap table',
                       '#cp-table-head','#cp-table-head-wrap'];
      for (var i = 0; i < selectors.length; i++) {
        var el = root.querySelector(selectors[i]);
        if (el && (el.tagName === 'TABLE' || el.querySelector('thead,tbody,tr'))) return el;
      }
      return null;
    }

    function _cpEscapeHtml(v) {
      return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function _cpNormalizeHeaderKey(v) {
      // Normalise to lowercase alphanumeric, then apply known aliases so that
      // CSV header names (e.g. "STORE NUMBER", "END USER") resolve to the same
      // key used in the named-field row objects produced by _cpLoad().
      var norm = String(v == null ? '' : v)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      // Alias map: CSV header normalised → row object field name
      var _aliases = {
        'storenumber': 'storeNumber',
        'storeno':     'storeNumber',
        'store':       'storeNumber',
        'enduser':     'endUser',
        'enduser2':    'endUser2',
        'urlconnectlink': 'url',
        'connectlink':    'url',
        'numberofcontrolsystems': 'systems',
        'controlsystems':         'systems',
        'stateprovinceregiont':   'state',
        'stateprovinceregion':    'state',
        'zippostalcode':          'zip',
        'timezone':               'timezone',
        'address1':               'address1',
      };
      return _aliases[norm] || norm;
    }

    // FIX-DYNAMIC: auto-discover headers from live CSV data — no hardcoded columns
    function _cpDiscoverHeaders(bodyTable, headTable) {
      var fromCpHeaders = Array.isArray(window.__cpHeaders)
        ? window.__cpHeaders.filter(function (h) { return typeof h === 'string' && h.trim(); })
        : [];
      if (fromCpHeaders.length) return fromCpHeaders;

      var rawRows = Array.isArray(window.__cpRawRows) ? window.__cpRawRows : [];
      var firstRaw = rawRows.length ? rawRows[0] : null;

      // ── Named-field objects from _cpLoad() ──────────────────────────────
      // Row objects use camelCase keys (site, directory, city, storeNumber…).
      // Map them back to the display-friendly header names used in the static
      // HTML <thead> so the patch renders the same 9-column layout.
      if (firstRaw && typeof firstRaw === 'object' && !Array.isArray(firstRaw)) {
        // Preferred: read header labels directly from the static head table
        var sourceTable = headTable || bodyTable;
        if (sourceTable) {
          var thCells = sourceTable.querySelectorAll('thead th');
          var domLabels = [];
          thCells.forEach(function (th) {
            var label = (th.getAttribute('data-col-key') || th.textContent || '').trim();
            // Skip the row-number "#" cell and empty cells
            if (label && label !== '#') domLabels.push(label);
          });
          if (domLabels.length) return domLabels;
        }
        // Fallback: use the object's own keys (camelCase) as headers
        var keys = Object.keys(firstRaw).filter(function (k) {
          // Exclude internal _search field
          return k && k !== '_search';
        });
        if (keys.length) return keys;
      }

      if (Array.isArray(firstRaw)) {
        var firstArrayHeaders = firstRaw.filter(function (h) { return typeof h === 'string' && h.trim(); });
        if (firstArrayHeaders.length) return firstArrayHeaders;
      }

      if (window.__cpHeaderMap && typeof window.__cpHeaderMap === 'object' && !Array.isArray(window.__cpHeaderMap)) {
        var mapKeys = Object.keys(window.__cpHeaderMap).filter(function (h) { return String(h).trim(); });
        if (mapKeys.length) return mapKeys;
      }

      var sourceTable2 = headTable || bodyTable;
      if (sourceTable2) {
        var domHeaders = [];
        var headerCells = sourceTable2.querySelectorAll('thead th[data-col-key]');
        headerCells.forEach(function (th) {
          var key = (th.getAttribute('data-col-key') || '').trim();
          if (key) domHeaders.push(key);
        });
        if (domHeaders.length) return domHeaders;
      }

      return [];
    }

    function _clearCpRewriteFlags(bodyTable, headTable) {
      if (bodyTable) {
        bodyTable.querySelectorAll('[data-cp-row-rewritten]').forEach(function (tr) {
          delete tr.dataset.cpRowRewritten;
        });
      }
      if (headTable) {
        headTable.querySelectorAll('thead tr[data-cp-header-rewritten]').forEach(function (tr) {
          delete tr.dataset.cpHeaderRewritten;
        });
      }
    }

    function _cpReadCurrentHeaderIndexMap(headTable) {
      var map = {};
      if (!headTable) return map;
      var headerRow = headTable.querySelector('thead tr');
      if (!headerRow) return map;
      var headerCells = headerRow.querySelectorAll('th,td');
      if (!headerCells.length) return map;
      var firstKey = (headerCells[0].getAttribute('data-col-key') || headerCells[0].textContent || '').trim();
      var firstNorm = _cpNormalizeHeaderKey(firstKey);
      var hasRowNumberCell = firstNorm === '' || firstNorm === '#' || firstNorm === 'no' || firstNorm === 'index';
      headerCells.forEach(function (cell, idx) {
        if (hasRowNumberCell && idx === 0) return;
        var key = (cell.getAttribute('data-col-key') || cell.textContent || '').trim();
        if (!key) return;
        var dataIdx = hasRowNumberCell ? (idx - 1) : idx;
        if (map[key] === undefined) map[key] = dataIdx;
        var normalized = _cpNormalizeHeaderKey(key);
        if (normalized && map[normalized] === undefined) map[normalized] = dataIdx;
      });
      return map;
    }

    function _cpBuildRawHeaderIndex(headers) {
      var map = {};
      headers.forEach(function (h, idx) {
        if (map[h] === undefined) map[h] = idx;
        var normalized = _cpNormalizeHeaderKey(h);
        if (normalized && map[normalized] === undefined) map[normalized] = idx;
      });
      return map;
    }

    function _cpBuildCsvColIndex(rawRows) {
      var map = {};
      if (!Array.isArray(rawRows) || !rawRows.length) return map;
      var firstRaw = rawRows[0];
      if (!Array.isArray(firstRaw)) return map;
      firstRaw.forEach(function (h, idx) {
        var key = String(h == null ? '' : h).trim();
        if (!key) return;
        if (map[key] === undefined) map[key] = idx;
        var normalized = _cpNormalizeHeaderKey(key);
        if (normalized && map[normalized] === undefined) map[normalized] = idx;
      });
      return map;
    }

    function _cpGetRawValue(rawRowObj, header) {
      if (!rawRowObj || typeof rawRowObj !== 'object') return '';
      if (Object.prototype.hasOwnProperty.call(rawRowObj, header)) {
        return String(rawRowObj[header] == null ? '' : rawRowObj[header]).trim();
      }
      var target = _cpNormalizeHeaderKey(header);
      if (!target) return '';
      var keys = Object.keys(rawRowObj);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (_cpNormalizeHeaderKey(key) === target) {
          return String(rawRowObj[key] == null ? '' : rawRowObj[key]).trim();
        }
      }
      return '';
    }

    function _cpGetRawRowObject(rowIndex, headers, rawHeaderIndex) {
      var rawRows = Array.isArray(window.__cpRawRows) ? window.__cpRawRows : [];
      if (!rawRows.length) return null;

      var firstRaw = rawRows[0];

      // ── Named-field objects (produced by _cpLoad after BUG-FIX) ──────────
      // _cpLoad() now stores rows as {site, directory, city, state, country,
      // timezone, storeNumber, endUser, systems, url, ...} objects. When
      // __cpRawRows contains these, _cpGetRawValue already handles them
      // correctly via property lookup + normalised-key fallback.
      if (firstRaw && typeof firstRaw === 'object' && !Array.isArray(firstRaw)) {
        var namedRow = rawRows[rowIndex];
        if (!namedRow) return null;
        return namedRow; // already a named-field object — return as-is
      }

      // ── Legacy: raw CSV array rows (first row = header row) ──────────────
      var csvColIndex = _cpBuildCsvColIndex(rawRows);
      var rawRow = rawRows[rowIndex];
      if (Array.isArray(firstRaw) && firstRaw.length && rawRows[rowIndex + 1]) {
        rawRow = rawRows[rowIndex + 1];
      }
      if (!rawRow) return null;

      if (rawRow && typeof rawRow === 'object' && !Array.isArray(rawRow)) return rawRow;

      if (Array.isArray(rawRow)) {
        var obj = {};
        headers.forEach(function (h) {
          var idx = csvColIndex[h];
          if (idx === undefined) idx = csvColIndex[_cpNormalizeHeaderKey(h)];
          if (idx === undefined) idx = rawHeaderIndex[h];
          if (idx === undefined) idx = rawHeaderIndex[_cpNormalizeHeaderKey(h)];
          obj[h] = idx === undefined ? '' : String(rawRow[idx] == null ? '' : rawRow[idx]);
        });
        return obj;
      }

      return null;
    }

    // FIX-URLDETECT: auto-detect URL cells and render as Open buttons
    function _cpBuildCellHtml(value) {
      var val = String(value == null ? '' : value).trim();
      if (!val) return '<td>—</td>';
      if (val.indexOf('http') === 0 || val.indexOf('//') === 0) {
        var safeHref = _cpEscapeHtml(val);
        return '<td><a href="' + safeHref + '" target="_blank" rel="noopener noreferrer"'
          + ' style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;'
          + 'background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.3);'
          + 'border-radius:5px;color:#22d3ee;font-size:10px;font-weight:700;'
          + 'text-decoration:none;white-space:nowrap;"'
          + ' onclick="event.stopPropagation();">'
          + '<i class="fas fa-external-link-alt" style="font-size:9px;"></i>Open</a></td>';
      }
      return '<td>' + _cpEscapeHtml(val) + '</td>';
    }

    function _cpRenderDynamic(bodyTable, headTable) {
      if (!bodyTable) return;
      var root = _getCpRoot();
      if (!root || !root.contains(bodyTable)) return;

      var headers = _cpDiscoverHeaders(bodyTable, headTable);
      if (!headers.length) return;

      var schemaFingerprint = JSON.stringify(headers);
      // FIX-SCHEMA-CHANGE: detect CSV schema change and force full re-render
      if (_lastCpHeaderFingerprint && _lastCpHeaderFingerprint !== schemaFingerprint) {
        _clearCpRewriteFlags(bodyTable, headTable);
      }
      _lastCpHeaderFingerprint = schemaFingerprint;

      var headerTarget = headTable || bodyTable;
      var currentHeaderMap = _cpReadCurrentHeaderIndexMap(headerTarget);
      var rawHeaderIndex = _cpBuildRawHeaderIndex(headers);

      if (headerTarget) {
        var thead = headerTarget.querySelector('thead');
        if (!thead) {
          try {
            thead = document.createElement('thead');
            headerTarget.insertBefore(thead, headerTarget.firstChild);
          } catch (_) {
            thead = null;
          }
        }

        if (thead) {
          var headerRow = thead.querySelector('tr');
          if (!headerRow) {
            try {
              headerRow = document.createElement('tr');
              thead.appendChild(headerRow);
            } catch (_) {
              headerRow = null;
            }
          }

          if (headerRow) {
            var headerHtml = '<th style="width:36px;text-align:center;">#</th>';
            headers.forEach(function (header) {
              var safeHeader = _cpEscapeHtml(header);
              headerHtml += '<th data-col-key="' + safeHeader + '">' + safeHeader + '</th>';
            });
            try {
              headerRow.innerHTML = headerHtml;
              // FIX-FLAGPOS: set rewritten flag only after innerHTML succeeds
              headerRow.dataset.cpHeaderRewritten = 'true';
            } catch (_) {}
          }
        }
      }

      var tbody = bodyTable.querySelector('tbody');
      if (!tbody) return;
      var rows = tbody.querySelectorAll('tr');
      if (!rows.length) return;

      rows.forEach(function (tr, idx) {
        var existingCells = tr.querySelectorAll('td');
        var cpIdxRaw = tr.getAttribute('data-cp-idx');
        var cpIdx = cpIdxRaw != null && cpIdxRaw !== '' ? Number(cpIdxRaw) : idx;
        if (!isFinite(cpIdx) || cpIdx < 0) cpIdx = idx;

        var rawRowObj = _cpGetRawRowObject(cpIdx, headers, rawHeaderIndex);
        var rowHtml = '<td style="text-align:center;color:rgba(255,255,255,.3);font-size:10px;">' + (cpIdx + 1) + '</td>';

        headers.forEach(function (header, headerIdx) {
          var fromDom = '';
          var cellIndex = currentHeaderMap[header];
          if (cellIndex === undefined) cellIndex = currentHeaderMap[_cpNormalizeHeaderKey(header)];
          if (cellIndex === undefined) cellIndex = headerIdx;
          var domCell = existingCells[cellIndex];
          if (domCell) fromDom = String(domCell.textContent || domCell.innerText || '').trim();

          var fromRaw = _cpGetRawValue(rawRowObj, header);

          var value = fromRaw || fromDom;
          rowHtml += _cpBuildCellHtml(value);
        });

        try {
          tr.innerHTML = rowHtml;
          // FIX-FLAGPOS: set rewritten flag only after innerHTML succeeds
          tr.dataset.cpRowRewritten = 'true';
        } catch (_) {}
      });
    }

    var _cpRenderInProgress = false;
    var _cpMutDebounce = null;
    function _queueCpRender() {
      if (_cpRenderInProgress) return;
      _cpRenderInProgress = true;
      try {
        var root = _getCpRoot();
        var bodyTable = _getCpTable(root);
        var headTable = _getCpHeadTable(root);
        if (!root || !bodyTable || !root.contains(bodyTable)) return;
        _clearCpRewriteFlags(bodyTable, headTable);
        _cpRenderDynamic(bodyTable, headTable);
      } finally {
        _cpRenderInProgress = false;
      }
    }

    function _watchCpTab() {
      var root = _getCpRoot();
      if (!root) {
        setTimeout(_watchCpTab, 800);
        return;
      }
      if (root.dataset.cpPatchAttached) return;
      root.dataset.cpPatchAttached = 'true';

      _queueCpRender();

      var obs = new MutationObserver(function () {
        clearTimeout(_cpMutDebounce);
        _cpMutDebounce = setTimeout(_queueCpRender, 120);
      });
      try {
        obs.observe(root, { childList: true, subtree: true });
      } catch (_) {}
    }

    function _interceptCpRows() {
      var _raw = window.__cpRawRows;
      var _headers = window.__cpHeaders;

      try {
        Object.defineProperty(window, '__cpRawRows', {
          configurable: true,
          get: function () { return _raw; },
          set: function (v) {
            _raw = v;
            setTimeout(_queueCpRender, 100);
          }
        });
      } catch (_) {}

      try {
        Object.defineProperty(window, '__cpHeaders', {
          configurable: true,
          get: function () { return _headers; },
          set: function (v) {
            _headers = v;
            setTimeout(_queueCpRender, 100);
          }
        });
      } catch (_) {}
    }

    _interceptCpRows();
    _watchCpTab();
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────
  function boot() {
    defineQbsOpenDeepResult();
    patchDeepSearch();
    patchQbRowClick();
    patchDeepSearchActionBtn();
    patchBannerDismissal();
    patchDeepSearchCards();
    patchConnectPlusColumns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
