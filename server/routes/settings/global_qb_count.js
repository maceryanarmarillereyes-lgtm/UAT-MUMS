/**
 * @file global_qb_count.js
 * @description Global Qb Count module
 * @module MUMS/MUMS
 * @version UAT
 */
// server/routes/settings/global_qb_count.js
// GET /api/settings/global_qb_count?realm=&tableId=&qid=&where=
//
// Lightweight QB record COUNT for the Dashboard page counters.
// Uses Global QB Settings token (server-side) — never exposed to client.
//
// v2.0 FIX: Now applies the SAME filters as My Quickbase monitoring.js:
//   1. globalQb.filterConfig  — Super Admin-configured base filters (e.g. "Case Status ≠ Resolved")
//   2. Report filter formula  — from QID metadata (same report the My QB page uses)
//   3. Client WHERE clause    — the counter's user+field filter (user's QB Name + counter value)
//
// This makes Dashboard Counter numbers identical to what My Quickbase shows the same user.
//
// SECURITY:
//   - Auth required (any authenticated user can read QB counts)
//   - QB token NEVER sent to client (resolved server-side from global_quickbase settings)
//   - Only count is returned — no record data leaked
//
// ISOLATED: does not touch monitoring, realtime, My Quickbase, or any other feature.

const { getUserFromJwt }              = require('../../lib/supabase');
const { readGlobalQuickbaseSettings } = require('../../lib/global_quickbase');

// ── In-process cache for report filter metadata ──────────────────────────────
// Avoids a QB API call on every counter refresh (60-second refresh rate on dashboard).
const _reportFilterCache = new Map();
const REPORT_FILTER_TTL_MS = 5 * 60 * 1000; // 5 min

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.quickbase.com`;
}

function encodeQbLiteral(v) {
  return String(v == null ? '' : v).replace(/'/g, "\\'");
}

// ── [FIX-1] Build global base filter WHERE clause from filterConfig ──────────
// Mirrors buildProfileFilterClauses() logic from monitoring.js.
// Applied to ALL counter queries so they match My Quickbase scope.
function buildGlobalFilterClause(filterConfig) {
  if (!Array.isArray(filterConfig) || !filterConfig.length) return '';

  const VALID_OPS = ['EX','XEX','CT','XCT','SW','XSW','BF','AF','IR','XIR','TV','XTV','LT','LTE','GT','GTE'];
  const INCLUSION_OPS = new Set(['EX','CT','SW','BF','AF','LT','LTE','GT','GTE','IR','TV']);

  const inclusionByField = new Map();
  const exclusionClauses = [];

  filterConfig.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    const fieldId = Number(f.fieldId ?? f.field_id ?? f.fid ?? f.id);
    const value   = String(f.value ?? '').trim();
    const opRaw   = String(f.operator ?? 'EX').trim().toUpperCase();
    const op      = VALID_OPS.includes(opRaw) ? opRaw : 'EX';
    if (!Number.isFinite(fieldId) || !value) return;
    const clause = `{${fieldId}.${op}.'${encodeQbLiteral(value)}'}`;
    if (INCLUSION_OPS.has(op)) {
      if (!inclusionByField.has(fieldId)) inclusionByField.set(fieldId, []);
      inclusionByField.get(fieldId).push(clause);
    } else {
      exclusionClauses.push(clause);
    }
  });

  const parts = [];
  inclusionByField.forEach((clauses) => {
    parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
  });
  exclusionClauses.forEach((c) => parts.push(c));

  return parts.filter(Boolean).join(' AND ');
}

// ── [FIX-2] Fetch report filter formula from QB report metadata ──────────────
// Mirrors getQuickbaseReportMetadata() from monitoring.js.
// Returns the report's built-in filter string, or '' on failure.
// Result is cached per realm+tableId+qid for 5 minutes.
async function getReportFilterFormula({ realm, token, tableId, qid }) {
  const normalizedRealm = normalizeRealm(realm);
  if (!normalizedRealm || !tableId || !qid || !token) return '';

  const cacheKey = `${normalizedRealm}|${tableId}|${qid}`;
  const hit = _reportFilterCache.get(cacheKey);
  if (hit && (Date.now() - hit.at) < REPORT_FILTER_TTL_MS) return hit.filter;

  try {
    const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}?tableId=${encodeURIComponent(tableId)}`;
    const resp = await fetch(url, {
      method : 'GET',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        'Authorization'    : `QB-USER-TOKEN ${token}`,
        'Content-Type'     : 'application/json',
      },
    });

    if (!resp.ok) {
      console.warn(`[global_qb_count] report metadata fetch failed: ${resp.status} — proceeding without report filter`);
      // Cache empty to avoid hammering QB on every request
      _reportFilterCache.set(cacheKey, { at: Date.now(), filter: '' });
      return '';
    }

    const json = await resp.json().catch(() => ({}));

    // QB API returns filter under different keys depending on version and report type
    const reportFilter = String(
      json.query?.filterFormula ||
      json.query?.formula       ||
      json.query?.filter        ||
      json.query?.queryString   ||
      ''
    ).trim();

    _reportFilterCache.set(cacheKey, { at: Date.now(), filter: reportFilter });

    if (reportFilter) {
      console.log(`[global_qb_count] ✓ Report filter loaded for qid=${qid}: ${reportFilter.slice(0, 80)}${reportFilter.length > 80 ? '…' : ''}`);
    }
    return reportFilter;

  } catch (err) {
    console.warn('[global_qb_count] report metadata exception:', err && err.message || err);
    _reportFilterCache.set(cacheKey, { at: Date.now(), filter: '' });
    return '';
  }
}

