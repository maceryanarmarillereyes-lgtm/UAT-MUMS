// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms).
//   2. QB row number click: opens Case Detail View.
//   3. Deep search card click: defines _qbsOpenDeepResult + [data-action] fallback.

(function () {
  'use strict';

  // ── HELPER: open Case Detail modal with a snap object ───────────────────────
  // Tries every available opener in priority order.
  // Key insight: _open(snap, snaps) in my_quickbase.js renders the modal directly
  // from the snap object — it does NOT need the snap to be in _qbRowSnaps.
  // So window.__studioQbCdOpen (which calls root._qbcdOpen = _open) is the right path.
  // window.MQ.openCaseDetailModal is wrong for deep search because it requires
  // the record to already be in _qbRowSnaps (QB table page).
  function _callCdOpen(snap) {
    // 1. Primary: window.__studioQbCdOpen → root._qbcdOpen → _open(snap, snaps)
    //    This works even if the record is NOT in the QB table — snap has the fields.
    if (typeof window.__studioQbCdOpen === 'function') {
      window.__studioQbCdOpen(snap);
      return true;
    }

    // 2. Find root with _qbcdOpen by data-page attribute (set by support_studio.html)
    var rootEl = document.querySelector('[data-page="quickbase_s"]');
    if (rootEl && typeof rootEl._qbcdOpen === 'function') {
      rootEl._qbcdOpen(snap, [snap]);
      return true;
    }

    // 3. Walk known container IDs and their ancestors
    var ids = ['qbPageShell', 'qbs-root', 'qbDataBody'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && typeof el._qbcdOpen === 'function') {
        el._qbcdOpen(snap, [snap]);
        return true;
      }
      if (el) {
        var p = el;
        while (p && p !== document.body) {
          if (typeof p._qbcdOpen === 'function') { p._qbcdOpen(snap, [snap]); return true; }
          p = p.parentElement;
        }
      }
    }

    // 4. Last resort: MQ (NOTE: only works if record is in QB table page)
    if (window.MQ && typeof window.MQ.openCaseDetailModal === 'function') {
      window.MQ.openCaseDetailModal({ qbRecordId: snap.recordId || '', fields: snap.fields || {} });
      return true;
    }

    console.warn('[SupportStudioPatch] _callCdOpen: no opener found', snap);
    return false;
  }

  // ── HELPER: build a snap from record data ────────────────────────────────────
  function _buildSnap(rid, fields, columnMap, rowNum) {
    return {
      rowNum: rowNum || 0,
      recordId: String(rid || ''),
      fields: fields || {},
      columnMap: columnMap || {}
    };
  }

  // ── HELPER: find a record in caches by record ID ─────────────────────────────
  function _findInCache(rid) {
    var sources = [window.__studioQbDeepRecords, window.__studioQbRecords];
    for (var s = 0; s < sources.length; s++) {
      if (!Array.isArray(sources[s])) continue;
      for (var i = 0; i < sources[s].length; i++) {
        var r = sources[s][i];
        if (!r) continue;
        var id = String(r.qbRecordId || r['Case #'] || r['3'] || r.id || '');
        if (id === String(rid)) return r;
      }
    }
    return null;
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
        var btn = document.getElementById('qbs-search-btn');
        if (btn) btn.click();
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
      var rowIndex = parseInt(badge.getAttribute('data-qb-snap-idx') || '', 10);
      if (isNaN(rowIndex)) return;
      var snap = bodyEl._qbRowSnaps && bodyEl._qbRowSnaps[rowIndex];
      if (!snap) return;
      _callCdOpen(snap);
    }, false);

    console.log('[SupportStudioPatch] QB row click safety-net patch applied.');
  }

  // ── PATCH 3: window._qbsOpenDeepResult ──────────────────────────────────────
  // Called by deep search cards: onclick="window._qbsOpenDeepResult('<caseNum>')"
  function defineQbsOpenDeepResult() {
    if (typeof window._qbsOpenDeepResult === 'function') return;

    window._qbsOpenDeepResult = function (caseNum) {
      if (!caseNum || String(caseNum) === '—') return;
      var rid = String(caseNum);
      var cached = _findInCache(rid);
      var snap = _buildSnap(
        cached ? (cached.qbRecordId || rid) : rid,
        cached ? (cached.fields || cached) : {},
        cached ? (cached.columnMap || {}) : {},
        cached ? (cached.rowNum || 0) : 0
      );
      _callCdOpen(snap);
    };

    console.log('[SupportStudioPatch] window._qbsOpenDeepResult defined.');
  }

  // ── PATCH 4: [data-action="ds-case-view-details"] fallback ──────────────────
  // Catches clicks on CASE VIEW DETAILS buttons from the deep search result cards.
  // The primary handler is in support_studio.html (_qbsEnsureDeepSearchCaseDetailBinding),
  // but it uses window.MQ.openCaseDetailModal which fails if the record isn't in
  // the QB table snaps. This fallback fires ONLY if the modal didn't open.
  function patchDeepSearchActionBtn() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest &&
        e.target.closest('[data-action="ds-case-view-details"]');
      if (!btn) return;

      // Defer slightly — let the native handler in support_studio.html try first
      setTimeout(function () {
        var modal = document.getElementById('qbCaseDetailModal');
        if (modal && (modal.classList.contains('open') ||
            modal.style.display === 'flex' || modal.style.display === 'block')) {
          return; // Native handler succeeded — do nothing
        }

        // Native handler failed — use our path
        var rid = btn.getAttribute('data-rid') || '';
        var rowData = {};
        try { rowData = JSON.parse(btn.getAttribute('data-row') || '{}'); } catch (_) {}
        if (!rid) rid = String(rowData.qbRecordId || rowData.recordId || '');
        if (!rid) return;

        var cached = _findInCache(rid);
        var snap = _buildSnap(
          rid,
          cached ? (cached.fields || cached) : (rowData.fields || rowData),
          cached ? (cached.columnMap || {}) : {},
          cached ? (cached.rowNum || 0) : 0
        );
        _callCdOpen(snap);
      }, 80);
    }, false);

    console.log('[SupportStudioPatch] ds-case-view-details fallback patch applied.');
  }

  // ── BOOT ─────────────────────────────────────────────────────────────────────
  function boot() {
    defineQbsOpenDeepResult(); // must be first — cards may render immediately
    patchDeepSearch();
    patchQbRowClick();
    patchDeepSearchActionBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
