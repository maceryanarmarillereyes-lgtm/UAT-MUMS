/**
 * @file members.js
 * @description Page: Members — team member list with status, schedule, and inline editing
 * @module MUMS/Pages
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { sendJson, requireAuthedUser, roleFlags, serviceSelect } = require('./_common');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const role = String(auth && auth.profile && auth.profile.role || '').toUpperCase();
    const teamId = String(auth && auth.profile && auth.profile.team_id || '').trim();
    const { isAdmin } = roleFlags(role);

    const baseSelect = 'select=user_id,name,username,role,team_id,duty';
    const scopedSelect = (!isAdmin && teamId)
      ? `${baseSelect}&team_id=eq.${encodeURIComponent(teamId)}&order=name.asc`
      : `${baseSelect}&order=name.asc`;

    const out = await serviceSelect('mums_profiles', scopedSelect);
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'members_fetch_failed', details: out.json || out.text });

    return sendJson(res, 200, { ok: true, rows: Array.isArray(out.json) ? out.json : [] });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'members_failed', message: String(err && err.message ? err.message : err) });
  }
};
