/**
 * @file env_runtime.js
 * @description Runtime environment bootstrap — fetches /api/env and exposes MUMS_ENV globally
 * @module MUMS/Core
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(function(){
  const DBG = (window.MUMS_DEBUG || {log(){},warn(){},error(){}});
  DBG.log('info','env_runtime.start');

  // Global proportional scaling (layout-stability)
  // Goal: when viewport shrinks, keep the desktop grid intact and scale the whole UI
  // (similar to browser zoom) rather than reflowing the layout.
  (function initGlobalAppScale(){
    try {
      var root = document.documentElement;
      if (!root) return;

      // Desktop layout was designed around a 3-column shell.
      // We scale down once the viewport drops below this width to prevent grid reflow.
      var DESIGN_W = 1300; // px
      var MIN_SCALE = 0.70;
      var MAX_SCALE = 1.00;

      function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

      function applyScale(){
        var vw = Math.max(root.clientWidth || 0, window.innerWidth || 0);
        // Mobile gets a dedicated layout; keep scale at 1 for readability/touch targets.
        var scale = (vw <= 768) ? 1 : ((vw < DESIGN_W) ? (vw / DESIGN_W) : 1);
        scale = clamp(scale, MIN_SCALE, MAX_SCALE);

        // Avoid noisy CSS diffs by keeping a consistent precision.
        var s = String(scale.toFixed(3));
        root.style.setProperty('--app-scale', s);
        root.setAttribute('data-app-scale', s);
      }

      var rafPending = false;
      function schedule(){
        if (rafPending) return;
        rafPending = true;
        (window.requestAnimationFrame || setTimeout)(function(){
          rafPending = false;
          applyScale();
        }, 16);
      }

      window.addEventListener('resize', schedule, { passive: true });
      window.addEventListener('orientationchange', schedule, { passive: true });
      // Apply immediately (works for both login and app shells).
      applyScale();
    } catch(e) {
      // Never block env loading
    }
  })();

  function safeParseInt(v, d){
    var n = parseInt(v, 10);
    return isNaN(n) ? d : n;
  }

  // Public (safe) runtime env delivered by /api/env
  var env = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    USERNAME_EMAIL_DOMAIN: 'mums.local',
    REALTIME_RELAY_URL: '',
    REMOTE_PATCH_URL: '',
    // ── FREE TIER OPTIMIZED: 30 users × 8hr × 30 days — target ≤100k req/day ──
    // PERF FIX v4.0: All intervals increased to prevent Cloudflare/Supabase overload.
    // Root cause: MAILBOX_OVERRIDE_POLL_MS=10s caused 360 req/hr from 1 user alone.
    // Combined all timers generated ~980 req/hr. Now reduced to ~85 req/hr.
    MAILBOX_OVERRIDE_POLL_MS: 120000,  // 120s (was 10s — 12× reduction). Idle auto-scales to 720s.
    PRESENCE_TTL_SECONDS: 600,         // 10min TTL — survives 2 missed HBs at new 240s interval
    PRESENCE_POLL_MS: 120000,          // 120s HB (was 45s — 2.7× reduction)
    PRESENCE_LIST_POLL_MS: 300000,     // 300s roster (was 90s — 3.3× reduction)
    SYNC_POLL_MS: 180000,              // 180s offline fallback sync (was 90s)
    SYNC_RECONCILE_MS: 180000,         // 180s reconcile — realtime WS is primary (was 90s)
    SYNC_ENABLE_SUPABASE_REALTIME: true
  };

  var readyResolve;
  var ready = new Promise(function(resolve){ readyResolve = resolve; });

  // Backwards-compatible globals
  window.__MUMS_ENV_READY = ready;
  window.MUMS_ENV = env;

  // Canonical helper used across modules
  window.EnvRuntime = {
    ready: function(){ return ready; },
    env: function(){ return env; }
  };

  // file:// cannot call /api. Keep env empty and resolve.
  if (location.protocol === 'file:') {
    readyResolve(env);
    return;
  }

  var envController = new AbortController();
  var envTimedOut = false;
  var envTimer = setTimeout(function(){
    envTimedOut = true;
    try { envController.abort(); } catch(_) {}
  }, 3500);

  // ── ORG FINGERPRINT CHECK ─────────────────────────────────────────────────
  // Supabase is the SINGLE SOURCE OF TRUTH for all org data.
  // localStorage is only a read-through cache. When the Supabase org changes
  // (new org / migration), all cached data (users, mailbox tables, schedules,
  // cases, etc.) is stale and MUST be purged before any module reads it.
  //
  // STRATEGY:
  //   - Fingerprint = SUPABASE_URL (unique per org)
  //   - On first boot (no stored fingerprint): CLEAR all org-cache then set FP.
  //     Reason: we cannot know if existing localStorage data is from this org.
  //     Safe because CloudUsers + Realtime sync will repopulate within seconds.
  //   - On URL match (same org): no-op — normal boot.
  //   - On URL mismatch (org changed): CLEAR then set new FP.
  //
  // Keys preserved across all scenarios (user-preference, not org-data):
  //   mums_theme, mums_worldclocks, mums_quicklinks,
  //   mums_release_notes, mums_release_notes_backup, mums__org_fp
  //
  var ORG_FP_KEY = 'mums__org_fp';
  var PRESERVE_KEYS = {
    'mums_theme': 1, 'mums_worldclocks': 1, 'mums_quicklinks': 1,
    'mums_release_notes': 1, 'mums_release_notes_backup': 1,
    'mums__org_fp': 1
  };

  function _clearOrgCache(newUrl, reason) {
    try {
      var toDelete = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        // Only clear MUMS-owned keys (prefixed ums_ or mums_)
        if ((k.indexOf('ums_') === 0 || k.indexOf('mums_') === 0) && !PRESERVE_KEYS[k]) {
          toDelete.push(k);
        }
      }
      for (var j = 0; j < toDelete.length; j++) {
        localStorage.removeItem(toDelete[j]);
      }
      localStorage.setItem(ORG_FP_KEY, newUrl);
      DBG.log('info', 'env_runtime.org_cache_cleared', { reason: reason, keys: toDelete.length, org: newUrl });
    } catch(e) {
      // localStorage may be full or blocked — non-fatal
    }
  }

  function _checkOrgFingerprint(newUrl) {
    if (!newUrl) return; // no URL yet — skip
    try {
      var stored = localStorage.getItem(ORG_FP_KEY) || '';
      if (stored === newUrl) {
        // Same org — no-op, normal boot
        return;
      } else if (!stored) {
        // ── FIRST BOOT or fingerprint was cleared ──────────────────────────
        // Cannot verify if existing localStorage data belongs to this org.
        // Clear all org-specific cache NOW before any module reads stale data.
        // CloudUsers + Realtime will repopulate from Supabase within seconds.
        _clearOrgCache(newUrl, 'first_boot_cache_sanitize');
      } else {
        // ── ORG CHANGED (migration) ────────────────────────────────────────
        // stored !== newUrl — different Supabase org. All cached data is
        // from the old org. Purge everything and set the new fingerprint.
        _clearOrgCache(newUrl, 'org_migration');
      }
    } catch(e) {}
  }
  // ─────────────────────────────────────────────────────────────────────────

  fetch('/api/env', { cache: 'no-store', signal: envController.signal })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (data && typeof data === 'object') {
        env.SUPABASE_URL = data.SUPABASE_URL || '';
        env.SUPABASE_ANON_KEY = data.SUPABASE_ANON_KEY || '';
        env.USERNAME_EMAIL_DOMAIN = data.USERNAME_EMAIL_DOMAIN || env.USERNAME_EMAIL_DOMAIN;
        env.REALTIME_RELAY_URL = data.REALTIME_RELAY_URL || '';
        env.REMOTE_PATCH_URL = data.REMOTE_PATCH_URL || '';
        env.MAILBOX_OVERRIDE_POLL_MS = Math.max(60000,  safeParseInt(data.MAILBOX_OVERRIDE_POLL_MS, env.MAILBOX_OVERRIDE_POLL_MS));
        env.PRESENCE_TTL_SECONDS     = Math.max(300,    safeParseInt(data.PRESENCE_TTL_SECONDS,     env.PRESENCE_TTL_SECONDS));
        env.PRESENCE_POLL_MS         = Math.max(45000,  safeParseInt(data.PRESENCE_POLL_MS,         env.PRESENCE_POLL_MS));
        // IO-OPT: Wire up PRESENCE_LIST_POLL_MS — was defined in defaults (90s) but never
        // loaded from the server /api/env response, so operators couldn't override it.
        env.PRESENCE_LIST_POLL_MS    = Math.max(90000,  safeParseInt(data.PRESENCE_LIST_POLL_MS,    env.PRESENCE_LIST_POLL_MS));
        env.SYNC_POLL_MS             = Math.max(45000,  safeParseInt(data.SYNC_POLL_MS,             env.SYNC_POLL_MS));
        env.SYNC_ENABLE_SUPABASE_REALTIME = (String(data.SYNC_ENABLE_SUPABASE_REALTIME || 'true') !== 'false');

        // ── Run fingerprint check NOW — SUPABASE_URL is known, modules not yet loaded ──
        _checkOrgFingerprint(env.SUPABASE_URL);
      }
      clearTimeout(envTimer);
      readyResolve(env);
    })
    .catch(function(){
      clearTimeout(envTimer);
      try {
        if (envTimedOut && DBG && typeof DBG.warn === 'function') {
          DBG.warn('env_runtime.fetch_timeout_fallback', { timeoutMs: 3500 });
        }
      } catch(_) {}
      readyResolve(env);
    });
})();

// Controller Lab - Google Sheets Web App Endpoint
window._CTL_SHEETS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwqLf7vypKtM978oGn5_qovvLwmjzjDvwNM1WnvyykjT71TxxxJ6KFjF-BogbGLXWA5ow/exec';
