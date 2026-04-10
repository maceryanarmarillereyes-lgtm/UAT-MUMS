// server/routes/studio/ctl_lab_config.js
// GET  /api/studio/ctl_lab_config  — load shared controller list (all authenticated users)
// POST /api/studio/ctl_lab_config  — save shared controller list (all authenticated users)
//
// Stores the controller list in mums_documents under key 'ss_ctl_lab_config_v1'.
// This makes the lab config SHARED across all users/browsers — fixing the
// "invisible to other users" bug caused by the previous localStorage-only storage.

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

const DOC_KEY = 'ss_ctl_lab_config_v1';
const MAX_ITEMS = 20;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200);
}

// Sanitize a single controller item
function normalizeItem(item, idx) {
  if (!item || typeof item !== 'object') return null;
  var id = safeStr(item.id, 80) || ('ctl_' + Date.now() + '_' + idx);
  var type = safeStr(item.type, 40);
  if (!['E2', 'E3', 'Site Supervisor'].includes(type)) type = 'E2';
  var ip = safeStr(item.ip, 60);
  var status = safeStr(item.status, 40) || 'Online';
  return { id, type, ip, status };
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

module.exports = async (req, res) => {
  try {
    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── GET — read shared config ──────────────────────────────────────────
    if (req.method === 'GET') {
      const out = await serviceSelect(
        'mums_documents',
        `select=value,updated_at&key=eq.${encodeURIComponent(DOC_KEY)}&limit=1`
      );
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_read_failed' });

      const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
      const items = normalizeItems(row && row.value && row.value.items);
      return sendJson(res, 200, {
        ok: true,
        items,
        updatedAt: row ? row.updated_at : null,
      });
    }

    // ── POST — save shared config ─────────────────────────────────────────
    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object')
        ? req.body
        : await new Promise((resolve) => {
            let d = '';
            req.on('data', (c) => { d += c; });
            req.on('end', () => {
              try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); }
            });
          });

      const items = normalizeItems(body.items);
      const nowIso = new Date().toISOString();

      const doc = {
        key: DOC_KEY,
        value: { items },
        updated_at: nowIso,
        updated_by_user_id: String(user.id || ''),
        updated_by_name: String(user.email || ''),
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) {
        return sendJson(res, 500, {
          ok: false,
          error: 'db_write_failed',
          detail: out.text ? out.text.slice(0, 300) : 'Unknown DB error',
        });
      }

      return sendJson(res, 200, { ok: true, saved: items.length, items, updatedAt: nowIso });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/ctl_lab_config]', err);
    return sendJson(res, 500, {
      ok: false,
      error: 'internal_error',
      message: String(err && err.message ? err.message : err),
    });
  }
};
