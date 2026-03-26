// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms) — no button click needed.
//   2. Row number click: opens Case Detail View via root._qbcdOpen
//   3. Deep search result card click: opens Case Detail View via data-action buttons
//      AND via window._qbsOpenDeepResult for inline onclick handlers.

(function () {
  'use strict';

  // ── HELPER: resolve the open function at call-time ──────────────────────────
  // root._qbcdOpen is set by my_quickbase.js AFTER renderRecords() runs.
  // We MUST look it up at click-time, not at boot.
  function _callCdOpen(snap) {
    // 1. Primary: window.__studioQbCdOpen (exposed by support_studio.html)
    if (typeof window.__studioQbCdOpen === 'function') {
      window.__studioQbCdOpen(snap);
      return true;
    }

    // 2. Find root element with _qbcdOpen (set by my_quickbase.js)
    var rootEl = document.querySelector('[data-page="quickbase_s"]');
    if (rootEl && typeof rootEl._qbcdOpen === 'function') {
      rootEl._qbcdOpen(snap, [snap]);
      return true;
    }

    // 3. Traverse known container IDs
    var roots = ['qbPageShell', 'qbs-root', 'qbDataBody'];
    for (var i = 0; i < roots.length; i++) {
      var el = document.getElementById(roots[i]);
      if (el && typeof el._qbcdOpen === 'function') {
        el._qbcdOpen(snap, [snap]);
        return true;
      }
      // Walk up DOM tree to find element with _qbcdOpen
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

    // 4. Fallback: window.MQ.openCaseDetailModal
    if (window.MQ && typeof window.MQ.openCaseDetailModal === 'function') {
      window.MQ.openCaseDetailModal({
        qbRecordId: snap.recordId || '',
        fields: snap.fields || {}
      });
      return true;
    }

    console.warn('[SupportStudioPatch] _callCdOpen: no opener found for snap', snap);
    return false;
  }

  // ── HELPER: Continuously poll to expose __studioQbCdOpen ───────────────────
  // This solves the timing issue where root._qbcdOpen isn't set until after
  // data loads. We poll until we find it and expose it globally.
  function pollAndExposeOpener() {
    if (typeof window.__studioQbCdOpen === 'function') return; // already set

    var rootEl = document.querySelector('[data-page="quickbase_s"]');
    if (rootEl && typeof rootEl._qbcdOpen === 'function') {
      window.__studioQbCdOpen = function (snap) {
        var host = rootEl.querySelector('#qbDataBody');
        var snaps = host && Array.isArray(host._qbRowSnaps) ? host._qbRowSnaps : [snap];
        return rootEl._qbcdOpen(snap, snaps);
      };
      console.log('[SupportStudioPatch] __studioQbCdOpen exposed from root._qbcdOpen');
      return;
    }

    // Keep polling every 2 seconds for up to 30 seconds
    if (!pollAndExposeOpener._attempts) pollAndExposeOpener._attempts = 0;
    pollAndExposeOpener._attempts++;
    if (pollAndExposeOpener._attempts < 15) {
      setTimeout(pollAndExposeOpener, 2000);
    }
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

  // ── PATCH 2: QB Records row number badge click ──────────────────────────────
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

  // ── PATCH 3: window._qbsOpenDeepResult ─────────────────────────────────────
  // ROOT CAUSE FIX:
  // The _qbsDeepSearch render loop may emit cards with:
  //   onclick="window._qbsOpenDeepResult('<caseNum>')"
  // This function was NEVER DEFINED in the original code — so every card click
  // threw a silent ReferenceError and nothing happened.
  function defineQbsOpenDeepResult() {
    if (typeof window._qbsOpenDeepResult === 'function') return;

    window._qbsOpenDeepResult = function (caseNum) {
      if (!caseNum || String(caseNum) === '—') return;
      var rid = String(caseNum);

      var snap = {
        rowNum: 0,
        recordId: rid,
        fields: {},
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
            r['Case #'] ||
            r['3'] ||
            r.id || ''
          );
          if (id === rid) { found = r; break; }
        }
        if (found) {
          snap.fields = found.fields || found;
          snap.rowNum = found.rowNum || 0;
          snap.recordId = String(found.qbRecordId || rid);
          snap.columnMap = found.columnMap || {};
          break;
        }
      }

      _callCdOpen(snap);
    };

    console.log('[SupportStudioPatch] window._qbsOpenDeepResult defined.');
  }

  // ── PATCH 4: Deep search "CASE VIEW DETAILS" button click (data-action) ────
  // Catches clicks on [data-action="ds-case-view-details"] buttons that might
  // not be handled by the inline support_studio.html handler (timing/scope issues).
  function patchDeepSearchCaseViewDetailsBtn() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest &&
        e.target.closest('[data-action="ds-case-view-details"]');
      if (!btn) return;

      // If the native handler already opened the modal, don't double-fire
      var modal = document.getElementById('qbCaseDetailModal');
      if (modal && (modal.classList.contains('open') || modal.style.display === 'flex')) return;

      e.preventDefault();
      e.stopPropagation();

      var rid = btn.getAttribute('data-rid') || '';
      var rowData = {};
      try {
        rowData = JSON.parse(btn.getAttribute('data-row') || '{}');
      } catch (_) {}

      if (!rid && rowData.qbRecordId) rid = String(rowData.qbRecordId);
      if (!rid) return;

      var snap = {
        rowNum: 0,
        recordId: rid,
        fields: rowData.fields || rowData || {},
        columnMap: {}
      };

      // Enrich from caches
      var sources = [window.__studioQbDeepRecords, window.__studioQbRecords];
      for (var s = 0; s < sources.length; s++) {
        if (!Array.isArray(sources[s])) continue;
        for (var i = 0; i < sources[s].length; i++) {
          var r = sources[s][i];
          if (!r) continue;
          var id = String(r.qbRecordId || r['Case #'] || r['3'] || r.id || '');
          if (id === rid) {
            snap.fields = r.fields || r;
            snap.rowNum = r.rowNum || 0;
            snap.recordId = String(r.qbRecordId || rid);
            snap.columnMap = r.columnMap || {};
            break;
          }
        }
        if (snap.fields !== rowData) break;
      }

      // Small delay to let any native handler attempt first
      setTimeout(function () {
        var m = document.getElementById('qbCaseDetailModal');
        if (m && (m.classList.contains('open') || m.style.display === 'flex')) return;
        _callCdOpen(snap);
      }, 50);
    }, true); // capture phase — runs before bubble

    console.log('[SupportStudioPatch] Deep search CASE VIEW DETAILS fallback applied.');
  }

  // ── BOOT ──────────────────────────────────────────────────────────────────────
  function boot() {
    defineQbsOpenDeepResult();       // PATCH 3 first — must exist before any search
    patchDeepSearch();               // PATCH 1
    patchQbRowClick();               // PATCH 2
    patchDeepSearchCaseViewDetailsBtn(); // PATCH 4
    pollAndExposeOpener();           // Continuously try to expose __studioQbCdOpen
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
