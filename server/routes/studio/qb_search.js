/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// server/routes/studio/qb_search.js
// GET /api/studio/qb_search?q=term&skip=0&top=100
//
// Deep server-side search across ALL QB records (22,314+).
// Strategy: use QB /v1/records/query with CT clauses on TEXT fields only.
// CT (contains) only works on text-type fields in QB.
// Using text-only fields avoids QB API errors and gets maximum matches.
//
// FIX v2.1 — Three permanent fixes:
//   1. Default top raised to 10000 (was 100). Cap raised to 10000 (was 1000).
//      This allows searching across 22k+ records instead of being limited to 100.
//   2. Numeric-only search terms (e.g. '441056') now get an EX clause on field 3
//      (Record ID#) in addition to CT clauses on text fields. QB CT operator does
//      NOT work on numeric fields — so pure numeric searches returned 0 results.
//   3. allAvailableFields and columns are now returned in a format that allows
//      the frontend to build a full columnMap for the Case Detail modal.

const { getUserFromJwt } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');
const { normalizeQuickbaseCellValue } = require('../../lib/quickbase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// ── Fields cache ───────────────────────────────────────────────────
const FIELDS_CACHE = new Map();
const FIELDS_TTL   = 10 * 60 * 1000;
function cacheGet(k) { const h = FIELDS_CACHE.get(k); if (!h || Date.now() - h.at > FIELDS_TTL) { FIELDS_CACHE.delete(k); return null; } return h.v; }
function cacheSet(k, v) { FIELDS_CACHE.set(k, { at: Date.now(), v }); }

function normalizeRealm(r) {
  const s = String(r || '').trim();
  return (s && !s.includes('.')) ? `${s}.quickbase.com` : s;
}

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '' };
  if (!url) return out;
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
    if (m) out.realm = m[1];
    const segs = u.pathname.split('/').filter(Boolean);
    const ti = segs.indexOf('table');
    if (ti >= 0 && segs[ti + 1]) out.tableId = segs[ti + 1];
    if (!out.tableId) { const di = segs.indexOf('db'); if (di >= 0 && segs[di + 1]) out.tableId = segs[di + 1]; }
    const rawQid = u.searchParams.get('qid') || '';
    const qm = rawQid.match(/-?\d+/);
    if (qm) out.qid = qm[0];
    if (!out.qid) { const rm = url.match(/[?&]qid=(-?\d+)/i); if (rm) out.qid = rm[1]; }
  } catch (_) {}
  return out;
}

function encLit(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// QB text-compatible field types — CT operator works on these
const TEXT_FIELD_TYPES = new Set([
  'text', 'text-multi-line', 'text-multiple-choice', 'rich-text',
  'email', 'url', 'phone', 'text-formula', 'lookup',
  // numeric IDs that QB uses in field metadata
  1, 2, 3, 5, 6, 8, 13, 14, 29, 35, 36
]);

// ── Fetch all fields + their types ────────────────────────────────
async function getTextFields({ realm, token, tableId }) {
  const normRealm = normalizeRealm(realm);
  const cacheKey  = `${normRealm}:${tableId}:textfields`;
  const cached    = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}`,
      { method: 'GET', headers: { 'QB-Realm-Hostname': normRealm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' } }
    );
    if (!resp.ok) return { all: [], text: [] };
    const rawText = await resp.text();
    let arr; try { arr = rawText ? JSON.parse(rawText) : []; } catch (_) { arr = []; }
    if (!Array.isArray(arr)) arr = arr.fields || [];

    const all = arr
      .map(f => ({ id: Number(f.id), label: String(f.label || f.name || '').trim(), type: f.fieldType || f.type || '' }))
      .filter(f => Number.isFinite(f.id) && f.label);

    // Keep only text-compatible fields for search
    const text = all.filter(f => {
      const t = String(f.type || '').toLowerCase();
      return TEXT_FIELD_TYPES.has(t) || TEXT_FIELD_TYPES.has(Number(f.type)) ||
        t.includes('text') || t.includes('email') || t.includes('url') || t.includes('phone') || t.includes('rich');
    });

    cacheSet(cacheKey, { all, text });
    return { all, text };
  } catch (_) {
    return { all: [], text: [] };
  }
}

// ── QB records/query — searches the WHOLE TABLE, not just report rows ──
// This is the key: /v1/records/query searches ALL records regardless of report,
// limited only by our WHERE clause. This is how QB "Search this app" works.
async function queryAllRecords({ realm, token, tableId, where, select, skip, top }) {
  const normRealm = normalizeRealm(realm);
  // FIX v2.1: Raised cap from 1000 to 10000 so deep search can reach all 22k+ records.
  const safeTop = Math.min(Math.max(1, top || 10000), 10000);
  const body = {
    from: tableId,
    where: where || '',
    select: Array.isArray(select) && select.length ? select.slice(0, 30) : undefined,
    options: { skip: skip || 0, top: safeTop }
  };
  if (!body.select) delete body.select;

  try {
    const resp = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': normRealm,
        Authorization: `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const rawText = await resp.text();
    let json; try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }
    if (!resp.ok) {
      console.error('[studio/qb_search] QB query failed:', resp.status, json?.message || json?.description);
      return { ok: false, status: resp.status, message: json?.message || json?.description || 'QB query failed' };
    }
    return {
      ok: true,
      records: Array.isArray(json.data) ? json.data : [],
      fields:  Array.isArray(json.fields) ? json.fields : [],
      metadata: json.metadata || {},
      totalCount: json.metadata?.totalRecords ?? null,
    };
  } catch (err) {
    return { ok: false, status: 500, message: String(err?.message || err) };
  }
}

