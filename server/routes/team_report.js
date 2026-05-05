/**
 * @file team_report.js
 * @description API Route: Team Report — full Power BI-style data payload.
 *   Includes 7-day case history, attendance, QB open/closed, pattern detection.
 * @module MUMS/Server/Routes
 * @version UAT-p1-667
 * @access TEAM_LEAD, SUPER_USER, SUPER_ADMIN
 */

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceFetch } = require('../lib/supabase');
const { readGlobalQuickbaseSettings } = require('../lib/global_quickbase');

const CACHE_TTL_MS    = 2 * 60 * 1000;
const cache    = new Map();

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeNumber(v) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }

function dateToIso(d) { return new Date(d).toISOString().slice(0, 10); }

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateToIso(d);
}

function weekStartIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (wd === 0 ? -6 : 1 - wd));
  return dateToIso(d);
}

function dayIndexFromIso(iso) { return new Date(`${iso}T00:00:00Z`).getUTCDay(); }

function parseHM(v) {
  const p = String(v || '').split(':');
  if (p.length < 2) return null;
  const h = Number(p[0]); const m = Number(p[1]);
  return (Number.isFinite(h) && Number.isFinite(m)) ? h * 60 + m : null;
}

function normalizeSchedRole(r) {
  const s = String(r || '').toLowerCase();
  if (s === 'mailbox_manager' || s === 'mailbox_call') return 'mailbox';
  if (s === 'call_onqueue'    || s === 'call_available') return 'call';
  if (s === 'back_office') return 'back_office';
  return 'other';
}

/* ── SQL fallback ─────────────────────────────────────────────────────────── */

async function tryExecSql(sql) {
  for (const fn of ['exec_sql', 'execute_sql', 'mums_exec_sql', 'sql']) {
    try {
      const out = await serviceFetch(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql })
      });
      if (out && out.ok) return out;
    } catch (_) {}
  }
  return null;
}

async function loadCasesWithSql() {
  const out = await tryExecSql(`select value as cases from mums_documents where key = 'ums_cases' limit 1;`);
  if (!out || !out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].cases || null;
}

/* ── Doc loader ───────────────────────────────────────────────────────────── */

async function loadDocValue(key) {
  const out = await serviceSelect('mums_documents', `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`);
  if (!out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].value;
}

/* ── Profiles — BUG-1 FIX: removed non-existent `status` column ─────────── */

async function fetchProfiles(teamId) {
  const filter = teamId ? `&team_id=eq.${encodeURIComponent(teamId)}` : '';
  const out = await serviceSelect(
    'mums_profiles',
    `select=user_id,name,username,team_id,role,qb_name,duty${filter}&role=eq.MEMBER&order=name.asc`
  );
  if (!out.ok || !Array.isArray(out.json)) return [];
  return out.json.map(p => ({
    id:      String(p.user_id   || ''),
    name:    p.name    || p.username || '',
    username: p.username || '',
    teamId:  p.team_id || '',
    role:    p.role    || 'MEMBER',
    qbName:  String(p.qb_name  || '').trim(),
    duty:    String(p.duty     || '').trim()
  }));
}

/* ── QB Tabs — BUG-2 FIX: corrected PostgREST OR dot-notation ───────────── */

async function fetchQbTabCounts(memberIds) {
  if (!memberIds.length) return { counts: {}, tabNames: {} };
  const idFilter = memberIds.map(id => `user_id.eq.${encodeURIComponent(id)}`).join(',');
  const out = await serviceSelect('quickbase_tabs', `select=user_id,tab_id,tab_name&or=(${idFilter})`);
  const counts = {}; const tabNames = {};
  memberIds.forEach(id => { counts[id] = 0; tabNames[id] = []; });
  if (out.ok && Array.isArray(out.json)) {
    out.json.forEach(r => {
      const uid = String(r.user_id || '');
      if (uid in counts) {
        counts[uid]++;
        const n = String(r.tab_name || r.tab_id || '').trim();
        if (n) tabNames[uid].push(n);
      }
    });
  }
  return { counts, tabNames };
}

