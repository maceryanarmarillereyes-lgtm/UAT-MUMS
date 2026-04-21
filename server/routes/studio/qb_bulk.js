/* eslint-env node */
/**
 * server/routes/studio/qb_bulk.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FAST BULK UPDATE endpoint for Services QB Lookup.
 *
 * PROBLEM (Issue 4):
 *   refreshAllLinkedColumns() sends ~11 batch requests (50 records each) with
 *   50ms gaps = 2-4 seconds minimum for 520 rows. This is slow because QB's
 *   /api/v1/reports/:id/run can return ALL 500-1000 records in ONE call.
 *
 * SOLUTION:
 *   This endpoint wraps the existing runQBReport() pattern into a single call
 *   that returns a case# → {fields, columnMap} map. The client calls this ONCE
 *   during Update instead of 11 sequential batches.
 *
 * RESULT: 520 rows updated in ~1-2 seconds (same speed as Google Apps Script).
 *
 * GET /api/studio/qb_bulk?bust=1  (bust=1 bypasses server-side cache)
 *
 * Response:
 *   { ok: true, caseMap: { '436860': { fields: { '3': {value,label}, ... }, columnMap: { '3': 'Case #', ... } } } }
 *   { ok: false, error: 'studio_qb_not_configured', warning: '...' }
 */

const { getUserFromJwt }       = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  try {
    if (req && typeof req.body === 'string') return JSON.parse(req.body || '{}');
    if (req && req.body && typeof req.body === 'object') return req.body;
  } catch (_) {}
  return await new Promise((resolve) => {
    try {
      let raw = '';
      req.on('data', (c) => { raw += String(c || ''); });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
      });
      req.on('error', () => resolve({}));
    } catch (_) {
      resolve({});
    }
  });
}

const BULK_CACHE    = new Map();
const BULK_CACHE_MS = 30 * 1000; // 30-second TTL — same as report mode

