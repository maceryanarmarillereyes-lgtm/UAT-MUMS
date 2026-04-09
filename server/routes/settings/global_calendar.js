/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/settings/global_calendar.js
// GET  /api/settings/global_calendar  — any authenticated user (token stripped)
// POST /api/settings/global_calendar  — SUPER_ADMIN only
const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readGlobalCalendarSettings, writeGlobalCalendarSettings } = require('../../lib/global_calendar');

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

function sendJson(res, code, body) {
  res.statusCode = code;
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
      const profile = await getProfileForUserId(user.id);
      const isAdmin = isSuperAdmin(profile);
      if (_cache && (Date.now() - _cacheAt) < CACHE_TTL) {
        const s = { ..._cache };
        if (!isAdmin) delete s.qbToken;
        return sendJson(res, 200, { ok: true, settings: s, cached: true });
      }
      const out = await readGlobalCalendarSettings();
      if (!out.ok) return sendJson(res, out.status || 500, { ok: false, error: 'db_error' });
      _cache = { ...out.settings };
      _cacheAt = Date.now();
      const s = { ...out.settings };
      if (!isAdmin) delete s.qbToken;
      return sendJson(res, 200, { ok: true, settings: s });
    }

    if (method === 'POST' || method === 'PATCH') {
      _cache = null; _cacheAt = 0;
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

      const out = await writeGlobalCalendarSettings(body, { userId: user.id, name: profile.name || profile.username });
      if (!out.ok) return sendJson(res, out.status || 500, { ok: false, error: 'save_failed', details: out.details });
      return sendJson(res, 200, { ok: true, settings: out.settings });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[global_calendar]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
};
