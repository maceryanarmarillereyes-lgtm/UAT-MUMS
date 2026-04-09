/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');

// POST /api/mailbox/confirm
// Body: { shiftKey, assignmentId }
//
// Rules:
// - Assignee (MEMBER) may confirm only their own assigned cases.
// - SUPER_ADMIN / SUPER_USER / ADMIN / TEAM_LEAD may confirm any case.
// - Writes with service role; appends audit log entry (ums_activity_logs).

const ADMIN_ROLES = new Set(['SUPER_ADMIN','SUPER_USER','ADMIN','TEAM_LEAD']);

async function getDocValue(key){
  const q = `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if(!out.ok) return { ok:false, error:'select_failed', details: out.json || out.text };
  const row = Array.isArray(out.json) ? out.json[0] : null;
  return { ok:true, value: row ? row.value : null };
}
function safeString(x, max=240){
  const s = (x==null) ? '' : String(x);
  return s.length>max ? s.slice(0,max) : s;
}
async function upsertDoc(key, value, actor, profile, clientId){
  const row = {
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actor.id,
    updated_by_name: profile && profile.name ? profile.name : null,
    updated_by_client_id: clientId || null
  };
  const up = await serviceUpsert('mums_documents', [row], 'key');
  if(!up.ok) return { ok:false, error:'upsert_failed', details: up.json || up.text };
  return { ok:true, json: up.json };
}
function pruneLogs(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (183*24*60*60*1000);
  return arr.filter(x => x && x.ts && Number(x.ts) >= cutoff).slice(0, 2500);
}
function pruneCases(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (366*24*60*60*1000);
  return arr.filter(x => x && Number(x.createdAt || x.ts || 0) >= cutoff).slice(0, 5000);
}

module.exports = async (req, res) => {
  try{
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if(req.method !== 'POST'){
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'Method not allowed' }));
    }

    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const actor = await getUserFromJwt(jwt);
    if(!actor){
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok:false, error:'Unauthorized' }));
    }
    const profile = await getProfileForUserId(actor.id);
    const role = safeString(profile && profile.role ? profile.role : 'MEMBER', 40);

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const shiftKey = safeString(body.shiftKey, 120);
    const assignmentId = safeString(body.assignmentId, 160);
    const clientId = safeString(body.clientId, 120) || null;

    if(!shiftKey || !assignmentId){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'Missing required fields' }));
    }

    const tablesDoc = await getDocValue('mums_mailbox_tables');
    if(!tablesDoc.ok){
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok:false, error:'Failed to read mailbox tables', details: tablesDoc.details }));
    }
    const allTables = (tablesDoc.value && typeof tablesDoc.value === 'object') ? tablesDoc.value : {};
    const table = allTables[shiftKey];
    if(!table || typeof table !== 'object'){
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok:false, error:'Mailbox table not found', shiftKey }));
    }

    const next = JSON.parse(JSON.stringify(table));
    next.assignments = Array.isArray(next.assignments) ? next.assignments : [];
    const a = next.assignments.find(x=>x && String(x.id||'') === assignmentId);
    if(!a){
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok:false, error:'Assignment not found' }));
    }

    // Permission
    if(!ADMIN_ROLES.has(role)){
      if(String(a.assigneeId||'') !== String(actor.id||'')){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (not your assignment)' }));
      }
    }

    if(a.confirmedAt){
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok:true, shiftKey, table: next, alreadyConfirmed:true }));
    }

    a.confirmedAt = Date.now();
    a.confirmedById = actor.id;
    a.confirmedByName = (profile && profile.name) ? profile.name : (actor.email || '');

    let persistedTable = next;
    let confirmed = false;
    for(let attempt=0; attempt<4; attempt++){
      let latestAll = allTables;
      if(attempt > 0){
        const latestDoc = await getDocValue('mums_mailbox_tables');
        latestAll = (latestDoc.ok && latestDoc.value && typeof latestDoc.value === 'object') ? latestDoc.value : {};
      }
      const latestTable = (latestAll[shiftKey] && typeof latestAll[shiftKey] === 'object') ? latestAll[shiftKey] : {};
      const merged = JSON.parse(JSON.stringify(latestTable));
      merged.assignments = Array.isArray(merged.assignments) ? merged.assignments : [];
      const idx = merged.assignments.findIndex(x=>x && String(x.id||'') === assignmentId);
      if(idx < 0){
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok:false, error:'Assignment not found' }));
      }
      const item = merged.assignments[idx];
      if(item.confirmedAt){
        persistedTable = merged;
        confirmed = true;
      }else{
        item.confirmedAt = a.confirmedAt;
        item.confirmedById = actor.id;
        item.confirmedByName = (profile && profile.name) ? profile.name : (actor.email || '');
        const payloadAll = Object.assign({}, latestAll, { [shiftKey]: merged });
        const up = await upsertDoc('mums_mailbox_tables', payloadAll, actor, profile, clientId);
        if(!up.ok){
          res.statusCode = 500;
          return res.end(JSON.stringify({ ok:false, error:'Failed to update mailbox tables', details: up.details }));
        }
        const verify = await getDocValue('mums_mailbox_tables');
        const verifyAll = (verify.ok && verify.value && typeof verify.value === 'object') ? verify.value : {};
        const verifyTable = verifyAll[shiftKey];
        if(verifyTable && Array.isArray(verifyTable.assignments)){
          const v = verifyTable.assignments.find(x=>x && String(x.id||'') === assignmentId);
          if(v && Number(v.confirmedAt || 0) > 0){
            persistedTable = verifyTable;
            confirmed = true;
          }
        }
      }
      if(confirmed) break;
    }
    if(!confirmed){
      res.statusCode = 409;
      return res.end(JSON.stringify({ ok:false, error:'Confirm write conflict. Please try again.', code:'MAILBOX_CONFIRM_CONFLICT' }));
    }

    // Audit log
    try{
      const logsDoc = await getDocValue('ums_activity_logs');
      const prevLogs = (logsDoc.ok && Array.isArray(logsDoc.value)) ? logsDoc.value : [];
      const logEntry = {
        ts: a.confirmedAt,
        teamId: safeString(persistedTable?.meta?.teamId, 40),
        actorId: actor.id,
        actorName: a.confirmedByName,
        action: 'MAILBOX_CASE_CONFIRM',
        targetId: safeString(a.caseNo, 120),
        targetName: safeString(a.caseNo, 120),
        msg: `Mailbox case confirmed`.trim(),
        detail: `${safeString(a.caseNo,120)} • confirmed • shiftKey ${shiftKey} • actorRole ${role}`,
        shiftKey,
        bucketId: safeString(a.bucketId, 60),
        assigneeId: safeString(a.assigneeId, 80),
        actorRole: role
      };
      const nextLogs = pruneLogs([logEntry, ...prevLogs]);
      await upsertDoc('ums_activity_logs', nextLogs, actor, profile, clientId);
    }catch(_){}

    // Keep canonical case entries consistent with mailbox confirmation.
    try{
      const casesDoc = await getDocValue('ums_cases');
      const prevCases = (casesDoc.ok && Array.isArray(casesDoc.value)) ? casesDoc.value : [];
      const caseNoLower = String(a.caseNo || '').trim().toLowerCase();
      const confirmedAt = Number(a.confirmedAt || Date.now()) || Date.now();
      const confirmerName = (profile && profile.name) ? profile.name : (actor.email || '');
      const nextCases = prevCases.map((c)=>{
        if(!c || typeof c !== 'object') return c;
        const sameAssignee = String(c.assigneeId || '') === String(a.assigneeId || '');
        const sameShift = String(c.shiftKey || '') === String(shiftKey || '');
        const sameCaseNo = String(c.caseNo || c.title || '').trim().toLowerCase() === caseNoLower;
        if(!sameAssignee || !sameShift || !sameCaseNo) return c;
        return Object.assign({}, c, {
          status: 'Accepted',
          confirmedAt,
          confirmedById: actor.id,
          confirmedByName: confirmerName
        });
      });
      await upsertDoc('ums_cases', pruneCases(nextCases), actor, profile, clientId);
    }catch(_){}

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok:true, shiftKey, table: persistedTable }));
  }catch(e){
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok:false, error:'Server error', details: String(e?.message||e) }));
  }
};
