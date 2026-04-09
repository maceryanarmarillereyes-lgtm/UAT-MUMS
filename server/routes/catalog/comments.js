/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/catalog/comments.js
// GET    /api/catalog/comments?item_id=X  — list comments for item
// POST   /api/catalog/comments            — add comment (all users)
// PATCH  /api/catalog/comments            — acknowledge (assigned user + SA)

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceInsert, serviceUpdate } = require('../../lib/supabase');

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

    // ── GET — list comments for item ──────────────────────────────────────────
    if (method === 'GET') {
      const itemId = req.query && req.query.item_id;
      if (!itemId) return sendJson(res, 400, { ok: false, error: 'missing_item_id' });
      const out = await serviceSelect('support_catalog_comments',
        `select=*&item_id=eq.${itemId}&order=created_at.asc`
      );
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_error' });
      return sendJson(res, 200, { ok: true, comments: out.json || [] });
    }

    // ── POST — add comment ────────────────────────────────────────────────────
    if (method === 'POST') {
      let body;
      try { body = await parseBody(req); } catch(_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      const itemId = String(body.item_id || '').trim();
      const comment = String(body.comment || '').trim();
      if (!itemId || !comment) return sendJson(res, 400, { ok: false, error: 'missing_fields' });

      const row = {
        item_id:         itemId,
        user_id:         user.id,
        user_name:       profile.name || profile.username || 'Unknown',
        comment:         comment,
        is_acknowledged: false,
        created_at:      new Date().toISOString(),
      };
      const out = await serviceInsert('support_catalog_comments', [row]);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'comment_failed' });
      return sendJson(res, 200, { ok: true, comment: Array.isArray(out.json) ? out.json[0] : row });
    }

    // ── PATCH — acknowledge comment ───────────────────────────────────────────
    if (method === 'PATCH') {
      let body;
      try { body = await parseBody(req); } catch(_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      const commentId = String(body.id || '').trim();
      if (!commentId) return sendJson(res, 400, { ok: false, error: 'missing_id' });

      // Fetch comment to get item_id, then check assigned_to
      const cOut = await serviceSelect('support_catalog_comments', `select=*&id=eq.${commentId}&limit=1`);
      if (!cOut.ok || !cOut.json || !cOut.json[0]) return sendJson(res, 404, { ok: false, error: 'not_found' });
      const commentRow = cOut.json[0];

      // Get item to check assigned_to
      const iOut = await serviceSelect('support_catalog', `select=assigned_to&id=eq.${commentRow.item_id}&limit=1`);
      const item = iOut.ok && iOut.json && iOut.json[0] ? iOut.json[0] : {};
      const isAssigned = item.assigned_to && String(item.assigned_to) === String(user.id);

      if (!isSA && !isAssigned) {
        return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only assigned user or Super Admin can acknowledge.' });
      }

      const patch = {
        is_acknowledged:   true,
        acknowledged_by:   user.id,
        acknowledged_name: profile.name || profile.username || 'Unknown',
        acknowledged_at:   new Date().toISOString(),
      };
      const out = await serviceUpdate('support_catalog_comments', patch, { id: `eq.${commentId}` });
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'ack_failed' });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[catalog/comments]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message || err) });
  }
};
