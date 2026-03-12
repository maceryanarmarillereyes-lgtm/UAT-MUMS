/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { getUserFromJwt, serviceSelect, serviceInsert, serviceUpdate } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// POST /api/users/ensure_profile
// Ensures the authenticated user's profile exists.
// IMPORTANT: If the profile is missing, we treat the account as removed
// and deny access. Exception: the bootstrap SUPERADMIN_EMAIL may self-heal.
// Bootstrap behavior:
// - If SUPERADMIN_EMAIL is set, only that email becomes SUPER_ADMIN.
// - Else, first ever profile in the project becomes SUPER_ADMIN.

const DEFAULT_BOOTSTRAP_EMAIL = 'supermace@mums.local';
// Option A: only the configured bootstrap email is SUPER_ADMIN.

function parseBody(req) {
  try {
    if (!req || req.body == null) return {};
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body || {};
  } catch (_) {
    return {};
  }
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method && req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = jwt ? await getUserFromJwt(jwt) : null;
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // Return existing profile if present.
    const existing = await serviceSelect(
      'mums_profiles',
      `select=*&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    );
    if (!existing.ok) {
      return sendJson(res, existing.status || 500, { ok: false, error: 'db_error', details: existing.json || existing.text });
    }
    if (Array.isArray(existing.json) && existing.json[0]) {
      const prof = existing.json[0];
      const bootstrapEmail = String(process.env.SUPERADMIN_EMAIL || DEFAULT_BOOTSTRAP_EMAIL).trim().toLowerCase();
      const userEmail = String(user.email || '').trim().toLowerCase();
      const wantSuper = bootstrapEmail && userEmail === bootstrapEmail;
      const patch = {};
      if (wantSuper && String(prof.role || '').toUpperCase() !== 'SUPER_ADMIN') patch.role = 'SUPER_ADMIN';
      // Do not force team_id for SUPER_ADMIN; keep NULL/EMPTY to match profile policy.
      if (Object.keys(patch).length) {
        const up = await serviceUpdate('mums_profiles', `user_id=eq.${encodeURIComponent(user.id)}`, patch);
        if (up.ok && Array.isArray(up.json) && up.json[0]) {
          return sendJson(res, 200, { ok: true, profile: up.json[0], created: false, updated: true });
        }
      }
      return sendJson(res, 200, { ok: true, profile: prof, created: false });
    }
    // If the profile is missing, treat the account as removed unless it is the bootstrap user.
    const bootstrapEmail = String(process.env.SUPERADMIN_EMAIL || DEFAULT_BOOTSTRAP_EMAIL).trim().toLowerCase();
    const userEmail = String(user.email || '').trim().toLowerCase();
    const isBootstrap = bootstrapEmail && userEmail === bootstrapEmail;

    if (!isBootstrap) {
      return sendJson(res, 403, {
        ok: false,
        error: 'account_removed',
        message: 'This account has been removed from the system.'
      });
    }

    const role = 'SUPER_ADMIN';

    const username = String(user.email || '').split('@')[0] || 'user';
    const metaName = user.user_metadata ? (user.user_metadata.full_name || user.user_metadata.name) : '';
    const name = String(metaName || '').trim() || username;

    // Optional per-user defaults from request body (future-proofing)
    const body = parseBody(req);
    const duty = String(body.duty || '').trim();

    const profileRow = {
      user_id: user.id,
      username,
      name,
      role,
      team_id: (role === 'SUPER_ADMIN') ? null : 'morning',
      duty: duty || ''
    };

    const ins = await serviceInsert('mums_profiles', [profileRow]);
    if (!ins.ok) {
      return sendJson(res, ins.status || 500, { ok: false, error: 'profile_create_failed', details: ins.json || ins.text });
    }

    return sendJson(res, 200, { ok: true, profile: ins.json && ins.json[0] ? ins.json[0] : null, created: true });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: e?.message || String(e) });
  }
};
