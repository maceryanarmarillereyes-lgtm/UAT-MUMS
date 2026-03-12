/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');

// POST /api/mailbox/assign
// Body: { shiftKey, assigneeId, caseNo, desc? }
//
// Rules:
// - SUPER_ADMIN / SUPER_USER / ADMIN may assign anytime (any shift/team).
// - TEAM_LEAD may assign during the active duty shift.
// - MEMBER may assign ONLY when they are on-duty as Mailbox Manager during the active duty window.
// - MEMBER may assign ONLY when they are on-duty as Mailbox Manager during the active duty window
//   and only for their own duty team.
// - Server re-checks active duty window + active mailbox bucket at commit time (prevents privilege drift).
// - Writes are performed with service role (members cannot write mums_mailbox_tables via sync/push).
// - Appends an enterprise audit log entry to `ums_activity_logs` (mums_documents).

const ADMIN_ANYTIME = new Set(['SUPER_ADMIN','SUPER_USER','ADMIN']);
const TEAM_LEAD_ROLE = 'TEAM_LEAD';

// Manila time helpers (no DST; UTC+08:00).
function manilaNowParts(){
  const d = new Date(Date.now() + 8*60*60*1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const isoDate = d.toISOString().slice(0,10);
  const dayIndex = d.getUTCDay(); // 0=Sun
  return { hh, mm, isoDate, dayIndex, nowMin: hh*60+mm, nowMs: Date.now() };
}
function manilaPartsFromMs(ms){
  const d = new Date(Number(ms || 0) + 8*60*60*1000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const isoDate = d.toISOString().slice(0,10);
  const dayIndex = d.getUTCDay(); // 0=Sun
  return { hh, mm, isoDate, dayIndex, nowMin: hh*60+mm, nowMs: Number(ms || Date.now()) };
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

async function getDocValue(key){
  const q = `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if(!out.ok) return { ok:false, error:'select_failed', details: out.json || out.text };
  const row = Array.isArray(out.json) ? out.json[0] : null;
  return { ok:true, value: row ? row.value : null };
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

function computeActiveBucketId(table, nowMin){
  const buckets = Array.isArray(table && table.buckets) ? table.buckets : [];
  if(!buckets.length) return '';
  for(const b of buckets){
    const s = parseHM(b.start);
    const e = parseHM(b.end);
    if(blockHit(nowMin, s, e)) return String(b.id||'');
  }
  return String(buckets[0].id||'');
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

    // For cross-midnight duty window (night shift), include previous day blocks when after midnight.
    try{
      const startMin = Number(dutyWindow?.startMin);
      const endMin = Number(dutyWindow?.endMin);
      if(Number.isFinite(startMin) && Number.isFinite(endMin)){
        const wraps = endMin <= startMin;
        if(wraps && nowMin < endMin) dows.push((dow+6)%7);
      }
    }catch(_){}

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
  }catch(_){}
  return false;
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

function safeString(x, max=240){
  const s = (x==null) ? '' : String(x);
  return s.length>max ? s.slice(0,max) : s;
}

function makeAssignmentId(){
  return 'mbx_srv_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(36);
}


function normalizeCaseNo(v){
  return String(v||'').trim().toLowerCase();
}

function pruneLogs(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (183*24*60*60*1000); // ~6 months
  return arr.filter(x => x && x.ts && Number(x.ts) >= cutoff).slice(0, 2500);
}

function pruneNotifs(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (183*24*60*60*1000); // ~6 months
  return arr.filter(x => x && x.ts && Number(x.ts) >= cutoff).slice(0, 2500);
}

function pruneCases(list){
  const arr = Array.isArray(list) ? list : [];
  const cutoff = Date.now() - (366*24*60*60*1000); // ~12 months
  return arr.filter(x => x && x.createdAt && Number(x.createdAt) >= cutoff).slice(0, 5000);
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

    const isAdminAnytime = ADMIN_ANYTIME.has(role);
    const isTeamLead = (role === TEAM_LEAD_ROLE);


    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const shiftKey = safeString(body.shiftKey, 120);
    const assigneeId = safeString(body.assigneeId, 80);
    const caseNo = safeString(body.caseNo, 120);
    const desc = safeString(body.desc, 260);
    const clientId = safeString(body.clientId, 120) || null;

    if(!shiftKey || !assigneeId || !caseNo){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'Missing required fields' }));
    }

    const overrideNow = await getMailboxOverrideNowParts();
    const now = overrideNow || manilaNowParts();
    const shiftTeamId = parseShiftTeamId(shiftKey);

    // Load mailbox tables
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

    const dutyWindow = resolveDutyWindow(shiftTeamId, table);
    const inDutyWindow = blockHit(now.nowMin, dutyWindow.startMin, dutyWindow.endMin);

    // TEAM_LEAD + MEMBER must act only on the active duty shift (admins may override).
    if(!isAdminAnytime){
      if(!inDutyWindow){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (not on active shift)' }));
      }
      const teamIdGate = safeString(profile && (profile.team_id || profile.teamId) ? (profile.team_id || profile.teamId) : '', 40);
      if(teamIdGate && shiftTeamId && teamIdGate !== shiftTeamId){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (not in duty team)' }));
      }
    }

    // Member gating
    if(!isAdminAnytime && !isTeamLead){
      // Must be a member mailbox manager on duty and assigned to current duty team.
      const teamId = safeString(profile && (profile.team_id || profile.teamId) ? (profile.team_id || profile.teamId) : '', 40);
      if(!teamId || (shiftTeamId && teamId !== shiftTeamId)){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (not in duty team)' }));
      }

      const scheduleDoc = await getMailboxScheduleDoc();
      if(!scheduleDoc.ok){
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'Failed to read schedules', details: scheduleDoc.details }));
      }
      const schedule = scheduleDoc.value || {};
      const onDuty = isMailboxManagerOnDuty(schedule, actor.id, now, dutyWindow);
      if(!onDuty){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (Mailbox Manager duty not active)' }));
      }
    }

    // TEAM_LEAD + MEMBER: enforce that assignment is within the active duty shift table.
    if(!isAdminAnytime){
      const tableTeam = safeString(table && table.meta && table.meta.teamId ? table.meta.teamId : '', 40);
      if(tableTeam && shiftTeamId && tableTeam !== shiftTeamId){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (shiftKey not current duty shift)' }));
      }
    }

    // Duplicate guard (caseNo across current + previous shift tables if available)
    const lower = caseNo.toLowerCase();
    try{
      const stateDoc = await getDocValue('mums_mailbox_state');
      const st = stateDoc.ok && stateDoc.value && typeof stateDoc.value === 'object' ? stateDoc.value : {};
      const curKey = safeString(st.currentKey || shiftKey, 120);
      const prevKey = safeString(st.previousKey || '', 120);
      const toCheck = [curKey, prevKey].filter(Boolean).map(k=>allTables[k]).filter(t=>t && Array.isArray(t.assignments));
      const dup = toCheck.some(t => t.assignments.some(a => String(a && a.caseNo || '').toLowerCase() === lower));
      if(dup){
        res.statusCode = 409;
        return res.end(JSON.stringify({ ok:false, error:'Duplicate case number', code:'DUPLICATE_CASE' }));
      }
    }catch(_){}

    // Compute active bucket server-side (prevents client drift)
    const bucketId = computeActiveBucketId(table, now.nowMin);
    const buckets = Array.isArray(table.buckets) ? table.buckets : [];
    const bucket = buckets.find(b=>String(b.id||'')===bucketId) || buckets[0] || {};
    const bucketLabel = safeString((bucket.start||'') + '-' + (bucket.end||''), 40);

    
    // Resolve assignee display name/role for audit logs and UI resilience (best-effort).
    let assigneeProfile = null;
    try{ assigneeProfile = await getProfileForUserId(assigneeId); }catch(_){ assigneeProfile = null; }
    const assigneeName = safeString(
      (assigneeProfile && (assigneeProfile.name || assigneeProfile.username)) ? (assigneeProfile.name || assigneeProfile.username) : assigneeId,
      120
    );
    const assigneeRole = safeString((assigneeProfile && assigneeProfile.role) ? assigneeProfile.role : 'MEMBER', 40);

    // Mailbox Manager (MEMBER) can only assign to MEMBER accounts.
    if(!isAdminAnytime && !isTeamLead){
      if(assigneeRole !== 'MEMBER'){
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok:false, error:'Forbidden (Mailbox Manager can assign to members only)' }));
      }
    }

// Build assignment
    const assignment = {
      id: makeAssignmentId(),
      caseNo,
      desc,
      assigneeId,
      assigneeName,
      assigneeRole,
      bucketId: bucketId || safeString(bucket.id, 40),
      assignedAt: Date.now(),
      actorId: actor.id,
      actorName: (profile && profile.name) ? profile.name : (actor.email || ''),
      actorRole: role,
      confirmedAt: 0,
      confirmedById: ''
    };

    // Apply patch with minimal risk of clobbering
    const next = JSON.parse(JSON.stringify(table)); // deep-ish clone for safety
    next.assignments = Array.isArray(next.assignments) ? next.assignments : [];
    const lowerCaseNo = normalizeCaseNo(caseNo);
    const existingSameCase = next.assignments.find(a=>normalizeCaseNo(a && a.caseNo) === lowerCaseNo);
    if(existingSameCase){
      res.statusCode = 409;
      return res.end(JSON.stringify({ ok:false, error:'Duplicate case number', code:'DUPLICATE_CASE' }));
    }
    next.assignments.unshift(assignment);

    next.counts = (next.counts && typeof next.counts === 'object') ? next.counts : {};
    next.counts[assigneeId] = (next.counts[assigneeId] && typeof next.counts[assigneeId] === 'object') ? next.counts[assigneeId] : {};
    next.counts[assigneeId][assignment.bucketId] = (Number(next.counts[assigneeId][assignment.bucketId]) || 0) + 1;

    // Track current bucket manager for visibility
    next.meta = (next.meta && typeof next.meta === 'object') ? next.meta : {};
    next.meta.bucketManagers = (next.meta.bucketManagers && typeof next.meta.bucketManagers === 'object') ? next.meta.bucketManagers : {};
    next.meta.bucketManagers[assignment.bucketId] = {
      id: actor.id,
      name: assignment.actorName,
      at: Date.now(),
      role
    };

    // Write back mailbox tables doc.
    // Persist with verify/retry and fail hard when we cannot confirm durability.
    let wrote = false;
    let persistedTable = next;
    for(let attempt=0; attempt<4; attempt++){
      let latestAll = allTables;
      if(attempt > 0){
        const latestDoc = await getDocValue('mums_mailbox_tables');
        latestAll = (latestDoc.ok && latestDoc.value && typeof latestDoc.value === 'object') ? latestDoc.value : {};
      }

      const latestTable = (latestAll[shiftKey] && typeof latestAll[shiftKey] === 'object') ? latestAll[shiftKey] : {};
      const merged = JSON.parse(JSON.stringify(latestTable));
      merged.assignments = Array.isArray(merged.assignments) ? merged.assignments : [];
      const existingById = merged.assignments.find(a=>a && a.id===assignment.id);
      const existingByCase = merged.assignments.find(a=>normalizeCaseNo(a && a.caseNo) === lowerCaseNo);
      if(existingByCase && !existingById){
        // Concurrent duplicate assignment guard: treat as duplicate and stop retries.
        res.statusCode = 409;
        return res.end(JSON.stringify({ ok:false, error:'Duplicate case number', code:'DUPLICATE_CASE' }));
      }
      const inserted = !existingById;
      if(inserted) merged.assignments.unshift(assignment);

      merged.counts = (merged.counts && typeof merged.counts === 'object') ? merged.counts : {};
      merged.counts[assigneeId] = (merged.counts[assigneeId] && typeof merged.counts[assigneeId] === 'object') ? merged.counts[assigneeId] : {};
      if(inserted){
        merged.counts[assigneeId][assignment.bucketId] = (Number(merged.counts[assigneeId][assignment.bucketId]) || 0) + 1;
      }

      merged.meta = (merged.meta && typeof merged.meta === 'object') ? merged.meta : {};
      merged.meta.bucketManagers = (merged.meta.bucketManagers && typeof merged.meta.bucketManagers === 'object') ? merged.meta.bucketManagers : {};
      merged.meta.bucketManagers[assignment.bucketId] = {
        id: actor.id,
        name: assignment.actorName,
        at: Date.now(),
        role
      };

      const payloadAll = Object.assign({}, latestAll, { [shiftKey]: merged });
      const up = await upsertDoc('mums_mailbox_tables', payloadAll, actor, profile, clientId);
      if(!up.ok){
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'Failed to update mailbox tables', details: up.details }));
      }

      const verify = await getDocValue('mums_mailbox_tables');
      const verifyAll = (verify.ok && verify.value && typeof verify.value === 'object') ? verify.value : {};
      const verifyTable = verifyAll[shiftKey];
      const ok = !!(verifyTable && Array.isArray(verifyTable.assignments) && verifyTable.assignments.some(a=>a && a.id===assignment.id));
      if(ok){
        wrote = true;
        allTables[shiftKey] = verifyTable;
        persistedTable = verifyTable;
        break;
      }
    }
    if(!wrote){
      res.statusCode = 409;
      return res.end(JSON.stringify({ ok:false, error:'Assignment write conflict. Please try again.', code:'MAILBOX_ASSIGN_CONFLICT' }));
    }

    // Append audit log entry (document-based)
    try{
      const logsDoc = await getDocValue('ums_activity_logs');
      const prevLogs = (logsDoc.ok && Array.isArray(logsDoc.value)) ? logsDoc.value : [];
      const logEntry = {
        ts: assignment.assignedAt,
        teamId: safeString(persistedTable?.meta?.teamId, 40),
        actorId: actor.id,
        actorName: assignment.actorName,
        actorRole: role,

        action: 'MAILBOX_CASE_ASSIGN',
        targetId: caseNo,
        targetName: caseNo,

        // Primary human-readable message (kept short for UI lists)
        msg: `Mailbox assigned: ${caseNo} → ${assigneeName}`.trim(),

        // Detail string (used by Logs/Exports; include full RBAC + timeblock context)
        detail: [
          `Assigned by ${assignment.actorName} (${role})`,
          `to ${assigneeName} (${assigneeRole})`,
          (desc ? `note: ${desc}` : ''),
          `timeblock ${bucketLabel}`,
          `bucketId ${assignment.bucketId}`,
          `shiftKey ${shiftKey}`
        ].filter(Boolean).join(' • '),

        // Structured context (safe to ignore by older clients)
        shiftKey,
        bucketId: assignment.bucketId,
        timeblock: {
          start: safeString(bucket.start, 10),
          end: safeString(bucket.end, 10),
          label: bucketLabel
        },
        assigner: { id: actor.id, name: assignment.actorName, role },
        assignee: { id: assigneeId, name: assigneeName, role: assigneeRole },
        caseNo,
        desc
      };
      const nextLogs = pruneLogs([logEntry, ...prevLogs]);
      await upsertDoc('ums_activity_logs', nextLogs, actor, profile, clientId);
    }catch(_){}

    // Notify assignee (real-time schedule notifications feed)
    try{
      const notifsDoc = await getDocValue('mums_schedule_notifs');
      const prevNotifs = (notifsDoc.ok && Array.isArray(notifsDoc.value)) ? notifsDoc.value : [];
      const notifId = `mbx_assign_${assignment.id}`;
      const notif = {
        id: notifId,
        ts: assignment.assignedAt,
        type: 'MAILBOX_ASSIGN',
        teamId: safeString(persistedTable?.meta?.teamId || shiftTeamId, 40),
        fromId: actor.id,
        fromName: assignment.actorName,
        title: 'Case Assigned Notification',
        body: `Case ${caseNo} assigned to you.`,
        recipients: [assigneeId],
        assignmentId: assignment.id,
        caseNo,
        desc,
        shiftKey,
        bucketId: assignment.bucketId,
        timeblock: {
          start: safeString(bucket.start, 10),
          end: safeString(bucket.end, 10),
          label: bucketLabel
        },
        userMessages: {
          [assigneeId]: `Case ${caseNo} assigned to you for mailbox time ${bucketLabel}.`
        }
      };
      const has = prevNotifs.some(n=>n && String(n.id||'') === notifId);
      if(!has){
        const nextNotifs = pruneNotifs([notif, ...prevNotifs]);
        await upsertDoc('mums_schedule_notifs', nextNotifs, actor, profile, clientId);
      }
    }catch(_){}

    // Append to global cases list (used by My Case + stats)
    try{
      const casesDoc = await getDocValue('ums_cases');
      const prevCases = (casesDoc.ok && Array.isArray(casesDoc.value)) ? casesDoc.value : [];
      const caseId = `mbx_${caseNo}`;
      const entry = {
        id: caseId,
        title: caseNo,
        status: 'Assigned',
        createdAt: assignment.assignedAt,
        ts: assignment.assignedAt,
        assigneeId,
        assigneeName,
        assignedById: actor.id,
        assignedByName: assignment.actorName,
        shiftKey,
        bucketId: assignment.bucketId,
        mailboxTime: bucketLabel
      };
      const exists = prevCases.some(c=>String(c?.id||'') === caseId);
      if(!exists){
        const nextCases = pruneCases([entry, ...prevCases]);
        await upsertDoc('ums_cases', nextCases, actor, profile, clientId);
      }
    }catch(_){}

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok:true, shiftKey, table: allTables[shiftKey], assignmentId: assignment.id }));
  }catch(e){
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok:false, error:'Server error', details: String(e?.message||e) }));
  }
};
