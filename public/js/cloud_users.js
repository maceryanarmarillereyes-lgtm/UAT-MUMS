/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
// ===== CODE UNTOUCHABLES =====
// Save button must disable immediately (dataset.busy=1).
// Cooldown UI must auto re-enable after retry window.
// Do NOT strip these behaviors in future versions.
// Exception: Only change if required by UX specification updates
// or documented frontend behavior changes.
// ==============================

// Cloud user directory sync helpers.
// Uses Vercel API routes (server-side Supabase service key) so no secrets are in the client.

const CloudUsers = (() => {
  const authHeader = () => {
    const jwt = window.CloudAuth && CloudAuth.accessToken ? CloudAuth.accessToken() : '';
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  };

  const list = async () => {
    const res = await fetch('/api/users/list', { headers: { ...authHeader() } });
    if (!res.ok) {
      return { ok: false, message: `Failed to load users (${res.status})` };
    }
    const body = await res.json().catch(() => null);
    // Accept either an array response (legacy) or { ok, rows }.
    const users = Array.isArray(body) ? body : (body && Array.isArray(body.rows) ? body.rows : []);
    return { ok: true, users };
  };

  const me = async () => {
    const res = await fetch('/api/users/me', { headers: { ...authHeader() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };

    const profile = data.profile || null;
    const email = String((data && (data.email || (profile && profile.email))) || '').trim();
    // Normalize: ensure `profile.email` is present for UI consumers that read from profile only.
    if (profile && !profile.email && email) {
      try { profile.email = email; } catch (_) {}
    }

    return { ok: true, email, profile, created: !!data.created, updated: !!data.updated };
  };

  const updateMe = async (patch) => {
    const res = await fetch('/api/users/update_me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(patch || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, data };
  };

  const updateUser = async (payload) => {
    const res = await fetch('/api/users/update_user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, data };
  };

  const resolveEmail = async (username) => {
    const u = String(username || '').trim();
    if (!u) return { ok: false, message: 'missing_username' };
    const res = await fetch('/api/users/resolve_email?username=' + encodeURIComponent(u), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, data };
  };


  const uploadAvatar = async (dataUrl) => {
    const res = await fetch('/api/users/upload_avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ dataUrl })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, url: data.url, data };
  };

  const removeAvatar = async () => {
    const res = await fetch('/api/users/remove_avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, data };
  };

  const refreshIntoLocalStore = async () => {
    const out = await list();
    if (!out.ok) return out;
    // Normalize to the existing local store user shape used by the offline app.
    const domain = (window.Config && Config.USERNAME_EMAIL_DOMAIN) ? String(Config.USERNAME_EMAIL_DOMAIN) : 'mums.local';

    const users = (out.users || []).map((p) => {
      const role = String(p.role || 'MEMBER').toUpperCase();
      const username = p.username || (p.email ? String(p.email).split('@')[0] : '');
      const email = p.email || (username ? (username + '@' + domain) : '');
      const teamIdRaw = (p.team_id === null || p.team_id === undefined) ? '' : String(p.team_id).trim();
      let teamOverride = !!(p.team_override ?? p.teamOverride ?? false);
      if ((role === 'SUPER_ADMIN' || role === 'SUPER_USER') && (p.team_override === undefined && p.teamOverride === undefined)) {
        // If DB doesn't provide an explicit override flag, infer it from team_id presence.
        teamOverride = !!teamIdRaw;
      }

      return {
        id: p.user_id || p.id,
        username: username,
        email,
        name: p.name || username || 'User',
        role: role || 'MEMBER',
        teamId: teamIdRaw, // '' => Developer Access
        teamOverride,
        duty: p.duty || '—',
        photoDataUrl: p.avatar_url || '',
        qb_name: p.qb_name || '',
        // Passwords are never stored client-side when using cloud auth.
        password: null,
        _cloud: true
      };
    });

    // Persist into the app's local Store so Auth.getUser() can resolve role/team/name.
    // Cloud roster must overwrite local roster to avoid duplicates/stale data.
    //
    // FIX (race condition): Write users SILENTLY so _usersCache is fully updated
    // BEFORE any mums:store event fires. A non-silent write dispatches the event
    // synchronously inside write(), which means listeners calling Store.getUsers()
    // would see the OLD stale empty cache — causing the User Management table to
    // appear blank even though data was returned. We fire the event manually AFTER
    // the cache is guaranteed to be current.
    try {
      if (window.Store) {
        if (typeof Store.setUsers === 'function') {
          // Clear silently first.
          try{ Store.setUsers([], { skipSanitize:true, silent:true }); }catch(_){ }
          // Write users silently — cache is updated but no premature render fired.
          Store.setUsers(users, { silent:true });
          // NOW dispatch: cache is fully current, any listener that calls getUsers() sees real data.
          try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'ums_users', source: 'cloud_refresh' } })); }catch(_){}
        } else if (typeof Store.saveUsers === 'function') {
          Store.saveUsers(users, { silent:true });
          try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'ums_users', source: 'cloud_refresh' } })); }catch(_){}
        } else if (typeof Store.importUsers === 'function') {
          Store.importUsers(users);
        } else {
          // Very old fallback: write directly.
          try { localStorage.setItem('ums_users', JSON.stringify(users)); } catch (_) {}
          try { localStorage.setItem('ums_users_backup', JSON.stringify(users)); } catch (_) {}
          try { localStorage.setItem('ums_users_rev', String(Date.now())); } catch (_) {}
        }
      }
    } catch (_) {}
    return { ok: true, users };
  };

  const create = async (payload) => {
    const res = await fetch('/api/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload || {})
    });

    // Robust parsing: if an intermediary returns HTML or non-JSON, surface a useful message.
    const raw = await res.text().catch(() => '');
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      data = { message: (raw || '').slice(0, 400) };
    }

    const retryAfterHeader = res.headers ? (res.headers.get('retry-after') || '') : '';
    const retryAfterBody = data && (data.retry_after || data.retryAfter) ? String(data.retry_after || data.retryAfter) : '';
    const retryAfter = String(retryAfterHeader || retryAfterBody || '').trim();
    const out = {
      ok: res.ok,
      status: res.status,
      retryAfter: String(retryAfter || '').trim(),
      data
    };

    if (!res.ok) {
      return {
        ok: false,
        status: out.status,
        retryAfter: out.retryAfter,
        message: data.message || data.error || `Failed (${res.status})`,
        data
      };
    }

    return out;
  };
  const ensureProfile = async (payload) => {
    const res = await fetch('/api/users/ensure_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, profile: data.profile || null, created: !!data.created, updated: !!data.updated };
  };

  const deleteUser = async (userId) => {
    const uid = String(userId || '').trim();
    if (!uid) return { ok: false, message: 'missing_user_id' };

    const res = await fetch('/api/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ userId: uid })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, data };
  };

  return { list, me, updateMe, updateUser, resolveEmail, uploadAvatar, removeAvatar, create, refreshIntoLocalStore, ensureProfile, deleteUser };
})();

window.CloudUsers = CloudUsers;
