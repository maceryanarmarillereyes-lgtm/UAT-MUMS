/* eslint-env node */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// server/routes/studio/qb_data.js
// BATCH REFACTOR (MACE CLEARED 2026-04-19):
//   ?recordId=X       — single-record fetch (unchanged)
//   ?recordIds=X,Y,Z  — batch fetch: up to 50 IDs per call, 1 QB query total
//   (no params)       — report/list view (unchanged)
//
// FIX 2026-04-20 (MACE CLEARED):
//   - normalizeCaseKey() now applied on BOTH sides of batch match
//   - Prevents false not-found when QB returns "436860.0" but sheet has "436860"

const { getUserFromJwt } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');
const { listQuickbaseFields } = require('../../lib/quickbase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const REPORT_CACHE  = new Map();
const FIELDS_CACHE  = new Map();
const BATCH_CACHE   = new Map();
const CACHE_TTL_MS  = 5 * 60 * 1000;
const REPORT_TTL_MS = 30 * 1000;

function readCache(cache, key, ttl) {
  const hit = cache.get(key);
  if (!hit || (Date.now() - hit.at) > (ttl || CACHE_TTL_MS)) { cache.delete(key); return null; }
  return hit.value;
}
function writeCache(cache, key, value) { cache.set(key, { at: Date.now(), value }); }

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
    return raw.map(x => {
      if (x && typeof x === 'object') return x.name || x.label || x.value || x.id || '';
      return String(x || '');
    }).filter(Boolean).join(', ');
  }
  return String(raw);
}

