/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/*
  CloudAuth (Supabase Auth wrapper)
  ------------------------------------------------------------
  This module intentionally provides backward-compatible method
  names used across earlier iterations of the app:
    - isEnabled() / enabled()
    - signIn()    / login()
    - signOut()   / logout()

  Only SAFE (public) env values are used from /api/env.
*/
(function(){
  const DBG = (window.MUMS_DEBUG || {log(){},warn(){},error(){}});

  const LS_SESSION = 'mums_supabase_session';
  // In-memory fallback for browsers/environments where localStorage is blocked
  // (e.g., strict privacy/tracking prevention settings).
  let memSession = null;
  let refreshTimer = null;


  function _cookieSecureFlag(){
    try { return (location && location.protocol === 'https:'); } catch (_) { return false; }
  }
  function _setCookie(name, value, days){
    try {
      const maxAge = (days ? (days * 86400) : 86400 * 30);
      const secure = _cookieSecureFlag() ? '; Secure' : '';
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
    } catch (_) {}
  }
  function _getCookie(name){
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g,'\\$1') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (_) { return ''; }
  }
  function _delCookie(name){
    try {
      const secure = _cookieSecureFlag() ? '; Secure' : '';
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    } catch (_) {}
  }
  function _minifySession(session){
    if(!session) return null;
    const u = session.user || null;
    let expires_at = session.expires_at || null;
    if(!expires_at && session.expires_in){
      expires_at = Math.floor(Date.now()/1000) + Number(session.expires_in||0);
    }
    return {
      access_token: session.access_token || '',
      refresh_token: session.refresh_token || '',
      expires_at,
      user: u ? { id: u.id, email: u.email } : null
    };
  }


  function env(){
    try{ return (window.EnvRuntime && EnvRuntime.env) ? EnvRuntime.env() : (window.MUMS_ENV || {}); }catch(_){ return (window.MUMS_ENV || {}); }
  }

  // FIX v3.9.24: 10s AbortController timeout added.
  // Without this, 502/CORS from a new/throttled Supabase project hangs fetch
  // indefinitely causing login button to be stuck for 1-2 minutes with no feedback.
  function apiFetch(path, opts){
    const e = env();
    const base = String(e.SUPABASE_URL || '').replace(/\/$/, '');
    const anon = String(e.SUPABASE_ANON_KEY || '');
    if(!base || !anon) throw new Error('Supabase env missing (SUPABASE_URL/SUPABASE_ANON_KEY)');

    const url = base + path;
    const o = Object.assign({ method:'GET', headers:{} }, (opts||{}));
    o.headers = Object.assign({
      'apikey': anon,
      'Authorization': `Bearer ${anon}`
    }, (o.headers||{}));

    // 10s timeout — prevents login hanging on 502/CORS/throttled Supabase.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    o.signal = controller.signal;
    return fetch(url, o).finally(() => clearTimeout(timer));
  }

  function readSession(){
    // Priority: localStorage → sessionStorage → cookie → in-memory
    try{
      const raw = localStorage.getItem(LS_SESSION);
      if(raw){ return JSON.parse(raw); }
    }catch(e){
      DBG.warn('cloud_auth.readSession.localStorage_error', {e: String(e)});
    }
    try{
      const raw = sessionStorage.getItem(LS_SESSION);
      if(raw){ return JSON.parse(raw); }
    }catch(e){
      DBG.warn('cloud_auth.readSession.sessionStorage_error', {e: String(e)});
    }
    try{
      const raw = _getCookie(LS_SESSION);
      if(raw){ return JSON.parse(raw); }
    }catch(e){
      DBG.warn('cloud_auth.readSession.cookie_error', {e: String(e)});
    }
    if(memSession) return memSession;
    return null;
  }

  function writeSession(session){
    // IMPORTANT: Supabase token payloads can be large. Persist a minimal, stable
    // session shape to avoid cookie/localStorage bloat and reduce login/reconnect loops.
    const min = _minifySession(session || null);
    memSession = min;
    const payload = JSON.stringify(min || null);
    try{ localStorage.setItem(LS_SESSION, payload); }
    catch(e){ DBG.warn('cloud_auth.writeSession.localStorage_error', {e: String(e), len: payload.length}); }
    try{ sessionStorage.setItem(LS_SESSION, payload); }
    catch(e){ DBG.warn('cloud_auth.writeSession.sessionStorage_error', {e: String(e), len: payload.length}); }
    // Cookies are size-limited; best-effort only (minified payload).
    try{ _setCookie(LS_SESSION, payload, 30); }
    catch(e){ DBG.warn('cloud_auth.writeSession.cookie_error', {e: String(e), len: payload.length}); }
  }

  function clearSession(){
    memSession = null;
    try{ localStorage.removeItem(LS_SESSION); }catch(_){ }
    try{ sessionStorage.removeItem(LS_SESSION); }catch(_){ }
    try{ _delCookie(LS_SESSION); }catch(_){ }
  }

  function emitToken(){
    try {
      const t = accessToken();
      if (!t) return;
      window.dispatchEvent(new CustomEvent('mums:authtoken', { detail: { token: t } }));
    } catch (_) {}
  }

  function clearRefreshTimer(){
    try { if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; } } catch (_) {}
  }

  async function refreshSession(){
    try {
      const s = readSession();
      const rt = s && s.refresh_token ? String(s.refresh_token) : '';
      if (!rt) return { ok:false, message:'missing_refresh_token' };

      const r = await apiFetch('/auth/v1/token?grant_type=refresh_token', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ refresh_token: rt })
      });

      const bodyText = await r.text().catch(()=> '');
      let data = null;
      try{ data = bodyText ? JSON.parse(bodyText) : null; }catch(_){ data = null; }

      if (!r.ok || !data || !data.access_token) {
        // If refresh fails, force re-login on next protected action.
        return { ok:false, message:'refresh_failed', status:r.status, data };
      }

      // Preserve refresh token if not returned.
      if (!data.refresh_token && s && s.refresh_token) data.refresh_token = s.refresh_token;

      // Normalize expires_at if missing.
      if (!data.expires_at && data.expires_in) {
        data.expires_at = Math.floor(Date.now()/1000) + Number(data.expires_in);
      }

      writeSession(data);
      emitToken();
      scheduleRefresh(data);
      return { ok:true, session:data };
    } catch (_) {}
    return { ok:false, message:'refresh_exception' };
  }

  function scheduleRefresh(session){
    clearRefreshTimer();
    try {
      const s = session || readSession();
      if (!s) return;
      const expiresAt = s.expires_at ? Number(s.expires_at) : 0;
      let msUntil = 0;
      if (expiresAt) {
        msUntil = Math.max(0, (expiresAt * 1000) - Date.now());
      } else if (s.expires_in) {
        msUntil = Math.max(0, Number(s.expires_in) * 1000);
      }
      // Refresh 60s before expiry (min 15s).
      const refreshIn = Math.max(15000, msUntil - 60000);
      refreshTimer = setTimeout(refreshSession, refreshIn);
    } catch (_) {}
  }

  

