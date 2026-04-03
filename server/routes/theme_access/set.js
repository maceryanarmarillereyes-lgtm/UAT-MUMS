/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

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
