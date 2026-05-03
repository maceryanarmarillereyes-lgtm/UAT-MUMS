/**
 * @file monitoring.js
 * @description Monitoring module
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


const { sendJson, requireAuthedUser, roleFlags, serviceSelect } = require('./_common');
module.exports = async (req, res) => {
try {
const auth = await requireAuthedUser(req);
if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

const userRole = String(auth.profile?.role || '').toUpperCase();
const flags = roleFlags(userRole);
const isSuper = flags.isAdmin || flags.isLead || ['TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN', 'SUPER_USER'].includes(userRole);
const myTeamId = auth.profile?.team_id;
const limit = Number(req.query.limit) || 20;
const offset = Number(req.query.offset) || 0;
// 1. Fetch Batch Cards
const dOut = await serviceSelect('task_distributions', `select=*&order=created_at.desc&limit=${limit}&offset=${offset}`);
const dists = dOut.ok && Array.isArray(dOut.json) ? dOut.json : [];
if (!dists.length) return sendJson(res, 200, { ok: true, distributions: [], team_roster: [], has_more: false });
const distIds = dists.map(d => d.id).filter(Boolean);
// 2. BULLETPROOF FETCH
const itemPromises = distIds.map(async (id) => {
  const out = await serviceSelect('task_items', `select=*&distribution_id=eq.${id}`);
  return out.ok && Array.isArray(out.json) ? out.json : [];
});
const nestedItems = await Promise.all(itemPromises);
const allItems = nestedItems.flat();
// 3. Profiles Hydration & FULL TEAM ROSTER
const userIds = [...new Set(allItems.map(i => i.assigned_to).filter(Boolean))];
const profileMap = {};
const teamRoster = [];
// A. Hydrate profiles for active tasks
if (userIds.length) {
  const pOut = await serviceSelect('mums_profiles', `select=user_id,name,username,team_id&user_id=in.(${userIds.join(',')})`);
  if (pOut.ok) (pOut.json || []).forEach(p => { profileMap[p.user_id] = p; });
}
// B. Fetch Full Roster for Lead's Dropdown (Includes 0-task members)
if (myTeamId) {
  const rOut = await serviceSelect('mums_profiles', `select=user_id,name,username,team_id&team_id=eq.${encodeURIComponent(myTeamId)}`);
  if (rOut.ok) {
    (rOut.json || []).forEach(p => {
      profileMap[p.user_id] = p; // Ensure they are in the map
      teamRoster.push({ user_id: p.user_id, name: p.name || p.username || p.user_id, team_id: p.team_id });
    });
  }
} else if (isSuper) {
  // Admin fallback: fetch all
  const rOut = await serviceSelect('mums_profiles', `select=user_id,name,username,team_id`);
  if (rOut.ok) {
    (rOut.json || []).forEach(p => {
      profileMap[p.user_id] = p;
      teamRoster.push({ user_id: p.user_id, name: p.name || p.username || p.user_id, team_id: p.team_id });
    });
  }
}
// 4. Aggregation Loop
const response = dists.map(d => {
  const items = allItems.filter(i => i.distribution_id === d.id);
  const memberBuckets = {};
  items.forEach(it => {
    const uid = it.assigned_to;
    if(!uid) return;
    const prof = profileMap[uid] || {};
    if(!isSuper){
      if(myTeamId && prof.team_id && String(prof.team_id).toLowerCase() !== String(myTeamId).toLowerCase()) return;
    }
    if(!memberBuckets[uid]) {
      memberBuckets[uid] = { 
        user_id: uid, name: prof.name || prof.username || uid, team_id: prof.team_id || null, 
        total:0, completed:0, pending:0, with_problem:0, items:[] 
      };
    }
    
    const m = memberBuckets[uid];
    const s = String(it.status || '').toLowerCase();
    m.total++;
    if(s.includes('complete') || s === 'done') m.completed++;
    else if(s.includes('problem')) m.with_problem++;
    else m.pending++;
    m.items.push({ 
      id: it.id, 
      case_number: it.case_number || it.case_no || it.task_description || it.description || 'N/A', 
      site: it.site || 'N/A', 
      status: it.status 
    });
  });
  const members = Object.values(memberBuckets).map(m => ({
    ...m, completion_pct: m.total ? Math.round((m.completed / m.total) * 100) : 0
  })).sort((a,b) => a.name.localeCompare(b.name));
  if(!isSuper && !members.length) return null;
  return {
    id: d.id, title: d.title, created_at: d.created_at, created_by_name: d.created_by_name || 'System',
    totals: members.reduce((acc, m) => { acc.total += m.total; acc.pending += m.pending; acc.with_problem += m.with_problem; return acc; }, {total:0,pending:0,with_problem:0}),
    members
  };
}).filter(Boolean);
// Inject team_roster into final response
return sendJson(res, 200, { ok: true, distributions: response, team_roster: teamRoster, has_more: dists.length === limit });
} catch (err) { return sendJson(res, 500, { ok: false, message: err.message }); }
};
