/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { getUserFromJwt, getProfileForUserId, serviceFetch, serviceSelect, serviceUpsert } = require('../../lib/supabase');
function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object') return resolve(req.body);
        if (typeof req.body === 'string') return resolve(req.body ? JSON.parse(req.body) : {});
      }
    } catch (_) {}

    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => {
      const raw = String(data || '').trim();
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch (e) {
        return reject(e);
      }
    });
  });
}

function isMissingTableOrColumn(out) {
  const status = out && out.status ? Number(out.status) : 0;
  const msg = String((out && out.json && (out.json.message || out.json.error)) || out.text || '');
  if (status === 404) return true;
  if (status === 400 && /does not exist/i.test(msg)) return true;
  return false;
}

async function deleteWhere(table, filterQuery) {
  const path = `/rest/v1/${encodeURIComponent(table)}?${filterQuery}`;
  const out = await serviceFetch(path, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });

  // Back-compat: ignore missing tables/columns in older deployments.
  if (!out.ok && isMissingTableOrColumn(out)) {
    return { ok: true, ignored: true, status: out.status, text: out.text, json: out.json };
  }
  return out;
}

async function fetchTargetProfile(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const out = await serviceSelect('mums_profiles', `select=*&user_id=eq.${encodeURIComponent(uid)}&limit=1`);
  if (!out.ok) return null;
  return Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
}

// POST /api/users/delete
// Body: { userId }
// Permissions:
// - SUPER_ADMIN / SUPER_USER: can delete any non-self account.
// - TEAM_LEAD: can delete MEMBER users in their team only.
//
// Fix intent: prevent "ghost login" by hard-deleting from Supabase Auth
// and removing directory-related rows.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST' && req.method !== 'DELETE') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const actor = await getUserFromJwt(jwt);
    if (!actor) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    let body = {};
    try {
      body = await readBody(req);
    } catch (_) {
      body = {};
    }

    const targetId = String((body && (body.userId || body.user_id || body.id)) || '').trim();
    if (!targetId) return sendJson(res, 400, { ok: false, error: 'missing_user_id' });

    if (String(actor.id) === String(targetId)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'cannot_delete_self',
        message: 'You cannot delete your own account via this endpoint.'
      });
    }

    const actorProfile = await getProfileForUserId(actor.id);
    if (!actorProfile) {
      return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Missing directory profile for actor.' });
    }

    const actorRole = String(actorProfile.role || '').toUpperCase();
    const isSA = actorRole === 'SUPER_ADMIN' || actorRole === 'SUPER_USER';
    const isTL = actorRole === 'TEAM_LEAD';
    if (!isSA && !isTL) {
      return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Insufficient privileges.' });
    }

    const targetProfile = await fetchTargetProfile(targetId);

    if (isTL) {
      if (!targetProfile) {
        return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Team Leads may only delete users in their team.' });
      }
      const targetRole = String(targetProfile.role || '').toUpperCase();
      const sameTeam = String(targetProfile.team_id || '') === String(actorProfile.team_id || '');
      if (!sameTeam || targetRole !== 'MEMBER') {
        return sendJson(res, 403, {
          ok: false,
          error: 'forbidden',
          message: 'Team Leads may only delete MEMBER users in their own team.'
        });
      }
    }

    
// 0) Broadcast a short-lived deletion marker via presence (best-effort).
// Clients polling /api/presence/list can detect this and force logout quickly across tabs/devices.
try {
  const markerId = `deleted_${String(targetId)}`;
  const marker = {
    client_id: markerId,
    user_id: markerId,
    name: 'DELETED',
    role: 'DELETED',
    team_id: null,
    route: '__user_deleted__',
    last_seen: new Date().toISOString()
  };
  await serviceUpsert('mums_presence', [marker], 'client_id');
} catch (_) {}

    // 1) Best-effort: revoke sessions/refresh tokens.
    let logoutOut = null;
    try {
      logoutOut = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(targetId)}/logout`, { method: 'POST' });
    } catch (_) {
      logoutOut = null;
    }

    // 2) Hard delete auth user (critical).
    const delAuth = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
    // Supabase returns 404 with error_code "user_not_found" when the auth user was already
    // deleted (e.g. orphaned profile). Treat this as a soft success so we still clean up
    // the profile/directory rows below.
    const authAlreadyGone = !delAuth.ok && (
      delAuth.status === 404 ||
      (delAuth.json && (delAuth.json.error_code === 'user_not_found' || delAuth.json.code === 404))
    );
    if (!delAuth.ok && !authAlreadyGone) {
      // NOTE: Never forward a raw 404 HTTP status from this endpoint — Cloudflare Pages
      // intercepts 404 responses from API functions and serves its own HTML 404 page
      // instead of our JSON payload. Map unknown failures to 422 or 500.
      const safeStatus = (delAuth.status === 404) ? 422 : (delAuth.status || 500);
      const rawMsg = (delAuth.json && (delAuth.json.message || delAuth.json.msg || delAuth.json.error)) || delAuth.text || 'Failed to delete auth user.';
      return sendJson(res, safeStatus, {
        ok: false,
        error: 'auth_delete_failed',
        message: rawMsg,
        details: delAuth.json || delAuth.text,
        logout_attempted: !!logoutOut,
        logout_status: logoutOut ? logoutOut.status : undefined
      });
    }

    // 3) Best-effort: delete directory + related records.
    const deletes = [];
    const uidq = `user_id=eq.${encodeURIComponent(targetId)}`;
    deletes.push(['mums_presence', uidq]);
    deletes.push(['mums_profiles', uidq]);
    deletes.push(['mums_attendance', uidq]);
    deletes.push(['mums_team_assignments', uidq]);
    deletes.push(['mums_roles', uidq]);

    const results = {};
    for (const [table, q] of deletes) {
      try {
        const out = await deleteWhere(table, q);
        results[table] = { ok: !!out.ok, status: out.status, ignored: !!out.ignored };
      } catch (e) {
        results[table] = { ok: false, status: 0, message: String(e && e.message ? e.message : e) };
      }
    }

    return sendJson(res, 200, {
      ok: true,
      userId: targetId,
      auth_deleted: !authAlreadyGone,
      auth_already_gone: !!authAlreadyGone,
      logout_attempted: !!logoutOut,
      logout_status: logoutOut ? logoutOut.status : undefined,
      deleted: results,
      had_profile: !!targetProfile
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'delete_failed', message: String(err && err.message ? err.message : err) });
  }
};
