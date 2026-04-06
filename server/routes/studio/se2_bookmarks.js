// server/routes/studio/se2_bookmarks.js
// GET  /api/studio/se2_bookmarks  — load this user's Search Engine 2 bookmarks
// POST /api/studio/se2_bookmarks  — save (replace) this user's bookmarks

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function docKey(userId) {
  return `ss_se2_bookmarks_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const key = docKey(user.id);

    if (req.method === 'GET') {
      const out = await serviceSelect('mums_documents',
        `select=value&key=eq.${encodeURIComponent(key)}&limit=1`);
      if (!out.ok) {
        return sendJson(res, 500, { ok: false, error: 'db_read_failed', detail: out.text || '' });
      }
      const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
      const bookmarks = (row && Array.isArray(row.value)) ? row.value : [];
      return sendJson(res, 200, { ok: true, bookmarks });
    }

    if (req.method === 'POST') {
      let body = {};
      if (req.body && typeof req.body === 'object') {
        body = req.body;
      } else {
        body = await new Promise((resolve) => {
          let d = '';
          req.on('data', c => d += c);
          req.on('end', () => {
            try { resolve(d ? JSON.parse(d) : {}); }
            catch (_) { resolve({}); }
          });
        });
      }

      if (!Array.isArray(body.bookmarks)) {
        return sendJson(res, 400, { ok: false, error: 'bookmarks_must_be_array' });
      }

      const nowIso = new Date().toISOString();
      const bookmarks = body.bookmarks.slice(0, 500);
      const doc = {
        key,
        value: bookmarks,
        updated_at: nowIso,
        updated_by_user_id: user.id,
        updated_by_name: user.email || '',
        updated_by_client_id: null,
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) {
        return sendJson(res, 500, {
          ok: false,
          error: 'db_write_failed',
          detail: out.text ? out.text.slice(0, 300) : 'Unknown DB error',
        });
      }
      return sendJson(res, 200, { ok: true, saved: bookmarks.length });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/se2_bookmarks]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
