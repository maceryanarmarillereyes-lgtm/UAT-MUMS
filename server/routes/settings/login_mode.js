/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const {
  VALID_MODES,
  normalizeMode,
  readLoginModeSettings,
  writeLoginModeSettings
} = require('../../lib/login_mode');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  const role = String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g, '_');
  return role === 'SUPER_ADMIN';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object' && !Array.isArray(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (_) { return resolve({}); }
        }
      }
    } catch (_) {}
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      const raw = String(data || '').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
  });
}

// GET  /api/settings/login_mode  — public (no auth required, login page reads this)
// POST /api/settings/login_mode  — Super Admin only
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    // ── GET: public — login page needs to know the mode without a token ──────
    if (method === 'GET') {
      const result = await readLoginModeSettings();
      return sendJson(res, 200, {
        ok: true,
        settings: result.settings
      });
    }

    // ── POST: Super Admin only ────────────────────────────────────────────────
    if (method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    if (!jwt) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Missing bearer token.' });

    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Invalid token.' });

    const profile = await getProfileForUserId(user.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'profile_missing' });
    if (!isSuperAdmin(profile)) {
      return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only Super Admin can change login mode.' });
    }

    let body = {};
    try { body = await readBody(req); } catch (_) {
      return sendJson(res, 400, { ok: false, error: 'invalid_json' });
    }

    const rawMode = String(body.mode || '').trim().toLowerCase();
    if (!VALID_MODES.has(rawMode)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'invalid_mode',
        message: `mode must be one of: ${[...VALID_MODES].join(', ')}`
      });
    }

    const actor = {
      userId: user.id,
      name: String(profile.name || profile.username || 'Super Admin')
    };

    const result = await writeLoginModeSettings({ mode: rawMode }, actor);
    if (!result.ok) {
      return sendJson(res, result.status || 500, {
        ok: false,
        error: 'save_failed',
        details: result.details,
        message: 'Failed to save login mode setting.'
      });
    }

    return sendJson(res, 200, {
      ok: true,
      settings: result.settings,
      message: `Login mode set to "${rawMode}".`
    });

  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(e && e.message ? e.message : e) });
  }
};
