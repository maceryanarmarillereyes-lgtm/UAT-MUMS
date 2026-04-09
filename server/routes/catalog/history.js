/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/catalog/history.js
// GET /api/catalog/history?item_id=X — list edit history for item

const { getUserFromJwt, serviceSelect } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const itemId = req.query && req.query.item_id;
    if (!itemId) return sendJson(res, 400, { ok: false, error: 'missing_item_id' });

    const out = await serviceSelect('support_catalog_history',
      `select=*&item_id=eq.${itemId}&order=edited_at.desc&limit=100`
    );
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_error' });
    return sendJson(res, 200, { ok: true, history: out.json || [] });
  } catch (err) {
    console.error('[catalog/history]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
};
