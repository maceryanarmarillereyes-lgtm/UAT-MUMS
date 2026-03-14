/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');

// POST /api/sync/push
// Body: { key, value, op: 'set'|'merge', removedIds?: string[], clientId?: string, ts?: number }
//
// Rules:
// - Reads are global (authenticated users can read all documents).
// - Writes are RBAC gated; MEMBER writes are restricted to safe collaborative keys.
// - The server performs merge semantics for list keys to avoid clobbering concurrent updates.

const WRITE_KEYS = new Set([
  'ums_announcements',
  'mums_team_reminders',
  'ums_weekly_schedules',
  // Canonical schedule docs (enterprise)
  'mums_schedule_blocks',
  'mums_schedule_snapshots',
  'ums_master_schedule',
  'ums_schedule_locks',
  'mums_schedule_lock_state',
  'ums_member_leaves',
  'ums_schedule_notifs',
  'mums_schedule_notifs',
  'mums_team_config',
  'mums_attendance',
  'mums_mailbox_tables',
  'mums_mailbox_state',
  'ums_cases',
  'ums_activity_logs',
  'mums_mailbox_time_override_cloud',
  'mums_user_events'
]);

const MEMBER_WRITE_KEYS = new Set([
  'mums_attendance',
  'mums_mailbox_state',
  'ums_cases',
  'ums_schedule_notifs',
  'mums_schedule_notifs'
]);

function isObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function idForItem(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.id || item.caseNo || item.case_no || item.uuid || item.key || '');
}

function mergeArrays(existing, incoming, removedIds) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const map = new Map();
  for (const it of out) {
    const id = idForItem(it);
    if (id) map.set(id, it);
  }

  // Apply removals first
  if (Array.isArray(removedIds) && removedIds.length) {
    const removed = new Set(removedIds.map((x) => String(x)));
    for (let i = out.length - 1; i >= 0; i--) {
      const id = idForItem(out[i]);
      if (id && removed.has(id)) out.splice(i, 1);
    }
  }

  // Upsert / merge incoming
  if (Array.isArray(incoming)) {
    for (const it of incoming) {
      const id = idForItem(it);
      if (!id) continue;
      const existingIt = map.get(id);
      if (existingIt) {
        // Shallow merge (incoming wins)
        Object.assign(existingIt, it);
      } else {
        out.push(it);
        map.set(id, it);
      }
    }
  }

  return out;
}

function mergeObjects(existing, incoming) {
  const base = isObject(existing) ? Object.assign({}, existing) : {};
  if (isObject(incoming)) {
    for (const k of Object.keys(incoming)) {
      base[k] = incoming[k];
    }
  }
  return base;
}

function mergeMailboxAssignments(existing, incoming, removedSet){
  const byId = new Map();
  const toArr = (x)=>Array.isArray(x) ? x : [];
  const add = (item)=>{
    if(!item || typeof item !== 'object') return;
    const id = idForItem(item);
    if(!id) return;
    const prev = byId.get(id);
    if(!prev){
      byId.set(id, Object.assign({}, item));
      return;
    }
    const merged = Object.assign({}, prev, item);
    const prevConf = Number(prev.confirmedAt||0);
    const nextConf = Number(item.confirmedAt||0);
    if(prevConf > nextConf){
      merged.confirmedAt = prevConf;
      if(prev.confirmedById) merged.confirmedById = prev.confirmedById;
      if(prev.confirmedByName) merged.confirmedByName = prev.confirmedByName;
    }
    byId.set(id, merged);
  };
  // Add from existing ONLY when NOT in the explicitly-removed set.
  // This prevents resurrecting cases that were deleted on the client — even if
  // Supabase's current doc (read by this merge) still has the old entry due to
  // a stale push, a slow race, or a concurrent write from another client.
  toArr(existing).forEach(item => {
    if(removedSet && removedSet.size > 0){
      const id = idForItem(item);
      if(id && removedSet.has(id)) return; // explicitly deleted — do not restore
    }
    add(item);
  });
  toArr(incoming).forEach(add);
  return Array.from(byId.values()).sort((a,b)=>Number(b?.assignedAt||0)-Number(a?.assignedAt||0));
}

