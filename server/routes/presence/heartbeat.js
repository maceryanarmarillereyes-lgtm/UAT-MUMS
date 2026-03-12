/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const DEFAULT_BOOTSTRAP_EMAIL = 'supermace@mums.local';

const { getUserFromJwt, getProfileForUserId, serviceUpsert, serviceUpdate, serviceInsert } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}


function normalizeTeamId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const t = s.toLowerCase();
  if (t === 'developer access' || t === 'developer_access' || t === 'developer') return null;
  return s;
}

function isMissingColumn(out) {
  const msg = String((out && out.json && (out.json.message || out.json.error)) || (out && out.text) || '');
  return (out && out.status === 400 && /column .* does not exist/i.test(msg));
}

async function safeProfileUpdate(userId, patch) {
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, status: 400, text: 'missing_user_id' };
  // First attempt (full patch)
  let out = await serviceUpdate('mums_profiles', patch, { user_id: `eq.${uid}` });
  if (out.ok) return out;

  // Retry without optional fields if the schema is behind.
  if (isMissingColumn(out)) {
    const next = Object.assign({}, patch);
    delete next.team_override;
    out = await serviceUpdate('mums_profiles', next, { user_id: `eq.${uid}` });
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      // Cloudflare Pages Functions adapter will provide req.body directly.
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object' && !Array.isArray(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return reject(e); }
        }
      }
    } catch (_) {}

    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

// POST /api/presence/heartbeat
// Stores the current authenticated user's online marker.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'invalid_json' });
    }
    let clientId = String(body.clientId || body.client_id || '').trim();
    if (!clientId) clientId = String(req.headers['x-mums-client-id'] || '').trim();
    if (!clientId) clientId = 'cid_' + String(authed.id).slice(0, 12);

    let profile = await getProfileForUserId(authed.id);
    // IMPORTANT:
    // If profile is missing, treat the account as removed and deny access.
    // Exception: the bootstrap SUPERADMIN_EMAIL may self-heal by creating a profile.
    if (!profile) {
      const email0 = String(authed.email || '').trim();
      const uname0 = email0 ? email0.split('@')[0] : String(authed.id).slice(0, 8);
      const metaName0 = authed.user_metadata ? (authed.user_metadata.full_name || authed.user_metadata.name) : '';
      const defaultName0 = String(metaName0 || uname0 || 'User');

      const bootstrapEmail0 = String(process.env.SUPERADMIN_EMAIL || DEFAULT_BOOTSTRAP_EMAIL).trim().toLowerCase();
      const isBootstrap0 = bootstrapEmail0 && email0 && bootstrapEmail0 === email0.toLowerCase();
      if (!isBootstrap0) {
        return sendJson(res, 403, { ok: false, error: 'account_removed', message: 'This account has been removed from the system.' });
      }

      const insert = {
        user_id: authed.id,
        username: uname0,
        name: defaultName0,
        role: 'SUPER_ADMIN',
        team_id: null,
        duty: ''
      };
      const createdOut = await serviceInsert('mums_profiles', [insert]);
      if (createdOut.ok) {
        profile = createdOut.json && createdOut.json[0] ? createdOut.json[0] : insert;
      }
    }
    // Best-effort: bootstrap SUPER_ADMIN role if this user's email matches SUPERADMIN_EMAIL (or default bootstrap email).
    // This keeps monitoring + permissions stable even if an old profile row exists or env is misconfigured.
    try {
      const bootstrapEmail = String(process.env.SUPERADMIN_EMAIL || DEFAULT_BOOTSTRAP_EMAIL).trim().toLowerCase();
      const authedEmail = String(authed.email || '').trim().toLowerCase();
      const wantSuper = bootstrapEmail && authedEmail && bootstrapEmail === authedEmail;
      if (wantSuper && profile) {
        const curRole = String(profile.role || '').toUpperCase();
        // IMPORTANT:
        // - We promote role for the bootstrap email.
        // - We only reset team/team_override on *promotion* so SUPER_ADMIN defaults to Developer Access.
        // - Once already SUPER_ADMIN, do NOT overwrite team/team_override; SUPER_ADMIN may override their own team.
        const needsRole = (curRole !== 'SUPER_ADMIN');
        if (needsRole) {
          await safeProfileUpdate(authed.id, { role: 'SUPER_ADMIN', team_id: null, team_override: false });
          profile = Object.assign({}, profile, { role: 'SUPER_ADMIN', team_id: null, team_override: false });
        }
      }
    } catch (_) {}
    const metaName = authed.user_metadata ? (authed.user_metadata.full_name || authed.user_metadata.name) : '';

    const roleUpper = String((profile && profile.role) || '').trim().toUpperCase();
    const isDevAccess = (roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER_USER');

    // team_override is optional; when absent, infer override ONLY if team_id points to a real shift.
    // This avoids treating "Developer Access" as an override team on older schemas.
    let teamOverride = false;
    if (profile && profile.team_override !== undefined) teamOverride = !!profile.team_override;
    else if (profile && profile.teamOverride !== undefined) teamOverride = !!profile.teamOverride;
    else if (isDevAccess && profile) teamOverride = !!normalizeTeamId(profile.team_id);

    const record = {
      client_id: clientId,
      user_id: String(authed.id),
      name: String((profile && profile.name) || metaName || authed.email || 'User'),
      // Do NOT trust role/team from the client; always source from the profile row.
      role: String((profile && profile.role) || 'MEMBER'),
      // SUPER roles default to Developer Access (team_id NULL) unless team_override=true.
      team_id: (isDevAccess && !teamOverride) ? null : (normalizeTeamId((profile && profile.team_id) || null)),
      route: String(body.route || '').trim(),
      last_seen: new Date().toISOString()
    };


    let up = await serviceUpsert('mums_presence', [record], 'client_id');
    if (!up.ok) {
      // Transient network/DB hiccups should not break login. Retry once.
      if (up.status >= 500) {
        try { await new Promise((r) => setTimeout(r, 250)); } catch (_) {}
        const up2 = await serviceUpsert('mums_presence', [record], 'client_id');
        if (up2.ok) up = up2;
      }
    }
    if (!up.ok) return sendJson(res, 500, { ok: false, error: 'supabase_upsert_failed', details: up.json || up.text });

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'heartbeat_failed', message: String(err && err.message ? err.message : err) });
  }
};