// ── Build CT WHERE clause — text fields only ──────────────────────
// Splits term into tokens; each token matched across ALL text fields.
// "Case 526768" → each word searched separately (maximizes matches).
//
// FIX v2.1: When term is purely numeric (e.g. '441056'), also add an
// EX clause on field 3 (Record ID#). QB CT does NOT work on numeric fields
// so a numeric-only search with CT returns 0 results — EX on field 3 fixes this.
function buildSearchWhere(term, textFieldIds) {
  if (!term) return '';

  // Use at most 20 text field IDs to avoid QB WHERE clause length limits
  const fids = textFieldIds.slice(0, 20);

  // Split search term into individual tokens for broader matching
  const tokens = term.trim().split(/\s+/).filter(t => t.length >= 2);

  // If multiple tokens, search for ANY token across ALL text fields
  const allTerms = tokens.length > 1 ? tokens : [term.trim()];

  const clauses = [];

  // Text CT clauses (only if we have text fields to search)
  if (fids.length) {
    const termClauses = allTerms.map(tok => {
      const enc = encLit(tok);
      const fieldClauses = fids.map(id => `{${id}.CT.'${enc}'}`);
      return fieldClauses.length === 1 ? fieldClauses[0] : `(${fieldClauses.join(' OR ')})`;
    });
    const textWhere = termClauses.length === 1 ? termClauses[0] : `(${termClauses.join(' OR ')})`;
    clauses.push(textWhere);
  }

  // FIX v2.1: For numeric tokens, add EX clause on field 3 (Record ID#)
  // This is the permanent fix for case# searches like '441056' returning no results.
  const numericTokens = allTerms.filter(t => /^\d+$/.test(t));
  if (numericTokens.length) {
    const numericClauses = numericTokens.map(t => `{3.EX.'${encLit(t)}'}`);
    const numericWhere = numericClauses.length === 1 ? numericClauses[0] : `(${numericClauses.join(' OR ')})`;
    clauses.push(numericWhere);
  }

  if (!clauses.length) return '';
  // Combine text CT and numeric EX with OR — any match qualifies
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

// ── Main handler ──────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const studioOut = await readStudioQbSettings(user.id);
    const s = (studioOut.ok && studioOut.settings) ? studioOut.settings : {};

    let realm   = String(s.realm   || '').trim();
    let tableId = String(s.tableId || '').trim();
    let qid     = String(s.qid     || '').trim();
    const token = String(s.qbToken || '').trim();
    const rl    = String(s.reportLink || '').trim();

    if (rl && (!realm || !tableId || !qid)) {
      const p = parseQbUrl(rl);
      if (!realm)   realm   = p.realm;
      if (!tableId) tableId = p.tableId;
      if (!qid)     qid     = p.qid;
    }

    if (!token || !realm || !tableId) {
      return sendJson(res, 200, {
        ok: true, columns: [], records: [], total: 0, allAvailableFields: [],
        warning: 'studio_qb_not_configured',
        message: 'Studio QB not configured. Go to General Settings → Studio Quickbase Settings.',
      });
    }

    const q    = String(req?.query?.q || req?.query?.search || '').trim();
    const skip = Math.max(0, Number(req?.query?.skip  || 0));
    // FIX v2.1: Default top raised to 10000, cap raised to 10000 (was 100/1000).
    const top  = Math.min(Math.max(1, Number(req?.query?.top || req?.query?.limit || 10000)), 10000);

    // ── Load all fields + identify text fields ─────────────────────
    const { all: allFields, text: textFields } = await getTextFields({ realm, token, tableId });

    // If no fields loaded, fall back to querying with empty where
    const textFieldIds = textFields.map(f => f.id);

    // ── Build search WHERE clause ──────────────────────────────────
    const where = q ? buildSearchWhere(q, textFieldIds) : '';

    // ── Select fields: use report fields (from QB report metadata) ──
    // For display: use the known text/key field IDs so we get useful data back
    // We'll use all text field IDs plus field 3 (Record ID#)
    const priorityLabels = [
      'Case #', 'Case Status', 'Short Description', 'Short Description or New',
      'Assigned to', 'Contact - Full Name', 'End User', 'Type', 'Latest Update',
      'Case Notes', 'Last Update Days', 'Age'
    ];
    const priorityIds = priorityLabels
      .map(label => allFields.find(f => f.label.toLowerCase().startsWith(label.toLowerCase()))?.id)
      .filter(Number.isFinite);

    const selectIds = priorityIds.length >= 3
      ? [...new Set([3, ...priorityIds])].slice(0, 20)
      : [...new Set([3, ...textFieldIds.slice(0, 18)])];

    // ── Execute QB query across ALL records ────────────────────────
    const out = await queryAllRecords({ realm, token, tableId, where, select: selectIds, skip, top });

    if (!out.ok) {
      return sendJson(res, out.status || 500, {
        ok: false, error: 'qb_search_failed',
        message: out.message,
        debug: { where: where.slice(0, 200), selectIds }
      });
    }

    // ── Build column definitions ───────────────────────────────────
    const fieldById = Object.fromEntries(allFields.map(f => [String(f.id), f]));
    const returnedFieldIds = out.fields.length
      ? out.fields.map(f => Number(f.id)).filter(Number.isFinite)
      : selectIds;

    const columns = returnedFieldIds
      .filter(id => id !== 3)
      .map(id => {
        const f = fieldById[String(id)] || out.fields.find(f => Number(f.id) === id);
        return { id: String(id), label: String(f?.label || f?.name || `Field ${id}`) };
      });

    // FIX v2.1: Build a columnMap object keyed by fid string → label.
    // This is returned alongside records so the frontend can populate
    // snap.columnMap for the Case Detail modal (which shows all dashes
    // when columnMap is empty {}). Every record now carries the full
    // field label mapping needed for the detail view.
    const columnMap = Object.fromEntries(
      returnedFieldIds.map(id => {
        const f = fieldById[String(id)] || out.fields.find(f => Number(f.id) === id);
        return [String(id), String(f?.label || f?.name || `Field ${id}`)];
      })
    );

    // ── Normalize records ──────────────────────────────────────────
    const records = out.records.map((row, rowIdx) => {
      const normalized = {};
      returnedFieldIds.forEach(id => {
        const fid  = String(id);
        const cell = row?.[fid];
        const raw  = (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value'))
          ? cell.value : cell;
        normalized[fid] = { value: normalizeQuickbaseCellValue(raw) ?? '' };
      });
      const caseCell = row?.['3'];
      const recordId = (caseCell && typeof caseCell === 'object' ? caseCell.value : caseCell)
        || row?.recordId || 'N/A';
      return {
        qbRecordId: String(recordId),
        fields: normalized,
        // FIX v2.1: Attach columnMap to every record so _snapFromRecord in
        // support_studio_patches.js can read it directly without a separate lookup.
        columnMap,
        rowNum: rowIdx + 1 + skip,
      };
    });

    return sendJson(res, 200, {
      ok: true,
      columns,
      columnMap,
      records,
      total:      out.totalCount,
      returned:   records.length,
      skip,
      top,
      searchTerm: q || null,
      fieldCount: textFieldIds.length,
      allAvailableFields: allFields,
    });

  } catch (err) {
    console.error('[studio/qb_search]', err);
    sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