/* ── QB Records — active case counts per member via /v1/records/query ─────── */
// ROOT CAUSE FIX v667+2:
//   Previous approach used POST /v1/reports/{qid}/run — this runs the QB REPORT
//   as-saved, which has a user-level "Assigned to = [QB user who saved it]" filter
//   baked in. Result: only 1 person's records returned → all 10 members show 0.
//
//   Correct approach (mirrors monitoring global mode):
//   1. GET /v1/fields to resolve "Assigned to" and "Case Status" field IDs by label
//   2. POST /v1/records/query with:
//      - from: tableId  (bypass report-level filter)
//      - where: globalFilterConfig clauses only (e.g. "Case Status XEX 'C – Resolved'")
//      - select: [assignedToFieldId, caseStatusFieldId]
//      - NO user filter — we want ALL members' records so we can group by name
//   3. Group by assignedTo name → open/closed counts per member
//
// This is exactly what the monitoring endpoint does in global mode for the Dashboard.


function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.quickbase.com`;
}

function encodeQbLiteral(v) {
  return String(v == null ? '' : v).replace(/'/g, "\\'");
}

function buildGlobalFilterWhere(filterConfig, filterMatch) {
  if (!Array.isArray(filterConfig) || !filterConfig.length) return '';
  const VALID_OPS = ['EX','XEX','CT','XCT','SW','XSW','BF','AF','IR','XIR','TV','XTV','LT','LTE','GT','GTE'];
  const clauses = filterConfig.reduce((acc, f) => {
    if (!f || typeof f !== 'object') return acc;
    const fieldId  = Number(f.fieldId ?? f.field_id ?? f.fid ?? f.id);
    const value    = String(f.value ?? '').trim();
    const opRaw    = String(f.operator ?? 'EX').trim().toUpperCase();
    const operator = VALID_OPS.includes(opRaw) ? opRaw : 'EX';
    if (!Number.isFinite(fieldId) || !value) return acc;
    acc.push(`{${fieldId}.${operator}.'${encodeQbLiteral(value)}'}`);
    return acc;
  }, []);
  if (!clauses.length) return '';
  const join = String(filterMatch || 'ALL').toUpperCase() === 'ANY' ? ' OR ' : ' AND ';
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(join)})`;
}

const REPORT_FILTER_TTL_MS = 5 * 60 * 1000;
const reportFilterCache = new Map();

async function getReportFilterFormula({ realm, token, tableId, qid }) {
  const normalizedRealm = normalizeRealm(realm);
  if (!normalizedRealm || !tableId || !qid || !token) return '';
  const cacheKey = `${normalizedRealm}|${tableId}|${qid}`;
  const hit = reportFilterCache.get(cacheKey);
  if (hit && Date.now() - hit.at < REPORT_FILTER_TTL_MS) return hit.filter;

  try {
    const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}?tableId=${encodeURIComponent(tableId)}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        'Authorization': `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) {
      reportFilterCache.set(cacheKey, { at: Date.now(), filter: '' });
      return '';
    }
    const json = await resp.json().catch(() => ({}));
    const reportFilter = String(json.query?.filterFormula || json.query?.formula || json.query?.filter || json.query?.queryString || '').trim();
    reportFilterCache.set(cacheKey, { at: Date.now(), filter: reportFilter });
    return reportFilter;
  } catch (_) {
    reportFilterCache.set(cacheKey, { at: Date.now(), filter: '' });
    return '';
  }
}

async function countViaQbApi({ realm, token, tableId, where }) {
  const normalizedRealm = normalizeRealm(realm);
  if (!normalizedRealm || !tableId || !token) return null;
  try {
    const resp = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        'Authorization': `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: tableId, where: where || undefined, options: { skip: 0, top: 0 } })
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => ({}));
    if (typeof json?.metadata?.totalRecords === 'number') return json.metadata.totalRecords;
    if (Array.isArray(json?.data)) return json.data.length;
    return 0;
  } catch (_) { return null; }
}

async function loadDashboardCounterConfig() {
  const raw = await loadDocValue('mums_global_dashboard_counters');
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const hero = cfg.hero && typeof cfg.hero === 'object' ? cfg.hero : {};
  const heroFieldId = Number(hero.heroFieldId || hero.fieldId || 0);
  const heroOperator = String(hero.heroOperator || hero.operator || 'EX').trim().toUpperCase() || 'EX';
  return { heroFieldId, heroOperator };
}

