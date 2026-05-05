/**
 * @file team_report.js
 * @description API Route: Team Report — per-member workload with 3-day case history,
 *   schedule hours, QB tab count, and movement deltas for Team Lead daily meetings.
 * @module MUMS/Server/Routes
 * @version UAT
 * @access TEAM_LEAD, SUPER_USER, SUPER_ADMIN
 */

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceFetch } = require('../lib/supabase');

const CACHE_TTL_MS = 2 * 60 * 1000; // 2-min cache (fresher than overall_stats for daily meeting use)
const cache = new Map();

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

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

/* ─── Data Loaders ────────────────────────────────────────────────────────── */

async function loadDocValue(key) {
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`
  );
  if (!out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].value;
}

async function fetchProfiles(teamId) {
  // TEAM_LEAD sees only their team; SUPER_USER/SUPER_ADMIN can see all or filter
  const filter = teamId ? `&team_id=eq.${encodeURIComponent(teamId)}` : '';
  const out = await serviceSelect(
    'mums_profiles',
    `select=user_id,name,username,team_id,role,status&role=eq.MEMBER${filter}&order=name.asc`
  );
  if (!out.ok || !Array.isArray(out.json)) return [];
  return out.json
    .filter(p => !p.status || String(p.status).toLowerCase() !== 'inactive')
    .map(p => ({
      id: String(p.user_id || ''),
      name: p.name || p.username || '',
      username: p.username || '',
      teamId: p.team_id || '',
      role: p.role || 'MEMBER'
    }));
}

async function fetchQbTabCounts(memberIds) {
  // Returns { userId: count } map
  if (!memberIds || !memberIds.length) return {};
  // Fetch all tabs for these users in one query using OR filter
  const idFilter = memberIds.map(id => `user_id=eq.${encodeURIComponent(id)}`).join(',');
  const out = await serviceSelect(
    'quickbase_tabs',
    `select=user_id,tab_id&or=(${idFilter})`
  );
  const counts = {};
  memberIds.forEach(id => { counts[id] = 0; });
  if (out.ok && Array.isArray(out.json)) {
    out.json.forEach(row => {
      const uid = String(row.user_id || '');
      if (uid in counts) counts[uid] += 1;
    });
  }
  return counts;
}

function computeCaseCountsForDate(cases, memberIds, dateIso) {
  const startMs = new Date(`${dateIso}T00:00:00Z`).getTime();
  const endMs = new Date(`${dateIso}T23:59:59Z`).getTime();
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
  // Total cases ever assigned up to end-of-day for the given date
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

function computeScheduleHoursForDate(snapshotsByWeek, memberIds, dateIso) {
  const dayIdx = dayIndexFromIso(dateIso);
  const weekStart = weekStartIso(dateIso);
  const snap = snapshotsByWeek.get(weekStart);
  const result = {};
  memberIds.forEach(id => {
    result[id] = { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };
  });
  if (!snap || !snap.snapshots) return result;
  memberIds.forEach(uid => {
    const memberSnap = snap.snapshots[uid];
    if (!memberSnap || !memberSnap.days) return;
    const blocks = Array.isArray(memberSnap.days[String(dayIdx)])
      ? memberSnap.days[String(dayIdx)]
      : [];
    blocks.forEach(b => {
      const s = parseHM(b.start);
      const e = parseHM(b.end);
      if (s == null || e == null || e <= s) return;
      const mins = e - s;
      const roleKey = normalizeRole(b.role);
      result[uid][roleKey] += mins;
      result[uid].total += mins;
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

/* ─── Main Handler ────────────────────────────────────────────────────────── */

module.exports = async (req, res) => {
  try {
    // ── Auth ──
    const auth = String((req.headers && req.headers.authorization) || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u = await getUserFromJwt(jwt);
    if (!u) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

    const profile = await getProfileForUserId(u.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'Forbidden' });

    const role = String(profile.role || 'MEMBER').toUpperCase();
    const allowRoles = new Set(['TEAM_LEAD', 'SUPER_ADMIN', 'SUPER_USER']);
    if (!allowRoles.has(role)) return sendJson(res, 403, { ok: false, error: 'Forbidden: insufficient role' });

    // ── Resolve team ──
    let teamId = String((req.query && req.query.team_id) || '').trim();
    // TEAM_LEAD is always scoped to their own team
    if (role === 'TEAM_LEAD') teamId = String(profile.team_id || '').trim();

    // ── Date resolution — Manila local date ──
    // We compute today in Asia/Manila UTC+8; fall back to UTC
    const nowMs = Date.now();
    const manilaOffset = 8 * 60 * 60 * 1000;
    const manilaDate = new Date(nowMs + manilaOffset);
    const todayIso = manilaDate.toISOString().slice(0, 10);
    const d1Iso = addDays(todayIso, -1); // yesterday
    const d2Iso = addDays(todayIso, -2); // 2 days ago

    const cacheKey = `tr|${teamId}|${todayIso}`;
    const hit = cache.get(cacheKey);
    if (hit && nowMs - hit.ts < CACHE_TTL_MS) {
      return sendJson(res, 200, hit.data);
    }

    // ── Load all data in parallel ──
    const [profiles, notifsRaw, casesRaw] = await Promise.all([
      fetchProfiles(teamId),
      loadDocValue('mums_schedule_notifs').then(v => v || loadDocValue('ums_schedule_notifs')),
      loadDocValue('ums_cases')
    ]);

    const memberIds = profiles.map(p => String(p.id));
    const cases = Array.isArray(casesRaw) ? casesRaw : [];
    const snapshotsByWeek = selectLatestSnapshots(notifsRaw, teamId);

    // QB tab counts — fetch separately (may fail gracefully)
    const qbTabCounts = await fetchQbTabCounts(memberIds).catch(() => {
      const fallback = {};
      memberIds.forEach(id => { fallback[id] = 0; });
      return fallback;
    });

    // ── Compute per-day case counts ──
    const casesToday = computeCaseCountsForDate(cases, memberIds, todayIso);
    const casesD1 = computeCaseCountsForDate(cases, memberIds, d1Iso);
    const casesD2 = computeCaseCountsForDate(cases, memberIds, d2Iso);
    const casesTotal = computeTotalCasesUpToDate(cases, memberIds, todayIso);

    // ── Compute per-day schedule hours ──
    const schedToday = computeScheduleHoursForDate(snapshotsByWeek, memberIds, todayIso);
    const schedD1 = computeScheduleHoursForDate(snapshotsByWeek, memberIds, d1Iso);
    const schedD2 = computeScheduleHoursForDate(snapshotsByWeek, memberIds, d2Iso);

    // ── Build member rows ──
    const members = profiles.map(p => {
      const uid = p.id;

      const cT = casesToday[uid] || 0;
      const c1 = casesD1[uid] || 0;
      const c2 = casesD2[uid] || 0;
      const cTot = casesTotal[uid] || 0;

      const sT = schedToday[uid] || { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };
      const s1 = schedD1[uid] || { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };
      const s2 = schedD2[uid] || { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0 };

      const qbTabs = qbTabCounts[uid] || 0;

      // Movement indicators: positive = more cases handled (good), negative = fewer (stale)
      const deltaD1 = cT - c1;   // today vs yesterday
      const deltaD2 = cT - c2;   // today vs 2 days ago

      // Load status heuristic based on total assigned cases
      let loadStatus = 'normal';
      if (cTot >= 15) loadStatus = 'overload';
      else if (cTot >= 10) loadStatus = 'warning';

      return {
        id: uid,
        name: p.name,
        username: p.username,
        teamId: p.teamId,
        // Cases
        casesToday: cT,
        casesD1: c1,
        casesD2: c2,
        totalAssigned: cTot,
        deltaD1,
        deltaD2,
        // Schedule hours for today
        mailboxMins: sT.mailbox,
        callMins: sT.call,
        backOfficeMins: sT.back_office,
        totalMins: sT.total,
        mailboxH: Math.round(sT.mailbox / 60 * 10) / 10,
        callH: Math.round(sT.call / 60 * 10) / 10,
        backOfficeH: Math.round(sT.back_office / 60 * 10) / 10,
        totalH: Math.round(sT.total / 60 * 10) / 10,
        // Schedule hours for D-1
        schedD1TotalH: Math.round(s1.total / 60 * 10) / 10,
        // Schedule hours for D-2
        schedD2TotalH: Math.round(s2.total / 60 * 10) / 10,
        // QB
        qbTabs,
        // Status
        loadStatus
      };
    });

    // ── Team KPIs ──
    const totalCasesToday = members.reduce((s, m) => s + m.casesToday, 0);
    const totalCasesD1 = members.reduce((s, m) => s + m.casesD1, 0);
    const totalAssigned = members.reduce((s, m) => s + m.totalAssigned, 0);
    const overloaded = members.filter(m => m.loadStatus === 'overload').length;
    const warning = members.filter(m => m.loadStatus === 'warning').length;
    const avgCases = members.length ? Math.round((totalAssigned / members.length) * 10) / 10 : 0;

    const payload = {
      ok: true,
      dates: { today: todayIso, d1: d1Iso, d2: d2Iso },
      kpis: {
        totalMembers: members.length,
        totalCasesToday,
        totalCasesD1,
        totalAssigned,
        avgCasesPerMember: avgCases,
        overloaded,
        warning
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
