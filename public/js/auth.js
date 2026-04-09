/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(function(){
  const DBG = (window.MUMS_DEBUG || {
    enabled: false,
    log: function(){},
    warn: function(){},
    error: function(){},
    snapshot: function(){},
    redirect: function(target){ try{ window.location.href = target; } catch(_){} }
  });

  // NOTE: Local mode is kept for offline/dev fallback. In production,
  // CloudAuth (Supabase) should be enabled via env variables.


  // Session hydration barrier:
  // Background network work (e.g., presence polling) should wait until Auth.requireUser
  // finishes hydrating the Store/profile to avoid slowing first paint and dashboard render.
  if (!window.__MUMS_SESSION_HYDRATED) {
    window.__MUMS_SESSION_HYDRATED = new Promise((resolve) => { window.__MUMS_SESSION_HYDRATED_RESOLVE = resolve; });
  }
  function resolveHydrated(user){
    try{
      if (window.__MUMS_SESSION_HYDRATED_RESOLVE) {
        window.__MUMS_SESSION_HYDRATED_RESOLVE(user || true);
        window.__MUMS_SESSION_HYDRATED_RESOLVE = null;
        try {
          window.dispatchEvent(new CustomEvent('mums:session_hydrated', { detail: { userId: user && (user.id || user.user_id || user.userId) } }));
        } catch (_) {}
      }
    } catch (_) {}
  }

  let currentUser = null;

  // Online roster cache (avoid repeated JSON.parse on hot paths).
  // Used only to reconcile role/team display, not for authentication.
  let __onlineRaw = '';
  let __onlineMap = null;
  function getOnlineMapCached(){
    try{
      const raw = localStorage.getItem('mums_online_users') || '';
      if(!raw){ __onlineRaw = ''; __onlineMap = null; return null; }
      if(raw === __onlineRaw && __onlineMap) return __onlineMap;
      __onlineRaw = raw;
      __onlineMap = JSON.parse(raw);
      return __onlineMap;
    }catch(_){
      __onlineRaw = ''; __onlineMap = null;
      return null;
    }
  }

  // Deferred Store patches to prevent re-entrant render loops.
  // dispatchEvent('mums:store') is synchronous; updating Store inside Auth.getUser()
  // can cause immediate recursive calls (sidebar/route re-renders).
  const __pendingUserPatches = new Map();
  let __pendingPatchTimer = null;
  function scheduleUserPatch(userId, patch){
    try{
      const id = String(userId || '').trim();
      if(!id) return;
      if(!(window.Store && typeof Store.updateUser === 'function')) return;
      const prev = __pendingUserPatches.get(id) || {};
      const next = Object.assign({}, prev, patch || {});
      __pendingUserPatches.set(id, next);
      if(__pendingPatchTimer) return;
      __pendingPatchTimer = setTimeout(function(){
        __pendingPatchTimer = null;
        try{
          const entries = Array.from(__pendingUserPatches.entries());
          __pendingUserPatches.clear();
          entries.forEach(function(pair){
            try{ Store.updateUser(pair[0], pair[1]); }catch(_){ }
          });
        }catch(_){ __pendingUserPatches.clear(); }
      }, 0);
    }catch(_){ }
  }

  function emitAuth(type){
    try { window.dispatchEvent(new CustomEvent('mums:auth', { detail: { type } })); } catch (_) {}
  }

  const Auth = {
    getUser() {
      // Keep user context fresh:
      // - Sidebar role/shift must update immediately after any role/team change.
      // - Prefer the latest Store record, and optionally reconcile from the online roster cache.
      const norm = (v)=> (v === null || v === undefined) ? '' : String(v);
      const same = (a,b)=> norm(a) === norm(b);

      const reconcileFromStore = (uid)=>{
        const id = String(uid || '').trim();
        if(!id) return null;
        if(!(window.Store && Store.getUserById)) return null;
        const su = Store.getUserById(id);
        if(!su) return null;

        const missing = (!currentUser) || (currentUser.role == null) || (currentUser.username == null) || (currentUser.name == null) || (currentUser.teamId == null);
        const changed = (!currentUser)
          || !same(currentUser.role, su.role)
          || !same(currentUser.teamId, su.teamId)
          || !same(currentUser.teamOverride, su.teamOverride)
          || !same(currentUser.name, su.name)
          || !same(currentUser.username, su.username);

        if(missing || changed){
          currentUser = Object.assign({}, (currentUser || {}), su);
          return currentUser;
        }
        return currentUser || su;
      };

      const reconcileFromOnline = (uid)=>{
        const id = String(uid || '').trim();
        if(!id) return;
        if(!currentUser) return;
        try{
          const map = getOnlineMapCached();
          if(!map) return;
          const r = map && map[id];
          if(!r) return;

          let changed = false;
          const role = r.role || r.role_id || r.roleId || '';
          const team = (r.teamId !== undefined) ? r.teamId : ((r.team_id !== undefined) ? r.team_id : '');

          if(role && !same(currentUser.role, role)){ currentUser.role = String(role); changed = true; }
          if(!same(currentUser.teamId, team)){ currentUser.teamId = (team === null || team === undefined) ? '' : String(team); changed = true; }

          if(changed){
            // IMPORTANT: never update Store synchronously from inside Auth.getUser().
            // Store updates dispatch synchronous events that can re-enter Auth.getUser()
            // via sidebar/route render hooks, causing a tight loop and UI freeze.
            scheduleUserPatch(id, { role: currentUser.role, teamId: currentUser.teamId });
          }
        }catch(_){}
      };

      if (currentUser) {
        try {
          const cid = currentUser.id || currentUser.user_id;
          if (cid) {
            reconcileFromStore(cid);
            reconcileFromOnline(cid);
          }
        } catch (_) {}
        return currentUser;
      }

      try {
        const sess = window.Store && Store.getSession ? Store.getSession() : null;
        if (sess && sess.userId) {
          const u = window.Store && Store.getUserById ? Store.getUserById(sess.userId) : null;
          if (u) { currentUser = u; return u; }
        }
      } catch (_) {}
      return null;
    },// Require login (async; attempts to restore Supabase session before redirecting)
    async requireUser(opts) {
      opts = opts || {};
      const redirect = (opts.redirect !== false);

      // Base hydration cap (attempt #1). Attempt #2 can extend for first-time logins.
      const baseMaxMs = Number((opts && opts.maxMs) || 3000);
      const retryDelayMs = Number((opts && opts.retryDelayMs) || 300);

      const log = function(){
        try{ console.log.apply(console, ['[MUMS][hydrate]'].concat([].slice.call(arguments))); }catch(_){}
      };
      const warn = function(){
        try{ console.warn.apply(console, ['[MUMS][hydrate]'].concat([].slice.call(arguments))); }catch(_){}
      };

      const sleep = (ms)=> new Promise((resolve)=> setTimeout(resolve, ms));

      const clearFlash = ()=>{
        try{ localStorage.removeItem('mums_login_flash'); }catch(_){}
      };

      const isValidUser = (usr)=>{
        try{
          if(!usr) return false;
          const id = usr.id || usr.user_id || usr.userId;
          const role = usr.role;
          return !!(id && String(id).trim() && role && String(role).trim());
        }catch(_){ return false; }
      };

      const hardFail = async (message)=>{
        const msg = message || 'Login failed due to session error. Please try again.';
        try{ localStorage.setItem('mums_login_flash', msg); }catch(_){ }
        try{ window.CloudAuth && CloudAuth.signOut && (await CloudAuth.signOut()); }catch(_){ }
        try{ window.Store && Store.setSession && Store.setSession(null); }catch(_){ }
        currentUser = null;
        resolveHydrated(null);
        if (redirect) {
          try { window.location.href = '/login.html'; } catch(_) { }
        }
      };


// JWT validity preflight (boot/resume):
// If the stored access token is expired/invalid, attempt a silent refresh.
// If refresh is not possible, force a clean relogin to prevent 401/403 spam.
try {
  if (window.CloudAuth && CloudAuth.enabled && CloudAuth.enabled() && typeof CloudAuth.ensureFreshSession === 'function') {
    const g = await CloudAuth.ensureFreshSession({ tryRefresh:true, clearOnFail:false, leewaySec: 60 });
    if (g && !g.ok && (g.status === 'expired' || g.status === 'invalid_token' || g.status === 'missing_token')) {
      await hardFail('Session expired. Please log in again.');
      return null;
    }
  }
} catch (_) {
  await hardFail('Session expired. Please log in again.');
  return null;
}
      // Attempt hydration with a bounded deadline. Returns a valid user or null (no redirects/flash here).
      const attemptHydrate = async (maxMs, attemptNo)=>{
        const deadline = Date.now() + Math.max(500, Number(maxMs) || 0);
        const timeLeft = ()=> Math.max(0, deadline - Date.now());

        log('attempt', attemptNo, 'start (maxMs=', Math.max(500, Number(maxMs) || 0), ')');

        // Fast path: if getUser() returns a fully-hydrated profile, accept it.
        // IMPORTANT: if getUser() returns an incomplete Supabase user object (no role/team),
        // do NOT fail. Continue hydration instead (this is the first-time login bug).
        let u = null;
        try{ u = this.getUser(); }catch(_){ u = null; }
        if (u && !isValidUser(u)) {
          warn('attempt', attemptNo, 'getUser returned incomplete user; continuing hydration');
          u = null;
        }
        if (u) {
          clearFlash();
          resolveHydrated(u);
          log('attempt', attemptNo, 'fast path success');
          return u;
        }

        const withTimeout = async (promise)=>{
          const ms = timeLeft();
          if (ms <= 0) return { __timeout: true };
          return await Promise.race([
            promise,
            new Promise((resolve)=> setTimeout(()=> resolve({ __timeout: true }), ms))
          ]);
        };

        const work = async ()=>{
          // CloudAuth restore path (Supabase)
          try{
            if (window.CloudAuth && CloudAuth.enabled && CloudAuth.enabled()) {
              const sbUser = CloudAuth.getUser ? CloudAuth.getUser() : null;
              if (sbUser && sbUser.id) {

                // Guard: do not proceed with protected calls if the JWT is missing/expired.
                const __jwt0 = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
                if (!__jwt0) return null;
                if (timeLeft() <= 0) return null;

                // Ensure Store session points at this Supabase user
                try {
                  const sess = (window.Store && Store.getSession) ? Store.getSession() : null;
                  if (!sess || String(sess.userId) !== String(sbUser.id) || sess.mode !== 'supabase') {
                    Store.setSession && Store.setSession({ userId: sbUser.id, mode: 'supabase', ts: Date.now() });
                  }
                } catch (_) {}

                if (timeLeft() <= 0) return null;

                // Try resolving from Store again
                try{ u = this.getUser(); }catch(_){ u = null; }
                if (u && isValidUser(u)) return u;

                // Deleted-account guard
                try {
                  const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
                  if (jwt) {
                    const r = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${jwt}` } });
                    const data = await r.json().catch(() => ({}));
                    const err = String((data && (data.error || data.code)) || '').trim();
                    if (r.status === 403 && err === 'account_removed') {
                      try { await CloudAuth.signOut(); } catch (_) {}
                      try { window.Store && Store.setSession && Store.setSession(null); } catch (_) {}
                      currentUser = null;
                      resolveHydrated(null);
                      if (redirect) window.location.href = '/login.html';
                      return null;
                    }
                  }
                } catch (_) {}

                if (timeLeft() <= 0) return null;

                // Ensure profile exists (first-time login creates the row here)
                let ensured = null;
                try {
                  ensured = (window.CloudUsers && CloudUsers.ensureProfile) ? await CloudUsers.ensureProfile() : null;
                  if (ensured && ensured.created) log('attempt', attemptNo, 'ensureProfile created new profile');
                } catch (e) {
                  warn('attempt', attemptNo, 'ensureProfile error', e && e.message ? e.message : e);
                }

                if (timeLeft() <= 0) return null;

                // Hydrate directory into Store
                try {
                  if (window.CloudUsers && CloudUsers.refreshIntoLocalStore) {
                    await CloudUsers.refreshIntoLocalStore();
                  }
                } catch (e) {
                  warn('attempt', attemptNo, 'refreshIntoLocalStore error', e && e.message ? e.message : e);
                }

                if (timeLeft() <= 0) return null;

                // Also hydrate /api/users/me into Store so role/team is authoritative
                try {
                  const me = (window.CloudUsers && typeof CloudUsers.me === 'function') ? await CloudUsers.me() : null;
                  if (me && me.ok && me.profile) {
                    const p = me.profile;
                    const uid = p.user_id || p.id || sbUser.id;
                    if (window.Store && typeof Store.setProfile === 'function' && uid) {
                      try {
                        Store.setProfile(uid, Object.assign({}, p, { updatedAt: Date.now() }));
                      } catch (_) {}
                    }
                    if (window.Store && typeof Store.getUsers === 'function' && typeof Store.saveUsers === 'function') {
                      const users = Array.isArray(Store.getUsers()) ? Store.getUsers() : [];
                      const next = users.slice();
                      const patch = {
                        id: uid,
                        username: p.username || (sbUser.email ? sbUser.email.split('@')[0] : ''),
                        name: p.name || p.username || (sbUser.email || 'User'),
                        role: p.role || 'MEMBER',
                        teamId: p.team_id || null,
                        duty: p.duty || '—',
                        photoDataUrl: p.avatar_url || '',
                        password: null,
                        _cloud: true
                      };
                      const at = next.findIndex((x) => String(x.id) === String(uid));
                      if (at >= 0) next[at] = Object.assign({}, next[at], patch);
                      else next.push(patch);
                      Store.saveUsers(next);
                    }
                  }
                } catch (e) {
                  warn('attempt', attemptNo, 'CloudUsers.me hydrate error', e && e.message ? e.message : e);
                }

                if (timeLeft() <= 0) return null;

                // Resolve again
                try{ u = this.getUser(); }catch(_){ u = null; }
                if (u && isValidUser(u)) return u;

                try {
                  const su = (window.Store && Store.getUserById) ? Store.getUserById(sbUser.id) : null;
                  if (su && isValidUser(su)) { currentUser = su; return su; }
                } catch (_) {}

                // Last resort: minimal user (keeps UX unblocked; role may be updated after directory sync)
                const minimal = {
                  id: sbUser.id,
                  username: (sbUser.email || '').split('@')[0] || 'user',
                  email: sbUser.email || '',
                  name: sbUser.email || 'User',
                  role: 'MEMBER',
                  teamId: null,
                  duty: ''
                };
                currentUser = minimal;
                return minimal;
              }
            }
          }catch(e){
            warn('attempt', attemptNo, 'CloudAuth restore error', e && e.message ? e.message : e);
          }
          return null;
        };

        const res = await withTimeout(work());
        if (res && res.__timeout) {
          warn('attempt', attemptNo, 'timed out');
          return null;
        }

        if (res && !isValidUser(res)) {
          warn('attempt', attemptNo, 'hydration returned invalid user');
          return null;
        }

        if (res) {
          clearFlash();
          resolveHydrated(res);
          log('attempt', attemptNo, 'success');
          return res;
        }

        log('attempt', attemptNo, 'no user');
        return null;
      };

      // Attempt #1: base cap
      let out = await attemptHydrate(baseMaxMs, 1);
      if (out) return out;

      // Retry once silently (first-time logins can be slower due to profile creation).
      await sleep(Math.max(0, retryDelayMs));
      out = await attemptHydrate(Math.max(baseMaxMs, 4000), 2);
      if (out) return out;

      // Confirmed failure (both attempts failed)
      await hardFail('Login failed due to session error. Please try again.');
      return null;
    },
    async requireLogin() { return this.requireUser(); },


    async login(identifier, password) {
      const idf = (identifier || '').trim();
      const pass = (password || '').trim();
      if (!idf || !pass) return { ok: false, message: 'Please enter username/email and password.' };

      // Cloud-first
      if (window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled()) {
        const out = await CloudAuth.signIn(idf, pass);
        if (!out.ok) return out;

        // Login-time guard:
        // If the user exists in Supabase Auth but no longer has a directory profile
        // (deleted user), block access and surface a clear error.
        try {
          const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
          if (jwt) {
            const r = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${jwt}` } });
            const data = await r.json().catch(() => ({}));
            const err = String((data && (data.error || data.code)) || '').trim();
            if (r.status === 403 && err === 'account_removed') {
              try { await CloudAuth.signOut(); } catch (_) {}
              try { window.Store && Store.setSession && Store.setSession(null); } catch (_) {}
              currentUser = null;
              return { ok: false, message: 'This account has been removed from the system.' };
            }
          }
        } catch (_) {}

        try {
          window.Store && Store.setSession && Store.setSession({ userId: out.user.id, at: Date.now(), mode: 'supabase' });
        } catch (_) {}

        // Login delay optimization:
        // Do NOT block login navigation on profile bootstrapping. The dashboard boot
        // (Auth.requireUser) will ensure mums_profiles exists and hydrate the Store.
        // Best-effort: start ensureProfile in the background and swallow errors.
        try {
          if (window.CloudUsers && CloudUsers.ensureProfile) {
            const p = CloudUsers.ensureProfile();
            if (p && p.catch) p.catch(function(){});
          }
        } catch (_) {}

        // Do not block the login flow on a full directory fetch.
        // Index boot will refresh the directory cache in the background.

        // Clear stale flash messages after a successful login.
        try{ localStorage.removeItem('mums_login_flash'); }catch(_){ }

        // IMPORTANT: do not set currentUser to the raw Supabase user object.
        // The raw object has no role/team; Auth.requireUser will hydrate the full profile.
        currentUser = null;

        emitAuth('login');
        return { ok: true, user: out.user };
      }

      // Local fallback
      const u = window.Store && Store.findUserByLogin ? Store.findUserByLogin(idf, pass) : null;
      if (!u) return { ok: false, message: 'User not found.' };

      currentUser = u;
      try {
        window.Store && Store.setSession && Store.setSession({ userId: u.id, at: Date.now(), mode: 'local' });
      } catch (_) {}

      emitAuth('login');
      return { ok: true, user: u };
    },

    // Deterministic lightweight hash used for legacy local-user `passwordHash`
    // and client-side key derivation in offline mode.
    //
    // IMPORTANT: This is NOT intended to be a secure password hashing
    // mechanism. Supabase Auth handles real credentials.
    hash(input) {
      const str = String(input ?? '');
      // FNV-1a 32-bit
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      // Return fixed-width hex.
      return ('00000000' + h.toString(16)).slice(-8);
    },

    async logout() {
      currentUser = null;
      try {
        if (window.CloudAuth && CloudAuth.signOut) await CloudAuth.signOut();
      } catch (_) {}
      try {
        window.Store && Store.setSession && Store.setSession(null);
      } catch (_) {}
      emitAuth('logout');
      window.location.href = '/login.html';
    }
  };


// Global: if CloudAuth detects an invalid/expired JWT during resume, force a clean relogin.
async function __forceRelogin(message){
  const msg = message || 'Session expired. Please log in again.';
  try{ localStorage.setItem('mums_login_flash', msg); }catch(_){}
  try{ window.CloudAuth && CloudAuth.signOut && (await CloudAuth.signOut()); }catch(_){}
  try{ window.Store && Store.setSession && Store.setSession(null); }catch(_){}
  currentUser = null;
  try{ resolveHydrated(null); }catch(_){}
  try {
    // Avoid redirect loops on login page; just reload to pick up the flash message.
    const p = String(location.pathname || '');
    if (p.toLowerCase().includes('login')) {
      window.location.reload();
    } else {
      window.location.href = '/login.html';
    }
  } catch(_) {}
}

try {
  if (!window.__MUMS_AUTH_INVALID_BOUND) {
    window.__MUMS_AUTH_INVALID_BOUND = true;
    window.addEventListener('mums:auth_invalid', function(e){
      try {
        const reason = e && e.detail && e.detail.reason ? String(e.detail.reason) : '';
        // Always surface the required UX message.
        __forceRelogin('Session expired. Please log in again.');
      } catch (_) {
        __forceRelogin('Session expired. Please log in again.');
      }
    });
  }
} catch (_) {}

  window.Auth = Auth;
})();
