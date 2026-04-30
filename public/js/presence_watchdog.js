/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/**
 * MUMS Presence Watchdog
 * ─────────────────────────────────────────────────────────────────────────────
 * Supplements presence_client.js (UNTOUCHABLE) to solve the "user disappears"
 * problem caused by:
 *
 *  1. Browser tab throttling — when a tab goes to the background, setInterval
 *     timers can be paused/throttled for minutes (Chrome, Edge, Safari all do this).
 *     The 25-second TTL on the server means the user falls off after one missed beat.
 *
 *  2. No wakeup heartbeat — when the user comes back to the tab there's a gap
 *     between the last throttled beat and the next scheduled one.
 *
 *  3. Network reconnect gap — momentary connectivity drops cause missed beats,
 *     but there's no recovery trigger.
 *
 * Strategy:
 *  ─ Listen to document.visibilitychange → immediate heartbeat when tab becomes visible
 *  ─ Listen to window.focus → immediate heartbeat (browser/OS window switch)
 *  ─ Listen to window.online → immediate heartbeat on network reconnect
 *  ─ Listen to mousemove/keydown/touchstart (activity events) as anti-idle proof
 *  ─ Maintain a local "last confirmed heartbeat" timestamp in sessionStorage
 *  ─ If tab was hidden > WATCHDOG_GAP_MS, fire immediately on visibility restore
 *  ─ Never conflicts with presence_client.js — uses the same endpoint, server deduplicates by client_id
 *
 * This file is NOT UNTOUCHABLE and can be updated as needed.
 */
