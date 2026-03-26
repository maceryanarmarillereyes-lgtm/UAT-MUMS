// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms).
//   2. QB row number click: opens Case Detail View.
//   3. Deep search card click: _qbsOpenDeepResult + [data-action] fallback.
//   4. Banner dismissal memory: banner stays hidden after dismiss (sessionStorage).
//   5. Deep search card: remove Case View Details button + improve Assigned To.
//
// v2.0 FIX — Deep search result card opens CORRECT Case# in Case Detail View.
//   ROOT CAUSE: _findInCache() was doing an O(n) scan against the wrong cache
//   array (window.__studioQbDeepRecords), which often didn't contain the clicked
//   record → cached = null → snap.fields = {} → modal fell back to a wrong row.
//
//   PERMANENT FIX:
//     a) patchDeepSearchCards() now stamps every rendered card with
//        data-record-id AND data-snap-json (full serialised snap) right after
//        the card is painted in the DOM.
//     b) _qbsOpenDeepResult() now reads the snap DIRECTLY from the card DOM
//        (data-snap-json) — zero cache dependency.
//     c) __studioQbDeepMap: an O(1) Map built whenever __studioQbDeepRecords
//        is written, used as a fast fallback when data-snap-json is absent.
//     d) A delegated click handler on #qbs-search-results intercepts all card
//        clicks and opens the correct snap, covering every render path.

