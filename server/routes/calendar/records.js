/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// server/routes/calendar/records.js
// GET /api/calendar/records
// Fetches records from Quickbase using the Global Calendar Settings token.
// Available to all authenticated users. Token is server-side only (never exposed).

const { getUserFromJwt } = require('../../lib/supabase');
const { readGlobalCalendarSettings } = require('../../lib/global_calendar');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizeRealm(raw) {
  const r = String(raw || '').trim().toLowerCase();
  if (!r) return '';
  if (r.includes('.quickbase.com')) return r;
  return r + '.quickbase.com';
}

async function fetchQBFields(realm, tableId, token) {
  const url = `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}&includeFieldPerms=false`;
  const r = await fetch(url, {
    headers: {
      'QB-Realm-Hostname': normalizeRealm(realm),
      'Authorization': `QB-USER-TOKEN ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) return [];
  const json = await r.json();
  return Array.isArray(json) ? json.map(f => ({ id: Number(f.id), label: String(f.label || '') })) : [];
}

async function fetchQBRecords(realm, tableId, qid, token) {
  // Use the run-report API to get data exactly as configured in QB report
  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=500`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'QB-Realm-Hostname': normalizeRealm(realm),
      'Authorization': `QB-USER-TOKEN ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = {}; }
  if (!r.ok) {
    console.error('[calendar/records] QB run-report failed:', r.status, json?.message || text.slice(0, 200));
    return { ok: false, status: r.status, message: json?.message || 'QB request failed', records: [], fields: [] };
  }
  const records = Array.isArray(json.data) ? json.data : [];
  const fields = Array.isArray(json.fields)
    ? json.fields.map(f => ({ id: Number(f.id), label: String(f.label || '') }))
    : [];
  return { ok: true, records, fields };
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // Read calendar settings (contains the token securely)
    const calOut = await readGlobalCalendarSettings();
    if (!calOut.ok) return sendJson(res, 500, { ok: false, error: 'calendar_settings_unavailable' });

    const s = calOut.settings;
    if (!s.realm || !s.tableId || !s.qid || !s.qbToken) {
      return sendJson(res, 200, {
        ok: false,
        error: 'calendar_not_configured',
        message: 'Manila Calendar is not configured. Ask your Super Admin to set up Calendar Settings.',
        records: [],
        fields: [],
      });
    }

    // Fetch report records
    const runOut = await fetchQBRecords(s.realm, s.tableId, s.qid, s.qbToken);
    if (!runOut.ok) {
      return sendJson(res, runOut.status || 500, {
        ok: false, error: 'qb_fetch_failed', message: runOut.message, records: [], fields: [],
      });
    }

    // Fetch fields for label-based auto-detection
    let allFields = runOut.fields;
    if (!allFields.length) {
      try { allFields = await fetchQBFields(s.realm, s.tableId, s.qbToken); } catch (_) {}
    }

    return sendJson(res, 200, {
      ok: true,
      records: runOut.records,
      fields: allFields,
      fieldMappings: {
        fieldEmployee:  s.fieldEmployee  || '',
        fieldNote:      s.fieldNote      || '',
        fieldStartDate: s.fieldStartDate || '',
        fieldEndDate:   s.fieldEndDate   || '',
      },
    });
  } catch (err) {
    console.error('[calendar/records]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
