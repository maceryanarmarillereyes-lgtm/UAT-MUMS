// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms) — no button click needed.
//   2. Row number click: opens Case Detail View via window.__studioQbCdOpen
//   3. Deep search result card click: defines window._qbsOpenDeepResult (called by
//      the inline onclick in _qbsDeepSearch render loop) and opens Case Detail View.

(function () {
  'use strict';

  // ── HELPER: resolve the open function at call-time (not at patch-time) ──────
  function _callCdOpen(snap) {
    if (typeof window.__studioQbCdOpen === 'function') {
      window.__studioQbCdOpen(snap);
      return true;
    }
    var roots = ['qbPageShell', 'qbs-root', 'qbDataBody'];
    for (var i = 0; i < roots.length; i++) {
      var el = document.getElementById(roots[i]);
      if (el && typeof el._qbcdOpen === 'function') {
        el._qbcdOpen(snap, [snap]);
        return true;
      }
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
    // Fallback: window.MQ exposed by my_quickbase.js
    if (window.MQ && typeof window.MQ.openCaseDetail === 'function') {
      window.MQ.openCaseDetail(snap);
      return true;
    }
    console.warn('[SupportStudioPatch] _callCdOpen: no opener found for snap', snap);
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
  function patchQbRowClick() {
    var bodyEl = document.getElementById('qbDataBody');
    if (!bodyEl) { setTimeout(patchQbRowClick, 800); return; }
    if (bodyEl.dataset.rowClickPatched) return;
    bodyEl.dataset.rowClickPatched = 'true';

    bodyEl.addEventListener('click', function (e) {
      var badge = e.target && e.target.closest && e.target.closest('.qb-row-detail-btn');
      if (!badge) return;

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

  // ── PATCH 3: window._qbsOpenDeepResult ───────────────────────────────────────
  // ROOT CAUSE FIX:
  // The _qbsDeepSearch render loop emits cards with:
  //   onclick="window._qbsOpenDeepResult('<caseNum>')"
  // But window._qbsOpenDeepResult was NEVER DEFINED — so every card click
  // threw a silent ReferenceError and nothing happened.
  function defineQbsOpenDeepResult() {
    if (typeof window._qbsOpenDeepResult === 'function') return;

    window._qbsOpenDeepResult = function (caseNum) {
      if (!caseNum || String(caseNum) === '—') return;
      var rid = String(caseNum);

      var snap = {
        rowNum:    0,
        recordId:  rid,
        fields:    {},
        columnMap: {}
      };

      // Search: deep-search result cache first, then full QB dataset
      var sources = [
        window.__studioQbDeepRecords,
        window.__studioQbRecords
      ];

      for (var s = 0; s < sources.length; s++) {
        if (!Array.isArray(sources[s])) continue;
        var found = null;
        for (var i = 0; i < sources[s].length; i++) {
          var r = sources[s][i];
          if (!r) continue;
          var id = String(
            r.qbRecordId ||
            r['Case #']  ||
            r['3']       ||
            r.id         || ''
          );
          if (id === rid) { found = r; break; }
        }
        if (found) {
          snap.fields    = found.fields    || found;
          snap.rowNum    = found.rowNum    || 0;
          snap.recordId  = String(found.qbRecordId || rid);
          snap.columnMap = found.columnMap || {};
          break;
        }
      }

      _callCdOpen(snap);
    };

    console.log('[SupportStudioPatch] window._qbsOpenDeepResult defined.');
  }

  // ── BOOT ────────────────────────────────────────────────────────────────────
  function boot() {
    defineQbsOpenDeepResult(); // PATCH 3 first — must exist before any search
    patchDeepSearch();
    patchQbRowClick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
