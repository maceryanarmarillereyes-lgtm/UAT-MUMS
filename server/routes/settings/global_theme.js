/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const {
  DEFAULT_THEME_ID,
  normalizeThemeId,
  readGlobalThemeSettings,
  writeGlobalThemeSettings
} = require('../../lib/global_theme');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  const role = String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g, '_');
  return role === 'SUPER_ADMIN';
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Missing or invalid bearer token.' });
    }

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      const out = await readGlobalThemeSettings();
      if (!out.ok) {
        return sendJson(res, out.status || 500, {
          ok: false,
          error: 'db_error',
          message: 'Failed to read global theme settings.',
          details: out.details
        });
      }
      return sendJson(res, 200, {
        ok: true,
        defaultTheme: out.settings.defaultTheme || DEFAULT_THEME_ID,
        updatedAt: out.row && out.row.updated_at ? out.row.updated_at : null,
        updatedByName: out.row && out.row.updated_by_name ? out.row.updated_by_name : null,
        updatedByUserId: out.row && out.row.updated_by_user_id ? out.row.updated_by_user_id : null
      });
    }

    if (method === 'POST') {
      const profile = await getProfileForUserId(user.id);
      if (!isSuperAdmin(profile)) {
        return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const themeId = normalizeThemeId(body && body.themeId);
      if (!themeId) {
        return sendJson(res, 400, { ok: false, error: 'bad_request', message: 'Invalid themeId.' });
      }

      const out = await writeGlobalThemeSettings({ defaultTheme: themeId }, {
        userId: user.id,
        name: profile && profile.name ? profile.name : null
      });

      if (!out.ok) {
        return sendJson(res, out.status || 500, {
          ok: false,
          error: 'db_error',
          message: 'Failed to save global theme settings.',
          details: out.details
        });
      }

      return sendJson(res, 200, {
        ok: true,
        defaultTheme: out.settings.defaultTheme || DEFAULT_THEME_ID,
        message: 'Global default theme updated.'
      });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(e?.message || e) });
  }
};
