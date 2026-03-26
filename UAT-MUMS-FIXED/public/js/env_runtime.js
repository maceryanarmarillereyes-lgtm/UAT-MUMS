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
    // ── CALIBRATED: 30 users × 8hr × 30 days — target ≤3.5 GB/month ──
    MAILBOX_OVERRIDE_POLL_MS: 10000,   // 10s FIXED — lightweight Store check only
    PRESENCE_TTL_SECONDS: 360,         // 6min TTL — user stays in roster through 3 missed HBs
    PRESENCE_POLL_MS: 45000,           // 45s HB — was 3s (67× reduction)
    PRESENCE_LIST_POLL_MS: 90000,      // 90s roster list — biggest egress saver
    SYNC_POLL_MS: 90000,               // 90s offline fallback sync
    SYNC_RECONCILE_MS: 90000,          // 90s reconcile (realtime WebSocket is primary)
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

  fetch('/api/env', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (data && typeof data === 'object') {
        env.SUPABASE_URL = data.SUPABASE_URL || '';
        env.SUPABASE_ANON_KEY = data.SUPABASE_ANON_KEY || '';
        env.USERNAME_EMAIL_DOMAIN = data.USERNAME_EMAIL_DOMAIN || env.USERNAME_EMAIL_DOMAIN;
        env.REALTIME_RELAY_URL = data.REALTIME_RELAY_URL || '';
        env.REMOTE_PATCH_URL = data.REMOTE_PATCH_URL || '';
        env.MAILBOX_OVERRIDE_POLL_MS = safeParseInt(data.MAILBOX_OVERRIDE_POLL_MS, env.MAILBOX_OVERRIDE_POLL_MS);
        env.PRESENCE_TTL_SECONDS = safeParseInt(data.PRESENCE_TTL_SECONDS, env.PRESENCE_TTL_SECONDS);
        env.PRESENCE_POLL_MS = safeParseInt(data.PRESENCE_POLL_MS, env.PRESENCE_POLL_MS);
        env.SYNC_POLL_MS = safeParseInt(data.SYNC_POLL_MS, env.SYNC_POLL_MS);
        env.SYNC_ENABLE_SUPABASE_REALTIME = (String(data.SYNC_ENABLE_SUPABASE_REALTIME || 'true') !== 'false');
      }
      readyResolve(env);
    })
    .catch(function(){ readyResolve(env); });
})();