(function () {
  'use strict';

  // ── DEEP RECORD MAP — O(1) lookup by recordId ────────────────────────────
  // Rebuilt every time window.__studioQbDeepRecords is populated by the main
  // search function. Keyed by String(recordId).
  window.__studioQbDeepMap = window.__studioQbDeepMap || {};

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
        }
      });
    } catch (_) {}
  })();

  // ── HELPER: build a snap object from a raw QB record ────────────────────
  function _snapFromRecord(r, rid) {
    if (!r) return { rowNum: 0, recordId: String(rid), fields: {}, columnMap: {} };
    return {
      rowNum:    Number(r.rowNum || 0),
      recordId:  String(r.qbRecordId || r.recordId || rid),
      fields:    r.fields && typeof r.fields === 'object' ? r.fields : r,
      columnMap: r.columnMap && typeof r.columnMap === 'object' ? r.columnMap : {}
    };
  }

  // ── HELPER: find record in any available cache — Map-first, then array ──
  function _findInCache(rid) {
    var key = String(rid);

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
    console.warn('[SupportStudioPatch] _callCdOpen: no opener found', snap);
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
  // FIX v2.0: reads snap from card DOM (data-snap-json) first — no cache needed.
  // Falls back to Map lookup, then array scan, then bare recordId-only snap.
  function defineQbsOpenDeepResult() {
    // Always redefine to ensure v2.0 logic is active (overwrite any stale v1).
    window._qbsOpenDeepResult = function (caseNum, cardEl) {
      if (!caseNum || String(caseNum) === '—') return;
      var rid = String(caseNum);

      // Path A: card element passed directly → read data-snap-json (most reliable)
      if (cardEl && cardEl.getAttribute) {
        var rawSnap = cardEl.getAttribute('data-snap-json');
        if (rawSnap) {
          try {
            var parsed = JSON.parse(rawSnap);
            if (parsed && parsed.recordId) {
              _callCdOpen(parsed);
              return;
            }
          } catch (_) {}
        }
        // Fallback: read data-record-id from the card itself
        var cardRid = cardEl.getAttribute('data-record-id') || rid;
        rid = String(cardRid);
      }

      // Path B: Map / array cache lookup
      var cached = _findInCache(rid);
      var snap = _snapFromRecord(cached, rid);
      _callCdOpen(snap);
    };
    console.log('[SupportStudioPatch] window._qbsOpenDeepResult v2.0 defined.');
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

        // v2.0: check for data-snap-json on the button or its parent card first
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

  // ── PATCH 6: Deep search cards — stamp data-snap-json + delegated click ──
  // v2.0 CORE FIX:
  //   After every card is painted, we stamp two data attributes:
  //     data-record-id  = the exact Case# / recordId of this card
  //     data-snap-json  = full serialised snap object (fields + columnMap)
  //   A single delegated click listener on #qbs-search-results then reads
  //   data-snap-json and passes it directly to _callCdOpen — 100% accurate,
  //   no array index, no cache lookup, no wrong-row regression possible.
  function patchDeepSearchCards() {

    // ── Stamp data-snap-json on a single card element ──────────────────────
    function stampCard(card) {
      // Avoid double-stamping
      if (card.dataset.snapStamped) return;

      // --- Resolve the record ID from the card DOM ---
      // Try: data-record-id, data-case-num, data-rid, data-id, #qbs-case-num text, .qbs-case-num
      var rid = card.getAttribute('data-record-id')
             || card.getAttribute('data-case-num')
             || card.getAttribute('data-rid')
             || card.getAttribute('data-id')
             || '';

      if (!rid) {
        // Scan for a child element that looks like a Case # display
        var numEl = card.querySelector('[data-case-num], [data-record-id], .qbs-case-num, .ds-case-num, .qb-case-id');
        if (numEl) {
          rid = numEl.getAttribute('data-case-num')
             || numEl.getAttribute('data-record-id')
             || numEl.textContent.trim().replace(/[^0-9]/g, '');
        }
      }

      if (!rid) {
        // Last resort: look for any text that looks like a pure numeric case number
        var allText = card.textContent || '';
        var numMatch = allText.match(/\b(\d{5,8})\b/);
        if (numMatch) rid = numMatch[1];
      }

      if (!rid) return; // Cannot determine record ID — skip

      rid = String(rid);
      card.setAttribute('data-record-id', rid);

      // --- Build the snap from cache if available ---
      var cached = _findInCache(rid);
      var snap = _snapFromRecord(cached, rid);

      // Serialise and stamp
      try {
        card.setAttribute('data-snap-json', JSON.stringify(snap));
      } catch (_) {}
      card.dataset.snapStamped = 'true';
    }

    // ── Process all cards in a container ──────────────────────────────────
    function processCards(container) {
      // Stamp all recognisable card elements
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
    // This is the KEY fix: instead of relying on onclick="" inline handlers
    // (which call _qbsOpenDeepResult with only the Case# string — no card ref),
    // we intercept every click on the results container, find the nearest card,
    // read data-snap-json, and open the modal with the EXACT correct snap.
    function attachDelegatedClick(container) {
      if (container.dataset.delegatedClickAttached) return;
      container.dataset.delegatedClickAttached = 'true';

      container.addEventListener('click', function (e) {
        // Find the nearest stamped card ancestor of the click target
        var card = e.target && e.target.closest && e.target.closest('[data-snap-json]');
        if (!card) {
          // Try un-stamped card — attempt to stamp it now and retry
          var rawCard = e.target && e.target.closest && e.target.closest(
            '.qbs-result-card, .ds-result-card, .qbs-deep-card, [data-case-num], [data-record-id]'
          );
          if (rawCard) { stampCard(rawCard); card = rawCard; }
        }
        if (!card) return;

        // Don't steal clicks from buttons that have their own specific action
        var clickedBtn = e.target && e.target.closest && e.target.closest('button, a');
        if (clickedBtn) {
          var action = clickedBtn.getAttribute('data-action') || '';
          // Only block if it's a non-case-detail action button
          if (action && action !== 'ds-case-view-details' && action !== 'case-view-details') return;
        }

        // Read the snap directly from the card
        var rawSnap = card.getAttribute('data-snap-json');
        if (rawSnap) {
          try {
            var snap = JSON.parse(rawSnap);
            if (snap && snap.recordId) {
              e.stopPropagation();
              _callCdOpen(snap);
              return;
            }
          } catch (_) {}
        }

        // Fallback: use recordId only
        var rid = card.getAttribute('data-record-id') || '';
        if (!rid) return;
        e.stopPropagation();
        var cached = _findInCache(rid);
        _callCdOpen(_snapFromRecord(cached, rid));
      }, true); // capture phase — fires before inline onclick handlers

      console.log('[SupportStudioPatch] Delegated click handler attached to results container.');
    }

    // ── Watch #qbs-search-results for card renders ────────────────────────
    function watchResults() {
      var container = document.getElementById('qbs-search-results');
      if (!container) { setTimeout(watchResults, 800); return; }
      if (container.dataset.cardPatchApplied) return;
      container.dataset.cardPatchApplied = 'true';

      // Stamp cards already in DOM
      processCards(container);
      // Attach delegated click
      attachDelegatedClick(container);

      // Watch for future renders (each search clears + repaints the container)
      var obs = new MutationObserver(function (mutations) {
        // Re-stamp any new cards that were added
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            // The added node itself might be a card
            if (node.matches && node.matches(
              '.qbs-result-card, .ds-result-card, .qbs-deep-card, [data-case-num], [data-record-id]'
            )) {
              stampCard(node);
            }
            // Or it might contain cards
            processCards(node.querySelectorAll ? node : container);
          });
        });
        // Also re-stamp the whole container in case of full innerHTML replacement
        processCards(container);
      });
      obs.observe(container, { childList: true, subtree: true });
      console.log('[SupportStudioPatch] Deep search card patch v2.0 observer active.');
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