// ── QB Records count (uses metadata.totalRecords — no rows returned) ─────────
async function countViaQbApi({ realm, token, tableId, where }) {
  const normalizedRealm = normalizeRealm(realm);
  if (!normalizedRealm || !tableId || !token) return null;

  try {
    const body = {
      from   : tableId,
      where  : where || undefined,
      options: { skip: 0, top: 0 },  // top=0 → QB returns metadata only (no row data)
    };

    const url  = `https://api.quickbase.com/v1/records/query`;
    const resp = await fetch(url, {
      method : 'POST',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        'Authorization'    : `QB-USER-TOKEN ${token}`,
        'Content-Type'     : 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt    = await resp.text().catch(() => '');
      const parsed = (() => { try { return JSON.parse(txt); } catch (_) { return {}; } })();
      console.error('[global_qb_count] QB API error', resp.status, parsed.message || txt.slice(0, 120));
      return null;
    }

    const json = await resp.json();

    // QB returns metadata.totalRecords for the full matching set
    if (json && json.metadata && typeof json.metadata.totalRecords === 'number') {
      return json.metadata.totalRecords;
    }
    // Fallback: count returned data rows (should not happen with top:0 but just in case)
    if (Array.isArray(json.data)) return json.data.length;
    return 0;

  } catch (err) {
    console.error('[global_qb_count] exception:', err && err.message || err);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    // ── Auth ─────────────────────────────────────────────────────────────────
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── Params from client ────────────────────────────────────────────────────
    const q       = req.query || {};
    const realm   = String(q.realm   || '').trim();
    const tableId = String(q.tableId || '').trim();
    const qid     = String(q.qid     || '').trim();
    const where   = String(q.where   || '').trim(); // counter's custom WHERE (user+field filter)

    // ── Global QB Settings (single source of truth) ───────────────────────────
    const globalOut = await readGlobalQuickbaseSettings();
    if (!globalOut.ok) return sendJson(res, 500, { ok: false, error: 'settings_read_failed' });

    const gs    = globalOut.settings || {};
    const token = String(gs.qbToken || '').trim();

    // Client may send realm/tableId (from qbSettings fetched by dashboard.js).
    // Fall back to global settings if not provided.
    const effectiveRealm   = realm   || String(gs.realm   || '').trim();
    const effectiveTableId = tableId || String(gs.tableId || '').trim();
    // QID: prefer client-sent (same as global), used for report filter lookup
    const effectiveQid     = qid     || String(gs.qid     || '').trim();

    if (!token) {
      return sendJson(res, 200, {
        ok: false, count: null,
        warning: 'global_qb_not_configured',
        message: 'Global QB token not set. Configure in Settings → Global Quickbase.',
      });
    }
    if (!effectiveRealm || !effectiveTableId) {
      return sendJson(res, 200, {
        ok: false, count: null,
        warning: 'missing_params',
        message: 'realm and tableId are required.',
      });
    }

    // ── [FIX-1] Build global base filter clause ───────────────────────────────
    // Same as monitoring.js — Super Admin-configured filters that apply to ALL queries.
    // Example: "Case Status Is Not C – Resolved"
    const globalFilterClause = buildGlobalFilterClause(gs.filterConfig || []);

    // ── [FIX-2] Load report filter from QB report metadata ────────────────────
    // Same report the My Quickbase page uses (via QID). This ensures dashboard
    // counts match what My QB shows. Fails gracefully if metadata not available.
    let reportFilterClause = '';
    if (effectiveQid) {
      reportFilterClause = await getReportFilterFormula({
        realm  : effectiveRealm,
        token,
        tableId: effectiveTableId,
        qid    : effectiveQid,
      });
    }

    // ── [FIX-3] Combine all filters (same order as monitoring.js) ─────────────
    // Order: report filter → global base filters → client counter WHERE
    // This produces exactly the same record scope as My Quickbase monitoring.
    const finalWhere = [reportFilterClause, globalFilterClause, where]
      .filter(Boolean)
      .join(' AND ') || undefined;

    if (finalWhere) {
      console.log(`[global_qb_count] finalWhere="${finalWhere.slice(0,120)}${finalWhere.length>120?'…':''}"`);
    }

    // ── Count ─────────────────────────────────────────────────────────────────
    const count = await countViaQbApi({
      realm  : effectiveRealm,
      token,
      tableId: effectiveTableId,
      where  : finalWhere,
    });

    return sendJson(res, 200, {
      ok   : count !== null,
      count: count,
      // Expose applied filter breakdown for debugging (never includes token)
      _debug: {
        hadGlobalFilters: !!globalFilterClause,
        hadReportFilter : !!reportFilterClause,
        hadCounterWhere : !!where,
      },
    });

  } catch (err) {
    console.error('[global_qb_count]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message || err) });
  }
};
