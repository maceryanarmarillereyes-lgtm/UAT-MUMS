/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { sendJson, requireAuthedUser, serviceSelect } = require('./_common');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const out = await serviceSelect('mums_profiles', 'select=user_id,name,username,role,team_id,duty&order=name.asc');
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'members_fetch_failed', details: out.json || out.text });

    return sendJson(res, 200, { ok: true, rows: Array.isArray(out.json) ? out.json : [] });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'members_failed', message: String(err && err.message ? err.message : err) });
  }
};
