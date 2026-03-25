// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms) — no button click needed.
//   2. Row number click: opens Case Detail View via window.__studioQbCdOpen
//   3. Deep search result card click: opens Case Detail View

(function () {
  'use strict';

  // ── HELPER: resolve the open function at call-time (not at patch-time) ──────
  // root._qbcdOpen is set by my_quickbase.js AFTER renderRecords() runs.
  // We cannot capture it at boot — we must look it up at click-time.
  function _callCdOpen(snap) {
    // Primary: direct root reference exposed by support_studio.html init
    if (typeof window.__studioQbCdOpen === 'function') {
      window.__studioQbCdOpen(snap);
      return true;
    }
    // Fallback: find the qbs root element and check its _qbcdOpen
    var roots = ['qbPageShell', 'qbs-root', 'qbDataBody'];
    for (var i = 0; i < roots.length; i++) {
      var el = document.getElementById(roots[i]);
      if (el && typeof el._qbcdOpen === 'function') {
        el._qbcdOpen(snap, [snap]);
        return true;
      }
      // Walk up to find the root with _qbcdOpen
      if (el) {
        var parent = el;
        while (parent && parent !== document.body) {
          if (typeof parent._qbcdOpen === 'function') {
            parent._qbcdOpen(snap, [snap]);
            return true;
          }
          parent = parent.parentElement;
        }
      }
    }
    return false;
  }

  // ── PATCH 1: Deep search auto-input ─────────────────────────────────────────
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
        if (typeof window._qbsDeepSearch === 'function') {
          window._qbsDeepSearch(val, 0);
          return;
        }
        var searchBtn = document.getElementById('qbs-search-btn');
        if (searchBtn) searchBtn.click();
      }, 500);
    });
    console.log('[SupportStudioPatch] Deep search auto-input patch applied.');
  }

  // ── PATCH 2: QB Records row number badge click ───────────────────────────────
  // Strategy: delegate on #qbDataBody (rendered by my_quickbase.js renderRecords).
  // The button already has data-qb-snap-idx and host._qbRowSnaps is set.
  // We catch clicks that slip through (e.g. if root._qbcdOpen wasn't set at render time).
  function patchQbRowClick() {
    var bodyEl = document.getElementById('qbDataBody');
    if (!bodyEl) { setTimeout(patchQbRowClick, 800); return; }
    if (bodyEl.dataset.rowClickPatched) return;
    bodyEl.dataset.rowClickPatched = 'true';

    bodyEl.addEventListener('click', function (e) {
      var badge = e.target && e.target.closest && e.target.closest('.qb-row-detail-btn');
      if (!badge) return;

      // If root._qbcdOpen already handled it (stopPropagation), this won't fire.
      // This is a safety net for when root._qbcdOpen wasn't bound at render time.
      var rawIdx = badge.getAttribute('data-qb-snap-idx');
      var rowIndex = parseInt(String(rawIdx || ''), 10);
      if (isNaN(rowIndex)) return;

      var snaps = bodyEl._qbRowSnaps;
      var snap = snaps && snaps[rowIndex] ? snaps[rowIndex] : null;
      if (!snap) return;

      _callCdOpen(snap);
    }, false);

    console.log('[SupportStudioPatch] QB row click safety-net patch applied.');
  }

  // ── PATCH 3: Deep search result card click ───────────────────────────────────
  // The deep search results are rendered in a sidebar panel.
  // We delegate on the sidebar container and intercept card clicks.
  function patchDeepSearchCardClick() {
    // Try multiple possible container IDs used by the deep search sidebar
    var containerIds = ['qbs-sidebar', 'qbs-deep-search-results', 'qbs-search-panel',
                        'qbsSidebar', 'deepSearchResults', 'qbs-left-panel'];
    var container = null;
    for (var i = 0; i < containerIds.length; i++) {
      container = document.getElementById(containerIds[i]);
      if (container) break;
    }

    // Fallback: find by data attribute or class
    if (!container) {
      container = document.querySelector('[data-panel="deep-search"]') ||
                  document.querySelector('.qbs-sidebar') ||
                  document.querySelector('.deep-search-panel') ||
                  document.querySelector('.qbs-search-results');
    }

    if (!container) {
      setTimeout(patchDeepSearchCardClick, 1000);
      return;
    }

    if (container.dataset.cardClickPatched) return;
    container.dataset.cardClickPatched = 'true';

    container.addEventListener('click', function (e) {
      // Find the result card
      var card = e.target && e.target.closest &&
        (e.target.closest('.deep-search-result-card') ||
         e.target.closest('.qbs-result-card') ||
         e.target.closest('[data-case]') ||
         e.target.closest('[data-record-id]'));
      if (!card) return;

      var caseNum = card.getAttribute('data-case') ||
                    card.getAttribute('data-record-id') ||
                    card.getAttribute('data-case-number') ||
                    card.getAttribute('data-rid');
      if (!caseNum) return;

      // Build a minimal snap object for the modal
      var snap = {
        rowNum: 0,
        recordId: String(caseNum),
        fields: {},
        columnMap: {}
      };

      // Try to get full field data from window.__studioQbRecords
      if (Array.isArray(window.__studioQbRecords)) {
        var found = window.__studioQbRecords.find(function (r) {
          return String(r && (r.qbRecordId || r['Case #'] || r.id || r['3'] || '')) === String(caseNum);
        });
        if (found) {
          snap.fields = found.fields || found;
          snap.recordId = String(found.qbRecordId || caseNum);
        }
      }

      _callCdOpen(snap);
    }, false);

    console.log('[SupportStudioPatch] Deep search card click patch applied.');
  }

  function boot() {
    patchDeepSearch();
    patchQbRowClick();
    patchDeepSearchCardClick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
