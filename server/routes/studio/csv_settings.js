const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const type = req.query.type; 
    if (type !== 'connect_plus' && type !== 'parts_number') return sendJson(res, 400, { ok: false, error: 'invalid_type' });

    const docKey = type === 'connect_plus' ? 'ss_connectplus_settings' : 'ss_parts_number_settings';

    if (req.method === 'GET') {
      const out = await serviceSelect('mums_documents', `select=value&key=eq.${docKey}&limit=1`);
      const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
      return sendJson(res, 200, { ok: true, settings: row ? row.value : null });
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      let body = {};
      if (req.body && typeof req.body === 'object') body = req.body;
      else body = await new Promise((resolve) => {
        let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d ? JSON.parse(d) : {}));
      });
      
      const nowIso = new Date().toISOString();
      const doc = { key: docKey, value: body, updated_at: nowIso, updated_by_user_id: user.id };
      await serviceUpsert('mums_documents', [doc], 'key');
      return sendJson(res, 200, { ok: true, settings: body });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err) });
  }
};
