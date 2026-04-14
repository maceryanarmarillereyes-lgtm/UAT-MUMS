/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(function(){
  function getClientId(){
    var key = 'mums_client_id';

    function cookieSecure(){
      try { return (location && location.protocol === 'https:'); } catch(_) { return false; }
    }
    function setCookie(name, value){
      try {
        var secure = cookieSecure() ? '; Secure' : '';
        document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + (86400*365) + '; SameSite=Lax' + secure;
      } catch(_) {}
    }
    function getCookie(name){
      try {
        var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\/\+^])/g,'\\$1') + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : '';
      } catch(_) { return ''; }
    }

    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
    } catch(_) {}

    try {
      var c = getCookie(key);
      if (c) return c;
    } catch(_) {}

    var id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

    try { localStorage.setItem(key, id); } catch(_) {}
    try { setCookie(key, id); } catch(_) {}

    return id;
  }

  // Ensure we have a fresh access token before hitting protected API routes.
  var __jwtPromise = null;
  async function getJwt(){
    try {
      if (window.CloudAuth && typeof CloudAuth.loadSession === 'function') {
        // Debounce concurrent refreshes.
        if (!__jwtPromise) {
          __jwtPromise = (async function(){
            try {
              if (typeof CloudAuth.ensureFreshSession === 'function') {
                await CloudAuth.ensureFreshSession({ tryRefresh:true, clearOnFail:false, leewaySec: 60 });
              } else {
                await CloudAuth.loadSession();
              }
            } catch(_) {}
            return (typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : '';
          })();
          // Reset the promise after completion so future calls can refresh again.
          __jwtPromise.finally(function(){ __jwtPromise = null; });
        }
        return await __jwtPromise;
      }
      return (window.CloudAuth && typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : '';
    } catch (e) {
      return '';
    }
  }

  async function authHeader(){
    var jwt = await getJwt();
    return jwt ? { Authorization: 'Bearer ' + jwt } : {};
  }

function jwtSub(jwt){
  try {
    var token = String(jwt || '');
    var parts = token.split('.');
    if (parts.length !== 3) return '';
    var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    var json = atob(payload);
    var obj = JSON.parse(json);
    return String(obj && (obj.sub || obj.user_id || obj.userId || '') || '').trim();
  } catch (_) {
    return '';
  }
}


  // Refresh token on 401 once, then retry the request.
  var __refreshPromise = null;
  var __lastRefreshAt = 0;
  var REFRESH_THROTTLE_MS = 20000;

  async function refreshAuthIfPossible(){
    try {
      var now = Date.now();
      if ((now - __lastRefreshAt) < REFRESH_THROTTLE_MS) return { ok:false, throttled:true };
      if (!window.CloudAuth || typeof CloudAuth.refreshSession !== 'function') return { ok:false, missing:true };

      if (!__refreshPromise) {
        __lastRefreshAt = now;
        __refreshPromise = (async function(){
          try { return await CloudAuth.refreshSession(); } catch (e) { return { ok:false, message:'refresh_throw' }; }
        })();
        __refreshPromise.finally(function(){ __refreshPromise = null; });
      }

      var res = await __refreshPromise;
      return res && res.ok ? { ok:true } : { ok:false, result: res };
    } catch (_) {
      return { ok:false, message:'refresh_exception' };
    }
  }

  async function fetchWithAuthRetry(url, opts){
    var options = Object.assign({}, (opts || {}));
    options.headers = Object.assign({}, (options.headers || {}), await authHeader());

    var r = await fetch(url, options);
    if (r.status !== 401 && r.status !== 403) return r;

    // Attempt refresh once and retry.
    var refreshed = await refreshAuthIfPossible();
    if (!refreshed.ok) return r;

    var options2 = Object.assign({}, (opts || {}));
    options2.headers = Object.assign({}, (options2.headers || {}), await authHeader());
    return await fetch(url, options2);
  }

  function toMs(iso){
    var t = Date.parse(iso);
    return isNaN(t) ? Date.now() : t;
  }

  function buildOnlineMap(rows){
    // Keep only the newest presence row per user_id.
    // The server returns rows ordered by last_seen DESC, but clients must not
    // blindly overwrite since any future sort change (or partial ordering) can
    // cause flicker.
    var map = {};
    (rows || []).forEach(function(r){
      var uid = r.user_id || r.userId || r.name || r.client_id;
      if (!uid) return;
      var lastSeen = toMs(r.last_seen || r.lastSeen || new Date().toISOString());
      var existing = map[uid];
      if (existing && Number(existing.lastSeen || 0) >= lastSeen) return;
      map[uid] = {
        userId: r.user_id || r.userId || uid,
        name: r.name || 'User',
        role: r.role || '',
        teamId: r.team_id || r.teamId || '',
        route: r.route || '',
        lastSeen: lastSeen
      };
    });
    return map;
  }

  async function postJson(url, body){
    return await fetchWithAuthRetry(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, (await authHeader())),
      body: JSON.stringify(body)
    });
  }

  async function waitForSessionHydration(){
    // Ensure CloudAuth restores the session before starting presence polling.
    // This prevents early 401s on cold loads that can flip sync UI.
    try {
      if (window.CloudAuth && typeof CloudAuth.loadSession === 'function') {
        var deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          try {
            if (typeof CloudAuth.ensureFreshSession === 'function') {
              await CloudAuth.ensureFreshSession({ tryRefresh:true, clearOnFail:false, leewaySec: 60 });
            } else {
              await CloudAuth.loadSession();
            }
          } catch(_) {}
          var t = (typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : '';
          if (t) return true;
          await new Promise(function(resolve){ setTimeout(resolve, 250); });
        }
      }
    } catch(_) {}
    return false;
  }


  async function waitForAppHydration(){
    // Prefer the app-level hydration barrier (Auth.requireUser) if present.
    // This avoids presence requests competing with initial profile/bootstrap fetches.
    try {
      var p = window.__MUMS_SESSION_HYDRATED;
      if (p && typeof p.then === 'function') {
        var timed = await Promise.race([
          p.then(function(){ return true; }),
          new Promise(function(resolve){ setTimeout(function(){ resolve(false); }, 12000); })
        ]);
        if (timed) return true;
      }
    } catch (_) {}
    // Fallback: token presence (legacy).
    return await waitForSessionHydration();
  }

  async function run(){
    await (window.__MUMS_ENV_READY || Promise.resolve());
    var env = window.MUMS_ENV || {};
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      // Presence works only when deployed with envs.
      return;
    }

    var clientId = getClientId();

    // Throttle repeated 401 debug updates to avoid spam.
    var last401At = 0;
    var THROTTLE_401_MS = 20000;

    var hbInFlight = false;
    var listInFlight = false;

    // If the currently logged-in user is deleted from the directory/auth system,
    // the backend will start returning { error: "account_removed" } for protected calls.
    // Enforce immediate logout to eliminate "ghost sessions".
    var __forcedLogout = false;
    var __consecutive401 = 0;
    var __lastOkAt = Date.now();
    function noteOk(){ __consecutive401 = 0; __lastOkAt = Date.now(); }
    async function forceLogoutAccountRemoved(msg){
      if(__forcedLogout) return;
      __forcedLogout = true;
      try{ localStorage.setItem('mums_login_flash', msg || 'This account has been removed from the system.'); }catch(_){}
      try{ window.CloudAuth && CloudAuth.signOut && (await CloudAuth.signOut()); }catch(_){}
      try{ window.Store && Store.setSession && Store.setSession(null); }catch(_){}
      try{ window.location.href = '/login.html'; }catch(_){}
    }

    // Heartbeat: update server presence.
    async function heartbeat(){
      if (hbInFlight) return;
      hbInFlight = true;
      try {
        // Presence is meaningful only for authenticated sessions.
        var jwt = await getJwt();
        if (!jwt) return;

        var me = null;
        try { me = (window.Auth && Auth.getUser) ? Auth.getUser() : null; } catch(_) { me = null; }
        var hb = await postJson('/api/presence/heartbeat', {
          clientId: clientId,
          route: location.hash || '',
          teamId: (me && me.teamId) ? me.teamId : '',
          role: (me && me.role) ? me.role : ''
        });

        // Deleted users must be forcibly logged out from active sessions.
        if (hb && hb.status === 403) {
          try {
            var data403 = await hb.json().catch(function(){ return {}; });
            var err403 = String((data403 && (data403.error || data403.code)) || '').trim();
            if (err403 === 'account_removed') {
              await forceLogoutAccountRemoved((data403 && data403.message) || 'This account has been removed from the system.');
              return;
            }
          } catch(_) {}
        }

        if (hb && hb.ok) { try { noteOk(); } catch(_) {} }

// If we still get a 401 after refresh attempt, treat as session invalid (e.g., deleted user, revoked session).
// Use a short consecutive threshold to avoid false positives during cold loads.
if (hb && hb.status === 401) {
  __consecutive401++;
  if (__consecutive401 >= 2 && (Date.now() - __lastOkAt) > 1500) {
    await forceLogoutAccountRemoved('This account has been removed from the system.');
    return;
  }
  var now = Date.now();
  if ((now - last401At) > THROTTLE_401_MS) {
    last401At = now;
    try { window.dispatchEvent(new CustomEvent('mums:debug', { detail: { source: 'presence_client', kind: 'http', status: 401, url: '/api/presence/heartbeat' } })); } catch(_) {}
  }
}
      } catch (e) {
        // Silent failure; best-effort.
      } finally {
        hbInFlight = false;
      }
    }

    // List: pull roster and update Store online map.
    async function refreshRoster(){
      if (listInFlight) return;
      listInFlight = true;
      try {
        var jwt = await getJwt();
        if (!jwt) return;

        var r = await fetchWithAuthRetry('/api/presence/list', { cache: 'no-store' });
        if (!r.ok) {
          // Deleted users must be forcibly logged out from active sessions.
          if (r.status === 403) {
            try {
              var data403 = await r.json().catch(function(){ return {}; });
              var err403 = String((data403 && (data403.error || data403.code)) || '').trim();
              if (err403 === 'account_removed') {
                await forceLogoutAccountRemoved((data403 && data403.message) || 'This account has been removed from the system.');
                return;
              }
            } catch(_) {}
          }

          
// If we still get a 401 after refresh attempt, treat as session invalid (e.g., deleted user, revoked session).
if (r.status === 401) {
  __consecutive401++;
  if (__consecutive401 >= 2 && (Date.now() - __lastOkAt) > 1500) {
    await forceLogoutAccountRemoved('This account has been removed from the system.');
    return;
  }
  var now = Date.now();
  if ((now - last401At) > THROTTLE_401_MS) {
    last401At = now;
    try {
      window.dispatchEvent(new CustomEvent('mums:debug', { detail: { source: 'presence_client', kind: 'http', status: 401, url: '/api/presence/list' } }));
    } catch(_) {}
  }
}
          return;
        }
        var data = await r.json();
        if (!data || !data.rows) return;
        try { noteOk(); } catch(_) {}

// Detect server broadcast deletion marker (short-lived) and force logout immediately.
try {
  var myId = jwtSub(jwt);
  if (myId && data && data.rows && data.rows.length) {
    var markerKey = 'deleted_' + myId;
    for (var i = 0; i < data.rows.length; i++) {
      var rr = data.rows[i] || {};
      var uid = String(rr.user_id || rr.userId || '').trim();
      var cid = String(rr.client_id || rr.clientId || '').trim();
      var route = String(rr.route || '').trim();
      if ((uid === markerKey || cid === markerKey) && (route === '__user_deleted__' || route === 'user_deleted' || route === '__deleted__')) {
        await forceLogoutAccountRemoved('This account has been removed from the system.');
        return;
      }
    }
  }
} catch (_) {}
        var map = buildOnlineMap(data.rows);
        if (window.Store && typeof Store.write === 'function') {
          Store.write('mums_online_users', map);
        } else {
          localStorage.setItem('mums_online_users', JSON.stringify(map));
          // Keep same-tab UI in sync even if Store is not loaded (some builds load presence earlier).
          try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'mums_online_users' } })); }catch(_){ }
        }
      } catch (e) {
        // ignore
      } finally {
        listInFlight = false;
      }
    }

    // Delay first poll until session is hydrated to avoid 401 flicker on cold loads.
    await waitForAppHydration();

    // IO-OPT: Use separate intervals for heartbeat (write) vs roster list (read).
    // PRESENCE_LIST_POLL_MS was already defined in env_runtime.js (90s) but was
    // never wired up here — both calls wrongly used PRESENCE_POLL_MS (45s).
    // Fix: heartbeat every 45s (minimum 30s), roster list every 90s (minimum 60s).
    // Net result: ~50% fewer presence DB reads for 30-user teams.
    // PERF FIX: Increase intervals for free tier stability.
    // Heartbeat: 45s -> 120s (2 min)
    // Roster: 90s -> 300s (5 min)
    var poll     = Number(env.PRESENCE_POLL_MS      || 120000);
    var listPoll = Number(env.PRESENCE_LIST_POLL_MS || 300000);
    // Yield one tick so first paint / routing is not delayed by background presence calls.
    setTimeout(function(){ try{ heartbeat(); }catch(_){} try{ refreshRoster(); }catch(_){} }, 500);

    setInterval(heartbeat,     Math.max(60000, poll));
    setInterval(refreshRoster, Math.max(120000, listPoll));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
