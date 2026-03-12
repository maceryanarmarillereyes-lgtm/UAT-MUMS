/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { normalizeThemeMeta, writeThemeAccessMeta } = require('../../lib/theme_access');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u = await getUserFromJwt(jwt);
    if (!u) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Missing or invalid bearer token.' });

    const profile = await getProfileForUserId(u.id);
    if (!profile || String(profile.role || '').toUpperCase() !== 'SUPER_ADMIN') {
      return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const meta = normalizeThemeMeta(body && body.meta);

    const out = await writeThemeAccessMeta(meta, {
      userId: u.id,
      name: profile && profile.name ? profile.name : null
    });

    if (!out.ok) {
      return sendJson(res, out.status || 500, {
        ok: false,
        error: 'db_error',
        message: 'Failed to save theme access settings.',
        details: out.details
      });
    }

    return sendJson(res, 200, { ok: true, meta: out.meta });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(e?.message || e) });
  }
};
