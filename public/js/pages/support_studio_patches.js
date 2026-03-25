// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms) — no button click needed.
//   2. Row number click: opens Case Detail View in QuickBase_S tab.

(function () {
  'use strict';

  function patchDeepSearch() {
    const inputEl = document.getElementById('qbs-search-input');
    if (!inputEl) {
      setTimeout(patchDeepSearch, 800);
      return;
    }

    if (inputEl.dataset.autoSearchPatched) return;
    inputEl.dataset.autoSearchPatched = 'true';

    let debounceTimer = null;

    inputEl.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      const val = String(this.value || '').trim();

      debounceTimer = setTimeout(function () {
        if (typeof window._qbsDeepSearch === 'function') {
          window._qbsDeepSearch(val, 0);
          return;
        }

        const searchBtn = document.getElementById('qbs-search-btn');
        if (searchBtn) searchBtn.click();
      }, 500);
    });

    console.log('[SupportStudioPatch] Deep search auto-input patch applied.');
  }

  function patchQbRowClick() {
    const qbsRoot = document.getElementById('qbs-root');
    if (!qbsRoot) {
      setTimeout(patchQbRowClick, 800);
      return;
    }

    if (qbsRoot.dataset.rowClickPatched) return;
    qbsRoot.dataset.rowClickPatched = 'true';

    qbsRoot.addEventListener('click', function (e) {
      const badge = e.target && e.target.closest && e.target.closest('.qb-row-detail-btn');
      if (!badge) return;

      const rawIdx = badge.getAttribute('data-qb-snap-idx');
      const rowIndex = parseInt(String(rawIdx || ''), 10);
      if (Number.isNaN(rowIndex)) return;

      const records = Array.isArray(window.__studioQbRecords) ? window.__studioQbRecords : null;
      if (!records || !records[rowIndex]) return;

      // Let the native row click handler run first.
      // Fallback only if no modal opener is available in the current context.
      const openFn = typeof window._qbsOpenCaseDetail === 'function' ? window._qbsOpenCaseDetail : null;
      if (!openFn) return;

      const rec = records[rowIndex] || {};
      const snap = {
        rowNum: rowIndex + 1,
        recordId: rec['3'] || rec[3] || rec.recordId || rec.id || '',
        fields: rec,
        columnMap: window.__studioQbColumns || {}
      };

      setTimeout(function () {
        const modal = document.getElementById('qbCaseDetailModal');
        if (modal && modal.classList.contains('open')) return;
        openFn(snap, [snap]);
      }, 0);
    }, true);

    console.log('[SupportStudioPatch] QB row click patch applied.');
  }

  function boot() {
    patchDeepSearch();
    patchQbRowClick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
