// server/routes/studio/qb_settings.js
// GET  /api/studio/qb_settings  — read current user's studio QB settings
// POST /api/studio/qb_settings  — save current user's studio QB settings
// COMPLETELY ISOLATED from /api/settings/global_quickbase

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readStudioQbSettings, writeStudioQbSettings } = require('../../lib/studio_quickbase');

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
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const profile = await getProfileForUserId(user.id);
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      const out = await readStudioQbSettings(user.id);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_error' });
      // Never expose the token to non-admins (security)
      const settings = { ...out.settings };
      const role = String((profile && profile.role) || '').toUpperCase().replace(/\s+/g, '_');
      if (settings.qbToken) {
        settings.qbTokenSet = true;
        delete settings.qbToken; // token never returned to client
      }
      return sendJson(res, 200, { ok: true, settings });
    }

    if (method === 'POST' || method === 'PATCH') {
      let body = {};
      try {
        if (req.body && typeof req.body === 'object') body = req.body;
        else if (typeof req.body === 'string') body = JSON.parse(req.body || '{}');
        else {
          body = await new Promise((resolve, reject) => {
            let d = '';
            req.on('data', c => { d += c; });
            req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
          });
        }
      } catch (_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      // If qbToken is the sentinel value "__QB_TOKEN_SAVED__", keep existing token
      let effectiveBody = { ...body };
      if (effectiveBody.qbToken === '__QB_TOKEN_SAVED__') {
        const existing = await readStudioQbSettings(user.id);
        effectiveBody.qbToken = (existing.ok && existing.settings) ? (existing.settings.qbToken || '') : '';
        // Restore from raw value in settings (before deletion in GET)
      }

      const actorName = (profile && (profile.name || profile.username)) || '';
      const out = await writeStudioQbSettings(user.id, effectiveBody, actorName);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'save_failed' });
      const settings = { ...out.settings };
      if (settings.qbToken) { settings.qbTokenSet = true; delete settings.qbToken; }
      return sendJson(res, 200, { ok: true, settings });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/qb_settings]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
};
