/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// server/routes/studio/yct_data.js
// GET /api/studio/yct_data
//
// "Your Case Today" data endpoint.
// ─────────────────────────────────────────────────────────────────────────────
// PURPOSE:
//   Returns Quickbase cases assigned to the requesting user, using EXACTLY the
//   same Global QB settings that "My Quickbase" uses — so YCT always mirrors
//   what the user sees in their MUMS dashboard.
//
// ROOT CAUSE FIX (v1.0):
//   The previous implementation called /api/studio/qb_data which reads the
//   per-user STUDIO QB Settings (isolated, optional, often unconfigured).
//   "My Quickbase" reads Global QB Settings → different table/report/token.
//   Result: YCT showed empty or wrong data for most users.
//
// THIS FIX:
//   1. Reads Global QB Settings (same as My Quickbase / monitoring endpoint)
//   2. Reads the requesting user's qb_name from their profile (Supabase)
//   3. Builds QB WHERE clause: {assignedToFieldId.CT.'<qb_name>'}
//   4. Runs the Global QB report with that filter injected
//   5. Returns normalized snap-compatible records for the frontend YCT renderer
//
// QUERY PARAMS:
//   ?limit=500          Max records to fetch (default 500, max 1000)
//   ?forceRefresh=1     Bypass 30s server-side cache

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readGlobalQuickbaseSettings }          = require('../../lib/global_quickbase');
const { normalizeQuickbaseCellValue }          = require('../../lib/quickbase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// ── In-process cache — 30s TTL per user ──────────────────────────────────────
const DATA_CACHE = new Map();
const CACHE_TTL_MS = 30 * 1000;

function readCache(key) {
  const hit = DATA_CACHE.get(key);
  if (!hit || (Date.now() - hit.at) > CACHE_TTL_MS) { DATA_CACHE.delete(key); return null; }
  return hit.value;
}
function writeCache(key, value) { DATA_CACHE.set(key, { at: Date.now(), value }); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.quickbase.com`;
}

function encLit(v) {
  return String(v == null ? '' : v).replace(/'/g, "\\'");
}

// Safely extract a displayable string from any QB field value shape
function normalizeCell(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.url)      return String(raw.url);
    if (raw.name)     return String(raw.name);
    if (raw.userName) return String(raw.userName);
    if (raw.label)    return String(raw.label);
    if (raw.text)     return String(raw.text);
    if (raw.value != null) return normalizeCell(raw.value);
    if (raw.id  != null)   return String(raw.id);
    return '';
  }
  if (Array.isArray(raw)) {
    return raw.map(x => (x && typeof x === 'object') ? (x.name || x.label || x.value || '') : String(x || '')).filter(Boolean).join(', ');
  }
  return String(raw);
}

// ── QB API helpers ────────────────────────────────────────────────────────────
const FIELDS_CACHE = new Map();
const FIELDS_TTL   = 60 * 1000;

async function getFields(realm, token, tableId) {
  const key = `${realm}:${tableId}`;
  const hit = FIELDS_CACHE.get(key);
  if (hit && (Date.now() - hit.at) < FIELDS_TTL) return hit.value;

  const url = `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'QB-Realm-Hostname': realm,
        'Authorization': `QB-USER-TOKEN ${token}`,
      },
    });
    if (!resp.ok) return [];
    const json = await resp.json().catch(() => ({}));
    const fields = Array.isArray(json)
      ? json.map(f => ({ id: Number(f.id), label: String(f.label || f.name || '') })).filter(f => Number.isFinite(f.id) && f.label)
      : [];
    FIELDS_CACHE.set(key, { at: Date.now(), value: fields });
    return fields;
  } catch (_) { return []; }
}

