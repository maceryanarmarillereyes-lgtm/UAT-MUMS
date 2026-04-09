/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/studio/oncall_schedule.js
// GET /api/studio/oncall_schedule
// Reads the On-Call Schedule QuickBase report, finds the record whose
// On-Call Start Date ≤ today (PHT) < On-Call End Date, and returns:
//   wmTech, wmPhone, caTech, caPhone, startDate, endDate
// Uses the QB token from Studio QB Settings (shared / global fallback).

const { getUserFromJwt } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');
const { serviceSelect } = require('../../lib/supabase');

const DOC_KEY = 'ss_oncall_tech_settings';

// Cache so multiple home-page loads don't hammer QB
const _cache = { data: null, ts: 0, ttl: 5 * 60 * 1000 }; // 5 min TTL

// Bust stale cache on module load so first deploy serves fresh data
_cache.data = null; _cache.ts = 0;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '' };
  if (!url) return out;
  try {
    const u = new URL(url);
    // Realm from hostname: realm.quickbase.com
    const host = String(u.hostname || '').toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
    if (m) out.realm = m[1];

    const segs = u.pathname.split('/').filter(Boolean);

    // Primary: /table/{tableId}
    const ti = segs.findIndex(s => s.toLowerCase() === 'table');
    if (ti >= 0 && segs[ti + 1]) out.tableId = segs[ti + 1];

    // Legacy /db/{tableId}
    if (!out.tableId) {
      const di = segs.findIndex(s => s.toLowerCase() === 'db');
      if (di >= 0 && segs[di + 1]) out.tableId = segs[di + 1];
    }

    // Fallback: QB short URLs use /nav/app/{appId}/action/q — when no /table/ is present
    // the segment after /app/ may double as the tableId (single-table app or copied from nav)
    if (!out.tableId) {
      const ai = segs.findIndex(s => s.toLowerCase() === 'app');
      if (ai >= 0 && segs[ai + 1]) out.tableId = segs[ai + 1];
    }

    // QID from ?qid= param
    const rawQid = u.searchParams.get('qid') || '';
    const qm = rawQid.match(/-?\d+/);
    if (qm) out.qid = qm[0];
    if (!out.qid) {
      const rm = url.match(/[?&]qid=(-?\d+)/i);
      if (rm) out.qid = rm[1];
    }
  } catch(_) {}
  return out;
}