// ----------------------
// JWT expiry hardening
// ----------------------
function _b64UrlDecodeToJson(b64url){
  try{
    let b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = atob(b64);
    return JSON.parse(json);
  }catch(_){
    return null;
  }
}

function decodeJwtPayload(token){
  try{
    const t = String(token || '');
    const parts = t.split('.');
    if (parts.length !== 3) return null;
    return _b64UrlDecodeToJson(parts[1]);
  }catch(_){
    return null;
  }
}

function jwtExpSeconds(token){
  try{
    const p = decodeJwtPayload(token);
    if(!p) return null;
    const exp = p.exp;
    // exp must be a finite number in seconds since epoch.
    if (typeof exp !== 'number') return null;
    if (!isFinite(exp) || exp <= 0) return null;
    // Guard against accidental ms timestamps (should be ~1e9..2e9 currently).
    if (exp > 10_000_000_000) return null;
    return exp;
  }catch(_){
    return null;
  }
}

function isJwtExpired(token, leewaySec){
  const t = String(token || '');
  if(!t) return true;
  const exp = jwtExpSeconds(t);
  if(!exp) return true; // invalid token shape/claims
  const now = Math.floor(Date.now()/1000);
  const leeway = Math.max(0, Number(leewaySec || 0));
  return now >= (exp - leeway);
}