function rebuildMailboxCounts(table){
  const out = isObject(table) ? Object.assign({}, table) : {};
  const counts = {};
  for(const a of (Array.isArray(out.assignments) ? out.assignments : [])){
    const uid = String(a?.assigneeId||'');
    const bid = String(a?.bucketId||'');
    if(!uid || !bid) continue;
    counts[uid] = counts[uid] || {};
    counts[uid][bid] = (Number(counts[uid][bid]) || 0) + 1;
  }
  out.counts = counts;
  return out;
}

function mergeMailboxTables(existing, incoming, removedIds){
  // Build the removed-ID set once for all shift-key merges.
  // removedIds is a flat array of assignment IDs that the client explicitly deleted.
  const removedSet = new Set((Array.isArray(removedIds) ? removedIds : []).map(String));

  const base = isObject(existing) ? existing : {};
  const inc = isObject(incoming) ? incoming : {};
  const out = Object.assign({}, base);
  const keys = new Set([...Object.keys(base), ...Object.keys(inc)]);
  for(const shiftKey of keys){
    const a = isObject(base[shiftKey]) ? base[shiftKey] : null;
    const b = isObject(inc[shiftKey]) ? inc[shiftKey] : null;
    if(!a && b){
      out[shiftKey] = rebuildMailboxCounts(Object.assign({}, b));
      continue;
    }
    if(a && !b){
      out[shiftKey] = rebuildMailboxCounts(Object.assign({}, a));
      continue;
    }
    if(!a && !b){
      continue;
    }

    const merged = Object.assign({}, a, b);
    merged.meta = mergeObjects(a.meta, b.meta);
    merged.members = Array.isArray(b.members) ? b.members.slice() : (Array.isArray(a.members) ? a.members.slice() : []);
    merged.buckets = Array.isArray(b.buckets) ? b.buckets.slice() : (Array.isArray(a.buckets) ? a.buckets.slice() : []);
    merged.assignments = mergeMailboxAssignments(a.assignments, b.assignments, removedSet);
    out[shiftKey] = rebuildMailboxCounts(merged);
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    }

    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u = await getUserFromJwt(jwt);
    if (!u) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }

    const profile = await getProfileForUserId(u.id);
    const role = profile && profile.role ? String(profile.role) : 'MEMBER';

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const key = String(body.key || '').trim();
    const op = String(body.op || 'set');
    const clientId = String(body.clientId || '').trim() || null;
    const removedIds = Array.isArray(body.removedIds) ? body.removedIds : [];
    const incomingValue = body.value;

    if (!key || !WRITE_KEYS.has(key)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'Invalid key' }));
    }

    if (role === 'MEMBER' && !MEMBER_WRITE_KEYS.has(key)) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ ok: false, error: 'Forbidden (member write restricted)' }));
    }

    // Fetch current doc (for merge)
    let current = null;
    if (op === 'merge') {
      const cur = await serviceSelect('mums_documents', `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`);
      if (cur.ok && Array.isArray(cur.json) && cur.json[0]) current = cur.json[0].value;
    }

    let nextValue = incomingValue;
    if (op === 'merge') {
      if (key === 'mums_mailbox_tables') {
        nextValue = mergeMailboxTables(current, incomingValue, removedIds);
      } else if (Array.isArray(current) || Array.isArray(incomingValue)) {
        nextValue = mergeArrays(current, incomingValue, removedIds);
      } else if (isObject(current) || isObject(incomingValue)) {
        nextValue = mergeObjects(current, incomingValue);
      }
    }

    const row = {
      key,
      value: nextValue,
      updated_at: new Date().toISOString(),
      updated_by_user_id: u.id,
      updated_by_name: (profile && profile.name) ? profile.name : null,
      updated_by_client_id: clientId
    };

    const up = await serviceUpsert('mums_documents', [row], 'key');
    if (!up.ok) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'Supabase upsert failed', details: up.json || up.text }));
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Server error', details: String(e?.message || e) }));
  }
};
