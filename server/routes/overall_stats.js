/**
 * @file overall_stats.js
 * @description Page: Overall Stats — aggregate KPIs and performance metrics across all members
 * @module MUMS/Pages
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceFetch } = require('../lib/supabase');

const MAX_RANGE_DAYS = Number((process.env && process.env.OVERALL_STATS_MAX_RANGE_DAYS) || 90);
const CACHE_TTL_MS = Number((process.env && process.env.OVERALL_STATS_CACHE_TTL_MS) || 5 * 60 * 1000);
const cache = new Map();

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
}

function dateToIso(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateToIso(d);
}

function rangeDays(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function dayIndexFromIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCDay(); // 0=Sun..6=Sat
}

function weekStartIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = d.getUTCDay();
  const delta = (wd === 0) ? -6 : (1 - wd);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateToIso(d);
}

function parseHM(value) {
  const raw = String(value || '');
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'mailbox_manager' || r === 'mailbox_call') return 'mailbox';
  if (r === 'call_onqueue' || r === 'call_available') return 'call';
  if (r === 'back_office') return 'back_office';
  return 'other';
}

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

async function loadDocValue(key) {
  const out = await serviceSelect('mums_documents', `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`);
  if (!out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].value;
}

async function fetchProfiles(teamId) {
  const filter = teamId ? `&team_id=eq.${encodeURIComponent(teamId)}` : '';
  const out = await serviceSelect('mums_profiles', `select=user_id,name,username,team_id,role&role=eq.MEMBER${filter}&order=name.asc`);
  if (!out.ok || !Array.isArray(out.json)) return [];
  return out.json.map((p) => ({
    id: p.user_id,
    name: p.name || p.username || '',
    username: p.username || '',
    teamId: p.team_id || '',
    role: p.role || 'MEMBER'
  }));
}

function selectLatestSnapshots(notifs, teamId) {
  const map = new Map();
  (Array.isArray(notifs) ? notifs : []).forEach((n) => {
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

function computeCaseCounts(cases, memberIds, rangeStart, rangeEnd) {
  const startMs = new Date(`${rangeStart}T00:00:00Z`).getTime();
  const endMs = new Date(`${rangeEnd}T23:59:59Z`).getTime();
  const counts = {};
  memberIds.forEach((id) => {
    counts[id] = 0;
  });
  (Array.isArray(cases) ? cases : []).forEach((c) => {
    if (!c) return;
    const uid = String(c.assigneeId || c.assignee_id || '');
    if (!uid || !(uid in counts)) return;
    const ts = safeNumber(c.assignedAt || c.createdAt || c.ts || c.updatedAt);
    if (!ts) return;
    if (ts >= startMs && ts <= endMs) counts[uid] += 1;
  });
  return counts;
}

function computeScheduleTotals(snapshotsByWeek, memberIds, rangeStart, rangeEnd) {
  const totals = {};
  const dailyTotals = {};
  memberIds.forEach((id) => {
    totals[id] = { mailbox: 0, call: 0, back_office: 0, other: 0, total: 0, daily: [] };
    dailyTotals[id] = [];
  });
  const dates = [];
  const days = rangeDays(rangeStart, rangeEnd);
  for (let i = 0; i < days; i += 1) {
    dates.push(addDays(rangeStart, i));
  }
  const byWeek = new Map();
  dates.forEach((iso) => {
    const wk = weekStartIso(iso);
    const entry = byWeek.get(wk) || { days: [] };
    entry.days.push({ iso, dayIndex: dayIndexFromIso(iso) });
    byWeek.set(wk, entry);
  });

  byWeek.forEach((entry, wk) => {
    const snap = snapshotsByWeek.get(wk);
    if (!snap || !snap.snapshots) return;
    const snapshots = snap.snapshots;
    memberIds.forEach((uid) => {
      const memberSnap = snapshots[uid];
      if (!memberSnap || !memberSnap.days) return;
      entry.days.forEach(({ dayIndex }, idx) => {
        const blocks = Array.isArray(memberSnap.days[String(dayIndex)]) ? memberSnap.days[String(dayIndex)] : [];
        let dayTotal = 0;
        blocks.forEach((b) => {
          const s = parseHM(b.start);
          const e = parseHM(b.end);
          if (s == null || e == null || e <= s) return;
          const mins = e - s;
          const roleKey = normalizeRole(b.role);
          totals[uid][roleKey] += mins;
          totals[uid].total += mins;
          dayTotal += mins;
        });
        totals[uid].daily[idx] = (totals[uid].daily[idx] || 0) + dayTotal;
      });
    });
  });

  return { totals, dates };
}

function buildTrends(dates, totalsByMember) {
  const totals = Array(dates.length).fill(0);
  Object.values(totalsByMember).forEach((m) => {
    (m.daily || []).forEach((v, idx) => {
      totals[idx] += safeNumber(v);
    });
  });
  return dates.map((iso, idx) => ({
    date: iso,
    totalHours: Math.round(totals[idx] / 60)
  }));
}

function resolveSort(sortBy) {
  const allowed = new Set(['name', 'cases', 'mailbox', 'back_office', 'call', 'total']);
  return allowed.has(sortBy) ? sortBy : 'name';
}

function applySort(list, sortBy, sortDir) {
  const dir = sortDir === 'desc' ? -1 : 1;
  const key = resolveSort(sortBy);
  return list.sort((a, b) => {
    if (key === 'name') return String(a.name).localeCompare(String(b.name)) * dir;
    return (safeNumber(a[key]) - safeNumber(b[key])) * dir;
  });
}

async function tryExecSql(sql) {
  const candidates = ['exec_sql', 'execute_sql', 'mums_exec_sql', 'sql'];
  for (const fn of candidates) {
    const out = await serviceFetch(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { sql }
    });
    if (out.ok) return out;
  }
  return null;
}

async function loadCasesWithSql() {
  const sql = `
    select value as cases
    from mums_documents
    where key = 'ums_cases'
    limit 1;
  `;
  const out = await tryExecSql(sql);
  if (!out || !out.ok || !Array.isArray(out.json) || !out.json[0]) return null;
  return out.json[0].cases || null;
}

module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u = await getUserFromJwt(jwt);
    if (!u) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

    const profile = await getProfileForUserId(u.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'Forbidden' });
    const role = String(profile.role || 'MEMBER');
    const allowRoles = new Set(['TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN', 'SUPER_USER']);
    if (!allowRoles.has(role)) return sendJson(res, 403, { ok: false, error: 'Forbidden' });

    if (role === 'TEAM_LEAD') {
      const pilot = String(req.headers['x-mums-pilot'] || '').toLowerCase();
      if (pilot !== 'overall_stats') {
        return sendJson(res, 403, { ok: false, error: 'Pilot disabled' });
      }
    }

    const startDate = parseIsoDate(req.query && req.query.start_date);
    const endDate = parseIsoDate(req.query && req.query.end_date);
    if (!startDate || !endDate) {
      return sendJson(res, 400, { ok: false, error: 'Invalid date range' });
    }
    if (startDate > endDate) {
      return sendJson(res, 400, { ok: false, error: 'start_date must be <= end_date' });
    }
    const days = rangeDays(startDate, endDate);
    if (days > MAX_RANGE_DAYS) {
      return sendJson(res, 400, { ok: false, error: `Range exceeds ${MAX_RANGE_DAYS} days` });
    }

    let teamId = String((req.query && req.query.team_id) || '').trim();
    if (role === 'TEAM_LEAD') teamId = String(profile.team_id || '');

    const limit = Math.max(1, Math.min(100, Number((req.query && req.query.limit) || 10)));
    const offset = Math.max(0, Number((req.query && req.query.offset) || 0));
    const sortBy = resolveSort(String((req.query && req.query.sort_by) || 'name'));
    const sortDir = String((req.query && req.query.sort_dir) || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    const search = String((req.query && req.query.search) || '').trim().toLowerCase();
    const preset = String((req.query && req.query.preset) || '').trim().toLowerCase();

    const cacheKey = `${teamId}|${startDate}|${endDate}|${sortBy}|${sortDir}|${limit}|${offset}|${search}|${preset}`;
    const cacheEntry = cache.get(cacheKey);
    if (cacheEntry && Date.now() - cacheEntry.ts < CACHE_TTL_MS && preset && preset !== 'custom') {
      return sendJson(res, 200, cacheEntry.data);
    }

    const prevEnd = addDays(startDate, -1);
    const prevStart = addDays(startDate, -days);

    const [profiles, notifsRaw, casesRaw, casesSql] = await Promise.all([
      fetchProfiles(teamId),
      loadDocValue('mums_schedule_notifs').then((v) => v || loadDocValue('ums_schedule_notifs')),
      loadDocValue('ums_cases'),
      loadCasesWithSql()
    ]);

    const cases = casesSql || casesRaw || [];
    const snapshotsByWeek = selectLatestSnapshots(notifsRaw, teamId);
    const memberIds = profiles.map((p) => String(p.id));
    const caseCounts = computeCaseCounts(cases, memberIds, startDate, endDate);
    const caseCountsPrev = computeCaseCounts(cases, memberIds, prevStart, prevEnd);

    const scheduleTotals = computeScheduleTotals(snapshotsByWeek, memberIds, startDate, endDate);
    const scheduleTotalsPrev = computeScheduleTotals(snapshotsByWeek, memberIds, prevStart, prevEnd);

    const rows = profiles.map((p, idx) => {
      const cur = scheduleTotals.totals[p.id] || {};
      const prev = scheduleTotalsPrev.totals[p.id] || {};
      const mailboxH = Math.round(safeNumber(cur.mailbox) / 60);
      const backOfficeH = Math.round(safeNumber(cur.back_office) / 60);
      const callH = Math.round(safeNumber(cur.call) / 60);
      const totalH = Math.round(safeNumber(cur.total) / 60);
      const prevMailbox = Math.round(safeNumber(prev.mailbox) / 60);
      const prevBack = Math.round(safeNumber(prev.back_office) / 60);
      const prevCall = Math.round(safeNumber(prev.call) / 60);
      const prevTotal = Math.round(safeNumber(prev.total) / 60);
      const casesCount = safeNumber(caseCounts[p.id]);
      const prevCases = safeNumber(caseCountsPrev[p.id]);
      return {
        id: p.id,
        name: p.name,
        username: p.username,
        teamId: p.teamId,
        teamLabel: teamId || p.teamId,
        mailbox: mailboxH,
        back_office: backOfficeH,
        call: callH,
        total: totalH,
        cases: casesCount,
        mailboxH,
        backOfficeH,
        callH,
        totalH,
        caseCount: casesCount,
        deltaMailbox: mailboxH - prevMailbox,
        deltaBackOffice: backOfficeH - prevBack,
        deltaCall: callH - prevCall,
        deltaTotal: totalH - prevTotal,
        deltaCases: casesCount - prevCases,
        sparkline: (cur.daily || []).map((v) => Math.round(safeNumber(v) / 60))
      };
    });

    const filtered = search
      ? rows.filter((r) => String(r.name || r.username || '').toLowerCase().includes(search))
      : rows;
    const sorted = applySort(filtered, sortBy, sortDir);
    const paged = sorted.slice(offset, offset + limit);

    const kpis = {
      cases: rows.reduce((s, r) => s + safeNumber(r.cases), 0),
      mailbox_hours: rows.reduce((s, r) => s + safeNumber(r.mailbox), 0),
      back_office_hours: rows.reduce((s, r) => s + safeNumber(r.back_office), 0),
      call_hours: rows.reduce((s, r) => s + safeNumber(r.call), 0),
      total_hours: rows.reduce((s, r) => s + safeNumber(r.total), 0),
      prev_cases: rows.reduce((s, r) => s + safeNumber(r.cases - r.deltaCases), 0),
      prev_mailbox_hours: rows.reduce((s, r) => s + safeNumber(r.mailbox - r.deltaMailbox), 0),
      prev_back_office_hours: rows.reduce((s, r) => s + safeNumber(r.back_office - r.deltaBackOffice), 0),
      prev_call_hours: rows.reduce((s, r) => s + safeNumber(r.call - r.deltaCall), 0),
      prev_total_hours: rows.reduce((s, r) => s + safeNumber(r.total - r.deltaTotal), 0)
    };

    const payload = {
      ok: true,
      kpis,
      trends: buildTrends(scheduleTotals.dates, scheduleTotals.totals),
      members: paged,
      meta: {
        start_date: startDate,
        end_date: endDate,
        prev_start: prevStart,
        prev_end: prevEnd,
        total_members: filtered.length
      }
    };

    if (preset && preset !== 'custom') {
      cache.set(cacheKey, { ts: Date.now(), data: payload });
    }

    return sendJson(res, 200, payload);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'Server error', details: String(e && e.message ? e.message : e) });
  }
};

module.exports._test = {
  parseIsoDate,
  addDays,
  rangeDays,
  weekStartIso,
  dayIndexFromIso
};
