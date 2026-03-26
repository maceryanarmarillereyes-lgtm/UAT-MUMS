// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms).
//   2. QB row number click: opens Case Detail View.
//   3. Deep search card click: _qbsOpenDeepResult + [data-action] fallback.

(function () {
  'use strict';

  // ── HELPER: open Case Detail modal ──────────────────────────────────────────
  function _callCdOpen(snap) {
    // 1. window.__studioQbCdOpen → root._qbcdOpen → _open() — the real renderer
    //    Works even if the record is NOT in the QB table page.
    if (typeof window.__studioQbCdOpen === 'function') {
      window.__studioQbCdOpen(snap);
      return true;
    }
    // 2. Find root with data-page="quickbase_s" (set by support_studio.html init)
    var rootEl = document.querySelector('[data-page="quickbase_s"]');
    if (rootEl && typeof rootEl._qbcdOpen === 'function') {
      rootEl._qbcdOpen(snap, [snap]);
      return true;
    }
    // 3. Walk known container IDs
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
    // 4. MQ fallback (NOTE: requires record to be in QB table snaps)
    if (window.MQ && typeof window.MQ.openCaseDetailModal === 'function') {
      window.MQ.openCaseDetailModal({ qbRecordId: snap.recordId || '', fields: snap.fields || {} });
      return true;
    }
    console.warn('[SupportStudioPatch] _callCdOpen: no opener found', snap);
    return false;
  }

  // ── HELPER: look up a record by ID in caches ────────────────────────────────
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
        if (typeof window._qbsDeepSearch === 'function') { window._qbsDeepSearch(val, 0); return; }
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
  // Called by deep search card inline onclick handlers.
  function defineQbsOpenDeepResult() {
    if (typeof window._qbsOpenDeepResult === 'function') return;
    window._qbsOpenDeepResult = function (caseNum) {
      if (!caseNum || String(caseNum) === '—') return;
      var rid = String(caseNum);
      var cached = _findInCache(rid);
      var snap = {
        rowNum: cached ? (cached.rowNum || 0) : 0,
        recordId: cached ? String(cached.qbRecordId || rid) : rid,
        fields: cached ? (cached.fields || cached) : {},
        columnMap: cached ? (cached.columnMap || {}) : {}
      };
      _callCdOpen(snap);
    };
    console.log('[SupportStudioPatch] window._qbsOpenDeepResult defined.');
  }

  // ── PATCH 4: [data-action="ds-case-view-details"] fallback ──────────────────
  // Native handler in support_studio.html uses MQ.openCaseDetailModal which
  // requires the record to exist in QB table snaps. This fallback fires after
  // 80ms if the modal still hasn't opened.
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
        var cached = _findInCache(rid);
        var snap = {
          rowNum: cached ? (cached.rowNum || 0) : 0,
          recordId: rid,
          fields: cached ? (cached.fields || cached) : (rowData.fields || rowData),
          columnMap: cached ? (cached.columnMap || {}) : {}
        };
        _callCdOpen(snap);
      }, 80);
    }, false);
    console.log('[SupportStudioPatch] ds-case-view-details fallback patch applied.');
  }

  // ── BOOT ─────────────────────────────────────────────────────────────────────
  function boot() {
    defineQbsOpenDeepResult();
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
