/**
 * @file reassign_pending.js
 * @description Reassign Pending module
 * @module MUMS/MUMS
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { sendJson, requireAuthedUser, roleFlags, serviceSelect, serviceUpdate } = require('./_common');
function isUuid(v){
  return /^[0-9a-fA-F-]{20,}$/.test(String(v||''));
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    const flags = roleFlags(auth.profile && auth.profile.role);
    if (!flags.isAdmin && !flags.isLead) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const distributionId = String(body.distribution_id || '').trim();
    const fromUserId = String(body.from_user_id || '').trim();
    const toUserId = String(body.to_user_id || '').trim();
    const selectedItemIds = Array.isArray(body.selected_item_ids)
      ? body.selected_item_ids.map((id) => String(id || '').trim()).filter((id) => isUuid(id))
      : [];
    if (!distributionId || !isUuid(distributionId)) return sendJson(res, 400, { ok: false, error: 'invalid_distribution_id' });
    if (!fromUserId || !isUuid(fromUserId)) return sendJson(res, 400, { ok: false, error: 'invalid_from_user_id' });
    if (!toUserId || !isUuid(toUserId)) return sendJson(res, 400, { ok: false, error: 'invalid_to_user_id' });
    if (fromUserId === toUserId) return sendJson(res, 400, { ok: false, error: 'same_user' });
    if (!selectedItemIds.length) return sendJson(res, 400, { ok: false, error: 'invalid_selected_item_ids' });
    // Ensure distribution exists safely using select=*
    const dOut = await serviceSelect('task_distributions', `select=*&id=eq.${distributionId}&limit=1`);
    if (!dOut.ok) return sendJson(res, 500, { ok: false, error: 'distribution_fetch_failed', details: dOut.json || dOut.text });
    const dist = Array.isArray(dOut.json) && dOut.json[0] ? dOut.json[0] : null;
    if (!dist) return sendJson(res, 404, { ok: false, error: 'distribution_not_found' });
    // CRITICAL FIX: Quote UUIDs for PostgREST
    const quotedIds = selectedItemIds.map(id => `"${id}"`).join(',');
    const matchBase = `id=in.(${quotedIds})`;
    // SCHEMA SAFE: Only update assigned_to, avoiding missing columns
    const patchOnly = await serviceUpdate('task_items', matchBase, { assigned_to: toUserId });
    let moved = 0;
    if (patchOnly.ok && Array.isArray(patchOnly.json)) {
      moved = patchOnly.json.length;
    }

    return sendJson(res, 200, { ok: true, distribution_id: distributionId, moved });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'reassign_failed', message: String(err && err.message ? err.message : err) });
  }
};