async function fetchQbRecords(profiles) {
  const result = {};
  profiles.forEach(p => { result[p.id] = { open: 0, closed: 0, total: 0 }; });

  const eligibleProfiles = profiles.filter(p => String(p.qbName || '').trim());
  if (!eligibleProfiles.length) return result;

  const { ok, settings } = await readGlobalQuickbaseSettings();
  if (!ok) return result;
  const { realm, qbToken, tableId, qid, filterConfig, filterMatch } = settings || {};
  if (!realm || !qbToken || !tableId) return result;

  const { heroFieldId, heroOperator } = await loadDashboardCounterConfig();
  if (!Number.isFinite(heroFieldId) || heroFieldId <= 0) return result;

  const globalWhere = buildGlobalFilterWhere(filterConfig, filterMatch);
  const reportWhere = qid ? await getReportFilterFormula({ realm, token: qbToken, tableId, qid }) : '';

  const counts = await Promise.all(eligibleProfiles.map(async (p) => {
    const userWhere = `{${heroFieldId}.${heroOperator}.'${encodeQbLiteral(p.qbName)}'}`;
    const finalWhere = [reportWhere, globalWhere, userWhere].filter(Boolean).join(' AND ') || undefined;
    const c = await countViaQbApi({ realm, token: qbToken, tableId, where: finalWhere });
    return { uid: p.id, count: Number.isFinite(c) ? c : 0 };
  }));

  counts.forEach(({ uid, count }) => {
    if (!result[uid]) return;
    result[uid].open = count;
    result[uid].closed = 0;
    result[uid].total = count;
  });
  return result;
}

/* ── Case counting ────────────────────────────────────────────────────────── */

function countCasesForDate(cases, memberIds, dateIso) {
  const startMs = new Date(`${dateIso}T00:00:00Z`).getTime();
  const endMs   = new Date(`${dateIso}T23:59:59Z`).getTime();
  const counts  = {}; memberIds.forEach(id => { counts[id] = 0; });
  (Array.isArray(cases) ? cases : []).forEach(c => {
    if (!c) return;
    const uid = String(c.assigneeId || c.assignee_id || '');
    if (!uid || !(uid in counts)) return;
    const ts = safeNumber(c.assignedAt || c.createdAt || c.ts || c.updatedAt);
    if (ts >= startMs && ts <= endMs) counts[uid]++;
  });
  return counts;
}

function countTotalCasesUpTo(cases, memberIds, isoDate) {
  const endMs  = new Date(`${isoDate}T23:59:59Z`).getTime();
  const counts = {}; memberIds.forEach(id => { counts[id] = 0; });
  (Array.isArray(cases) ? cases : []).forEach(c => {
    if (!c) return;
    const uid = String(c.assigneeId || c.assignee_id || '');
    if (!uid || !(uid in counts)) return;
    const ts = safeNumber(c.assignedAt || c.createdAt || c.ts || c.updatedAt);
    if (ts && ts <= endMs) counts[uid]++;
  });
  return counts;
}

/* ── Schedule helpers ─────────────────────────────────────────────────────── */

function selectLatestSnapshots(notifs, teamId) {
  const map = new Map();
  (Array.isArray(notifs) ? notifs : []).forEach(n => {
    if (!n || !n.weekStartISO || !n.snapshots) return;
    if (teamId && n.teamId && String(n.teamId) !== String(teamId)) return;
    const existing = map.get(n.weekStartISO);
    const ts = safeNumber(n.ts);
    if (!existing || ts > existing.ts) map.set(n.weekStartISO, { ts, snapshots: n.snapshots });
  });
  return map;
}

