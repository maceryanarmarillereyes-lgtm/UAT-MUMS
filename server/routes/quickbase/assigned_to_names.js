// server/routes/quickbase/assigned_to_names.js
// GET /api/quickbase/assigned_to_names
// Returns unique "Assigned To" (#13) names from the global QB report.
// SUPER_ADMIN only. Used to populate the QB Name dropdown in User Management.
// This route uses the GLOBAL QB token + config — not the user's own settings.

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');
const { readGlobalQuickbaseSettings } = require('../../lib/global_quickbase');
const { queryQuickbaseRecords, listQuickbaseFields } = require('../../lib/quickbase');

const ASSIGNED_TO_FIELD_ID = 13; // Quickbase standard field
const NAMES_CACHE_KEY = 'mums_global_qb_assigned_to_names';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min in-memory

let _memCache = null;
let _memCacheAt = 0;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  return String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g, '_') === 'SUPER_ADMIN';
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const profile = await getProfileForUserId(user.id);
    if (!isSuperAdmin(profile)) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });

    // Return memory cache if fresh (with sanitization guard)
    if (_memCache && (Date.now() - _memCacheAt) < CACHE_TTL_MS) {
      const sanitizedCache = _memCache.filter(n => typeof n === 'string' && n.trim() && n !== '[object Object]');
      return sendJson(res, 200, { ok: true, names: sanitizedCache, cached: true });
    }

    // Load persisted names from mums_documents (always returned even if QB fetch fails)
    let persistedNames = [];
    try {
      const dbOut = await serviceSelect('mums_documents', `select=value&key=eq.${encodeURIComponent(NAMES_CACHE_KEY)}&limit=1`);
      if (dbOut.ok && Array.isArray(dbOut.json) && dbOut.json[0] && Array.isArray(dbOut.json[0].value)) {
        // Sanitize: only keep plain non-empty strings (guards against old [object Object] cache entries)
        persistedNames = dbOut.json[0].value
          .filter(n => typeof n === 'string' && n.trim() && n !== '[object Object]')
          .map(n => n.trim());
      }
    } catch (_) {}

    // Get global QB settings
    const globalOut = await readGlobalQuickbaseSettings();
    if (!globalOut.ok || !globalOut.settings || !globalOut.settings.qbToken || !globalOut.settings.realm || !globalOut.settings.tableId) {
      // Return persisted names if QB not configured
      return sendJson(res, 200, { ok: true, names: persistedNames, warning: 'global_qb_not_configured' });
    }

    const { qbToken, realm, tableId, qid } = globalOut.settings;

    // Fetch ALL records from QB (no user filter) using the assigned to field only
    // We use a high limit to get all assignee names across all cases
    const config = { qb_token: qbToken, qb_realm: realm, qb_table_id: tableId, qb_qid: qid };

    let fieldMapOut = null;
    try {
      fieldMapOut = await listQuickbaseFields({ config });
    } catch (_) {}

    // Find the actual Assigned To field ID (may differ from 13 if labels are different)
    let assignedToFid = ASSIGNED_TO_FIELD_ID;
    if (fieldMapOut && fieldMapOut.ok && Array.isArray(fieldMapOut.fields)) {
      const f = fieldMapOut.fields.find(x =>
        String(x.label || '').toLowerCase().includes('assigned to') ||
        Number(x.id) === ASSIGNED_TO_FIELD_ID
      );
      if (f) assignedToFid = Number(f.id);
    }

    // ── Build WHERE clause from global filterConfig ──────────────────────────
    // The global QB settings include filters like "Case Status Is Not C - Resolved".
    // These MUST be applied when fetching names so we only see ACTIVE-case assignees.
    // We mirror the buildProfileFilterClauses logic from monitoring.js (UNTOUCHABLE)
    // locally here — do NOT touch the untouchable file.
    const { filterConfig: globalFilters, filterMatch } = globalOut.settings;

    function encodeQbLiteral(s) {
      return String(s || '').replace(/'/g, "\'");
    }

    function buildGlobalWhereClause(filters, match) {
      if (!Array.isArray(filters) || !filters.length) return '';
      const VALID_OPS = ['EX','XEX','CT','XCT','SW','XSW','BF','AF','IR','XIR','TV','XTV','LT','LTE','GT','GTE','XNE'];
      const INCLUSION_OPS = new Set(['EX','CT','SW','BF','AF','LT','LTE','GT','GTE','IR','TV']);
      // Map human-readable operator aliases to QB codes (mirrors OPERATOR_ALIASES in quickbase-utils.js)
      const OP_ALIAS = {
        'Is Not': 'XEX', 'Not Equal To': 'XEX',
        'Is Equal To': 'EX', 'Is': 'EX', 'Is (Exact)': 'EX',
        'Contains': 'CT', 'Does Not Contain': 'XCT',
        'Is Not Empty': 'XNE', 'Starts With': 'SW',
        'Does Not Start With': 'XSW'
      };

      const inclusionByField = new Map();
      const exclusionClauses = [];

      filters.forEach(f => {
        if (!f || typeof f !== 'object') return;
        const fieldId = Number(f.fieldId ?? f.field_id ?? f.fid ?? f.id);
        if (!Number.isFinite(fieldId) || fieldId <= 0) return;
        const value = String(f.value ?? '').trim();
        if (!value) return;
        const opRaw = String(f.operator ?? 'EX').trim();
        // Resolve alias first, then uppercase and validate
        const opResolved = OP_ALIAS[opRaw] || opRaw.toUpperCase();
        const operator = VALID_OPS.includes(opResolved) ? opResolved : 'EX';
        const clause = `{${fieldId}.${operator}.'${encodeQbLiteral(value)}'}`;
        if (INCLUSION_OPS.has(operator)) {
          if (!inclusionByField.has(fieldId)) inclusionByField.set(fieldId, []);
          inclusionByField.get(fieldId).push(clause);
        } else {
          exclusionClauses.push(clause);
        }
      });

      const parts = [];
      inclusionByField.forEach(clauses => {
        if (!clauses.length) return;
        parts.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
      });
      exclusionClauses.forEach(c => parts.push(c));

      if (!parts.length) return '';
      const joiner = String(match || 'ALL').toUpperCase() === 'ANY' ? ' OR ' : ' AND ';
      return parts.length === 1 ? parts[0] : `(${parts.join(joiner)})`;
    }

    const globalWhereClause = buildGlobalWhereClause(globalFilters, filterMatch);
    if (globalWhereClause) {
      console.log('[assigned_to_names] Applying global filter WHERE:', globalWhereClause);
    } else {
      console.log('[assigned_to_names] No global filters configured — fetching all records');
    }

    // ── Paginated fetch: pull ALL records from QB regardless of total count ──
    // QB API hard-caps at 1000 per request. We loop with increasing skip until
    // a page returns fewer than PAGE_SIZE records (last page / exhausted).
    // Safety ceiling: MAX_PAGES × PAGE_SIZE = 50,000 records max.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50;
    const namesSet = new Set(persistedNames);
    let fetchError = null;

    // Resolve a QB User-type cell to a plain string.
    // Mirrors normalizeQuickbaseCellValue from quickbase.js — kept local so
    // we do NOT need to touch the UNTOUCHABLE lib.
    function resolveQbCell(raw) {
      if (raw == null) return '';
      if (typeof raw !== 'object') return String(raw).trim();
      for (const key of ['displayValue', 'display', 'text', 'name', 'fullName', 'label', 'email', 'value']) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
        const inner = raw[key];
        if (inner == null) continue;
        if (typeof inner === 'object') { const n = resolveQbCell(inner); if (n) return n; continue; }
        const s = String(inner).trim();
        if (s) return s;
      }
      return '';
    }

    for (let page = 0; page < MAX_PAGES; page++) {
      const skip = page * PAGE_SIZE;
      const reqBody = { from: tableId, select: [assignedToFid], options: { top: PAGE_SIZE, skip } };
      if (qid) reqBody.queryId = String(qid);
      // Apply global filter WHERE clause so only active-case assignees are returned
      if (globalWhereClause) reqBody.where = globalWhereClause;

      let pageJson = {};
      try {
        const pageRes = await fetch('https://api.quickbase.com/v1/records/query', {
          method: 'POST',
          headers: {
            'QB-Realm-Hostname': realm,
            Authorization: `QB-USER-TOKEN ${qbToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(reqBody)
        });
        const rawText = await pageRes.text();
        try { pageJson = rawText ? JSON.parse(rawText) : {}; } catch (_) { pageJson = {}; }
        if (!pageRes.ok) {
          console.error('[assigned_to_names] QB page failed — page:', page, 'status:', pageRes.status, pageJson.message || '');
          fetchError = { status: pageRes.status, message: pageJson.message || `QB query failed (${pageRes.status})` };
          break;
        }
      } catch (fetchErr) {
        console.error('[assigned_to_names] Network error on page:', page, fetchErr.message);
        fetchError = { message: fetchErr.message };
        break;
      }

      const pageRecords = Array.isArray(pageJson.data) ? pageJson.data : [];
      console.log(`[assigned_to_names] Page ${page + 1} — skip:${skip} — records:${pageRecords.length}`);

      pageRecords.forEach(row => {
        if (!row) return;
        const cell = row[String(assignedToFid)] || row[assignedToFid];
        const val = resolveQbCell(cell);
        if (val) namesSet.add(val);
      });

      // Last page reached when fewer records returned than requested
      if (pageRecords.length < PAGE_SIZE) break;
    }

    // If fetch errored before retrieving any new names, fall back to persisted
    if (fetchError && namesSet.size === persistedNames.length) {
      return sendJson(res, 200, { ok: true, names: persistedNames, warning: 'qb_fetch_failed', message: fetchError.message });
    }

    const sorted = Array.from(namesSet).filter(Boolean).sort((a, b) => a.localeCompare(b));

    // Persist to mums_documents so names survive even when cases are closed
    try {
      const nowIso = new Date().toISOString();
      await serviceUpsert('mums_documents', [{
        key: NAMES_CACHE_KEY,
        value: sorted,
        updated_at: nowIso,
        updated_by_user_id: user.id,
        updated_by_name: profile.name || profile.username,
        updated_by_client_id: null
      }], 'key');
    } catch (_) {}

    // Update memory cache
    _memCache = sorted;
    _memCacheAt = Date.now();

    return sendJson(res, 200, { ok: true, names: sorted });
  } catch (err) {
    console.error('[assigned_to_names]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err.message || err) });
  }
};
