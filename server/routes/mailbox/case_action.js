/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');

const ADMIN_ANYTIME = new Set(['SUPER_ADMIN','SUPER_USER','ADMIN']);
const TEAM_LEAD_ROLE = 'TEAM_LEAD';

function safeString(x, max=240){
  const s = (x==null) ? '' : String(x);
  return s.length>max ? s.slice(0,max) : s;
}

function parseHM(hm){
  const s = String(hm||'0:0').split(':');
  const h = Math.max(0, Math.min(23, parseInt(s[0]||'0',10)||0));
  const m = Math.max(0, Math.min(59, parseInt(s[1]||'0',10)||0));
  return h*60+m;
}

function blockHit(nowMin, startMin, endMin){
  const wraps = endMin <= startMin;
  return (!wraps && nowMin>=startMin && nowMin<endMin) || (wraps && (nowMin>=startMin || nowMin<endMin));
}

function manilaNowParts(){
  const d = new Date(Date.now() + 8*60*60*1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const isoDate = d.toISOString().slice(0,10);
  const dayIndex = d.getUTCDay();
  return { hh, mm, isoDate, dayIndex, nowMin: hh*60+mm, nowMs: Date.now() };
}

function manilaPartsFromMs(ms){
  const d = new Date(Number(ms || 0) + 8*60*60*1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const isoDate = d.toISOString().slice(0,10);
  const dayIndex = d.getUTCDay();
  return { hh, mm, isoDate, dayIndex, nowMin: hh*60+mm, nowMs: Number(ms || Date.now()) };
}

function parseShiftTeamId(shiftKey){
  if(!shiftKey) return '';
  return String(shiftKey).split('|')[0] || '';
}

function resolveDutyWindow(teamId, table){
  const rawStart = safeString(table?.meta?.dutyStart || '', 10);
  const rawEnd = safeString(table?.meta?.dutyEnd || '', 10);
  if(rawStart && rawEnd){
    return { start: rawStart, end: rawEnd, startMin: parseHM(rawStart), endMin: parseHM(rawEnd) };
  }
  const defaults = {
    morning: { start:'06:00', end:'15:00' },
    mid: { start:'15:00', end:'22:00' },
    night: { start:'22:00', end:'06:00' }
  };
  const def = defaults[String(teamId||'').trim()] || defaults.morning;
  return { start: def.start, end: def.end, startMin: parseHM(def.start), endMin: parseHM(def.end) };
}

function isMailboxManagerOnDuty(weekly, userId, nowParts, dutyWindow){
  try{
    const u = weekly && weekly[userId];
    if(!u) return false;
    const days = (u.days || {});
    const roleSet = new Set(['mailbox_manager','mailbox_call']);
    const nowMin = nowParts.nowMin;
    const dow = nowParts.dayIndex;
    const dows = [dow];

    try{
      const startMin = Number(dutyWindow?.startMin);
      const endMin = Number(dutyWindow?.endMin);
      if(Number.isFinite(startMin) && Number.isFinite(endMin)){
        const wraps = endMin <= startMin;
        if(wraps && nowMin < endMin) dows.push((dow+6)%7);
      }
    }catch(_){ }

    for(const di of dows){
      const list = Array.isArray(days[String(di)]) ? days[String(di)] : [];
      for(const b of list){
        if(!b) continue;
        if(!roleSet.has(String(b.role||''))) continue;
        const s = parseHM(b.start);
        const e = parseHM(b.end);
        if(blockHit(nowMin, s, e)) return true;
      }
    }
  }catch(_){ }
  return false;
}

async function getDocValue(key){
  const q = `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if(!out.ok) return { ok:false, error:'select_failed', details: out.json || out.text };
  const row = Array.isArray(out.json) ? out.json[0] : null;
  return { ok:true, value: row ? row.value : null };
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

async function getMailboxOverrideNowParts(){
  try{
    const overrideDoc = await getDocValue('mums_mailbox_time_override_cloud');
    if(!overrideDoc.ok || !overrideDoc.value || typeof overrideDoc.value !== 'object') return null;
    const o = overrideDoc.value;
    if(!o.enabled || String(o.scope || '') !== 'global') return null;
    const base = Number(o.ms);
    const MIN_VALID_MS = Date.UTC(2020,0,1);
    const MAX_VALID_MS = Date.now() + (366 * 24 * 60 * 60 * 1000);
    if(!Number.isFinite(base) || base <= 0) return null;
    if(base < MIN_VALID_MS || base > MAX_VALID_MS) return null;
    const freeze = (o.freeze !== false);
    let setAt = Number(o.setAt) || 0;
    if(!freeze){
      if(!Number.isFinite(setAt) || setAt <= 0 || setAt > (Date.now() + 60*1000)) setAt = Date.now();
    }else{
      setAt = 0;
    }
    const ms = freeze ? base : (base + Math.max(0, Date.now() - setAt));
    if(!Number.isFinite(ms) || ms <= 0) return null;
    return manilaPartsFromMs(ms);
  }catch(_){
    return null;
  }
}

async function getMailboxScheduleDoc(){
  const blocksDoc = await getDocValue('mums_schedule_blocks');
  if(blocksDoc.ok && blocksDoc.value && Object.keys(blocksDoc.value || {}).length){
    return { ok:true, value: blocksDoc.value, source: 'mums_schedule_blocks' };
  }
  const weeklyDoc = await getDocValue('ums_weekly_schedules');
  if(weeklyDoc.ok){
    return { ok:true, value: weeklyDoc.value || {}, source: 'ums_weekly_schedules' };
  }
  return { ok:false, error:'Failed to read schedules', details: weeklyDoc.details };
}

function pruneLogs(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (183*24*60*60*1000);
  return arr.filter(x => x && x.ts && Number(x.ts) >= cutoff).slice(0, 2500);
}

function pruneNotifs(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (183*24*60*60*1000);
  return arr.filter(x => x && x.ts && Number(x.ts) >= cutoff).slice(0, 2500);
}

function pruneCases(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (366*24*60*60*1000);
  return arr.filter(x => x && Number(x.createdAt || x.ts || 0) >= cutoff).slice(0, 5000);
}

async function canManageCases(actor, profile, role, shiftTeamId, table){
  if(ADMIN_ANYTIME.has(role) || role === TEAM_LEAD_ROLE) return { ok:true };

  const teamId = safeString(profile && (profile.team_id || profile.teamId) ? (profile.team_id || profile.teamId) : '', 40);
  if(!teamId || (shiftTeamId && teamId !== shiftTeamId)){
    return { ok:false, status:403, error:'Forbidden (not in duty team)' };
  }

  const overrideNow = await getMailboxOverrideNowParts();
  const now = overrideNow || manilaNowParts();
  const dutyWindow = resolveDutyWindow(shiftTeamId, table);
  if(!blockHit(now.nowMin, dutyWindow.startMin, dutyWindow.endMin)){
    return { ok:false, status:403, error:'Forbidden (not on active shift)' };
  }

  const scheduleDoc = await getMailboxScheduleDoc();
  if(!scheduleDoc.ok){
    return { ok:false, status:500, error:'Failed to read schedules', details: scheduleDoc.details };
  }
  const onDuty = isMailboxManagerOnDuty(scheduleDoc.value || {}, actor.id, now, dutyWindow);
  if(!onDuty){
    return { ok:false, status:403, error:'Forbidden (Mailbox Manager duty not active)' };
  }
  return { ok:true };
}

function normalizeCaseNo(v){
  return String(v||'').trim().toLowerCase();
}

function updateCasesForReassign(list, payload){
  const { oldAssigneeId, newAssigneeId, newAssigneeName, shiftKey, caseNo } = payload;
  const key = normalizeCaseNo(caseNo);
  return (Array.isArray(list) ? list : []).map((c)=>{
    if(!c || typeof c !== 'object') return c;
    const sameAssignee = String(c.assigneeId || '') === String(oldAssigneeId || '');
    const sameShift = String(c.shiftKey || '') === String(shiftKey || '');
    const sameCaseNo = normalizeCaseNo(c.caseNo || c.title || '') === key;
    if(!sameAssignee || !sameShift || !sameCaseNo) return c;
    return Object.assign({}, c, {
      assigneeId: newAssigneeId,
      assigneeName: newAssigneeName,
      status: 'Assigned'
    });
  });
}

function removeCaseEntry(list, payload){
  const { assigneeId, shiftKey, caseNo } = payload;
  const key = normalizeCaseNo(caseNo);
  return (Array.isArray(list) ? list : []).filter((c)=>{
    if(!c || typeof c !== 'object') return false;
    const sameAssignee = String(c.assigneeId || '') === String(assigneeId || '');
    const sameShift = String(c.shiftKey || '') === String(shiftKey || '');
    const sameCaseNo = normalizeCaseNo(c.caseNo || c.title || '') === key;
    return !(sameAssignee && sameShift && sameCaseNo);
  });
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
    const action = safeString(body.action, 20).toLowerCase();
    const shiftKey = safeString(body.shiftKey, 120);
    const assignmentId = safeString(body.assignmentId, 200);
    const clientId = safeString(body.clientId, 120) || null;

    // FIX: assignmentId is optional for delete when caseNo+ownerId are provided.
    // Synthetic/local IDs (local_*, merged_*) that never made it to the server
    // still need a valid delete path via caseNo+ownerId composite key lookup.
    const caseNoForLookup = safeString(body.caseNo, 120);
    const ownerIdForLookup = safeString(body.ownerId, 80);
    const hasAltKey = !!(caseNoForLookup && ownerIdForLookup);
    if(!shiftKey || (!assignmentId && !hasAltKey) || (action !== 'reassign' && action !== 'delete')){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'Missing or invalid required fields' }));
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

    const shiftTeamId = parseShiftTeamId(shiftKey);
    const perm = await canManageCases(actor, profile, role, shiftTeamId, table);
    if(!perm.ok){
      res.statusCode = perm.status || 403;
      return res.end(JSON.stringify({ ok:false, error: perm.error || 'Forbidden', details: perm.details }));
    }

    let persistedTable = null;
    let operationMeta = null;

    for(let attempt=0; attempt<4; attempt++){
      let latestAll = allTables;
      if(attempt > 0){
        const latestDoc = await getDocValue('mums_mailbox_tables');
        latestAll = (latestDoc.ok && latestDoc.value && typeof latestDoc.value === 'object') ? latestDoc.value : {};
      }
      const latestTable = (latestAll[shiftKey] && typeof latestAll[shiftKey] === 'object') ? latestAll[shiftKey] : null;
      if(!latestTable){
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok:false, error:'Mailbox table not found', shiftKey }));
      }

      const next = JSON.parse(JSON.stringify(latestTable));
      next.assignments = Array.isArray(next.assignments) ? next.assignments : [];
      next.counts = (next.counts && typeof next.counts === 'object') ? next.counts : {};

      // DUAL-KEY LOOKUP: Primary lookup by assignmentId (server-canonical mbx_srv_* IDs).
      // Fallback lookup by caseNo+ownerId composite key — handles synthetic/local IDs
      // (local_*, merged_*, mbx_* client-side IDs) that were never persisted server-side,
      // which happens during the Supabase Realtime propagation window after assign.
      let idx = assignmentId ? next.assignments.findIndex(x => x && String(x.id||'') === assignmentId) : -1;
      if(idx < 0 && hasAltKey){
        const normKey = normalizeCaseNo(caseNoForLookup);
        idx = next.assignments.findIndex(x =>
          x &&
          normalizeCaseNo(x.caseNo || '') === normKey &&
          String(x.assigneeId || '') === String(ownerIdForLookup)
        );
      }
      if(idx < 0){
        // If this is a delete and we still can't find the assignment, it may have already
        // been deleted server-side (race condition or double-submit). Return success so the
        // client doesn't resurrect a case that is genuinely gone on the server.
        if(action === 'delete'){
          const currentTable = latestAll[shiftKey] || latestTable;
          res.statusCode = 200;
          return res.end(JSON.stringify({
            ok: true,
            action,
            shiftKey,
            table: currentTable,
            alreadyDeleted: true
          }));
        }
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok:false, error:'Assignment not found' }));
      }
      const current = next.assignments[idx];

      if(action === 'reassign'){
        const newAssigneeId = safeString(body.newAssigneeId, 80);
        if(!newAssigneeId){
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok:false, error:'newAssigneeId is required for reassign' }));
        }
        if(String(newAssigneeId) === String(current.assigneeId || '')){
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok:false, error:'Case is already assigned to this user' }));
        }

        let nextProfile = null;
        try{ nextProfile = await getProfileForUserId(newAssigneeId); }catch(_){ nextProfile = null; }
        const nextRole = safeString(nextProfile && nextProfile.role ? nextProfile.role : '', 40);
        const nextTeamId = safeString(nextProfile && (nextProfile.team_id || nextProfile.teamId) ? (nextProfile.team_id || nextProfile.teamId) : '', 40);
        if(nextRole !== 'MEMBER'){
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok:false, error:'Reassign target must be a MEMBER account' }));
        }
        if(shiftTeamId && nextTeamId && shiftTeamId !== nextTeamId){
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok:false, error:'Reassign target must be from the same team' }));
        }

        const newAssigneeName = safeString((nextProfile && (nextProfile.name || nextProfile.username)) ? (nextProfile.name || nextProfile.username) : newAssigneeId, 120);
        const prevAssigneeId = safeString(current.assigneeId, 80);
        const prevAssigneeName = safeString(current.assigneeName, 120) || prevAssigneeId;
        const bucketId = safeString(current.bucketId, 80);

        current.previousAssigneeId = prevAssigneeId;
        current.previousAssigneeName = prevAssigneeName;
        current.assigneeId = newAssigneeId;
        current.assigneeName = newAssigneeName;
        current.assigneeRole = 'MEMBER';
        current.reassignedAt = Date.now();
        current.reassignedById = actor.id;
        current.reassignedByName = safeString((profile && profile.name) ? profile.name : (actor.email || ''), 120);

        if(bucketId){
          next.counts[prevAssigneeId] = (next.counts[prevAssigneeId] && typeof next.counts[prevAssigneeId] === 'object') ? next.counts[prevAssigneeId] : {};
          next.counts[newAssigneeId] = (next.counts[newAssigneeId] && typeof next.counts[newAssigneeId] === 'object') ? next.counts[newAssigneeId] : {};
          const oldCount = Number(next.counts[prevAssigneeId][bucketId]) || 0;
          next.counts[prevAssigneeId][bucketId] = Math.max(0, oldCount - 1);
          next.counts[newAssigneeId][bucketId] = (Number(next.counts[newAssigneeId][bucketId]) || 0) + 1;
        }

        operationMeta = {
          action,
          caseNo: safeString(current.caseNo, 120),
          oldAssigneeId: prevAssigneeId,
          oldAssigneeName: prevAssigneeName,
          newAssigneeId,
          newAssigneeName,
          bucketId
        };
      } else {
        const removed = next.assignments.splice(idx, 1)[0] || current;
        const assigneeId = safeString(removed.assigneeId, 80);
        const bucketId = safeString(removed.bucketId, 80);
        if(assigneeId && bucketId){
          next.counts[assigneeId] = (next.counts[assigneeId] && typeof next.counts[assigneeId] === 'object') ? next.counts[assigneeId] : {};
          const oldCount = Number(next.counts[assigneeId][bucketId]) || 0;
          next.counts[assigneeId][bucketId] = Math.max(0, oldCount - 1);
        }

        operationMeta = {
          action,
          caseNo: safeString(removed.caseNo, 120),
          oldAssigneeId: assigneeId,
          oldAssigneeName: safeString(removed.assigneeName, 120) || assigneeId,
          bucketId
        };
      }

      const payloadAll = Object.assign({}, latestAll, { [shiftKey]: next });
      const up = await upsertDoc('mums_mailbox_tables', payloadAll, actor, profile, clientId);
      if(!up.ok){
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'Failed to update mailbox tables', details: up.details }));
      }

      const verify = await getDocValue('mums_mailbox_tables');
      const verifyAll = (verify.ok && verify.value && typeof verify.value === 'object') ? verify.value : {};
      const verifyTable = verifyAll[shiftKey];
      if(verifyTable && Array.isArray(verifyTable.assignments)){
        const exists = verifyTable.assignments.some(a=>a && String(a.id||'') === assignmentId);
        if((action === 'reassign' && exists) || (action === 'delete' && !exists)){
          persistedTable = verifyTable;
          allTables[shiftKey] = verifyTable;
          break;
        }
      }
    }

    if(!persistedTable){
      res.statusCode = 409;
      return res.end(JSON.stringify({ ok:false, error:'Case action write conflict. Please try again.', code:'MAILBOX_CASE_ACTION_CONFLICT' }));
    }

    const actorName = safeString((profile && profile.name) ? profile.name : (actor.email || ''), 120) || 'Mailbox Manager';

    try{
      const logsDoc = await getDocValue('ums_activity_logs');
      const prevLogs = (logsDoc.ok && Array.isArray(logsDoc.value)) ? logsDoc.value : [];
      const logEntry = {
        ts: Date.now(),
        teamId: safeString(persistedTable?.meta?.teamId || shiftTeamId, 40),
        actorId: actor.id,
        actorName,
        actorRole: role,
        action: operationMeta.action === 'reassign' ? 'MAILBOX_CASE_REASSIGN' : 'MAILBOX_CASE_DELETE',
        targetId: safeString(operationMeta.caseNo, 120),
        targetName: safeString(operationMeta.caseNo, 120),
        msg: operationMeta.action === 'reassign'
          ? `Mailbox reassigned: ${operationMeta.caseNo} → ${operationMeta.newAssigneeName}`
          : `Mailbox case deleted: ${operationMeta.caseNo}`,
        detail: operationMeta.action === 'reassign'
          ? `${operationMeta.caseNo} reassigned by ${actorName} (${role}) from ${operationMeta.oldAssigneeName} to ${operationMeta.newAssigneeName} • shiftKey ${shiftKey}`
          : `${operationMeta.caseNo} deleted by ${actorName} (${role}) from ${operationMeta.oldAssigneeName} • shiftKey ${shiftKey}`,
        shiftKey,
        bucketId: safeString(operationMeta.bucketId, 80)
      };
      await upsertDoc('ums_activity_logs', pruneLogs([logEntry, ...prevLogs]), actor, profile, clientId);
    }catch(_){ }

    try{
      const casesDoc = await getDocValue('ums_cases');
      const prevCases = (casesDoc.ok && Array.isArray(casesDoc.value)) ? casesDoc.value : [];
      const nextCases = operationMeta.action === 'reassign'
        ? updateCasesForReassign(prevCases, {
          oldAssigneeId: operationMeta.oldAssigneeId,
          newAssigneeId: operationMeta.newAssigneeId,
          newAssigneeName: operationMeta.newAssigneeName,
          shiftKey,
          caseNo: operationMeta.caseNo
        })
        : removeCaseEntry(prevCases, {
          assigneeId: operationMeta.oldAssigneeId,
          shiftKey,
          caseNo: operationMeta.caseNo
        });
      await upsertDoc('ums_cases', pruneCases(nextCases), actor, profile, clientId);
    }catch(_){ }

    try{
      const notifsDoc = await getDocValue('mums_schedule_notifs');
      const prevNotifs = (notifsDoc.ok && Array.isArray(notifsDoc.value)) ? notifsDoc.value : [];
      const ts = Date.now();
      const teamId = safeString(persistedTable?.meta?.teamId || shiftTeamId, 40);
      const notifs = [];

      if(operationMeta.action === 'reassign'){
        // Notify NEW assignee about the reassigned case
        notifs.push({
          id: `mbx_reassign_${assignmentId}_${operationMeta.newAssigneeId}`,
          ts,
          type: 'MAILBOX_REASSIGN',
          teamId,
          fromId: actor.id,
          fromName: actorName,
          title: 'Case Reassigned Notification',
          body: `Case ${operationMeta.caseNo} reassigned to you.`,
          recipients: [operationMeta.newAssigneeId],
          caseNo: operationMeta.caseNo,
          shiftKey,
          assignmentId,
          userMessages: {
            [operationMeta.newAssigneeId]: `Case ${operationMeta.caseNo} was reassigned to you by ${actorName}.`
          }
        });

        // Notify OLD assignee that their case was reassigned away
        if(operationMeta.oldAssigneeId){
          const reassignMsg = `Case ${operationMeta.caseNo} was reassigned from you to ${operationMeta.newAssigneeName} by ${actorName}.`;
          notifs.push({
            id: `mbx_reassign_prev_${assignmentId}_${operationMeta.oldAssigneeId}`,
            ts,
            type: 'MAILBOX_REASSIGN_PREV_OWNER',
            teamId,
            fromId: actor.id,
            fromName: actorName,
            title: 'Case Reassigned',
            body: reassignMsg,
            recipients: [operationMeta.oldAssigneeId],
            caseNo: operationMeta.caseNo,
            shiftKey,
            assignmentId,
            userMessages: { [operationMeta.oldAssigneeId]: reassignMsg }
          });
        }
      }
      // FIX: On DELETE — send NO notification to the old assignee.
      // The case is gone; the end user does not need an acknowledgement prompt.
      // Instead, PURGE the original MAILBOX_ASSIGN + any MAILBOX_REASSIGN notifs
      // for this assignment so the assignee's accept button disappears cleanly.

      // IDs to remove from the notification store when deleting
      const _purgeIds = new Set();
      if(operationMeta.action === 'delete'){
        _purgeIds.add(`mbx_assign_${assignmentId}`);
        // Also purge any reassign notifs that may exist for this assignment
        prevNotifs.forEach(n => {
          if(!n || !n.id) return;
          const nId = String(n.id);
          if(nId.startsWith(`mbx_reassign_${assignmentId}_`)) _purgeIds.add(nId);
          if(n.assignmentId && String(n.assignmentId) === assignmentId) _purgeIds.add(nId);
          // Match by caseNo for any notif type referencing this case
          if(n.caseNo && String(n.caseNo).trim().toLowerCase() === String(operationMeta.caseNo||'').trim().toLowerCase()
             && (String(n.type||'') === 'MAILBOX_ASSIGN' || String(n.type||'') === 'MAILBOX_REASSIGN')){
            _purgeIds.add(nId);
          }
        });
      }

      const deduped = [...notifs, ...prevNotifs].filter((n, idx, arr)=>{
        if(!n || !n.id) return false;
        // Remove any purged IDs
        if(_purgeIds.has(String(n.id))) return false;
        return arr.findIndex(x=>x && String(x.id||'') === String(n.id)) === idx;
      });
      await upsertDoc('mums_schedule_notifs', pruneNotifs(deduped), actor, profile, clientId);
    }catch(_){ }

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok:true,
      action,
      shiftKey,
      table: persistedTable,
      caseNo: operationMeta.caseNo,
      previousOwnerId: operationMeta.oldAssigneeId || '',
      previousOwnerName: operationMeta.oldAssigneeName || ''
    }));
  }catch(e){
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok:false, error:'Server error', details: String(e?.message||e) }));
  }
};