async function runReport({ realm, token, tableId, reportId, limit, whereClause }) {
  const top = Math.min(Number(limit) || 500, 1000);
  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(reportId)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=${top}`;
  const body = whereClause ? { where: whereClause } : {};

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'QB-Realm-Hostname': realm,
      'Authorization': `QB-USER-TOKEN ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const rawText = await resp.text();
  let json; try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }

  if (!resp.ok) {
    return { ok: false, status: resp.status, message: json?.message || 'Report run failed' };
  }

  return {
    ok:      true,
    records: Array.isArray(json.data)   ? json.data   : [],
    fields:  Array.isArray(json.fields) ? json.fields : [],
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── User profile → qb_name ────────────────────────────────────────────────
    const profile   = await getProfileForUserId(user.id);
    const qbName    = String((profile && profile.qb_name) || '').trim();
    const isSuperAdmin = !!(profile && profile.role === 'SUPER_ADMIN');

    if (!qbName && !isSuperAdmin) {
      return sendJson(res, 200, {
        ok: true, records: [], columns: [], qbName: '',
        warning: 'qb_name_not_assigned',
        message: 'Your QuickBase name (qb_name) has not been set. Ask your administrator to assign it in User Management.',
      });
    }

    // ── Global QB Settings — same source as My Quickbase ─────────────────────
    const globalOut = await readGlobalQuickbaseSettings();
    if (!globalOut.ok) {
      return sendJson(res, 500, { ok: false, error: 'global_qb_settings_failed' });
    }

    const g       = globalOut.settings;
    const realm   = normalizeRealm(g.realm);
    const tableId = String(g.tableId  || '').trim();
    const qid     = String(g.qid      || '').trim();
    const token   = String(g.qbToken  || '').trim();

    if (!realm || !tableId || !qid || !token) {
      return sendJson(res, 200, {
        ok: true, records: [], columns: [], qbName,
        warning: 'global_qb_not_configured',
        message: 'Global QuickBase settings are not configured. Contact your Super Admin.',
      });
    }

    // ── Cache check ───────────────────────────────────────────────────────────
    const query        = req.query || {};
    const limit        = Number(query.limit) || 500;
    const forceRefresh = String(query.forceRefresh || '').trim() === '1';
    const cacheKey     = `yct:${user.id}:${qbName}`;

    if (!forceRefresh) {
      const cached = readCache(cacheKey);
      if (cached) return sendJson(res, 200, cached);
    }

    // ── Field resolution ──────────────────────────────────────────────────────
    const allFields = await getFields(realm, token, tableId);
    const byLabel   = Object.create(null);
    allFields.forEach(f => { byLabel[f.label.toLowerCase()] = f.id; });

    const resolveId = (...labels) => {
      for (const l of labels) {
        const id = byLabel[l.toLowerCase()];
        if (Number.isFinite(id)) return id;
      }
      return null;
    };

    const assignedToFieldId = resolveId('Assigned to', 'Assigned To', 'assigned to', 'assignedto');
    if (!assignedToFieldId) {
      return sendJson(res, 200, {
        ok: true, records: [], columns: [], qbName,
        warning: 'assigned_to_field_not_found',
        message: 'Could not locate "Assigned to" field in this QuickBase table.',
      });
    }

    // ── Build WHERE: assigned to CONTAINS qb_name ─────────────────────────────
    // Use CT (contains) rather than EX (exact) to handle cases where QB stores
    // the full name but profile has a short version, e.g. "Mace Ryan Reyes" vs "Mace Reyes"
    const whereClause = `{${assignedToFieldId}.CT.'${encLit(qbName)}'}`;

    // ── Run Global QB report with assignedTo filter ───────────────────────────
    const runOut = await runReport({ realm, token, tableId, reportId: qid, limit, whereClause });

    if (!runOut.ok) {
      return sendJson(res, runOut.status || 500, {
        ok: false,
        error: 'qb_report_failed',
        message: runOut.message || 'Failed to run QuickBase report.',
        hint: 'Check Global QB Settings: realm, token, table ID, and report ID.',
      });
    }

    // ── Build columnMap from report fields ────────────────────────────────────
    const reportFields = Array.isArray(runOut.fields) && runOut.fields.length
      ? runOut.fields
      : allFields;

    const columns = reportFields
      .map(f => ({ id: String(f.id), label: String(f.label || '') }))
      .filter(f => f.label);

    // ── Normalize records → snap-compatible shape ─────────────────────────────
    // Shape expected by frontend _yctRecordsToSnaps / _renderYCT:
    //   { qbRecordId: string, fields: { "fieldId": { value: string } } }
    const caseFieldId = resolveId('Case #', 'Case #', 'case #', 'Case Number', 'Case ID') || 3;

    const records = (runOut.records || []).map((row, i) => {
      const normalized = {};
      columns.forEach(col => {
        const fid  = col.id;
        const cell = row?.[fid];
        const raw  = (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value'))
          ? cell.value : cell;
        normalized[fid] = { value: normalizeCell(raw) };
      });

      // Resolve Case # (record ID)
      const caseCell = row?.[String(caseFieldId)];
      const qbRecordId = normalizeCell(
        (caseCell && typeof caseCell === 'object' && 'value' in caseCell)
          ? caseCell.value : caseCell
      ) || String(i + 1);

      return { qbRecordId, fields: normalized };
    });

    const payload = {
      ok:      true,
      qbName,
      columns,
      records,
      total:   records.length,
      source:  'global_qb',   // signals frontend this came from Global QB
    };

    writeCache(cacheKey, payload);
    return sendJson(res, 200, payload);

  } catch (err) {
    console.error('[studio/yct_data]', err);
    return sendJson(res, 500, {
      ok: false,
      error: 'internal_error',
      message: String(err?.message || err),
    });
  }
};
