// public/js/pages/support_studio_patches.js
// NON-INVASIVE patch for Support Studio — loaded AFTER all main scripts.
// Fixes:
//   1. Deep search: auto-search on input (debounced 500ms).
//   2. QB row number click: opens Case Detail View.
//   3. Deep search card click: _qbsOpenDeepResult + [data-action] fallback.
//   4. Banner dismissal memory: banner stays hidden after dismiss (sessionStorage).
//   5. Deep search card: remove Case View Details button + improve Assigned To.

(function () {
  'use strict';

  // ── HELPER: open Case Detail modal ──────────────────────────────────────────
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

  // ── PATCH 5: Banner dismissal memory (sessionStorage) ───────────────────────
  // Problem: Banner shows on every login/refresh even after dismissal because
  // _cacheUI.dismissBanner() has no persistent memory within the session.
  // Fix: intercept dismissBanner to set a sessionStorage flag, and suppress
  // banner display for the rest of the session unless a genuinely new update fires.
  function patchBannerDismissal() {
    var SS_KEY = 'ss_cache_banner_dismissed';

    function hookCacheUI() {
      if (!window._cacheUI) { setTimeout(hookCacheUI, 300); return; }
      var ui = window._cacheUI;

      // Wrap dismissBanner to record the dismissal in session
      if (!ui._origDismissBanner) {
        ui._origDismissBanner = ui.dismissBanner.bind(ui);
        ui.dismissBanner = function () {
          sessionStorage.setItem(SS_KEY, '1');
          ui._origDismissBanner();
        };
      }

      // Wrap showBanner / showBannerSoft / showUpdateBanner to respect dismissal
      ['showBanner', 'showBannerSoft', 'showUpdateBanner'].forEach(function (m) {
        if (typeof ui[m] === 'function' && !ui['_orig_' + m]) {
          ui['_orig_' + m] = ui[m].bind(ui);
          ui[m] = function () {
            if (sessionStorage.getItem(SS_KEY) === '1') return; // dismissed this session
            ui['_orig_' + m].apply(ui, arguments);
          };
        }
      });

      // Hide banners immediately if already dismissed this session
      if (sessionStorage.getItem(SS_KEY) === '1') {
        ['ss-cache-banner', 'ss-cache-banner-soft'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      }

      console.log('[SupportStudioPatch] Banner dismissal memory patch applied.');
    }

    // studiocache:update / studiocache:critical = genuinely new data available
    // → clear dismissed flag so the banner can resurface
    window.addEventListener('studiocache:update', function () {
      sessionStorage.removeItem(SS_KEY);
    }, false);
    window.addEventListener('studiocache:critical', function () {
      sessionStorage.removeItem(SS_KEY);
    }, false);

    // studiocache:fresh = data is current → hide banners
    window.addEventListener('studiocache:fresh', function () {
      ['ss-cache-banner', 'ss-cache-banner-soft'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }, false);

    hookCacheUI();
  }

  // ── PATCH 6: Deep search cards — remove Case View Details, improve Assigned To
  // Uses a MutationObserver on #qbs-search-results to post-process every card
  // rendered by window._qbsDeepSearch. Non-invasive: doesn't touch the HTML file.
  function patchDeepSearchCards() {
    function processResults(root) {
      // 1. Remove "Case View Details" buttons/links
      root.querySelectorAll(
        '[data-action="ds-case-view-details"], .ds-view-details-btn, .qbs-case-view-btn'
      ).forEach(function (b) { b.remove(); });

      // Sweep for any element whose visible text is "CASE VIEW DETAILS" leaf node
      root.querySelectorAll('button, a, span, div').forEach(function (el) {
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

      // 2. Improve "Assigned To" label + value visibility
      // Strategy A: class-based label elements
      root.querySelectorAll(
        '.ds-field-label, .qbs-label, .ss-field-label, [class*="label"], [class*="meta"]'
      ).forEach(function (labelEl) {
        if (labelEl.children.length > 0) return;
        var txt = (labelEl.textContent || '').trim().toUpperCase().replace(/[:\s]+$/, '');
        if (txt !== 'ASSIGNED TO') return;
        styleAssignedToLabel(labelEl);
        var valueEl = labelEl.nextElementSibling;
        if (valueEl) styleAssignedToValue(valueEl);
      });

      // Strategy B: scan all leaf text nodes inside result cards
      root.querySelectorAll(
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

    function watchResults() {
      var container = document.getElementById('qbs-search-results');
      if (!container) { setTimeout(watchResults, 800); return; }
      if (container.dataset.cardPatchApplied) return;
      container.dataset.cardPatchApplied = 'true';

      // Process cards already rendered
      processResults(container);

      // Watch for future renders (each search clears + repaints container)
      var obs = new MutationObserver(function () { processResults(container); });
      obs.observe(container, { childList: true, subtree: true });
      console.log('[SupportStudioPatch] Deep search card patch observer active.');
    }

    watchResults();
  }

  // ── BOOT ─────────────────────────────────────────────────────────────────────
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
