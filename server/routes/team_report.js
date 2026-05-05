/**
 * @file team_report.js
 * @description API Route: Team Report — per-member workload with 3-day case history,
 *   schedule hours, QB tab count, QB record count, and movement deltas.
 * @module MUMS/Server/Routes
 * @version UAT-p1-666
 * @access TEAM_LEAD, SUPER_USER, SUPER_ADMIN
 *
 * BUGFIX LOG (v666):
 *  BUG-1 FIXED: fetchProfiles queried non-existent `status` column → 400 → profiles=[] → NO MEMBERS
 *  BUG-2 FIXED: fetchQbTabCounts wrong PostgREST OR syntax (col=eq.val → col.eq.val)
 *  BUG-3 FIXED: Cases loading added SQL fallback (matches overall_stats pattern)
 *  FEAT: fetchQbRecordCounts — global QB report run once, count per qb_name
 */

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceFetch } = require('../lib/supabase');
const { readGlobalQuickbaseSettings } = require('../lib/global_quickbase');

const CACHE_TTL_MS = 2 * 60 * 1000;
const QB_CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map();
const qbCache = new Map();

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function dateToIso(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateToIso(d);
}

function weekStartIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = d.getUTCDay();
  const delta = wd === 0 ? -6 : 1 - wd;
  d.setUTCDate(d.getUTCDate() + delta);
  return dateToIso(d);
}

function dayIndexFromIso(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function parseHM(value) {
  const parts = String(value || '').split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'mailbox_manager' || r === 'mailbox_call') return 'mailbox';
  if (r === 'call_onqueue' || r === 'call_available') return 'call';
  if (r === 'back_office') return 'back_office';
  return 'other';
}

/* ── SQL fallback for ums_cases (matches overall_stats) ──────────────────── */

