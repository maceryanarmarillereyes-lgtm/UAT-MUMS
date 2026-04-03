/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

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
        defaultTheme:    out.settings.defaultTheme    || DEFAULT_THEME_ID,
        brightness:      out.settings.brightness      ?? 130,
        contrast:        out.settings.contrast        ?? 100,
        scale:           out.settings.scale           ?? 100,
        sidebarOpacity:  out.settings.sidebarOpacity  ?? 100,
        forcedTheme:     out.settings.forcedTheme     === true,
        forcedBrightness:out.settings.forcedBrightness=== true,
        forcedAt:        out.settings.forcedAt        || null,
        forcedByName:    out.settings.forcedByName    || null,
        updatedAt:       out.row && out.row.updated_at     ? out.row.updated_at     : null,
        updatedByName:   out.row && out.row.updated_by_name ? out.row.updated_by_name : null,
      });
    }

    if (method === 'POST') {
      const profile = await getProfileForUserId(user.id);
      if (!isSuperAdmin(profile)) {
        return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const themeId = normalizeThemeId(body && body.themeId || body && body.defaultTheme);

      // action='force_all' → override theme+brightness for all users on next load
      const isForceAll = body.action === 'force_all';

      const payload = {
        defaultTheme:    themeId || DEFAULT_THEME_ID,
        brightness:      body.brightness      !== undefined ? body.brightness      : undefined,
        contrast:        body.contrast        !== undefined ? body.contrast        : undefined,
        scale:           body.scale           !== undefined ? body.scale           : undefined,
        sidebarOpacity:  body.sidebarOpacity  !== undefined ? body.sidebarOpacity  : undefined,
        forcedTheme:     isForceAll ? true  : (body.forcedTheme     !== undefined ? !!body.forcedTheme     : undefined),
        forcedBrightness:isForceAll ? true  : (body.forcedBrightness!== undefined ? !!body.forcedBrightness: undefined),
        forcedAt:        isForceAll ? new Date().toISOString() : undefined,
        forcedByName:    isForceAll ? (profile && profile.name ? String(profile.name) : null) : undefined,
      };

      // Merge with existing so a partial update doesn't wipe other fields
      const existing = await readGlobalThemeSettings();
      const merged = Object.assign({}, existing.ok ? existing.settings : {}, payload);

      const out = await writeGlobalThemeSettings(merged, {
        userId: user.id,
        name: profile && profile.name ? profile.name : null
      });

      if (!out.ok) {
        return sendJson(res, out.status || 500, {
          ok: false,
          error: 'db_error',
          message: 'Failed to save global appearance settings.',
          details: out.details
        });
      }

      return sendJson(res, 200, {
        ok: true,
        defaultTheme:    out.settings.defaultTheme    || DEFAULT_THEME_ID,
        brightness:      out.settings.brightness      ?? 130,
        contrast:        out.settings.contrast        ?? 100,
        scale:           out.settings.scale           ?? 100,
        sidebarOpacity:  out.settings.sidebarOpacity  ?? 100,
        forcedTheme:     out.settings.forcedTheme     === true,
        forcedBrightness:out.settings.forcedBrightness=== true,
        forcedAt:        out.settings.forcedAt        || null,
        forcedByName:    out.settings.forcedByName    || null,
        message: 'Global appearance settings updated.'
      });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(e?.message || e) });
  }
};
