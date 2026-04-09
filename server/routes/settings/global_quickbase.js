/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/settings/global_quickbase.js
// GET  /api/settings/global_quickbase  — any authenticated user
// POST /api/settings/global_quickbase  — SUPER_ADMIN only
const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readGlobalQuickbaseSettings, writeGlobalQuickbaseSettings } = require('../../lib/global_quickbase');

// In-memory GET cache: avoids repeated DB reads on every page load.
// Invalidated immediately on any POST/PATCH write.
let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — reduced DB reads for 30+ users

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
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      // Serve from in-memory cache when fresh (avoids Supabase roundtrip on every page load)
      const profile = await getProfileForUserId(user.id);
      const isAdmin = isSuperAdmin(profile);
      if (_settingsCache && (Date.now() - _settingsCacheAt) < SETTINGS_CACHE_TTL_MS) {
        const settings = { ..._settingsCache };
        if (!isAdmin) delete settings.qbToken;
        return sendJson(res, 200, { ok: true, settings, cached: true });
      }
      const out = await readGlobalQuickbaseSettings();
      if (!out.ok) return sendJson(res, out.status || 500, { ok: false, error: 'db_error' });
      // Cache the full settings (including token) server-side only
      _settingsCache = { ...out.settings };
      _settingsCacheAt = Date.now();
      // Strip qbToken from GET response for non-admins (token is server-only)
      const settings = { ...out.settings };
      if (!isAdmin) delete settings.qbToken;
      return sendJson(res, 200, { ok: true, settings, updatedAt: out.row && out.row.updated_at || null, updatedByName: out.row && out.row.updated_by_name || null });
    }

    if (method === 'POST' || method === 'PATCH') {
      // Invalidate cache on write so next GET reflects new settings immediately
      _settingsCache = null;
      _settingsCacheAt = 0;
      const profile = await getProfileForUserId(user.id);
      if (!isSuperAdmin(profile)) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });

      let body = {};
      try {
        if (req.body && typeof req.body === 'object') body = req.body;
        else if (typeof req.body === 'string') body = JSON.parse(req.body || '{}');
        else {
          body = await new Promise((resolve, reject) => {
            let d = '';
            req.on('data', c => { d += c; });
            req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch(e) { reject(e); } });
          });
        }
      } catch (_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      const out = await writeGlobalQuickbaseSettings(body, { userId: user.id, name: profile.name || profile.username });
      if (!out.ok) return sendJson(res, out.status || 500, { ok: false, error: 'save_failed', details: out.details });
      return sendJson(res, 200, { ok: true, settings: out.settings });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[global_quickbase]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
};