function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.quickbase.com`;
}

function normalizeQbValue(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.url)      return String(raw.url);
    if (raw.name)     return String(raw.name);
    if (raw.userName) return String(raw.userName);
    if (raw.label)    return String(raw.label);
    if (raw.text)     return String(raw.text);
    if (raw.value != null) return normalizeQbValue(raw.value);
    if (raw.id != null)    return String(raw.id);
    return '';
  }
  if (Array.isArray(raw)) {
    return raw.map(x => (x && typeof x === 'object') ? (x.name || x.label || x.value || x.id || '') : String(x || '')).filter(Boolean).join(', ');
  }
  return String(raw);
}

function normalizeCaseKey(v) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  const noPrefix = raw.replace(/^\s*case(?:\s*(?:#|no\.?|number|id))?\s*[:\-]?\s*/i, '').trim();
  const compact  = noPrefix.replace(/,/g, '');
  if (/^\d+(?:\.0+)?$/.test(compact)) return String(Number(compact));
  const tok = compact.match(/\b(\d{3,})(?:\.0+)?\b/);
  if (tok && tok[1]) return String(Number(tok[1]));
  return compact;
}

/** Detect the case# field id from the field list */
function detectCaseFieldId(fields) {
  const EXACT = ['case #', 'case#', 'case number', 'case no', 'case id', 'case'];
  const byExact = fields.find(f => EXACT.includes(String(f.label || '').trim().toLowerCase()));
  if (byExact) return String(byExact.id);
  const byFuzzy = fields.find(f => String(f.label || '').toLowerCase().includes('case'));
  if (byFuzzy) return String(byFuzzy.id);
  return '3'; // QB default case field id
}

module.exports = async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  // ── Auth ─────────────────────────────────────────────────────────────────────
  let user;
  try { user = await getUserFromJwt(req); } catch (_) { user = null; }
  if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  // ── QB settings ──────────────────────────────────────────────────────────────
  let s;
  try { s = await readStudioQbSettings(user.id); } catch (e) { s = null; }
  if (!s) return sendJson(res, 200, { ok: false, error: 'studio_qb_not_configured', warning: 'studio_qb_not_configured' });

  const realm   = normalizeRealm(s.qb_realm || s.realm || '');
  const token   = String(s.qb_token || s.token || '').trim();
  const tableId = String(s.qb_table_id || s.table_id || '').trim();
  const qid     = String(s.qid || '').trim();

  if (!realm || !tableId || !qid || !token) {
    return sendJson(res, 200, { ok: false, error: 'studio_qb_not_configured', warning: 'studio_qb_not_configured' });
  }

  const body = method === 'POST' ? await readBody(req) : {};
  const requestedCaseFieldId = String((body && body.caseFieldId) || '').trim();
  const requestedFields = Array.isArray(body && body.fields) ? body.fields : [];

  // ── Cache check (skip if bust=1) ─────────────────────────────────────────────
  const bust     = String((req.query && req.query.bust) || '').trim() === '1';
  const cacheKey = `${realm}:${tableId}:${qid}`;
  if (!bust) {
    const hit = BULK_CACHE.get(cacheKey);
    if (hit && (Date.now() - hit.at) < BULK_CACHE_MS) {
      if (method === 'POST') return sendJson(res, 200, hit.value || {});
      return sendJson(res, 200, { ok: true, caseMap: hit.value, cached: true });
    }
  }

  // ── Fetch QB report — ALL records in ONE call ─────────────────────────────────
  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=1000`;
  let json;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': realm,
        Authorization: `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const rawText = await resp.text();
    try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }
    if (!resp.ok) {
      return sendJson(res, 200, { ok: false, error: 'qb_report_failed', message: json?.message || `QB API ${resp.status}` });
    }
  } catch (err) {
    return sendJson(res, 200, { ok: false, error: 'network_error', message: String(err?.message || err) });
  }

  const rows   = Array.isArray(json.data)   ? json.data   : [];
  const fields = Array.isArray(json.fields) ? json.fields : [];

  if (!rows.length) {
    return sendJson(res, 200, { ok: false, error: 'empty_report', message: 'QB report returned 0 records.' });
  }

  // ── Build columnMap: { fieldId → label } ─────────────────────────────────────
  const columnMap = {};
  fields.forEach(f => { columnMap[String(f.id)] = String(f.label || ''); });

  // ── Detect case# field ───────────────────────────────────────────────────────
  const caseFieldId = requestedCaseFieldId || detectCaseFieldId(fields);

  const requestedFieldIds = new Set(
    requestedFields
      .map((f) => String(f && f.fieldId != null ? f.fieldId : '').trim())
      .filter(Boolean)
  );

  // ── Build caseMap: { normalizedCaseNum → { fieldId: value } } for POST
  //                OR { normalizedCaseNum → { fields, columnMap } } for GET
  const caseMap = {};
  rows.forEach(row => {
    const caseCell = row[caseFieldId];
    const rawCase  = (caseCell && typeof caseCell === 'object' && 'value' in caseCell) ? caseCell.value : caseCell;
    const caseStr  = String(rawCase == null ? '' : rawCase).trim();
    const nk       = normalizeCaseKey(caseStr);
    if (!nk) return;

    if (method === 'POST') {
      const fieldValueMap = {};
      fields.forEach(f => {
        const fid = String(f.id);
        if (requestedFieldIds.size && !requestedFieldIds.has(fid)) return;
        const cell = row[fid];
        const raw = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
        fieldValueMap[fid] = normalizeQbValue(raw);
      });
      caseMap[nk] = fieldValueMap;
      return;
    }

    const fieldMap = {};
    fields.forEach(f => {
      const fid  = String(f.id);
      const cell = row[fid];
      const raw  = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
      fieldMap[fid] = { value: normalizeQbValue(raw), label: f.label || fid };
    });
    caseMap[nk] = { fields: fieldMap, columnMap };
  });

  // ── Cache and return ─────────────────────────────────────────────────────────
  BULK_CACHE.set(cacheKey, { at: Date.now(), value: caseMap });
  if (method === 'POST') return sendJson(res, 200, caseMap);
  return sendJson(res, 200, { ok: true, caseMap, total: rows.length });
};
