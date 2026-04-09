/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpdate } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isPlainObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (isPlainObject(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return reject(e); }
        }
      }
    } catch (_) {}

    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const raw = String(data || '').trim();
      if (!raw) return resolve({});
      try { return resolve(JSON.parse(raw)); } catch (e) { return reject(e); }
    });
  });
}

const ALLOWED_TEAMS = new Set(['morning', 'mid', 'night']);

function normalizeTeamId(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (s === 'null') s = '';
  if (s && s.includes('@')) s = s.split('@')[0];
  return s;
}

// PATCH /api/users/update_user
// Body: { user_id, name?, duty?, role?, team_id|teamId?, team_override|teamOverride? }
// Permissions:
// - SUPER_ADMIN: can update any user except setting role to SUPER_ADMIN.
// - TEAM_LEAD : can update MEMBER users in their own team (name/duty only).
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'PATCH' && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const actor = await getProfileForUserId(authed.id);
    if (!actor) return sendJson(res, 403, { ok: false, error: 'profile_missing' });

    let body = {};
    try { body = await readBody(req); } catch (_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

    const targetId = String(body.user_id || body.userId || body.id || '').trim();
    if (!targetId) return sendJson(res, 400, { ok: false, error: 'missing_user_id' });

    const actorRole = String(actor.role || 'MEMBER').toUpperCase();
    if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'TEAM_LEAD') {
      // allow self-only as a safety net (but update_me is preferred)
      if (String(actor.user_id) !== targetId) return sendJson(res, 403, { ok: false, error: 'insufficient_permission' });
    }

    const target = await getProfileForUserId(targetId);
    if (!target) return sendJson(res, 404, { ok: false, error: 'target_not_found' });

    const patch = {};

    // Name
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = String(body.name || '').trim();
      if (name && name.length > 80) return sendJson(res, 400, { ok: false, error: 'invalid_name' });
      if (name) patch.name = name;
    }

    // Duty
    if (Object.prototype.hasOwnProperty.call(body, 'duty')) {
      const duty = String(body.duty || '').trim();
      if (duty.length > 120) return sendJson(res, 400, { ok: false, error: 'invalid_duty' });
      patch.duty = duty;
    }

    // TEAM_LEAD restrictions
    if (actorRole === 'TEAM_LEAD') {
      const tRole = String(target.role || 'MEMBER').toUpperCase();
      if (tRole !== 'MEMBER') return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Team lead can only update MEMBER accounts.' });
      const team = String(actor.team_id || '').trim();
      const targetTeam = String(target.team_id || '').trim();
      if (team !== targetTeam) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Team lead can only update users in their own team.' });

      // Explicitly reject role/team changes from TEAM_LEAD.
      if (Object.prototype.hasOwnProperty.call(body, 'role') || Object.prototype.hasOwnProperty.call(body, 'team_id') || Object.prototype.hasOwnProperty.call(body, 'teamId') || Object.prototype.hasOwnProperty.call(body, 'team_override') || Object.prototype.hasOwnProperty.call(body, 'teamOverride')) {
        return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Team lead cannot change role or team.' });
      }
    }

    // Role changes (SUPER_ADMIN only)
    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      if (actorRole !== 'SUPER_ADMIN') return sendJson(res, 403, { ok: false, error: 'forbidden_role_change' });
      const roleUpper = String(body.role || '').trim().toUpperCase();
      if (!roleUpper) return sendJson(res, 400, { ok: false, error: 'invalid_role' });
      if (roleUpper === 'SUPER_ADMIN') return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Cannot set SUPER_ADMIN via this endpoint.' });
      patch.role = roleUpper;
    }

    // Team changes
    const wantsTeam = (
      Object.prototype.hasOwnProperty.call(body, 'team_id') ||
      Object.prototype.hasOwnProperty.call(body, 'teamId') ||
      Object.prototype.hasOwnProperty.call(body, 'team_override') ||
      Object.prototype.hasOwnProperty.call(body, 'teamOverride')
    );

    if (wantsTeam) {
      const actorIsSuperRole = (actorRole === 'SUPER_ADMIN' || actorRole === 'SUPER_USER');
      if (!actorIsSuperRole && String(actor.user_id) !== targetId) {
        return sendJson(res, 403, { ok: false, error: 'forbidden_team_change' });
      }

      const roleAfter = String((patch.role || target.role) || 'MEMBER').toUpperCase();

      const teamIn = (Object.prototype.hasOwnProperty.call(body, 'team_id') ? body.team_id : body.teamId);
      const overrideIn = (Object.prototype.hasOwnProperty.call(body, 'team_override') ? body.team_override : body.teamOverride);
      const overrideProvided = (overrideIn !== undefined);
      const overrideBool = (overrideIn === true || overrideIn === false) ? overrideIn : (String(overrideIn || '').trim().toLowerCase() === 'true' ? true : (String(overrideIn || '').trim().toLowerCase() === 'false' ? false : undefined));

      const teamId = normalizeTeamId(teamIn);

      const roleAfterIsSuperRole = (roleAfter === 'SUPER_ADMIN' || roleAfter === 'SUPER_USER');
      if (roleAfterIsSuperRole) {
        // Super Admin and Super User may have NULL team_id (Developer Access).
        if (overrideProvided && overrideBool === false) {
          patch.team_override = false;
          patch.team_id = null;
        } else if (overrideProvided && overrideBool === true) {
          if (!teamId) return sendJson(res, 400, { ok: false, error: 'invalid_team', message: 'team_id required when team_override=true' });
          if (!ALLOWED_TEAMS.has(teamId)) return sendJson(res, 400, { ok: false, error: 'invalid_team' });
          patch.team_override = true;
          patch.team_id = teamId;
        } else {
          // No explicit override provided: infer from teamId
          if (!teamId) {
            patch.team_override = false;
            patch.team_id = null;
          } else {
            if (!ALLOWED_TEAMS.has(teamId)) return sendJson(res, 400, { ok: false, error: 'invalid_team' });
            patch.team_override = true;
            patch.team_id = teamId;
          }
        }
      } else {
        // Non-Super accounts must always be on a shift team.
        if (!teamId) {
          return sendJson(res, 400, { ok: false, error: 'invalid_team', message: 'Developer Access is reserved for Super Admin and Super User roles. Choose Morning/Mid/Night.' });
        }
        if (!ALLOWED_TEAMS.has(teamId)) return sendJson(res, 400, { ok: false, error: 'invalid_team' });
        patch.team_override = false;
        patch.team_id = teamId;
      }
    }

    // QB Name (SUPER_ADMIN only — this is the Quickbase "Assigned To" display name for privacy filtering)
    if (Object.prototype.hasOwnProperty.call(body, 'qb_name') || Object.prototype.hasOwnProperty.call(body, 'qbName')) {
      if (actorRole !== 'SUPER_ADMIN') return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only Super Admin can set QB Name.' });
      const qbName = String(body.qb_name !== undefined ? body.qb_name : (body.qbName || '')).trim();
      if (qbName.length > 120) return sendJson(res, 400, { ok: false, error: 'invalid_qb_name' });
      patch.qb_name = qbName;
    }

    if (!Object.keys(patch).length) return sendJson(res, 200, { ok: true, updated: false, profile: null });

    const out = await serviceUpdate('mums_profiles', patch, { user_id: `eq.${encodeURIComponent(targetId)}` });
    if (!out.ok) {
      return sendJson(res, out.status || 500, { ok: false, error: 'update_failed', details: out.json || out.text });
    }

    const updated = (out.json && Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
    return sendJson(res, 200, { ok: true, updated: true, profile: updated, patch });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'update_user_failed', message: e?.message || String(e) });
  }
};
