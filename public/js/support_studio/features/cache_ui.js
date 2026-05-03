/**
 * @file cache_ui.js
 * @description Cache Ui module
 * @module MUMS/MUMS
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════
   CACHE UI ORCHESTRATOR — ties StudioCache events to all UI elements
   Handles: banner, modal, progress, Cache Manager panel, auto-check
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function _fmtAge(ms) {
    var m = Math.round(ms / 60000);
    if (m < 2)  return 'Just now';
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }
  function _fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  }
  function _fmtCount(n) { return Number.isFinite(n) ? n.toLocaleString() : '—'; }
  function _estimateSize(bundle) {
    if (!bundle || !bundle.data) return 0;
    try { return new Blob([JSON.stringify(bundle.data)]).size; } catch(_) { return 0; }
  }

  // ── Banner control ────────────────────────────────────────────────
  var _pendingOutdated = [];
  var _pendingManifest = null;
  var _isSyncing       = false;

  function showSoftBanner(outdated, serverManifest) {
    _pendingOutdated = outdated || [];
    _pendingManifest = serverManifest;

    var names = outdated.map(function(o) {
      return o.id === 'connect_plus'  ? 'Connect+ Sites' :
             o.id === 'parts_number'  ? 'Parts Number'   :
             o.id === 'catalog'       ? 'Catalog Items'  :
             o.id === 'qb_schema'     ? 'QB Schema'      : o.id;
    });

    var msg  = '<strong>' + names.join(', ') + '</strong> ';
    msg += outdated.length === 1 ? 'has been updated on the server.' : 'have been updated on the server.';
    msg += ' <span style="opacity:.75;font-weight:500;">Update your local cache to see the latest data.</span>';

    var msgEl = el('ss-cache-banner-msg');
    if (msgEl) msgEl.innerHTML = msg;

    // ss-cache-banner-soft is a fixed-position floating toast — show it
    var soft = el('ss-cache-banner-soft');
    if (soft) { soft.classList.remove('toast-hiding'); soft.style.display = 'flex'; }

    // Show dot on Cache Manager nav item
    var dot = el('ss-cache-nav-dot');
    if (dot) dot.style.display = '';
  }

  function autoSyncOutdated() {
    if (_isSyncing) return;
    if (!_pendingOutdated || !_pendingOutdated.length) return;
    // Defer slightly so banner/beacon can render first, then sync automatically.
    setTimeout(function() {
      if (_isSyncing) return;
      if (window._cacheUI && typeof window._cacheUI.startSync === 'function') {
        window._cacheUI.startSync(false);
      }
    }, 900);
  }

  function showCriticalModal(critical, outdated, serverManifest) {
    _pendingOutdated = [].concat(critical || [], outdated || []);
    _pendingManifest = serverManifest;

    var changes = el('ss-cache-modal-changes');
    if (changes) {
      changes.innerHTML = (critical || []).map(function(c) {
        var label = c.id === 'connect_plus' ? 'Connect+ Sites' :
                    c.id === 'parts_number' ? 'Parts Number'   :
                    c.id === 'catalog'      ? 'Catalog Items'  :
                    c.id === 'qb_schema'    ? 'QB Schema'      : c.id;
        var icon  = c.reason === 'deletions_detected'
          ? '<i class="fas fa-minus-circle" style="color:#f85149;width:14px;"></i>'
          : '<i class="fas fa-exclamation-triangle" style="color:#d29922;width:14px;"></i>';
        var desc  = c.reason === 'deletions_detected'
          ? label + ': <strong>' + (c.localCount - c.serverCount) + ' records deleted</strong> on server — local cache is stale'
          : label + ': <strong>Critical schema or data change</strong> detected';
        return '<div style="padding:7px 10px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);font-size:11px;color:#7d8590;display:flex;align-items:center;gap:8px;">' +
          icon + '<span>' + desc + '</span></div>';
      }).join('');
    }

    var modal = el('ss-cache-modal');
    if (modal) modal.style.display = 'flex';

    // Allow skip after 5 seconds
    var skip = el('ss-cache-modal-skip');
    if (skip) {
      skip.disabled = true;
      setTimeout(function() { if (skip) skip.disabled = false; }, 5000);
    }
  }

  function showProgress(bundleId, pct, overallDone, overallTotal) {
    var soft = el('ss-cache-banner-soft');
    var prog = el('ss-cache-progress');
    var bar    = el('ss-cache-progress-bar');
    var msgEl  = el('ss-cache-progress-msg');
    var pctEl  = el('ss-cache-progress-pct');

    // Toast host is always visible (fixed pos); just toggle child toasts
    if (soft) { soft.classList.add('toast-hiding'); setTimeout(function(){ if(soft) soft.style.display='none'; }, 180); }
    if (prog) { prog.classList.remove('toast-hiding'); prog.style.display = 'flex'; }

    var label = bundleId === 'connect_plus' ? 'Connect+ Sites' :
                bundleId === 'parts_number' ? 'Parts Number'   :
                bundleId === 'catalog'      ? 'Catalog Items'  :
                bundleId === 'qb_schema'    ? 'QB Field Schema': bundleId;
    var overall = overallTotal > 1
      ? ' (' + overallDone + '/' + overallTotal + ' bundles)'
      : '';

    if (msgEl) msgEl.textContent = 'Syncing ' + label + overall + '…';
    if (bar)   bar.style.width   = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }

  function hideBannerAndProgress() {
    var soft  = el('ss-cache-banner-soft');
    var prog  = el('ss-cache-progress');
    var modal = el('ss-cache-modal');
    var dot   = el('ss-cache-nav-dot');

    setTimeout(function() {
      // Animate toasts out, then hide
      function _hideToast(el) {
        if (!el || el.style.display === 'none') return;
        el.classList.add('toast-hiding');
        setTimeout(function() {
          if (el) { el.style.display = 'none'; el.classList.remove('toast-hiding'); }
        }, 200);
      }
      _hideToast(soft);
      _hideToast(prog);
      if (modal)  modal.style.display  = 'none';
      if (dot)    dot.style.display    = 'none';
      _isSyncing = false;
    }, 1500);
  }

  // ── Cache Manager panel refresh ───────────────────────────────────
  function refreshPanel() {
    if (typeof window.StudioCache === 'undefined') {
      var msgEl = el('cache-manager-msg');
      if (msgEl) { msgEl.textContent = 'IndexedDB not available in this browser.'; msgEl.style.opacity = '1'; msgEl.style.color = '#f85149'; }
      return;
    }
    window.StudioCache.getStats().then(function(stats) {
      _renderBundleRow('connect_plus',  stats.connect_plus,  '#58a6ff');
      _renderBundleRow('parts_number',  stats.parts_number,  '#fb923c');
      _renderBundleRow('catalog',       stats.catalog,       '#22d3ee');
      _renderBundleRow('qb_schema',     stats.qb_schema,     '#3fb950');
      _renderStorageBar(stats);
    });
  }

  function _renderBundleRow(id, stat, color) {
    var subEl    = el('cache-sub-'    + id);
    var ageEl    = el('cache-age-'    + id);
    var countEl  = el('cache-count-'  + id);
    var statusEl = el('cache-status-' + id);

    if (!stat || !stat.cached) {
      if (subEl)    subEl.textContent    = 'Not cached';
      if (ageEl)    ageEl.textContent    = '—';
      if (countEl)  countEl.textContent  = '—';
      if (statusEl) statusEl.innerHTML   = '<span style="color:#7d8590;">No data</span>';
      return;
    }

    if (subEl)   subEl.textContent  = _fmtCount(stat.count) + ' records';
    if (ageEl)   ageEl.innerHTML    = '<div style="color:#e6edf3;">' + _fmtDate(stat.fetchedAt) + '</div>' +
      '<div style="color:' + (stat.expired ? '#f85149' : '#3fb950') + ';font-size:9px;">' +
      _fmtAge(stat.ageMs) + '</div>';
    if (countEl) countEl.textContent = _fmtCount(stat.count);
    if (statusEl) statusEl.innerHTML = stat.expired
      ? '<div style="display:flex;align-items:center;gap:5px;"><div style="width:7px;height:7px;border-radius:50%;background:#f85149;"></div><span style="color:#f85149;font-weight:700;">Expired</span></div>'
      : '<div style="display:flex;align-items:center;gap:5px;"><div style="width:7px;height:7px;border-radius:50%;background:#3fb950;box-shadow:0 0 5px #3fb950;animation:pulse 2s infinite;"></div><span style="color:#3fb950;font-weight:700;">Current</span></div>';
  }

  function _renderStorageBar(stats) {
    // Estimate sizes (rough: JSON bytes)
    var cpSize  = stats.connect_plus  && stats.connect_plus.cached  ? (stats.connect_plus.count  * 200)  : 0;
    var pnSize  = stats.parts_number  && stats.parts_number.cached  ? (stats.parts_number.count  * 250)  : 0;
    var catSize = stats.catalog       && stats.catalog.cached       ? (stats.catalog.count       * 2000) : 0;
    var schSize = stats.qb_schema     && stats.qb_schema.cached     ? 5000                               : 0;
    var total   = cpSize + pnSize + catSize + schSize;

    var totalEl = el('cache-total-size');
    if (totalEl) totalEl.textContent = total > 0
      ? (total / 1048576).toFixed(1) + ' MB estimated'
      : 'Nothing cached yet';

    function pct(n) { return total > 0 ? Math.round(n / total * 100) + '%' : '0%'; }
    var barCp  = el('cache-bar-cp');
    var barCat = el('cache-bar-cat');
    var barSch = el('cache-bar-sch');
    if (barCp)  barCp.style.width  = pct(cpSize);
    if (barCat) barCat.style.width = pct(catSize);
    if (barSch) barSch.style.width = pct(schSize);
  }

  // ── Public API ────────────────────────────────────────────────────
  window._cacheUI = {

    dismissBanner: function() {
      var soft = el('ss-cache-banner-soft');
      if (soft) {
        soft.classList.add('toast-hiding');
        setTimeout(function() {
          if (soft) { soft.style.display = 'none'; soft.classList.remove('toast-hiding'); }
        }, 200);
      }
    },

    dismissModal: function() {
      var modal = el('ss-cache-modal');
      if (modal) modal.style.display = 'none';
    },

    startSync: function(fromModal) {
      if (_isSyncing) return;
      _isSyncing = true;

      if (fromModal) {
        var modal = el('ss-cache-modal');
        if (modal) modal.style.display = 'none';
      }

      if (typeof window.StudioCache === 'undefined') {
        _isSyncing = false;
        return;
      }

      var bundleIds = (_pendingOutdated.length > 0
        ? _pendingOutdated.map(function(o) { return o.id; })
        : ['connect_plus', 'parts_number', 'catalog', 'qb_schema']
      ).filter(function(id, i, a) { return a.indexOf(id) === i; });

      window.StudioCache.fetchServerManifest(true).then(function(manifest) {
        return window.StudioCache.syncBundles(bundleIds, manifest || { bundles: {} });
      }).catch(function(err) {
        console.warn('[CacheUI] sync error:', err.message);
        _isSyncing = false;
        hideBannerAndProgress();
      });
    },

    syncAll: function() {
      _pendingOutdated = [
        { id: 'connect_plus' }, { id: 'parts_number' }, { id: 'catalog' }, { id: 'qb_schema' }
      ];
      this.startSync(false);
    },

    syncOne: function(bundleId) {
      _pendingOutdated = [{ id: bundleId }];
      this.startSync(false);
    },

    clearAllConfirm: function() {
      if (!confirm('Clear all cached data? Connect+ and Catalog will reload from network on next visit.')) return;
      if (typeof window.StudioCache === 'undefined') return;
      window.StudioCache.clearAll().then(function() {
        refreshPanel();
        var msgEl = el('cache-manager-msg');
        if (msgEl) {
          msgEl.textContent = '✓ All cache cleared.';
          msgEl.style.cssText = 'font-size:11px;opacity:1;color:#3fb950;font-weight:600;';
          clearTimeout(msgEl._t);
          msgEl._t = setTimeout(function() { msgEl.style.opacity = '0'; }, 3000);
        }
      });
    },

    refreshPanel: refreshPanel,
  };

  // ── Listen to StudioCache events ──────────────────────────────────
  window.addEventListener('studiocache:firstrun', function(e) {
    // First time — auto-download everything silently in background
    if (typeof window.StudioCache === 'undefined') return;
    _pendingManifest = e.detail.serverManifest;
    _pendingOutdated = [
      { id: 'connect_plus' }, { id: 'parts_number' }, { id: 'catalog' }, { id: 'qb_schema' }
    ];
    // Don't show banner on first run — silent background download
    window.StudioCache.syncBundles(['connect_plus', 'parts_number', 'catalog', 'qb_schema'], e.detail.serverManifest || { bundles: {} })
      .catch(function(err) { console.warn('[CacheUI] firstrun sync failed:', err.message); });
  });

  window.addEventListener('studiocache:update', function(e) {
    showSoftBanner(e.detail.outdated, e.detail.serverManifest);
    beaconSetState('stale');
    beaconRefreshPopup(e.detail.outdated, []);
    autoSyncOutdated();
  });

  window.addEventListener('studiocache:critical', function(e) {
    showCriticalModal(e.detail.critical, e.detail.outdated, e.detail.serverManifest);
    beaconSetState('critical');
    beaconRefreshPopup(e.detail.outdated, e.detail.critical);
  });

  window.addEventListener('studiocache:progress', function(e) {
    var d = e.detail;
    showProgress(d.bundleId, d.bundlePct, d.overallDone, d.overallTotal);
    beaconSetState('syncing');
    var syncLabel = document.getElementById('bp-sync-label');
    var syncIcon  = document.getElementById('bp-sync-icon');
    var syncBtn   = document.getElementById('bp-sync-btn');
    if (syncLabel) syncLabel.textContent = 'Syncing…';
    if (syncIcon)  syncIcon.className    = 'fas fa-spinner fa-spin';
    if (syncBtn)   syncBtn.disabled      = true;
    var bpSub = document.getElementById('bp-sub');
    if (bpSub) bpSub.textContent = 'Downloading ' + (d.bundleId || '') + ' (' + (d.bundlePct || 0) + '%)…';
  });

  window.addEventListener('studiocache:synccomplete', function() {
    hideBannerAndProgress();
    refreshPanel();
    beaconSetState('fresh');
    beaconRefreshPopup([], []);
    var syncLabel = document.getElementById('bp-sync-label');
    var syncIcon  = document.getElementById('bp-sync-icon');
    var syncBtn   = document.getElementById('bp-sync-btn');
    if (syncLabel) syncLabel.textContent = 'Sync All';
    if (syncIcon)  syncIcon.className    = 'fas fa-sync-alt';
    if (syncBtn)   syncBtn.disabled      = false;
    // Reload Connect+ data from fresh cache if tab is open
    if (typeof window._cpRefresh === 'function' &&
        document.getElementById('left-panel-connectplus') &&
        document.getElementById('left-panel-connectplus').style.display !== 'none') {
      window._cpRefresh();
    }
    // Reload Parts Number data from fresh cache if tab is open
    if (typeof window._pnRefresh === 'function' &&
        document.getElementById('left-panel-parts_number') &&
        document.getElementById('left-panel-parts_number').style.display !== 'none') {
      window._pnRefresh();
    }
  });

  window.addEventListener('studiocache:fresh', function(e) {
    beaconSetState('fresh');
    beaconRefreshPopup([], []);
  });

  window.addEventListener('studiocache:firstrun', function(e) {
    beaconSetState('syncing');
  });

  window.addEventListener('studiocache:bundleerror', function(e) {
    console.warn('[CacheUI] bundle error:', e.detail.bundleId, e.detail.error);
  });

  // ── Beacon state controller ───────────────────────────────────────
  function beaconSetState(state) {
    var b = document.getElementById('ss-cache-beacon');
    if (b) b.setAttribute('data-state', state);
  }

  // ── Beacon popup content refresh ─────────────────────────────────
  function _fmtAgo(ms) {
    var m = Math.round(ms / 60000);
    if (m < 2)  return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function beaconRefreshPopup(outdated, critical) {
    if (typeof window.StudioCache === 'undefined') return;

    var outdatedIds = (outdated  || []).map(function(o) { return o.id; });
    var criticalIds = (critical  || []).map(function(o) { return o.id; });

    window.StudioCache.getStats().then(function(stats) {
      var allFresh = true;
      var bpSub    = document.getElementById('bp-sub');

      ['connect_plus','parts_number','catalog','qb_schema'].forEach(function(id) {
        var stat    = stats[id];
        var metaEl  = document.getElementById('bp-meta-' + id);
        var tagEl   = document.getElementById('bp-tag-' + id);
        if (!metaEl || !tagEl) return;

        if (!stat || !stat.cached) {
          metaEl.textContent = 'Not downloaded yet';
          tagEl.textContent  = 'None';
          tagEl.className    = 'bp-tag bp-tag-none';
          allFresh = false;
          return;
        }

        metaEl.textContent = (stat.count || 0).toLocaleString() + ' records · ' + _fmtAgo(stat.ageMs);

        if (criticalIds.indexOf(id) >= 0) {
          tagEl.textContent = '⚠ Critical';
          tagEl.className   = 'bp-tag bp-tag-critical';
          allFresh = false;
        } else if (outdatedIds.indexOf(id) >= 0 || stat.expired) {
          tagEl.textContent = 'Update';
          tagEl.className   = 'bp-tag bp-tag-stale';
          allFresh = false;
        } else {
          tagEl.textContent = '✓ Fresh';
          tagEl.className   = 'bp-tag bp-tag-fresh';
        }
      });

      if (bpSub) {
        bpSub.textContent = allFresh
          ? 'All data current · Last check: just now'
          : (criticalIds.length > 0 ? 'Critical update required' : 'Update available');
      }

      // Update beacon head icon color
      var ico = document.getElementById('bp-head-ico');
      if (ico) {
        var col = allFresh ? '#3fb950' : (criticalIds.length > 0 ? '#f85149' : '#d29922');
        ico.style.background   = 'rgba(' + (allFresh ? '63,185,80' : (criticalIds.length > 0 ? '248,81,73' : '210,153,34')) + ',.1)';
        ico.style.borderColor  = 'rgba(' + (allFresh ? '63,185,80' : (criticalIds.length > 0 ? '248,81,73' : '210,153,34')) + ',.2)';
        ico.querySelector('i').style.color = col;
      }
    }).catch(function() {});
  }

  // ── Beacon toggle / close ─────────────────────────────────────────
  window._beaconToggle = function() {
    var popup = document.getElementById('ss-beacon-popup');
    if (!popup) return;
    var isOpen = popup.classList.contains('open');
    if (isOpen) {
      popup.classList.remove('open');
    } else {
      popup.classList.add('open');
      beaconRefreshPopup([], []);
    }
  };

  window._beaconClose = function() {
    var popup = document.getElementById('ss-beacon-popup');
    if (popup) popup.classList.remove('open');
  };

  window._beaconSync = function() {
    window._beaconClose();
    if (window._cacheUI) window._cacheUI.syncAll();
  };

  // Close popup on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#ss-beacon-popup') &&
        !e.target.closest('#ss-cache-beacon')) {
      window._beaconClose();
    }
  });

  // ── Boot: run check on page load (after 2s to not block initial render) ──
  function _bootCacheCheck() {
    if (typeof window.StudioCache === 'undefined') return;
    window.StudioCache.startAutoCheck();
    setTimeout(function() {
      window.StudioCache.checkForUpdates(false).catch(function(err) {
        console.warn('[StudioCache] boot check failed:', err.message);
      });
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootCacheCheck);
  } else {
    _bootCacheCheck();
  }

})();
