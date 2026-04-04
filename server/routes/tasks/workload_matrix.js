/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { sendJson, requireAuthedUser, roleFlags, serviceSelect, escLike } = require('./_common');

function qList(values) {
  const uniq = Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
  if (!uniq.length) return '';
  return uniq.map((v) => encodeURIComponent(v)).join(',');
}

function statusOf(raw) {
  return String(raw || '').trim().toUpperCase();
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const flags = roleFlags(auth.profile && auth.profile.role);
    if (!flags.isLead && !flags.isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' });

    const profile = auth.profile || {};
    const role = statusOf(profile.role);
    const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'SUPER_USER';
    const leadTeamId = String(profile.team_id || profile.teamId || '').trim();
    const title = String((req.query && req.query.distribution_title) || '').trim();

    let distributionIds = [];
    if (title) {
      const dOut = await serviceSelect('task_distributions', `select=id&title=ilike.${escLike(title)}&limit=200`);
      if (!dOut.ok) return sendJson(res, 500, { ok: false, error: 'distribution_lookup_failed', details: dOut.json || dOut.text });
      distributionIds = (Array.isArray(dOut.json) ? dOut.json : []).map((d) => String(d.id || '').trim()).filter(Boolean);
      if (!distributionIds.length) return sendJson(res, 200, { ok: true, rows: [] });
    }

    const tq = [
      'select=id,status,distribution_id,assigned_to,updated_at,created_at',
      'order=created_at.desc',
      'limit=3000'
    ];
    if (distributionIds.length) tq.push(`distribution_id=in.(${qList(distributionIds)})`);

    const taskOut = await serviceSelect('task_items', tq.join('&'));
    if (!taskOut.ok) return sendJson(res, 500, { ok: false, error: 'workload_fetch_failed', details: taskOut.json || taskOut.text });
    const items = Array.isArray(taskOut.json) ? taskOut.json : [];
    if (!items.length) return sendJson(res, 200, { ok: true, rows: [] });

    const distributionIdList = Array.from(new Set(items.map((i) => String(i.distribution_id || '').trim()).filter(Boolean)));
    const assigneeList = Array.from(new Set(items.map((i) => String(i.assigned_to || '').trim()).filter(Boolean)));

    const [distOut, profileOut] = await Promise.all([
      distributionIdList.length
        ? serviceSelect('task_distributions', `select=id,title&limit=3000&id=in.(${qList(distributionIdList)})`)
        : Promise.resolve({ ok: true, json: [] }),
      assigneeList.length
        ? serviceSelect('mums_profiles', `select=user_id,name,username,duty,team_id&limit=3000&user_id=in.(${qList(assigneeList)})`)
        : Promise.resolve({ ok: true, json: [] })
    ]);

    if (!distOut.ok) return sendJson(res, 500, { ok: false, error: 'distribution_fetch_failed', details: distOut.json || distOut.text });
    if (!profileOut.ok) return sendJson(res, 500, { ok: false, error: 'profile_fetch_failed', details: profileOut.json || profileOut.text });

    const distMap = new Map((Array.isArray(distOut.json) ? distOut.json : []).map((d) => [String(d.id || ''), String(d.title || 'Untitled Distribution')]));
    const profileMap = new Map((Array.isArray(profileOut.json) ? profileOut.json : []).map((p) => [String(p.user_id || ''), p]));

    const rows = [];
    for (const item of items) {
      const profileRow = profileMap.get(String(item.assigned_to || '')) || null;
      if (!isSuperAdmin) {
        if (!leadTeamId) continue;
        const assigneeTeam = String((profileRow && profileRow.team_id) || '').trim();
        if (!assigneeTeam || assigneeTeam !== leadTeamId) continue;
      }

      const dutyRaw = String((profileRow && profileRow.duty) || '').trim();
      const teamRaw = String((profileRow && profileRow.team_id) || '').trim();
      const shiftCandidate = dutyRaw || teamRaw;

      rows.push({
        task_item_id: item.id,
        task_status: item.status,
        distribution_title: distMap.get(String(item.distribution_id || '')) || 'Untitled Distribution',
        member_name: (profileRow && (profileRow.name || profileRow.username || profileRow.user_id)) || String(item.assigned_to || 'Unknown Member'),
        member_shift: shiftCandidate || 'N/A',
        member_team_id: teamRaw || null,
        last_update: item.updated_at || item.created_at || null
      });
    }

    rows.sort((a, b) => String(a.distribution_title || '').localeCompare(String(b.distribution_title || '')) || String(a.member_name || '').localeCompare(String(b.member_name || '')));
    return sendJson(res, 200, { ok: true, rows });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'workload_matrix_failed', message: String(err && err.message ? err.message : err) });
  }
};