async function tryExecSql(sql) {
  const candidates = ['exec_sql', 'execute_sql', 'mums_exec_sql', 'sql'];
  for (const fn of candidates) {
    try {
      const out = await serviceFetch(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      if (out && out.ok) return out;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function loadCasesWithSql() {
  const sql = `select value as cases from mums_documents where key = 'ums_cases' limit 1;`;
  const out = await tryExecSql(sql);
  if (!out || !out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].cases || null;
}

/* ── Data loaders ─────────────────────────────────────────────────────────── */

async function loadDocValue(key) {
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`
  );
  if (!out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].value;
}

/**
 * BUG-1 FIX: Removed `status` from select (column does not exist in mums_profiles).
 * Added `qb_name` for QB record matching.
 */
async function fetchProfiles(teamId) {
  const filter = teamId ? `&team_id=eq.${encodeURIComponent(teamId)}` : '';
  const out = await serviceSelect(
    'mums_profiles',
    `select=user_id,name,username,team_id,role,qb_name${filter}&role=eq.MEMBER&order=name.asc`
  );
  if (!out.ok || !Array.isArray(out.json)) return [];
  return out.json.map(p => ({
    id: String(p.user_id || ''),
    name: p.name || p.username || '',
    username: p.username || '',
    teamId: p.team_id || '',
    role: p.role || 'MEMBER',
    qbName: String(p.qb_name || '').trim()
  }));
}

/**
 * BUG-2 FIX: PostgREST OR must use dot-notation: `col.eq.val` not `col=eq.val`
 */
async function fetchQbTabCounts(memberIds) {
  if (!memberIds || !memberIds.length) return { counts: {}, tabNames: {} };
  const idFilter = memberIds.map(id => `user_id.eq.${encodeURIComponent(id)}`).join(',');
  const out = await serviceSelect(
    'quickbase_tabs',
    `select=user_id,tab_id,tab_name&or=(${idFilter})`
  );
  const counts = {};
  const tabNames = {};
  memberIds.forEach(id => { counts[id] = 0; tabNames[id] = []; });
  if (out.ok && Array.isArray(out.json)) {
    out.json.forEach(row => {
      const uid = String(row.user_id || '');
      if (uid in counts) {
        counts[uid] += 1;
        const n = String(row.tab_name || row.tab_id || '').trim();
        if (n) tabNames[uid].push(n);
      }
    });
  }
  return { counts, tabNames };
}

/**
 * FEAT: Run global QB report ONCE, count records per qb_name.
 * Looks for "Assigned to" field in report columns. Fails gracefully.
 */
async function fetchQbRecordCounts(profiles) {
  const result = {};
  profiles.forEach(p => { result[p.id] = 0; });

  const nameToId = {};
  profiles.forEach(p => {
    if (p.qbName) nameToId[p.qbName.toLowerCase()] = p.id;
  });
  if (!Object.keys(nameToId).length) return result;

  const hit = qbCache.get('qb_counts');
  if (hit && Date.now() - hit.ts < QB_CACHE_TTL_MS) {
    Object.entries(hit.nameCounts).forEach(([name, cnt]) => {
      const uid = nameToId[name];
      if (uid) result[uid] = cnt;
    });
    return result;
  }

  try {
    const globalResult = await readGlobalQuickbaseSettings();
    if (!globalResult.ok) return result;
    const { realm, qbToken, tableId, qid } = globalResult.settings;
    if (!realm || !qbToken || !tableId || !qid) return result;

    const normalizedRealm = realm.includes('.') ? realm : `${realm}.quickbase.com`;
    const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=1000`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        'Authorization': `QB-USER-TOKEN ${qbToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) return result;
    let json;
    try { json = await response.json(); } catch (_) { return result; }

    const records = Array.isArray(json.data) ? json.data : [];
    const reportFields = Array.isArray(json.fields)
      ? json.fields.map(f => ({ id: Number(f.id), label: String(f.label || '').toLowerCase() }))
      : [];

    // Find Assigned To field by common label patterns
    const assignedField = reportFields.find(f =>
      f.label === 'assigned to' ||
      f.label === 'assigned_to' ||
      f.label === 'assignee' ||
      (f.label.includes('assign') && !f.label.includes('date'))
    );
    if (!assignedField || !Number.isFinite(assignedField.id)) return result;
    const fid = String(assignedField.id);

    const nameCounts = {};
    records.forEach(rec => {
      if (!rec || typeof rec !== 'object') return;
      const cell = rec[fid];
      const val = String((cell && cell.value !== undefined ? cell.value : cell) || '').trim();
      if (!val) return;
      nameCounts[val.toLowerCase()] = (nameCounts[val.toLowerCase()] || 0) + 1;
    });

    qbCache.set('qb_counts', { ts: Date.now(), nameCounts });

    Object.entries(nameCounts).forEach(([name, cnt]) => {
      const uid = nameToId[name];
      if (uid) result[uid] = cnt;
    });
  } catch (err) {
    console.warn('[team_report] QB record count skipped:', err && err.message);
  }

  return result;
}

/* ── Case counting ────────────────────────────────────────────────────────── */

function computeCaseCountsForDate(cases, memberIds, dateIso) {
  const startMs = new Date(`${dateIso}T00:00:00Z`).getTime();
  const endMs   = new Date(`${dateIso}T23:59:59Z`).getTime();
  const counts = {};
  memberIds.forEach(id => { counts[id] = 0; });
  (Array.isArray(cases) ? cases : []).forEach(c => {
    if (!c) return;
    const uid = String(c.assigneeId || c.assignee_id || '');
    if (!uid || !(uid in counts)) return;
    const ts = safeNumber(c.assignedAt || c.createdAt || c.ts || c.updatedAt);
    if (!ts) return;
    if (ts >= startMs && ts <= endMs) counts[uid] += 1;
  });
  return counts;
}

function computeTotalCasesUpToDate(cases, memberIds, upToDateIso) {
  const endMs = new Date(`${upToDateIso}T23:59:59Z`).getTime();
  const counts = {};
  memberIds.forEach(id => { counts[id] = 0; });
  (Array.isArray(cases) ? cases : []).forEach(c => {
    if (!c) return;
    const uid = String(c.assigneeId || c.assignee_id || '');
    if (!uid || !(uid in counts)) return;
    const ts = safeNumber(c.assignedAt || c.createdAt || c.ts || c.updatedAt);
    if (!ts) return;
    if (ts <= endMs) counts[uid] += 1;
  });
  return counts;
}

/* ── Schedule hours ───────────────────────────────────────────────────────── */

function computeScheduleHoursForDate(snapshotsByWeek, memberIds, dateIso) {
  const dayIdx    = dayIndexFromIso(dateIso);
  const weekStart = weekStartIso(dateIso);
  const snap      = snapshotsByWeek.get(weekStart);
  const result    = {};
  memberIds.forEach(id => { result[id] = { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 }; });
  if (!snap || !snap.snapshots) return result;
  memberIds.forEach(uid => {
    const memberSnap = snap.snapshots[uid];
    if (!memberSnap || !memberSnap.days) return;
    const blocks = Array.isArray(memberSnap.days[String(dayIdx)]) ? memberSnap.days[String(dayIdx)] : [];
    blocks.forEach(b => {
      const s = parseHM(b.start);
      const e = parseHM(b.end);
      if (s == null || e == null || e <= s) return;
      const mins = e - s;
      const roleKey = normalizeRole(b.role);
      result[uid][roleKey] += mins;
      result[uid].total    += mins;
    });
  });
  return result;
}

function selectLatestSnapshots(notifs, teamId) {
  const map = new Map();
  (Array.isArray(notifs) ? notifs : []).forEach(n => {
    if (!n || !n.weekStartISO || !n.snapshots) return;
    if (teamId && n.teamId && String(n.teamId) !== String(teamId)) return;
    const existing = map.get(n.weekStartISO);
    const ts = safeNumber(n.ts);
    if (!existing || ts > existing.ts) {
      map.set(n.weekStartISO, { ts, snapshots: n.snapshots });
    }
  });
  return map;
}

/* ── Main Handler ─────────────────────────────────────────────────────────── */

module.exports = async (req, res) => {
  try {
    const auth = String((req.headers && req.headers.authorization) || '');
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u    = await getUserFromJwt(jwt);
    if (!u) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

    const profile = await getProfileForUserId(u.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'Forbidden' });

    const role = String(profile.role || 'MEMBER').toUpperCase();
    const allowRoles = new Set(['TEAM_LEAD', 'SUPER_ADMIN', 'SUPER_USER']);
    if (!allowRoles.has(role)) return sendJson(res, 403, { ok: false, error: 'Forbidden: insufficient role' });

    let teamId = String((req.query && req.query.team_id) || '').trim();
    if (role === 'TEAM_LEAD') teamId = String(profile.team_id || '').trim();

    // Manila date (UTC+8)
    const nowMs       = Date.now();
    const manilaDate  = new Date(nowMs + 8 * 60 * 60 * 1000);
    const todayIso    = manilaDate.toISOString().slice(0, 10);
    const d1Iso       = addDays(todayIso, -1);
    const d2Iso       = addDays(todayIso, -2);

    const cacheKey = `tr|${teamId}|${todayIso}`;
    const hit = cache.get(cacheKey);
    if (hit && nowMs - hit.ts < CACHE_TTL_MS) return sendJson(res, 200, hit.data);

    // BUG-3 FIX: parallel load with SQL fallback for cases
    const [profiles, notifsRaw, casesDocRaw, casesSql] = await Promise.all([
      fetchProfiles(teamId),
      loadDocValue('mums_schedule_notifs').then(v => v || loadDocValue('ums_schedule_notifs')),
      loadDocValue('ums_cases'),
      loadCasesWithSql()
    ]);

    const cases      = Array.isArray(casesSql) ? casesSql : (Array.isArray(casesDocRaw) ? casesDocRaw : []);
    const memberIds  = profiles.map(p => String(p.id));
    const snapshots  = selectLatestSnapshots(notifsRaw, teamId);

    const [qbTabData, qbRecordCounts] = await Promise.all([
      fetchQbTabCounts(memberIds).catch(() => ({ counts: {}, tabNames: {} })),
      fetchQbRecordCounts(profiles).catch(() => {
        const fb = {}; memberIds.forEach(id => { fb[id] = 0; }); return fb;
      })
    ]);
    const { counts: qbTabCounts, tabNames: qbTabNameMap } = qbTabData;

    const casesToday = computeCaseCountsForDate(cases, memberIds, todayIso);
    const casesD1    = computeCaseCountsForDate(cases, memberIds, d1Iso);
    const casesD2    = computeCaseCountsForDate(cases, memberIds, d2Iso);
    const casesTotal = computeTotalCasesUpToDate(cases, memberIds, todayIso);

    const schedToday = computeScheduleHoursForDate(snapshots, memberIds, todayIso);
    const schedD1    = computeScheduleHoursForDate(snapshots, memberIds, d1Iso);
    const schedD2    = computeScheduleHoursForDate(snapshots, memberIds, d2Iso);

    const members = profiles.map(p => {
      const uid  = p.id;
      const cT   = casesToday[uid] || 0;
      const c1   = casesD1[uid]    || 0;
      const c2   = casesD2[uid]    || 0;
      const cTot = casesTotal[uid] || 0;
      const sT   = schedToday[uid] || { mailbox:0, call:0, back_office:0, other:0, total:0 };
      const s1   = schedD1[uid]    || { mailbox:0, call:0, back_office:0, other:0, total:0 };
      const s2   = schedD2[uid]    || { mailbox:0, call:0, back_office:0, other:0, total:0 };

      const qbRec = qbRecordCounts[uid] || 0;

      let loadStatus = 'normal';
      if (cTot >= 15) loadStatus = 'overload';
      else if (cTot >= 10) loadStatus = 'warning';

      return {
        id:         uid,
        name:       p.name,
        username:   p.username,
        teamId:     p.teamId,
        qbName:     p.qbName,
        // Dashboard cases — 3-day
        casesToday: cT,
        casesD1:    c1,
        casesD2:    c2,
        totalAssigned: cTot,
        deltaD1:    cT - c1,
        deltaD2:    cT - c2,
        // Schedule
        mailboxMins:    sT.mailbox,
        callMins:       sT.call,
        backOfficeMins: sT.back_office,
        totalMins:      sT.total,
        mailboxH:       Math.round(sT.mailbox     / 60 * 10) / 10,
        callH:          Math.round(sT.call        / 60 * 10) / 10,
        backOfficeH:    Math.round(sT.back_office / 60 * 10) / 10,
        totalH:         Math.round(sT.total       / 60 * 10) / 10,
        schedD1TotalH:  Math.round(s1.total       / 60 * 10) / 10,
        schedD2TotalH:  Math.round(s2.total       / 60 * 10) / 10,
        // QB
        qbTabs:     qbTabCounts[uid]   || 0,
        qbTabNames: qbTabNameMap[uid]  || [],
        qbRecords:  qbRec,
        // Status
        loadStatus
      };
    });

    const totalCasesToday = members.reduce((s, m) => s + m.casesToday, 0);
    const totalCasesD1    = members.reduce((s, m) => s + m.casesD1, 0);
    const totalAssigned   = members.reduce((s, m) => s + m.totalAssigned, 0);
    const totalQbRecords  = members.reduce((s, m) => s + m.qbRecords, 0);
    const overloaded      = members.filter(m => m.loadStatus === 'overload').length;
    const warning         = members.filter(m => m.loadStatus === 'warning').length;
    const avgCases        = members.length ? Math.round((totalAssigned / members.length) * 10) / 10 : 0;

    const payload = {
      ok: true,
      dates: { today: todayIso, d1: d1Iso, d2: d2Iso },
      kpis: {
        totalMembers: members.length,
        totalCasesToday,
        totalCasesD1,
        totalAssigned,
        totalQbRecords,
        avgCasesPerMember: avgCases,
        overloaded,
        warning,
        hasQbData: totalQbRecords > 0
      },
      members
    };

    cache.set(cacheKey, { ts: nowMs, data: payload });
    return sendJson(res, 200, payload);
  } catch (e) {
    return sendJson(res, 500, {
      ok: false,
      error: 'Server error',
      details: String(e && e.message ? e.message : e)
    });
  }
};
