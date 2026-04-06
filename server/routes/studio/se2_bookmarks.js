// server/routes/studio/se2_bookmarks.js
// GET  /api/studio/se2_bookmarks  — load this user's Search Engine 2 bookmarks/folders
// POST /api/studio/se2_bookmarks  — save (replace) this user's bookmarks/folders

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

function normalizeFolders(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = arr
    .map((f) => ({
      id: String((f && f.id) || '').trim(),
      name: String((f && f.name) || '').trim(),
      createdAt: String((f && f.createdAt) || new Date().toISOString()),
    }))
    .filter((f) => f.id && f.name)
    .slice(0, 100);

  if (!out.some((f) => f.id === 'default')) {
    out.unshift({ id: 'default', name: 'General', createdAt: new Date().toISOString() });
  }
  return out;
}

function normalizeItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((b) => {
    const folderId = String((b && b.folderId) || 'default').trim() || 'default';
    return Object.assign({}, b, { folderId });
  }).slice(0, 500);
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
      const value = row ? row.value : null;

      // Backward compatibility: old shape stored value as bookmarks array only.
      if (Array.isArray(value)) {
        return sendJson(res, 200, {
          ok: true,
          folders: [{ id: 'default', name: 'General', createdAt: new Date().toISOString() }],
          bookmarks: normalizeItems(value),
        });
      }

      const folders = normalizeFolders(value && value.folders);
      const folderIds = new Set(folders.map((f) => f.id));
      const bookmarks = normalizeItems(value && value.bookmarks).map((b) => {
        if (!folderIds.has(b.folderId)) return Object.assign({}, b, { folderId: 'default' });
        return b;
      });
      return sendJson(res, 200, { ok: true, folders, bookmarks });
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

      let folders = [];
      let bookmarks = [];

      if (Array.isArray(body.bookmarks) && !Array.isArray(body.folders)) {
        // Backward compatibility with old client payload shape.
        folders = [{ id: 'default', name: 'General', createdAt: new Date().toISOString() }];
        bookmarks = normalizeItems(body.bookmarks);
      } else {
        if (!Array.isArray(body.bookmarks) || !Array.isArray(body.folders)) {
          return sendJson(res, 400, { ok: false, error: 'bookmarks_and_folders_must_be_array' });
        }
        folders = normalizeFolders(body.folders);
        const folderIds = new Set(folders.map((f) => f.id));
        bookmarks = normalizeItems(body.bookmarks).map((b) => {
          if (!folderIds.has(b.folderId)) return Object.assign({}, b, { folderId: 'default' });
          return b;
        });
      }

      const nowIso = new Date().toISOString();
      const doc = {
        key,
        value: { folders, bookmarks },
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
      return sendJson(res, 200, { ok: true, saved: bookmarks.length, folders: folders.length });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/se2_bookmarks]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