function getSchedHoursForDate(snapshotsByWeek, uid, dateIso) {
  const dayIdx    = dayIndexFromIso(dateIso);
  const weekStart = weekStartIso(dateIso);
  const snap      = snapshotsByWeek.get(weekStart);
  if (!snap || !snap.snapshots) return { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };
  const memberSnap = snap.snapshots[uid];
  if (!memberSnap || !memberSnap.days) return { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };
  const blocks = Array.isArray(memberSnap.days[String(dayIdx)]) ? memberSnap.days[String(dayIdx)] : [];
  const res = { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };
  blocks.forEach(b => {
    const s = parseHM(b.start); const e = parseHM(b.end);
    if (s == null || e == null || e <= s) return;
    const mins = e - s;
    res[normalizeSchedRole(b.role)] += mins;
    res.total += mins;
  });
  return res;
}

/** Returns 'present' | 'partial' | 'absent' for a member on a given date */
function getAttendanceStatus(snapshotsByWeek, uid, dateIso) {
  const sched = getSchedHoursForDate(snapshotsByWeek, uid, dateIso);
  if (sched.total === 0) return 'absent';
  if (sched.total >= 240) return 'present'; // ≥4h = present
  return 'partial';
}

/* ── Pattern detection ────────────────────────────────────────────────────── */
function detectPattern(history7) {
  // history7[0] = today, [6] = 6 days ago
  const recent = history7.slice(0, 3); // last 3 days
  const older  = history7.slice(4, 7); // 3 days before that
  const recentAvg = recent.reduce((s, v) => s + v, 0) / Math.max(recent.length, 1);
  const olderAvg  = older.reduce((s, v) => s + v, 0) / Math.max(older.length, 1);
  const delta = history7[0] - history7[1]; // today vs yesterday
  if (delta >= 4) return 'spiking';
  if (recentAvg > olderAvg + 2) return 'rising';
  if (recentAvg < olderAvg - 2) return 'declining';
  return 'stable';
}

/* ── Main handler ─────────────────────────────────────────────────────────── */