// Ensure the stored session is usable. If access_token is expired/invalid,
// attempt a silent refresh using refresh_token (if available).
async function ensureFreshSession(opts){
  opts = opts || {};
  const leewaySec = (opts.leewaySec !== undefined) ? Number(opts.leewaySec) : 30;
  const tryRefresh = (opts.tryRefresh !== false);
  const clearOnFail = (opts.clearOnFail !== false);

  const s = readSession();
  if(!s || !s.access_token) return { ok:true, status:'no_session' };

  const token = String(s.access_token || '');
  if(!token) return { ok:false, status:'missing_token' };

  // Exp / claim sanity
  const exp = jwtExpSeconds(token);
  if(!exp){
    if (tryRefresh) {
      const rr = await refreshSession();
      if (rr && rr.ok) return { ok:true, status:'refreshed', refreshed:true };
    }
    if (clearOnFail) { clearRefreshTimer(); clearSession(); }
    return { ok:false, status:'invalid_token' };
  }

  if(isJwtExpired(token, leewaySec)){
    if (tryRefresh) {
      const rr = await refreshSession();
      if (rr && rr.ok) return { ok:true, status:'refreshed', refreshed:true };
    }
    if (clearOnFail) { clearRefreshTimer(); clearSession(); }
    return { ok:false, status:'expired' };
  }

  return { ok:true, status:'valid' };
}

// Resume guards: browsers pause timers during sleep. When the tab wakes up,
// refresh an about-to-expire token immediately; otherwise force a clean relogin.
let __resumeCheckAt = 0;
let __resumePromise = null;
const RESUME_THROTTLE_MS = 4000;

async function __runResumeCheck(trigger){
  try{
    const now = Date.now();
    if ((now - __resumeCheckAt) < RESUME_THROTTLE_MS) return;
    __resumeCheckAt = now;

    if (__resumePromise) return await __resumePromise;

    __resumePromise = (async function(){
      try{
        const res = await ensureFreshSession({ tryRefresh:true, clearOnFail:false, leewaySec: 60 });
        if (res && res.ok) return res;

        // Hard stop: clear session to prevent 401/403 spam and notify the app.
        try { clearRefreshTimer(); clearSession(); } catch(_) {}
        try {
          window.dispatchEvent(new CustomEvent('mums:auth_invalid', { detail: { reason: (res && res.status) ? res.status : 'invalid', trigger: trigger || 'resume' } }));
        } catch (_) {}
        return res || { ok:false, status:'invalid' };
      } finally {
        __resumePromise = null;
      }
    })();

    return await __resumePromise;
  }catch(_){
    return { ok:false, status:'resume_exception' };
  }
}

function installResumeGuards(){
  try{
    document.addEventListener('visibilitychange', function(){
      try{ if (!document.hidden) __runResumeCheck('visibility'); }catch(_){}
    });
  }catch(_){}
  try{ window.addEventListener('focus', function(){ __runResumeCheck('focus'); }); }catch(_){}
  try{ window.addEventListener('pageshow', function(){ __runResumeCheck('pageshow'); }); }catch(_){}
  try{ window.addEventListener('online', function(){ __runResumeCheck('online'); }); }catch(_){}
}

installResumeGuards();

