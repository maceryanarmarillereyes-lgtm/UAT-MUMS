/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { getUserFromJwt, getProfileForUserId, serviceSelect } = require('../../lib/supabase');

function setCors(res){
  try{
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }catch(_){}
}

// GET /api/sync/pull?since=<ms>&clientId=<id>
// Returns updated collaborative docs since the given timestamp.
module.exports = async (req, res) => {
  try {
    setCors(res);
    if (String(req.method || '').toUpperCase() === 'OPTIONS') {
      res.statusCode = 204;
      return res.end('');
    }
    res.setHeader('Cache-Control', 'no-store');

    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u = await getUserFromJwt(jwt);
    if (!u) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }

    // Optional: role gating on read can be added later. For now, authenticated users can read.
    await getProfileForUserId(u.id);

    const sinceMs = Math.max(0, parseInt((req.query && req.query.since) || '0', 10) || 0);
    const sinceIso = new Date(sinceMs || 0).toISOString();

    const q = `select=key,value,updated_at,updated_by_client_id&updated_at=gt.${encodeURIComponent(sinceIso)}&order=updated_at.asc&limit=200`;
    const out = await serviceSelect('mums_documents', q);

    if (!out.ok) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'Supabase select failed', details: out.json || out.text }));
    }

    const docs = Array.isArray(out.json) ? out.json : [];
    const mapped = docs.map((d) => ({
      key: d.key,
      value: d.value,
      updatedAt: d.updated_at ? Date.parse(d.updated_at) : Date.now(),
      updatedByClientId: d.updated_by_client_id || null
    }));

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, serverNow: Date.now(), docs: mapped }));
  } catch (e) {
    setCors(res);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'sync_unavailable', retryAfter: 30 }));
  }
};