module.exports = async (req, res) => {
  try {
    /* Auth */
    const auth = String((req.headers && req.headers.authorization) || '');
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u    = await getUserFromJwt(jwt);
    if (!u) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

    const profile = await getProfileForUserId(u.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'Forbidden' });

    const role = String(profile.role || 'MEMBER').toUpperCase();
    if (!['TEAM_LEAD', 'SUPER_ADMIN', 'SUPER_USER'].includes(role))
      return sendJson(res, 403, { ok: false, error: 'Forbidden: insufficient role' });

    let teamId = String((req.query && req.query.team_id) || '').trim();
    if (role === 'TEAM_LEAD') teamId = String(profile.team_id || '').trim();

    /* Date setup — Manila (UTC+8), 7-day window */
    const nowMs      = Date.now();
    const manilaDate = new Date(nowMs + 8 * 60 * 60 * 1000);
    const todayIso   = manilaDate.toISOString().slice(0, 10);
    const dates7     = Array.from({ length: 7 }, (_, i) => addDays(todayIso, -i)); // [today, D-1, … D-6]

    const cacheKey = `tr|${teamId}|${todayIso}`;
    const hit = cache.get(cacheKey);
    if (hit && nowMs - hit.ts < CACHE_TTL_MS) return sendJson(res, 200, hit.data);

    /* Load data in parallel — BUG-3 FIX: SQL fallback for cases */
    const [profiles, notifsRaw, casesDoc, casesSql] = await Promise.all([
      fetchProfiles(teamId),
      loadDocValue('mums_schedule_notifs').then(v => v || loadDocValue('ums_schedule_notifs')),
      loadDocValue('ums_cases'),
      loadCasesWithSql()
    ]);

    const cases     = Array.isArray(casesSql) ? casesSql : (Array.isArray(casesDoc) ? casesDoc : []);
    const memberIds = profiles.map(p => p.id);
    const snapshots = selectLatestSnapshots(notifsRaw, teamId);

    /* QB data — both fail gracefully */
    const [qbTabData, qbRecMap] = await Promise.all([
      fetchQbTabCounts(memberIds).catch(() => ({ counts: {}, tabNames: {} })),
      fetchQbRecords(profiles).catch(() => { const fb = {}; memberIds.forEach(id => { fb[id] = { open: 0, closed: 0, total: 0 }; }); return fb; })
    ]);
    const { counts: qbTabCounts, tabNames: qbTabNameMap } = qbTabData;

    /* Per-day case counts for all 7 days */
    const dayCounts = dates7.map(d => countCasesForDate(cases, memberIds, d));
    const totalUpTo = countTotalCasesUpTo(cases, memberIds, todayIso);

    /* Build member rows */
    const members = profiles.map(p => {
      const uid = p.id;

      // 7-day case history: [today, D-1, D-2, D-3, D-4, D-5, D-6]
      const history7 = dayCounts.map(dc => dc[uid] || 0);
      const [cT, c1, c2] = history7;
      const sevenDayAvg  = Math.round((history7.reduce((s, v) => s + v, 0) / 7) * 10) / 10;
      const totalAssigned = totalUpTo[uid] || 0;

      // Attendance for 7 days
      const attendance7 = dates7.map(d => getAttendanceStatus(snapshots, uid, d));
      const presentDays  = attendance7.filter(s => s === 'present' || s === 'partial').length;
      const attendancePct = Math.round((presentDays / 7) * 100);

      // Schedule hours for today
      const schedT = getSchedHoursForDate(snapshots, uid, todayIso);

      // QB
      const qbRec  = qbRecMap[uid]       || { open: 0, closed: 0, total: 0 };
      const qbTabs = qbTabCounts[uid]    || 0;

      // Load status (based on today's cases)
      let loadStatus = 'normal';
      if (cT >= 13) loadStatus = 'overload';
      else if (cT >= 10) loadStatus = 'warning';

      // Pattern
      const pattern = detectPattern(history7);

      return {
        id: uid, name: p.name, username: p.username, teamId: p.teamId, duty: p.duty, qbName: p.qbName,
        // Case history
        casesToday: cT, casesD1: c1, casesD2: c2,
        history7,       // full 7-day array for chart
        totalAssigned,
        deltaD1: cT - c1,
        deltaD2: cT - c2,
        deltaThreeDay: cT - (history7[2] || 0),
        sevenDayAvg,
        pattern,        // 'spiking' | 'rising' | 'stable' | 'declining'
        // Attendance
        attendance7,
        attendancePct,
        presentDays,
        // Schedule
        totalH:      Math.round(schedT.total       / 60 * 10) / 10,
        mailboxH:    Math.round(schedT.mailbox     / 60 * 10) / 10,
        callH:       Math.round(schedT.call        / 60 * 10) / 10,
        mailboxMins: schedT.mailbox,
        // QB
        qbOpen:     qbRec.open,
        qbClosed:   qbRec.closed,
        qbTotal:    qbRec.total,
        qbTabs,
        qbTabNames: qbTabNameMap[uid] || [],
        // Status
        loadStatus
      };
    });

    /* Team KPIs */
    const totalCasesToday = members.reduce((s, m) => s + m.casesToday, 0);
    const totalCasesD1    = members.reduce((s, m) => s + m.casesD1,    0);
    const totalAssigned   = members.reduce((s, m) => s + m.totalAssigned, 0);
    const overloaded      = members.filter(m => m.loadStatus === 'overload').length;
    const warning         = members.filter(m => m.loadStatus === 'warning').length;
    const avgCases        = members.length ? Math.round((totalAssigned / members.length) * 10) / 10 : 0;
    const totalPresent    = members.reduce((s, m) => s + m.presentDays, 0);
    const maxPossible     = members.length * 7;
    const attendancePct   = maxPossible ? Math.round((totalPresent / maxPossible) * 100) : 0;
    const totalQbOpen     = members.reduce((s, m) => s + m.qbOpen,   0);
    const hasQbData       = members.some(m => m.qbTotal > 0);

    const payload = {
      ok: true,
      dates: { today: todayIso, d1: addDays(todayIso, -1), d2: addDays(todayIso, -2), history7: dates7 },
      kpis: {
        totalMembers: members.length,
        totalCasesToday, totalCasesD1, totalAssigned, avgCases,
        overloaded, warning, attendancePct, totalQbOpen, hasQbData
      },
      members
    };

    cache.set(cacheKey, { ts: nowMs, data: payload });
    return sendJson(res, 200, payload);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'Server error', details: String(e && e.message ? e.message : e) });
  }
};