function buildOAuthAuthorizeUrl(provider, opts){
  const e = env();
  const base = String(e.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(e.SUPABASE_ANON_KEY || '');
  if(!base || !anon) return '';
  const options = opts || {};
  const url = new URL(base + '/auth/v1/authorize');
  url.searchParams.set('provider', String(provider || '').trim());
  url.searchParams.set('scopes', String(options.scopes || 'email'));
  url.searchParams.set('redirect_to', String(options.redirectTo || window.location.origin));
  url.searchParams.set('skip_http_redirect', 'false');
  return url.toString();
}

async function signInWithAzure(opts){
  try{
    const url = buildOAuthAuthorizeUrl('azure', opts || {});
    if(!url) return { ok:false, message:'Supabase env missing (SUPABASE_URL/SUPABASE_ANON_KEY)' };
    window.location.assign(url);
    return { ok:true };
  }catch(e){
    return { ok:false, message:String(e && e.message ? e.message : e) };
  }
}

async function login(usernameOrEmail, password){
  const e = env();
  const domain = String(e.USERNAME_EMAIL_DOMAIN || 'mums.local');

  const id = String(usernameOrEmail||'').trim();
  if(!id) return { ok:false, message:'Missing username/email.' };

  // Guard: never hit the password grant endpoint with an empty/undefined password.
  // This prevents noisy 400s ("missing password") from accidental callers.
  const pw = String(password || '').trim();
  if (!pw) return { ok:false, message:'Missing password.' };

  // Accept either full email or username.
  const canonicalEmail = id.includes('@') ? id : `${id}@${domain}`;

  // FIX v3.9.24: 502/abort handling + stale-session clear before retry.
  // Old behaviour: 502 returned CORS error (no headers) → fetch threw → hung.
  // New behaviour: catch abort/CORS → clear stored session → single retry after 2s.
  async function passwordGrant(email, attempt){
    attempt = attempt || 1;
    let r;
    try {
      r = await apiFetch('/auth/v1/token?grant_type=password', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password: pw })
      });
    } catch(fetchErr) {
      // AbortError (10s timeout) or CORS/network failure
      const isAbort = fetchErr && fetchErr.name === 'AbortError';
      if (attempt < 2) {
        // Clear any stale session that might be causing the 502 loop, then retry once
        try { clearRefreshTimer(); clearSession(); } catch(_) {}
        await new Promise(res => setTimeout(res, 2000));
        return passwordGrant(email, 2);
      }
      return { ok:false, message: isAbort ? 'Login timed out. Supabase may be starting up — please try again in 30 seconds.' : 'Network error. Please check your connection and try again.', status: 0 };
    }

    const bodyText = await r.text().catch(()=> '');
    let data = null;
    try{ data = bodyText ? JSON.parse(bodyText) : null; }catch(_){ data = null; }

    if(!r.ok){
      // 502 = Supabase temporarily unavailable (new project warming up or throttled)
      if (r.status === 502 || r.status === 503) {
        try { clearRefreshTimer(); clearSession(); } catch(_) {}
        if (attempt < 2) {
          await new Promise(res => setTimeout(res, 2000));
          return passwordGrant(email, 2);
        }
        return { ok:false, message: 'Supabase is temporarily unavailable (502). Please wait 30 seconds and try again.', status: r.status };
      }
      const msg = (data && (data.error_description || data.msg || data.message || data.error)) ? (data.error_description || data.msg || data.message || data.error) : bodyText;
      return { ok:false, message: String(msg || 'Login failed.'), status:r.status, data };
    }
    // Supabase returns access_token + user
    if (!data.expires_at && data.expires_in) {
      data.expires_at = Math.floor(Date.now()/1000) + Number(data.expires_in);
    }
    return { ok:true, session:data, user:data.user || null };
  }

  // First attempt: canonical email (username@domain or the email provided).
  let out = await passwordGrant(canonicalEmail);

  // Legacy fallback: if the user typed a username and canonical fails, try resolving to a stored profile email.
  if(!out.ok && !id.includes('@')){
    const msg = String(out.message || '').toLowerCase();
    const mightBeEmailMismatch = msg.includes('invalid login credentials') || msg.includes('invalid_grant') || msg.includes('invalid grant');
    if(mightBeEmailMismatch){
      try{
        const rr = await fetch('/api/users/resolve_email?username=' + encodeURIComponent(id), { method:'GET' });
        const dd = await rr.json().catch(()=> ({}));
        // dd may be either the direct payload or {ok:true,data:{...}} depending on caller.
        const resolved = (dd && (dd.resolved_email || (dd.data && dd.data.resolved_email))) ? (dd.resolved_email || (dd.data && dd.data.resolved_email)) : '';
        if(rr.ok && resolved && String(resolved).toLowerCase() !== String(canonicalEmail).toLowerCase()){
          out = await passwordGrant(resolved);
        }
      }catch(_){}
    }
  }

  if(!out.ok) return { ok:false, message: out.message || 'Login failed.' };

  writeSession(out.session);
  emitToken();
  scheduleRefresh(out.session);
  return { ok:true, session:out.session, user:out.user || null };
}


  async function logout(){
    // Best-effort: clear local session. (Server revoke is optional.)
    clearRefreshTimer();
    clearSession();
    return { ok:true };
  }

  function accessToken(){
  const s = readSession();
  const t = (s && s.access_token) ? String(s.access_token) : '';
  if (!t) return '';
  // Never expose expired/invalid JWTs to callers (prevents 401/403 spam + InvalidJWTToken crashes).
  try{
    if (isJwtExpired(t, 10)) return '';
  }catch(_){
    return '';
  }
  return t;
}

  function getUser(){
    const s = readSession();
    return (s && s.user) ? s.user : null;
  }

  function enabled(){
    const e = env();
    if(e.SUPABASE_URL && e.SUPABASE_ANON_KEY) return true;
    // Cold start: EnvRuntime may not be ready yet. If a session exists, allow auth-dependent flows.
    try{
      const s = readSession();
      if(s && (s.access_token || (s.session && s.session.access_token))){
        DBG.warn('cloud_auth.enabled.env_missing_but_session_present', {hasUrl: !!e.SUPABASE_URL, hasKey: !!e.SUPABASE_ANON_KEY});
        return true;
      }
    }catch(e){}
    return false;
  }

  function absorbOAuthCallbackSession(){
    try{
      const hash = String(window.location.hash || '').replace(/^#/, '');
      if(!hash) return false;
      const params = new URLSearchParams(hash);

      // OAuth provider/database-trigger failures are returned in the callback hash.
      // Surface the exact description so login UI can show the real failure reason
      // instead of silently looping back to the login page.
      if (params.get('error')) {
        const error = String(params.get('error') || 'oauth_error');
        const errorDescription = String(params.get('error_description') || params.get('errorDescription') || error || 'OAuth sign-in failed.');
        try {
          localStorage.setItem('mums_login_flash', errorDescription);
        } catch (_) {}
        try {
          window.dispatchEvent(new CustomEvent('mums:oauth_error', { detail: { error, error_description: errorDescription } }));
        } catch (_) {}
        try {
          const cleanError = window.location.pathname + window.location.search;
          window.history.replaceState({}, document.title, cleanError);
        } catch (_) {}
        return false;
      }

      if(!hash.includes('access_token=')) return false;
      const access_token = String(params.get('access_token') || '');
      if(!access_token) return false;
      const refresh_token = String(params.get('refresh_token') || '');
      const expires_in = parseInt(String(params.get('expires_in') || '0'), 10) || 0;
      const expires_at = expires_in > 0 ? (Math.floor(Date.now()/1000) + expires_in) : null;
      const payload = decodeJwtPayload(access_token) || {};
      const user = {
        id: String(payload.sub || params.get('user_id') || ''),
        email: String(payload.email || params.get('email') || '')
      };
      const prev = readSession() || {};
      const mergedUser = {
        id: user.id || (prev.user && prev.user.id) || '',
        email: user.email || (prev.user && prev.user.email) || ''
      };
      writeSession({ access_token, refresh_token: refresh_token || (prev.refresh_token || ''), expires_at, user: mergedUser });
      try { localStorage.removeItem('mums_login_flash'); } catch (_) {}
      emitToken();
      scheduleRefresh(readSession());
      try{
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState({}, document.title, clean);
      }catch(_){ }

      // Successful OAuth callback on login page should continue to app shell.
      try {
        const p = String(window.location.pathname || '').toLowerCase();
        if (p.endsWith('/login.html') || p.endsWith('/login')) {
          window.location.replace('./dashboard');
        }
      } catch (_) {}
      return true;
    }catch(_){
      return false;
    }
  }

  // Backward-compatible wrappers
  async function signIn(usernameOrEmail, password){
    const out = await login(usernameOrEmail, password);
    if(out && out.ok) return { ok:true, user: out.user, session: out.session };
    return { ok:false, message: (out && out.message) ? out.message : 'Login failed.' };
  }

  async function signOut(){
    return logout();
  }

  window.CloudAuth = {
    // Canonical
    enabled,
    login,
    logout,
    accessToken,
    loadSession: readSession,
    getUser,
    refreshSession,
    ensureFreshSession,
    signInWithAzure,

    // Compatibility
    isEnabled: enabled,
    signIn,
    signOut
  };

  try { absorbOAuthCallbackSession(); } catch (_) {}

  // If a session is already present (page reload / new tab), validate/refresh it
// immediately so realtime/polling does not resume with a stale/invalid JWT.
try {
  const s = readSession();
  if (s && s.access_token) {
    // FIX v3.9.24: On 502/network error at boot, clear stale session immediately.
    // Stale sessions from old Supabase project cause a refresh loop → CORS spam.
    ensureFreshSession({ tryRefresh:true, clearOnFail:false, leewaySec: 60 })
      .then(function(res){
        try {
          const t = accessToken();
          if (t) emitToken();
          const ss = readSession();
          if (ss && ss.access_token) scheduleRefresh(ss);
        } catch (_) {}
        try {
          if (res && !res.ok && (res.status === 'expired' || res.status === 'invalid_token' || res.status === 'refresh_failed' || res.status === 'invalid')) {
            clearRefreshTimer();
            clearSession();
            window.dispatchEvent(new CustomEvent('mums:auth_invalid', { detail: { reason: res.status, trigger: 'boot' } }));
          }
        } catch (_) {}
      })
      .catch(function(){
        // Network error at boot (502/CORS) — clear session to stop retry loops
        try { clearRefreshTimer(); clearSession(); } catch(_) {}
      });
  }
} catch (_) {}
})();