function encLit(v) { return String(v == null ? '' : v).replace(/'/g, "\\'"); }

// ── CRITICAL: normalize case # so "436860", "436860.0", "436,860" all match ──
function normalizeCaseKey(v) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  const noPrefix = raw.replace(/^\s*case(?:\s*(?:#|no\.?|number|id))?\s*[:\-]?\s*/i, '').trim();
  const compact = noPrefix.replace(/,/g, '');
  if (/^\d+(?:\.0+)?$/.test(compact)) return String(Number(compact));
  const numericToken = compact.match(/\b(\d{3,})(?:\.0+)?\b/);
  if (numericToken && numericToken[1]) return String(Number(numericToken[1]));
  return compact;
}

async function getFields({ realm, token, tableId }) {
  const cacheKey = `${realm}:${tableId}`;
  const cached = readCache(FIELDS_CACHE, cacheKey);
  if (cached) return cached;
  try {
    const out = await listQuickbaseFields({ config: { qb_realm: realm, qb_token: token, qb_table_id: tableId } });
    if (out && out.ok) writeCache(FIELDS_CACHE, cacheKey, out);
    return out;
  } catch (_) { return { ok: false, fields: [] }; }
}

async function resolveCaseFieldId({ realm, token, tableId }) {
  const cacheKey = `caseFieldId:${realm}:${tableId}`;
  const cached = readCache(FIELDS_CACHE, cacheKey);
  if (cached) return cached;

  const fieldsOut = await getFields({ realm, token, tableId });
  const allFields = fieldsOut.ok
    ? (fieldsOut.fields || []).map(f => ({ id: Number(f?.id), label: String(f?.label || '').trim() })).filter(f => Number.isFinite(f.id) && f.label)
    : [];

  const candidates = [];
  const add = (id) => { const n = Number(id); if (Number.isFinite(n) && !candidates.includes(n)) candidates.push(n); };
  allFields.forEach(f => { const l = f.label.toLowerCase(); if (l === 'case #' || l === 'case number' || l === 'case no' || l === 'case id') add(f.id); });
  allFields.forEach(f => { const l = f.label.toLowerCase(); if (l.includes('case #') || l.includes('case number')) add(f.id); });
  allFields.forEach(f => { const l = f.label.toLowerCase(); if (l === 'case' || l.includes('case')) add(f.id); });
  add(3);

  const fieldId = candidates[0] || 3;
  writeCache(FIELDS_CACHE, cacheKey, fieldId);
  return fieldId;
}

function getCaseFieldCandidates(allFields) {
  const candidates = [];
  const add = (id) => { const n = Number(id); if (Number.isFinite(n) && !candidates.includes(n)) candidates.push(n); };
  (Array.isArray(allFields) ? allFields : []).forEach(f => {
    const l = String(f?.label || '').trim().toLowerCase();
    if (!l) return;
    if (l === 'case #' || l === 'case number' || l === 'case no' || l === 'case id') add(f.id);
  });
  (Array.isArray(allFields) ? allFields : []).forEach(f => {
    const l = String(f?.label || '').trim().toLowerCase();
    if (!l) return;
    if (l.includes('case #') || l.includes('case number') || l.includes('case no') || l.includes('case id')) add(f.id);
  });
  (Array.isArray(allFields) ? allFields : []).forEach(f => {
    const l = String(f?.label || '').trim().toLowerCase();
    if (!l) return;
    if (l === 'case' || l.includes('case')) add(f.id);
  });
  add(3);
  return candidates;
}

async function runQBReport({ realm, token, tableId, reportId, limit, extraWhere }) {
  const cacheKey = `${realm}:${tableId}:${reportId}:${limit}:${extraWhere || ''}`;
  const cached = readCache(REPORT_CACHE, cacheKey, REPORT_TTL_MS);
  if (cached) return cached;

  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(reportId)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=${Math.min(Number(limit) || 500, 1000)}`;
  const body = extraWhere ? { where: extraWhere } : {};
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'QB-Realm-Hostname': realm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const rawText = await resp.text();
    let json; try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }
    if (!resp.ok) return { ok: false, status: resp.status, message: json?.message || 'Report run failed' };
    const records = Array.isArray(json.data) ? json.data : [];
    const fields = Array.isArray(json.fields)
      ? json.fields.map(f => ({ id: Number(f.id), label: String(f.label || '') })).filter(f => Number.isFinite(f.id))
      : [];
    const result = { ok: true, records, fields };
    writeCache(REPORT_CACHE, cacheKey, result);
    return result;
  } catch (err) {
    return { ok: false, status: 500, message: String(err?.message || err) };
  }
}

function buildFieldMap(row, fields) {
  const columnMap = {};
  const fieldValues = {};
  (Array.isArray(fields) ? fields : []).forEach(f => {
    const fid = String(f.id);
    columnMap[fid] = String(f.label || f.name || '');
    const cell = row[fid];
    const raw = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
    fieldValues[fid] = { value: normalizeQbValue(raw), label: columnMap[fid] };
  });
  return { fieldValues, columnMap };
}

function getRowCaseKeys(row, caseFieldCandidates) {
  const keys = new Set();
  const rowObj = row && typeof row === 'object' ? row : {};
  (Array.isArray(caseFieldCandidates) ? caseFieldCandidates : []).forEach(fid => {
    const cell = rowObj[String(fid)];
    const raw = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
    const nk = normalizeCaseKey(normalizeQbValue(raw));
    if (nk) keys.add(nk);
  });
  return Array.from(keys);
}

function buildCaseExactClauses(caseFieldId, ids) {
  const clauses = [];
  (Array.isArray(ids) ? ids : []).forEach(id => {
    const nk = normalizeCaseKey(id);
    if (!nk) return;
    clauses.push(`{${caseFieldId}.EX.'${encLit(nk)}'}`);
    if (/^\d+$/.test(nk)) clauses.push(`{${caseFieldId}.EX.'${encLit(`${nk}.0`)}'}`);
  });
  return clauses;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const settingsOut = await readStudioQbSettings(user.id);
    if (!settingsOut.ok) return sendJson(res, 500, { ok: false, error: 'settings_read_failed' });

    const s       = settingsOut.settings;
    const realm   = normalizeRealm(s.realm);
    const tableId = String(s.tableId || '').trim();
    const qid     = String(s.qid    || '').trim();
    const token   = String(s.qbToken|| '').trim();

    if (!realm || !tableId || !qid || !token) {
      return sendJson(res, 200, {
        ok: true, columns: [], records: [], allAvailableFields: [],
        warning: 'studio_qb_not_configured',
        message: 'Studio Quickbase is not configured. Go to General Settings → Studio Quickbase Settings to set up.',
      });
    }

    const query      = req.query || {};
    const searchTerm = String(query.search || '').trim();

    // ══════════════════════════════════════════════════════════════════════════
    // MODE A — SINGLE RECORD FETCH  (?recordId=461023)
    // ══════════════════════════════════════════════════════════════════════════
    const recordIdParam = String(query.recordId || '').trim();
    if (recordIdParam) {
      const fieldsOut = await getFields({ realm, token, tableId });
      const allFields = fieldsOut.ok
        ? (fieldsOut.fields || []).map(f => ({ id: Number(f?.id), label: String(f?.label || '').trim() })).filter(f => Number.isFinite(f.id) && f.label)
        : [];

      const caseFieldCandidates = getCaseFieldCandidates(allFields);
      const selectIds    = allFields.map(f => f.id).filter(id => Number.isFinite(id));
      const safeSelectIds = selectIds.length ? selectIds : undefined;

      try {
        let json = null;
        for (const caseFieldId of caseFieldCandidates) {
          const whereClause = `{${caseFieldId}.EX.'${encLit(recordIdParam)}'}`;
          const body = { from: tableId, where: whereClause, options: { top: 1 } };
          if (safeSelectIds) body.select = safeSelectIds;
          const resp = await fetch('https://api.quickbase.com/v1/records/query', {
            method: 'POST',
            headers: { 'QB-Realm-Hostname': realm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const out = await resp.json().catch(() => ({}));
          if (!resp.ok) continue;
          if (Array.isArray(out.data) && out.data.length) { json = out; break; }
        }

        if (!json || !Array.isArray(json.data) || !json.data.length) {
          return sendJson(res, 200, { ok: false, error: 'record_not_found', message: `Case #${recordIdParam} not found`, debug: { triedCaseFieldIds: caseFieldCandidates } });
        }

        const row    = json.data[0];
        const fields = Array.isArray(json.fields) ? json.fields : [];
        const { fieldValues, columnMap } = buildFieldMap(row, fields);
        return sendJson(res, 200, { ok: true, fields: fieldValues, columnMap });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: 'record_not_found', message: String(err?.message || err) });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE B — BATCH FETCH  (?recordIds=436860,436776,...)
    // FIX: normalizeCaseKey() applied on BOTH sides so "436860.0" matches "436860"
    // ══════════════════════════════════════════════════════════════════════════
    const recordIdsParam = String(query.recordIds || '').trim();
    if (recordIdsParam) {
      const rawIds = recordIdsParam.split(',').map(x => x.trim()).filter(Boolean);
      // Normalize incoming IDs so the cache key is always canonical
      const ids    = [...new Set(rawIds.map(normalizeCaseKey))].filter(Boolean).slice(0, 50);
      if (!ids.length) return sendJson(res, 200, { ok: true, records: {}, notFound: [] });

      // bust=1 is sent by the Update button — skip BATCH_CACHE to force a fresh QB fetch
      const bustCache = String(query.bust || '') === '1';

      const caseFieldId      = await resolveCaseFieldId({ realm, token, tableId });

      const fieldsOutForCase = await getFields({ realm, token, tableId });
      const allFieldsForCase = fieldsOutForCase.ok
        ? (fieldsOutForCase.fields || []).map(f => ({ id: Number(f?.id), label: String(f?.label || '').trim() })).filter(f => Number.isFinite(f.id) && f.label)
        : [];
      const caseFieldCandidates = getCaseFieldCandidates(allFieldsForCase);

      const batchCachePrefix = `${realm}:${tableId}:${caseFieldId}`;

      const result   = {};
      const notFound = [];
      const toFetch  = [];

      ids.forEach(id => {
        // When bust=1, skip cache entirely — send everything to toFetch
        if (bustCache) { toFetch.push(id); return; }
        const cached = readCache(BATCH_CACHE, `${batchCachePrefix}:${id}`);
        if (cached === null) {
          notFound.push(id);
        } else if (cached) {
          result[id] = cached;
        } else {
          toFetch.push(id);
        }
      });

      if (toFetch.length > 0) {
        const fieldsOut    = await getFields({ realm, token, tableId });
        const allFieldIds  = fieldsOut.ok
          ? (fieldsOut.fields || []).map(f => Number(f?.id)).filter(id => Number.isFinite(id))
          : [];
        const allFieldMeta = fieldsOut.ok
          ? (fieldsOut.fields || []).map(f => ({ id: Number(f?.id), label: String(f?.label || '') })).filter(f => Number.isFinite(f.id))
          : [];

        const pendingIds = new Set(toFetch);
        const requestedIdSet = new Set(toFetch.map(id => normalizeCaseKey(id)).filter(Boolean));
        const foundIds = new Set();
        let hadSuccessfulQbQuery = false;
        try {
          for (const caseFieldId of caseFieldCandidates) {
            if (pendingIds.size === 0) break;
            const idsForThisPass = Array.from(pendingIds);
            const clauses = buildCaseExactClauses(caseFieldId, idsForThisPass);
            if (!clauses.length) continue;
            const whereClause = clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
            const body = { from: tableId, where: whereClause, options: { top: 100 } };
            if (allFieldIds.length) body.select = allFieldIds;

            const resp = await fetch('https://api.quickbase.com/v1/records/query', {
              method: 'POST',
              headers: { 'QB-Realm-Hostname': realm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!resp.ok) continue;
            hadSuccessfulQbQuery = true;

          const json       = await resp.json().catch(() => ({}));
          const rows       = Array.isArray(json.data)   ? json.data   : [];
          const fieldsMeta = Array.isArray(json.fields) ? json.fields : allFieldMeta;

            rows.forEach(row => {
              const rowCaseKeys = getRowCaseKeys(row, caseFieldCandidates);
              if (!rowCaseKeys.length) return;

            const { fieldValues, columnMap } = buildFieldMap(row, fieldsMeta);
            const rec = { fields: fieldValues, columnMap };

            // Match against requested IDs using normalized keys
            const matchedId = toFetch.find(id => rowCaseKeys.includes(normalizeCaseKey(id)));
            if (matchedId) {
              result[matchedId] = rec;
              foundIds.add(matchedId);
              pendingIds.delete(matchedId);
              writeCache(BATCH_CACHE, `${batchCachePrefix}:${matchedId}`, rec);
              return;
            }

            // Secondary guard: if QB row has a valid case key that is in the request set,
            // map it back directly (handles formatting edge-cases not preserved in toFetch).
            const directKey = rowCaseKeys.find(k => requestedIdSet.has(k));
            if (!directKey) return;
            result[directKey] = rec;
            foundIds.add(directKey);
            pendingIds.delete(directKey);
            writeCache(BATCH_CACHE, `${batchCachePrefix}:${directKey}`, rec);
          });

          }

          // Only mark as not found after at least one successful QB query.
          // If QB is temporarily failing, avoid poisoning cache with false misses.
          if (hadSuccessfulQbQuery) {
            toFetch.forEach(id => {
              if (!foundIds.has(id)) {
                notFound.push(id);
                BATCH_CACHE.set(`${batchCachePrefix}:${id}`, { at: Date.now(), value: null });
              }
            });
          } else {
            return sendJson(res, 200, { ok: true, records: result, notFound, transientError: 'qb_query_failed' });
          }
        } catch (err) {
          return sendJson(res, 200, { ok: true, records: result, notFound, transientError: String(err?.message || err) });
        }
      }

      return sendJson(res, 200, { ok: true, records: result, notFound });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE C — REPORT / LIST VIEW  (no recordId/recordIds param)
    // ══════════════════════════════════════════════════════════════════════════
    const reportResult = await runQBReport({ realm, token, tableId, reportId: qid, limit: 1000 });
    if (!reportResult.ok) return sendJson(res, 200, { ok: false, error: 'report_failed', message: reportResult.message });

    const { records, fields: reportFields } = reportResult;
    const columns = reportFields.map(f => ({ id: String(f.id), label: f.label }));
    const mapped  = records.map(row => {
      const out = {};
      reportFields.forEach(f => {
        const cell = row[String(f.id)];
        const raw  = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
        out[String(f.id)] = { value: normalizeQbValue(raw), label: f.label };
      });
      return out;
    });

    return sendJson(res, 200, { ok: true, columns, records: mapped, allAvailableFields: reportFields });

  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'internal', message: String(err?.message || err) });
  }
};