(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────────────────
  // ── EGRESS-OPTIMIZED INTERVALS ─────────────────────────────────────────────
  // Watchdog only fires HB (heartbeat) — roster fetches delegated to presence_client.js
  // at 60s to avoid double-counting bandwidth.
  // Watchdog HB at 30s = 2× per minute per user = ~0.06 GB/month for 30 users.
  // ── CALIBRATED for 45s HB interval + 360s TTL ──────────────────────────
  // Watchdog fires HB only — roster fetch stays with presence_client (90s)
  // Gap threshold = 1.5× main HB interval: fires immediately if 67s+ since last beat
  // This ensures user never misses more than 1 HB before watchdog recovers it
  // ── PERF FIX v4.0: FREE TIER OPTIMIZED INTERVALS ──────────────────────────
  // Watchdog POLL increased from 45s → 150s (backup only; presence_client is primary).
  // Gap threshold matches 2× new HB interval (240s) → 300s.
  // Activity debounce: 180s (was 90s) — prevents mouse-move storms.
  // With 30 users: watchdog HB = 30 × (3600/150) = 720 req/hr (was 2,400/hr).
  var WATCHDOG_POLL_MS     = 300000; // 150s backup poll (was 45s — 3.3× reduction)
  var WATCHDOG_GAP_MS      = 300000; // Fire if >300s since last beat (2× 150s interval)
  var ACTIVITY_DEBOUNCE_MS = 180000; // Activity-triggered HB max 1 per 180s (was 90s)
  var STORAGE_KEY          = 'mums_watchdog_last_hb';
  var CLIENT_ID_KEY        = 'mums_client_id';

  // ── STATE ───────────────────────────────────────────────────────────────────
  var lastBeatAt      = 0;
  var lastActivityAt  = 0;
  var hbInFlight      = false;
  var initialized     = false;
  var hiddenAt        = 0; // timestamp when tab went hidden
  var jwtCacheValue   = '';
  var jwtCacheAt      = 0;
  var jwtInFlight     = null;
  var JWT_CACHE_MS    = 30000;
  var EVENT_COALESCE_MS = 2000;
  var heartbeatCoalesceTimer = null;
  var consecutiveAuthErrors = 0;
  var authBackoffUntil = 0;
  var backupPollTimer = null;
  var stopped = false;

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  function now() { return Date.now(); }

  function getClientId() {
    try { return localStorage.getItem(CLIENT_ID_KEY) || ''; } catch (_) { return ''; }
  }

  function readLastBeat() {
    try {
      var v = Number(sessionStorage.getItem(STORAGE_KEY) || 0);
      return isNaN(v) ? 0 : v;
    } catch (_) { return 0; }
  }

  function writeLastBeat(ts) {
    try { sessionStorage.setItem(STORAGE_KEY, String(ts)); } catch (_) {}
    lastBeatAt = ts;
  }

  async function getJwt() {
    var cachedAge = now() - jwtCacheAt;
    if (jwtCacheValue && cachedAge >= 0 && cachedAge < JWT_CACHE_MS) {
      return jwtCacheValue;
    }
    if (jwtInFlight) return await jwtInFlight;

    jwtInFlight = (async function(){
    try {
      if (window.CloudAuth) {
        if (typeof CloudAuth.ensureFreshSession === 'function') {
          await CloudAuth.ensureFreshSession({ tryRefresh: true, clearOnFail: false, leewaySec: 60 });
        }
        if (typeof CloudAuth.accessToken === 'function') {
          var tok = CloudAuth.accessToken();
          if (tok) {
            jwtCacheValue = tok;
            jwtCacheAt = now();
            return tok;
          }
        }
        if (typeof CloudAuth.loadSession === 'function') {
          await CloudAuth.loadSession();
          if (typeof CloudAuth.accessToken === 'function') {
            var loaded = CloudAuth.accessToken() || '';
            if (loaded) {
              jwtCacheValue = loaded;
              jwtCacheAt = now();
            }
            return loaded;
          }
        }
      }
    } catch (_) {}
    return '';
    })();

    try {
      var jwt = await jwtInFlight;
      return jwt || '';
    } finally {
      jwtInFlight = null;
    }
  }

  // ── CORE HEARTBEAT ──────────────────────────────────────────────────────────
  async function fireHeartbeat(reason) {
    if (stopped) return;
    if (window.__mumsFreemiumGuard && !window.__mumsFreemiumGuard.isLeader()) return;
    if (authBackoffUntil && now() < authBackoffUntil) return;
    if (hbInFlight) return;
    hbInFlight = true;
    try {
      var jwt = await getJwt();
      if (!jwt) return;

      var me = null;
      try { me = (window.Auth && Auth.getUser) ? Auth.getUser() : null; } catch (_) {}

      var clientId = getClientId();
      var body = JSON.stringify({
        clientId:  clientId,
        route:     location.hash || '',
        teamId:    (me && me.teamId) ? me.teamId : '',
        role:      (me && me.role)   ? me.role   : '',
        _src:      'watchdog:' + (reason || 'poll')
      });

      var res = await fetch('/api/presence/heartbeat', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + jwt
        },
        body:  body,
        cache: 'no-store'
      });

      if (res.ok) {
        consecutiveAuthErrors = 0;
        authBackoffUntil = 0;
        writeLastBeat(now());
        // NOTE: We intentionally do NOT call triggerRosterRefresh() here.
        // presence_client.js already polls the roster every 60s.
        // Calling it here too would double the egress. The bar will update
        // within 60s naturally, or instantly on visibility restore.
      }
      if (res.status === 401 || res.status === 403) {
        consecutiveAuthErrors = Math.min(consecutiveAuthErrors + 1, 8);
        var backoffMs = Math.min(60000, Math.pow(2, consecutiveAuthErrors) * 1000);
        authBackoffUntil = now() + backoffMs;
      }
    } catch (_) {
      // Silent — best-effort
    } finally {
      hbInFlight = false;
    }
  }

  function coalescedHeartbeat(reason) {
    if (heartbeatCoalesceTimer) return;
    heartbeatCoalesceTimer = setTimeout(function(){
      heartbeatCoalesceTimer = null;
      fireHeartbeat(reason || 'coalesced');
    }, EVENT_COALESCE_MS);
  }

  // ── ROSTER REFRESH ──────────────────────────────────────────────────────────
  // Forces an immediate list fetch so the bar shows current state without
  // waiting for presence_client.js next scheduled poll.
  var rosterInFlight = false;
  async function triggerRosterRefresh() {
    if (rosterInFlight) return;
    rosterInFlight = true;
    try {
      var jwt = await getJwt();
      if (!jwt) return;

      var r = await fetch('/api/presence/list', {
        cache:   'no-store',
        headers: { 'Authorization': 'Bearer ' + jwt }
      });
      if (!r.ok) return;

      var data = await r.json();
      if (!data || !data.rows) return;

      // Write into Store so renderOnlineUsersBar picks it up
      var map = buildOnlineMap(data.rows);
      if (window.Store && typeof Store.write === 'function') {
        Store.write('mums_online_users', map);
      } else {
        localStorage.setItem('mums_online_users', JSON.stringify(map));
        try {
          window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'mums_online_users' } }));
        } catch (_) {}
      }

      // Re-render the bar immediately
      try {
        if (typeof renderOnlineUsersBar === 'function') renderOnlineUsersBar();
      } catch (_) {}

    } catch (_) {
    } finally {
      rosterInFlight = false;
    }
  }

  function buildOnlineMap(rows) {
    var map = {};
    (rows || []).forEach(function (r) {
      var uid = r.user_id || r.userId || r.name || r.client_id;
      if (!uid) return;
      var lastSeen = Date.parse(r.last_seen || r.lastSeen || new Date().toISOString());
      if (isNaN(lastSeen)) lastSeen = now();
      var existing = map[uid];
      if (existing && Number(existing.lastSeen || 0) >= lastSeen) return;
      map[uid] = {
        userId:   r.user_id   || r.userId   || uid,
        name:     r.name      || 'User',
        role:     r.role      || '',
        teamId:   r.team_id   || r.teamId   || '',
        route:    r.route     || '',
        lastSeen: lastSeen,
        photo:    r.avatar_url || ''
      };
    });
    return map;
  }

  // ── VISIBILITY / FOCUS / NETWORK HANDLERS ──────────────────────────────────

  function onBecomeVisible() {
    var hidden = now() - hiddenAt;
    var stale = (now() - (readLastBeat() || lastBeatAt)) > WATCHDOG_GAP_MS;
    if (stale || hidden > WATCHDOG_GAP_MS) {
      coalescedHeartbeat('visibility-restore');
      // One-shot roster refresh on wakeup is acceptable (user needs to see current state)
      triggerRosterRefresh();
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = now();
    } else {
      onBecomeVisible();
    }
  });

  window.addEventListener('focus', function () {
    var stale = (now() - (readLastBeat() || lastBeatAt)) > WATCHDOG_GAP_MS;
    if (stale) coalescedHeartbeat('window-focus');
  });

  window.addEventListener('online', function () {
    // Network came back — fire immediately so user reappears ASAP
    coalescedHeartbeat('network-online');
  });

  // ── ACTIVITY DETECTION ──────────────────────────────────────────────────────
  // Treats user interaction as a "proof of life" signal.
  // Debounced so it doesn't spam the server on every keystroke.
  function onUserActivity() {
    var t = now();
    if ((t - lastActivityAt) < ACTIVITY_DEBOUNCE_MS) return;
    lastActivityAt = t;
    // Only beat if the last confirmed beat is getting stale
    if ((t - (readLastBeat() || lastBeatAt)) > (WATCHDOG_GAP_MS / 2)) {
      coalescedHeartbeat('user-activity');
    }
  }

  ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'].forEach(function (evt) {
    document.addEventListener(evt, onUserActivity, { passive: true, capture: true });
  });

  // ── BACKUP POLL ─────────────────────────────────────────────────────────────
  // Secondary poll at WATCHDOG_POLL_MS to back up presence_client.js.
  // Skips firing if presence_client.js already beat recently (reads lastBeat from session).
  function backupPoll() {
    if (stopped) return;
    if (document.hidden) return; // Don't poll when tab is hidden — save resources
    if (window.__mumsFreemiumGuard && !window.__mumsFreemiumGuard.isLeader()) return;
    var stale = (now() - (readLastBeat() || lastBeatAt)) > WATCHDOG_GAP_MS;
    if (stale) {
      fireHeartbeat('backup-poll');
    }
  }

  // ── EXPLICIT OFFLINE MARKER ─────────────────────────────────────────────────
  // Called on browser close (beforeunload) and on logout.
  // Sends route='__offline__' which the server stores as the last_seen row.
  // The presence list filters this out so the user disappears immediately
  // instead of waiting for TTL expiry.
  function sendOfflineMarker() {
    // Use sendBeacon for reliability on page unload (fetch can be cancelled)
    try {
      var jwt = (window.CloudAuth && typeof CloudAuth.accessToken === 'function')
        ? CloudAuth.accessToken() : '';
      if (!jwt) return;
      var me = null;
      try { me = (window.Auth && Auth.getUser) ? Auth.getUser() : null; } catch (_) {}
      var body = JSON.stringify({
        clientId: getClientId(),
        route:    '__offline__',
        teamId:   (me && me.teamId) || '',
        role:     (me && me.role)   || '',
        _src:     'watchdog:offline'
      });
      // sendBeacon works even during unload; fetch does not
      var sent = false;
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        // sendBeacon can't set Authorization header — include token in body as fallback
        // The server will need to read it from body._jwt if present
        var bodyWithJwt = JSON.stringify({
          clientId: getClientId(),
          route:    '__offline__',
          teamId:   (me && me.teamId) || '',
          role:     (me && me.role)   || '',
          _src:     'watchdog:offline',
          _jwt:     jwt
        });
        sent = navigator.sendBeacon('/api/presence/heartbeat', new Blob([bodyWithJwt], { type: 'application/json' }));
      }
      if (!sent) {
        // Fallback: sync XHR (deprecated but works during unload)
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/presence/heartbeat', false); // sync
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.setRequestHeader('Authorization', 'Bearer ' + jwt);
          xhr.send(body);
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Wire up browser close
  window.addEventListener('beforeunload', function () {
    sendOfflineMarker();
  });

  // Wire up logout button (belt-and-suspenders on top of beforeunload)
  // We expose the marker function globally so app.js logout handler can call it
  window.__mumsPresenceOffline = sendOfflineMarker;

  // ── BOOT ────────────────────────────────────────────────────────────────────
  async function init() {
    if (initialized) return;
    initialized = true;

    // Wait for env + session
    try { await (window.__MUMS_ENV_READY || Promise.resolve()); } catch (_) {}
    var env = window.MUMS_ENV || {};
    if (!env.SUPABASE_URL) return; // No env = not deployed, skip

    // Wait for session hydration
    try {
      if (window.__MUMS_SESSION_HYDRATED) {
        await Promise.race([
          window.__MUMS_SESSION_HYDRATED,
          new Promise(function (resolve) { setTimeout(resolve, 10000); })
        ]);
      }
    } catch (_) {}

    lastBeatAt = readLastBeat() || 0;

    // First beat after hydration (slight delay so presence_client.js goes first)
    setTimeout(function () { fireHeartbeat('init'); }, 1200);

    // Backup poll — offset from presence_client's interval deliberately
    backupPollTimer = setInterval(backupPoll, WATCHDOG_POLL_MS);
  }


  function stop() {
    stopped = true;
    try { if (backupPollTimer) clearInterval(backupPollTimer); } catch (_) {}
    backupPollTimer = null;
    try { if (heartbeatCoalesceTimer) clearTimeout(heartbeatCoalesceTimer); } catch (_) {}
    heartbeatCoalesceTimer = null;
  }

  window.presenceWatchdog = { stop: stop };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
