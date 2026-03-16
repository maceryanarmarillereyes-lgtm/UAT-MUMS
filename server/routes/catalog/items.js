// server/routes/catalog/items.js
// GET    /api/catalog/items          — list all items
// POST   /api/catalog/items          — create item (SUPER_ADMIN)
// PATCH  /api/catalog/items          — update item (assigned user + SUPER_ADMIN)
// DELETE /api/catalog/items          — delete item (SUPER_ADMIN)

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceInsert, serviceUpdate, serviceDelete } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  return String(profile && profile.role || '').trim().toUpperCase().replace(/\s+/g,'_') === 'SUPER_ADMIN';
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch(e) { reject(e); } });
  });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    const profile = await getProfileForUserId(user.id);
    const isSA = isSuperAdmin(profile);
    const method = String(req.method || 'GET').toUpperCase();

    // ── GET — list all items ──────────────────────────────────────────────────
    if (method === 'GET') {
      const out = await serviceSelect('support_catalog',
        'select=id,item_code,name,category,brand,part_number,specs,user_guide,troubleshooting,compatible_units,status,assigned_to,assigned_to_name,created_at,updated_at&order=item_code.asc'
      );
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_error' });
      return sendJson(res, 200, { ok: true, items: out.json || [] });
    }

    // ── POST — create item ────────────────────────────────────────────────────
    if (method === 'POST') {
      if (!isSA) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });
      let body;
      try { body = await parseBody(req); } catch(_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      const row = {
        item_code:        String(body.item_code || '').trim().toUpperCase(),
        name:             String(body.name || '').trim(),
        category:         String(body.category || 'Controller').trim(),
        brand:            String(body.brand || '').trim(),
        part_number:      String(body.part_number || '').trim(),
        specs:            String(body.specs || '').trim(),
        user_guide:       String(body.user_guide || '').trim(),
        troubleshooting:  String(body.troubleshooting || '').trim(),
        compatible_units: String(body.compatible_units || '').trim(),
        status:           String(body.status || 'Active').trim(),
        assigned_to:      body.assigned_to || null,
        assigned_to_name: String(body.assigned_to_name || '').trim(),
        updated_at:       new Date().toISOString(),
      };
      if (!row.item_code || !row.name) return sendJson(res, 400, { ok: false, error: 'missing_fields', message: 'item_code and name are required.' });

      const out = await serviceInsert('support_catalog', [row]);
      if (!out.ok) return sendJson(res, out.status || 500, { ok: false, error: 'create_failed', details: out.json });
      return sendJson(res, 200, { ok: true, item: Array.isArray(out.json) ? out.json[0] : out.json });
    }

    // ── PATCH — update item ───────────────────────────────────────────────────
    if (method === 'PATCH') {
      let body;
      try { body = await parseBody(req); } catch(_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      const itemId = String(body.id || '').trim();
      if (!itemId) return sendJson(res, 400, { ok: false, error: 'missing_id' });

      // Fetch current item to check permissions
      const cur = await serviceSelect('support_catalog', `select=id,assigned_to,item_code&id=eq.${itemId}&limit=1`);
      if (!cur.ok || !cur.json || !cur.json[0]) return sendJson(res, 404, { ok: false, error: 'not_found' });
      const item = cur.json[0];

      const isAssigned = item.assigned_to && String(item.assigned_to) === String(user.id);
      if (!isSA && !isAssigned) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only assigned user or Super Admin can edit.' });

      const EDITABLE = ['name','category','brand','part_number','specs','user_guide','troubleshooting','compatible_units','status','assigned_to','assigned_to_name'];
      const patch = { updated_at: new Date().toISOString() };
      const historyRows = [];

      // Build patch + history
      const curFull = await serviceSelect('support_catalog', `select=*&id=eq.${itemId}&limit=1`);
      const prev = curFull.ok && curFull.json && curFull.json[0] ? curFull.json[0] : {};

      EDITABLE.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          const newVal = body[field] === null ? null : String(body[field] || '');
          const oldVal = prev[field] === null || prev[field] === undefined ? '' : String(prev[field]);
          if (newVal !== oldVal) {
            patch[field] = body[field];
            historyRows.push({
              item_id: itemId,
              edited_by: user.id,
              edited_by_name: profile.name || profile.username || 'Unknown',
              field_changed: field,
              old_value: oldVal,
              new_value: newVal || '',
              edited_at: new Date().toISOString(),
            });
          }
        }
      });

      const out = await serviceUpdate('support_catalog', patch, { id: `eq.${itemId}` });
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'update_failed' });

      if (historyRows.length) {
        await serviceInsert('support_catalog_history', historyRows).catch(() => {});
      }

      const fresh = await serviceSelect('support_catalog', `select=*&id=eq.${itemId}&limit=1`);
      return sendJson(res, 200, { ok: true, item: fresh.ok && fresh.json[0] ? fresh.json[0] : patch });
    }

    // ── DELETE — delete item ──────────────────────────────────────────────────
    if (method === 'DELETE') {
      if (!isSA) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });
      let body;
      try { body = await parseBody(req); } catch(_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }
      const itemId = String(body.id || '').trim();
      if (!itemId) return sendJson(res, 400, { ok: false, error: 'missing_id' });
      const out = await serviceDelete('support_catalog', `id=eq.${itemId}`);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'delete_failed' });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[catalog/items]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message || err) });
  }
};