// Philippine Time = UTC+8
function getPHTDateOnly() {
  const now = new Date();
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Parse QB date value to "YYYY-MM-DD"
// QB returns epoch ms as string, or ISO string, or "MM-DD-YYYY", or "YYYY-MM-DD"
function parseQbDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Epoch ms (QB often returns millisecond timestamps)
  if (/^\d{10,}$/.test(s)) {
    const ms = Number(s);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  // ISO string
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2,'0')}-${String(mdy[2]).padStart(2,'0')}`;
  // MM/DD/YYYY
  const mds = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mds) return `${mds[3]}-${String(mds[1]).padStart(2,'0')}-${String(mds[2]).padStart(2,'0')}`;
  return null;
}

// Format YYYY-MM-DD → "Mon, Apr 1, 2026" (PHT display)
function fmtDate(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

// Normalize any QB field value to a plain string.
// QB REST API v1 returns complex objects for User, Multi-user, Lookup, and File fields:
//   Text field:    { value: "Paul Humphreys" }          → "Paul Humphreys"
//   User field:    { value: { id:.., name:.., email:.. }} → "Paul Humphreys"
//   Multi-user:    { value: [{ id:.., name:.. }, ...] }  → "Paul Humphreys, John Doe"
//   Lookup/Ref:    { value: { value: "text" } }          → "text"
//   File:          { value: { url: ".." } }              → url string
//   Empty:         { value: null } or { value: "" }      → ""
// Using String() directly on an object → "[object Object]" (the bug).
function normalizeQbValue(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    // File attachment
    if (raw.url)       return String(raw.url);
    // User / staff record — most common case for Technician fields
    if (raw.name)      return String(raw.name);
    if (raw.userName)  return String(raw.userName);
    if (raw.label)     return String(raw.label);
    if (raw.text)      return String(raw.text);
    // Nested value wrapper
    if (raw.value != null) return normalizeQbValue(raw.value);
    // Numeric relation ID only
    if (raw.id != null) return String(raw.id);
    return '';
  }
  if (Array.isArray(raw)) {
    return raw
      .map(x => (x && typeof x === 'object') ? (x.name || x.label || x.value || x.id || '') : String(x || ''))
      .filter(Boolean)
      .join(', ');
  }
  return String(raw);
}

// Get field value by label keyword match — returns a plain normalized string
function getFieldByLabel(fields, columnMap, keywords) {
  if (!fields || !columnMap) return '';
  const colId = Object.keys(columnMap).find(id => {
    const lbl = (columnMap[id] || '').toLowerCase();
    return keywords.some(k => lbl.includes(k.toLowerCase()));
  });
  if (!colId) return '';
  const f = fields[colId];
  if (!f) return '';
  // f is the raw QB cell: { value: <any> }
  const raw = (typeof f === 'object' && f !== null && Object.prototype.hasOwnProperty.call(f, 'value'))
    ? f.value : f;
  return normalizeQbValue(raw);
}

// Extract initials from full name
function initials(name) {
  return String(name || '').trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '??';
}

module.exports = async (req, res) => {
  try {
    // Auth
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // Return cache if fresh
    if (_cache.data && (Date.now() - _cache.ts) < _cache.ttl) {
      return sendJson(res, 200, _cache.data);
    }

    // Step 1: Read oncall settings (report link)
    const settingsOut = await serviceSelect('mums_documents', `select=value&key=eq.${DOC_KEY}&limit=1`);
    const settingsRow = Array.isArray(settingsOut.json) && settingsOut.json[0] ? settingsOut.json[0] : null;
    const settingsVal = (settingsRow && settingsRow.value) ? settingsRow.value : {};

    const reportLink = String(settingsVal.reportLink || '').trim();
    if (!reportLink) {
      return sendJson(res, 200, { ok: true, configured: false, message: 'Oncall Tech not configured. Add QB report link in General Settings → Oncall Tech Settings.' });
    }

    const parsed = parseQbUrl(reportLink);
    const realm   = String(settingsVal.realm   || parsed.realm   || '').trim();
    const tableId = String(settingsVal.tableId || parsed.tableId || '').trim();
    const qid     = String(settingsVal.qid     || parsed.qid     || '').trim();

    if (!realm || !tableId || !qid) {
      return sendJson(res, 200, { ok: true, configured: false, message: 'Could not extract realm/tableId/qid from report link.' });
    }

    // Step 2: Get QB token from Studio QB Settings (shared)
    const studioOut = await readStudioQbSettings(user.id);
    const studioS   = (studioOut.ok && studioOut.settings) ? studioOut.settings : {};
    const token     = String(studioS.qbToken || '').trim();

    if (!token) {
      return sendJson(res, 200, { ok: true, configured: false, message: 'No QB token configured. Set token in General Settings → Studio Quickbase Settings.' });
    }

    // Step 3: Run the QB report via API
    const realmHost  = realm.includes('.') ? realm : `${realm}.quickbase.com`;
    const reportUrl  = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=500`;

    let qbData;
    try {
      const qbResp = await fetch(reportUrl, {
        method: 'POST',
        headers: {
          'QB-Realm-Hostname': realmHost,
          'Authorization':     `QB-USER-TOKEN ${token}`,
          'Content-Type':      'application/json',
          'User-Agent':        'MUMS-SupportStudio/1.0',
        },
        body: JSON.stringify({}),
      });
      const rawText = await qbResp.text();
      qbData = rawText ? JSON.parse(rawText) : {};
      if (!qbResp.ok) {
        _cache.data = null; // invalidate cache on QB error
        return sendJson(res, 200, { ok: false, configured: true, error: 'qb_api_error', status: qbResp.status, message: qbData.message || `QB returned HTTP ${qbResp.status}` });
      }
    } catch(fetchErr) {
      _cache.data = null;
      return sendJson(res, 200, { ok: false, configured: true, error: 'fetch_failed', message: String(fetchErr.message) });
    }

    const records = Array.isArray(qbData.data)   ? qbData.data   : [];
    const fields  = Array.isArray(qbData.fields)  ? qbData.fields : [];

    // Build column label map: { fieldId: label }
    const columnMap = {};
    fields.forEach(f => { columnMap[String(f.id)] = String(f.label || ''); });

    // Step 4: Find today's record
    // QB On-Call Start Date ≤ today (PHT) < On-Call End Date
    const todayPHT = getPHTDateOnly();

    let todayRecord = null;
    for (const row of records) {
      const snapFields = {};
      Object.keys(row).forEach(fid => { snapFields[fid] = row[fid]; });

      // Broad keyword sets — QB column labels may vary slightly in customer installs
      const startRaw = getFieldByLabel(snapFields, columnMap,
        ['on-call start', 'oncall start', 'start date', 'schedule start', 'duty start']);
      const endRaw   = getFieldByLabel(snapFields, columnMap,
        ['on-call end',   'oncall end',   'end date',   'schedule end',   'duty end']);

      const startDate = parseQbDate(startRaw);
      const endDate   = parseQbDate(endRaw);

      if (!startDate || !endDate) continue;

      // today >= startDate AND today < endDate (string comparison works for ISO dates)
      if (todayPHT >= startDate && todayPHT < endDate) {
        todayRecord = { snapFields, startDate, endDate };
        break;
      }
    }

    if (!todayRecord) {
      const result = { ok: true, configured: true, onDutyToday: false, todayPHT,
        totalRecords: records.length,
        message: `No on-call schedule found for today (${todayPHT} PHT). ${records.length} records checked.` };
      _cache.data = result; _cache.ts = Date.now();
      return sendJson(res, 200, result);
    }

    const { snapFields, startDate, endDate } = todayRecord;

    // Extract technician details — broad keyword matching for different QB setups
    const wmTech  = getFieldByLabel(snapFields, columnMap,
      ['walmart technician', 'wm tech', 'walmart tech', 'wm technician', 'walmart on-call']);
    const wmPhone = getFieldByLabel(snapFields, columnMap,
      ['wm tech number', 'wm technician number', 'walmart tech number', 'wm number', 'wm phone']);
    const caTech  = getFieldByLabel(snapFields, columnMap,
      ['ca technician', 'ca tech', 'ca on-call', 'coldchain tech', 'ca on call']);
    const caPhone = getFieldByLabel(snapFields, columnMap,
      ['ca tech number', 'ca technician number', 'ca number', 'ca phone', 'coldchain number']);

    // Calculate days remaining
    const endMs   = new Date(endDate).getTime();
    const todayMs = new Date(todayPHT).getTime();
    const daysLeft = Math.max(0, Math.ceil((endMs - todayMs) / 86400000));

    const result = {
      ok: true,
      configured: true,
      onDutyToday: true,
      todayPHT,
      startDate,
      endDate,
      startDateLabel: fmtDate(startDate),
      endDateLabel:   fmtDate(endDate),
      daysLeft,
      wmTech:    wmTech  || '—',
      wmPhone:   wmPhone || '—',
      wmInitials: initials(wmTech),
      caTech:    caTech  || '—',
      caPhone:   caPhone || '—',
      caInitials: initials(caTech),
    };

    _cache.data = result;
    _cache.ts   = Date.now();
    return sendJson(res, 200, result);

  } catch(err) {
    console.error('[oncall_schedule]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err.message || err) });
  }
};
