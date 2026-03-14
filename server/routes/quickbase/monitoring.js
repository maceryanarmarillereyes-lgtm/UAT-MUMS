/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { sendJson, requireAuthedUser } = require('../tasks/_common');
const { queryQuickbaseRecords, listQuickbaseFields, normalizeQuickbaseCellValue } = require('../../lib/quickbase');
const { normalizeSettings } = require('../../lib/normalize_settings');
const { readGlobalQuickbaseSettings } = require('../../lib/global_quickbase');

const FIELDS_CACHE_TTL_MS = 60 * 1000;
const REPORT_META_CACHE_TTL_MS = 30 * 1000;
const fieldsCache = new Map();
const reportMetaCache = new Map();

function readCache(cache, key, ttlMs) {
  const hit = cache.get(key);
  if (!hit) return null;
  if ((Date.now() - hit.at) > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(cache, key, value) {
  cache.set(key, { at: Date.now(), value });
}

// ── BYPASS REPORT RUNNER ─────────────────────────────────────────────────────
// Uses the correct Quickbase API: POST /v1/reports/{reportId}/run
// This runs the report EXACTLY as configured in Quickbase — all built-in filters,
// columns, and sorting are applied server-side by Quickbase itself.
// This is the only reliable way to reproduce what you see in the QB web UI.
// The previous approach (/v1/reports/{id} GET + manual filter reconstruction) fails
// because Quickbase does not reliably expose filter formulas via the metadata API.
async function runQuickbaseReport({ realm, token, tableId, reportId, limit, extraWhere }) {
  const rawRealm = String(realm || '').trim();
  const normalizedRealm = (rawRealm && !rawRealm.includes('.'))
    ? `${rawRealm}.quickbase.com`
    : rawRealm;

  const top = Math.min(Number(limit) > 0 ? Number(limit) : 500, 1000);
  const cacheKey = `run:${normalizedRealm}:${tableId}:${reportId}:${top}:${extraWhere || ''}`;
  const cached = readCache(reportMetaCache, cacheKey, REPORT_META_CACHE_TTL_MS);
  if (cached) return cached;

  try {
    const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(reportId)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=${top}`;

    // Build run body — extraWhere lets us AND additional conditions (e.g. search)
    // on top of the report's own filters without overriding them.
    const body = {};
    if (extraWhere) body.where = extraWhere;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        Authorization: `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const rawText = await response.text();
    let json;
    try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }

    if (!response.ok) {
      console.error('[QB Report Run] failed:', response.status, json?.message || json);
      return { ok: false, status: response.status, message: json?.message || 'Report run failed' };
    }

    const records = Array.isArray(json.data) ? json.data : [];
    // fields array from run response tells us which field IDs are in the report
    const reportFields = Array.isArray(json.fields)
      ? json.fields.map(f => ({ id: Number(f.id), label: String(f.label || '') })).filter(f => Number.isFinite(f.id))
      : [];

    const result = { ok: true, records, fields: reportFields };
    writeCache(reportMetaCache, cacheKey, result);
    console.log(`[QB Report Run] ✅ reportId=${reportId} → ${records.length} records, ${reportFields.length} fields`);
    return result;
  } catch (err) {
    console.error('[QB Report Run] exception:', err?.message || err);
    return { ok: false, status: 500, message: String(err?.message || err) };
  }
}

async function getQuickbaseReportMetadata({ config, qid }) {
  // REALM FIX: Normalize realm to full QB hostname before API call.
  // profile stores realm as bare subdomain (e.g. "copeland-coldchainservices") but
  // QB-Realm-Hostname header requires the full hostname (e.g. "copeland-coldchainservices.quickbase.com").
  const rawRealm = String(config.qb_realm || '').trim();
  const normalizedRealm = (rawRealm && !rawRealm.includes('.'))
    ? `${rawRealm}.quickbase.com`
    : rawRealm;

  const cacheKey = [normalizedRealm, config.qb_table_id, qid].join('|');
  const cached = readCache(reportMetaCache, cacheKey, REPORT_META_CACHE_TTL_MS);
  if (cached) return cached;

  try {
    const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(qid)}?tableId=${encodeURIComponent(config.qb_table_id)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        Authorization: `QB-USER-TOKEN ${config.qb_token}`,
        'Content-Type': 'application/json'
      }
    });

    const json = await response.json();
    if (!response.ok) {
      console.error('[QB Report Meta] fetch failed:', response.status, json?.message || json);
      return null;
    }

    const columnFieldIds = (json.query?.fields || [])
      .map((f) => Number(f))
      .filter((id) => Number.isFinite(id));

    // FILTER FIX: Quickbase API returns the WHERE formula under different field names
    // depending on report type and API version. Check all known locations in priority order.
    const reportFilter = String(
      json.query?.filterFormula ||   // newer API versions
      json.query?.formula ||          // some report types
      json.query?.filter ||           // older API versions
      json.query?.queryString ||      // legacy
      ''
    ).trim();

    const payload = {
      fields: columnFieldIds,
      filter: reportFilter,
      sortBy: json.query?.sortBy || []
    };
    writeCache(reportMetaCache, cacheKey, payload);
    return payload;
  } catch (_) {
    return null;
  }
}

function encodeQuickbaseLiteral(value) {
  return String(value == null ? '' : value).replace(/'/g, "\\'");
}

function buildAnyEqualsClause(fieldId, values) {
  if (!Number.isFinite(fieldId)) return '';
  const safeValues = (Array.isArray(values) ? values : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (!safeValues.length) return '';
  if (safeValues.length === 1) {
    return `{${fieldId}.EX.'${encodeQuickbaseLiteral(safeValues[0])}'}`;
  }
  return `(${safeValues.map((v) => `{${fieldId}.EX.'${encodeQuickbaseLiteral(v)}'}`).join(' OR ')})`;
}

function parseCsvOrArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw.split(',').map((v) => String(v || '').trim()).filter(Boolean);
}


function parseSearchFieldIds(value) {
  const list = parseCsvOrArray(value)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return Array.from(new Set(list));
}

function buildSearchClause(searchTerm, fieldIds) {
  const term = String(searchTerm || '').trim();
  const ids = Array.isArray(fieldIds) ? fieldIds.filter((n) => Number.isFinite(n)) : [];
  if (!term || !ids.length) return '';
  const encoded = encodeQuickbaseLiteral(term);
  const clauses = ids.map((fid) => `{${fid}.CT.'${encoded}'}`);
  if (!clauses.length) return '';
  if (clauses.length === 1) return clauses[0];
  return `(${clauses.join(' OR ')})`;
}

function normalizeProfileColumns(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
}


function sortFieldsByProfileOrder(fields, profileColumnOrder) {
  if (!Array.isArray(fields) || !fields.length) return [];
  const order = Array.isArray(profileColumnOrder) ? profileColumnOrder.map((v) => Number(v)).filter((n) => Number.isFinite(n)) : [];
  if (!order.length) return fields;
  const orderIndex = new Map(order.map((fid, idx) => [String(fid), idx]));
  return fields
    .slice()
    .sort((a, b) => {
      const ai = orderIndex.has(String(a.id)) ? orderIndex.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(String(b.id)) ? orderIndex.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });
}
function buildProfileFilterClauses(rawFilters) {
  if (!Array.isArray(rawFilters)) return [];

  const VALID_OPS = ['EX', 'XEX', 'CT', 'XCT', 'SW', 'XSW', 'BF', 'AF', 'IR', 'XIR', 'TV', 'XTV', 'LT', 'LTE', 'GT', 'GTE'];
  const INCLUSION_OPS = new Set(['EX', 'CT', 'SW', 'BF', 'AF', 'LT', 'LTE', 'GT', 'GTE', 'IR', 'TV']);

  // INCLUSION operators: group same-field values → OR'd together (record matches any value)
  // EXCLUSION operators: each kept as its own individual AND clause
  //   (XEX OR XEX for same field is logically always-true → exclusions must never be OR-grouped)
  const inclusionByField = new Map();
  const exclusionClauses = [];

  rawFilters.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    const fieldId = Number(f.fieldId ?? f.field_id ?? f.fid ?? f.id);
    const value = String(f.value ?? '').trim();
    const opRaw = String(f.operator ?? 'EX').trim().toUpperCase();
    const operator = VALID_OPS.includes(opRaw) ? opRaw : 'EX';
    if (!Number.isFinite(fieldId) || !value) return;
    const clause = `{${fieldId}.${operator}.'${encodeQuickbaseLiteral(value)}'}`;
    if (INCLUSION_OPS.has(operator)) {
      if (!inclusionByField.has(fieldId)) inclusionByField.set(fieldId, []);
      inclusionByField.get(fieldId).push(clause);
    } else {
      exclusionClauses.push(clause);
    }
  });

  const result = [];
  // Each inclusion field-group becomes one OR'd clause
  inclusionByField.forEach((clauses) => {
    if (!clauses.length) return;
    result.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
  });
  // Each exclusion clause is its own item (AND'd individually by caller)
  exclusionClauses.forEach((c) => result.push(c));

  return result.filter(Boolean);
}

function normalizeFilterMatch(raw) {
  return String(raw || '').trim().toUpperCase() === 'ANY' ? 'ANY' : 'ALL';
}

function parseQuickbaseSettings(raw, userId) {
  const normalized = normalizeSettings(raw);
  if (raw && typeof raw !== 'object' && !Object.keys(normalized).length) {
    console.warn('normalizeSettings fallback', { userId, originalType: typeof raw });
  }
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? normalized : {};
}

module.exports = async (req, res) => {
  try {
    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const profile = auth?.profile || {};
    const actorRole = String(profile.role || 'MEMBER').toUpperCase().replace(/\s+/g, '_');
    const isSuperAdmin = actorRole === 'SUPER_ADMIN';

    // ── GLOBAL QB SETTINGS (single source of truth for report config + token) ──
    const globalQbOut = await readGlobalQuickbaseSettings();
    const globalQb = (globalQbOut.ok && globalQbOut.settings) ? globalQbOut.settings : {};
    const globalToken = String(globalQb.qbToken || '').trim();
    const globalRealm = String(globalQb.realm || '').trim();
    const globalTableId = String(globalQb.tableId || '').trim();
    const globalQid = String(globalQb.qid || '').trim();
    const globalReportLink = String(globalQb.reportLink || '').trim();

    // Per-user QB name — used for privacy filtering (Assigned To field = this name)
    const userQbName = String(profile.qb_name || '').trim();

    // For non-SUPER_ADMIN: if no qb_name set, return empty (no data leaks)
    if (!isSuperAdmin && !userQbName) {
      return sendJson(res, 200, {
        ok: true, columns: [], records: [], allAvailableFields: [],
        settings: { dynamicFilters: ['Assigned to', 'Case Status', 'Type'], sortBy: ['End User ASC', 'Type ASC'] },
        warning: 'qb_name_not_assigned',
        message: 'Your Quickbase name has not been assigned. Contact your administrator.'
      });
    }

    // Per-tab settings (for custom columns / filters) — report config comes from global
    const profileQuickbaseSettingsRaw = parseQuickbaseSettings(profile.quickbase_settings, auth.id);
    const profileQuickbaseConfigRaw = parseQuickbaseSettings(profile.quickbase_config, auth.id);

    // TAB-RESOLUTION FIX: When quickbase_settings has a tabs array, resolve the ACTIVE TAB's
    // settings for customColumns/customFilters. Using the full { activeTabIndex, tabs } object
    // as profileQuickbaseConfig means .customColumns/.customFilters are always undefined —
    // they live under tabs[N], not at the top level.
    let profileQuickbaseConfig;
    if (Array.isArray(profileQuickbaseSettingsRaw.tabs) && profileQuickbaseSettingsRaw.tabs.length) {
      const _activeIdx = Math.min(
        Math.max(Number(profileQuickbaseSettingsRaw.activeTabIndex || 0), 0),
        profileQuickbaseSettingsRaw.tabs.length - 1
      );
      // For bypassGlobal, prefer the tab whose bypassGlobal=true — it's the one making this request
      let _resolvedTab = profileQuickbaseSettingsRaw.tabs[_activeIdx] || {};
      const _bypassTabOverride = String(req?.query?.bypassGlobal || '').trim() === 'true';
      if (_bypassTabOverride) {
        // Find the first tab with bypassGlobal=true (the tab making this bypass request)
        const _bypassTab = profileQuickbaseSettingsRaw.tabs.find(t => !!(t && t.bypassGlobal));
        if (_bypassTab) _resolvedTab = _bypassTab;
      }
      profileQuickbaseConfig = _resolvedTab;
    } else if (Object.keys(profileQuickbaseSettingsRaw).length) {
      profileQuickbaseConfig = profileQuickbaseSettingsRaw;
    } else {
      profileQuickbaseConfig = profileQuickbaseConfigRaw;
    }

    // Token resolution:
    // - bypassGlobal=true → use profile.qb_token (personal token, any role)
    // - bypassGlobal=false (default) → use globalToken, fallback to SA profile token
    const profileToken = String(profile.qb_token || profile.quickbase_token || profile.quickbase_user_token || '').trim();
    const bypassGlobal = String(req?.query?.bypassGlobal || req?.query?.bypass_global || '').trim() === 'true';
    const activeToken = (bypassGlobal && profileToken)
      ? profileToken
      : (globalToken || (isSuperAdmin ? profileToken : ''));

    // Realm/tableId/qid: from request params first, then global settings, then profile (legacy fallback)
    let qid = String(req?.query?.qid || req?.query?.qId || '').trim();
    let tableId = String(req?.query?.tableId || req?.query?.table_id || '').trim();
    let realm = String(req?.query?.realm || '').trim();

    // Fall back to global settings
    qid = qid || globalQid || String(profileQuickbaseConfig.qid || profileQuickbaseConfig.qb_qid || profile.qb_qid || '').trim();
    tableId = tableId || globalTableId || String(profileQuickbaseConfig.tableId || profileQuickbaseConfig.qb_table_id || profile.qb_table_id || '').trim();
    realm = realm || globalRealm || String(profileQuickbaseConfig.realm || profileQuickbaseConfig.qb_realm || profile.qb_realm || '').trim();
    const profileLink = globalReportLink || String(profileQuickbaseConfig.reportLink || profileQuickbaseConfig.qb_report_link || profile.qb_report_link || '').trim();

    if (!qid || !tableId || !realm) {
      // When bypassGlobal=true: user's personal config is missing — prompt them to set it in tab settings
      const msg = bypassGlobal
        ? 'Personal Quickbase configuration not set. Configure Report Config in this tab\u2019s Settings.'
        : 'Missing Quickbase configuration. Please configure Global QB Settings in the admin panel.';
      return sendJson(res, 400, {
        ok: false,
        warning: bypassGlobal ? 'personal_qb_not_configured' : 'quickbase_credentials_missing',
        message: msg
      });
    }

    const userQuickbaseConfig = {
      qb_token: activeToken,
      qb_realm: realm,
      qb_table_id: tableId,
      qb_qid: qid,
      qb_report_link: profileLink
    };

    if (!userQuickbaseConfig.qb_token || (!userQuickbaseConfig.qb_realm && !userQuickbaseConfig.qb_report_link)) {
      return sendJson(res, 200, {
        ok: true,
        columns: [],
        records: [],
        allAvailableFields: [],
        settings: {
          dynamicFilters: ['Assigned to', 'Case Status', 'Type'],
          sortBy: ['End User ASC', 'Type ASC']
        },
        warning: 'quickbase_credentials_missing'
      });
    }

    const fieldCacheKey = [userQuickbaseConfig.qb_realm, userQuickbaseConfig.qb_table_id].join('|');
    let fieldMapOut = readCache(fieldsCache, fieldCacheKey, FIELDS_CACHE_TTL_MS);
    if (!fieldMapOut) {
      fieldMapOut = await listQuickbaseFields({ config: userQuickbaseConfig });
      if (fieldMapOut && fieldMapOut.ok) writeCache(fieldsCache, fieldCacheKey, fieldMapOut);
    }
    if (!fieldMapOut.ok) {
      return sendJson(res, fieldMapOut.status || 500, {
        ok: false,
        error: fieldMapOut.error || 'quickbase_fields_failed',
        message: fieldMapOut.message || 'Quickbase fields lookup failed'
      });
    }

    const allAvailableFields = (fieldMapOut.fields || [])
      .map((f) => ({ id: Number(f?.id), label: String(f?.label || '').trim() }))
      .filter((f) => Number.isFinite(f.id) && f.label)
      .sort((a, b) => a.label.localeCompare(b.label));

    const fieldsByLabel = Object.create(null);
    const fieldsByLowerLabel = Object.create(null);
    (fieldMapOut.fields || []).forEach((f) => {
      const label = String(f?.label || '').trim();
      const id = Number(f?.id);
      if (!label || !Number.isFinite(id)) return;
      fieldsByLabel[label] = id;
      fieldsByLowerLabel[label.toLowerCase()] = id;
    });

    const resolveFieldId = (label) => {
      if (fieldsByLabel[label]) return fieldsByLabel[label];
      return fieldsByLowerLabel[String(label || '').toLowerCase()] || null;
    };

    const wantedLabels = [
      'Case #',
      'End User',
      'Short Description or New "Concern" That Is Not in The KB',
      'Case Status',
      'Assigned to',
      'Last Update Days',
      'Age',
      'Type'
    ];

    const hasPersonalQuickbaseQuery = !!String(qid || '').trim();
    const profileCustomColumns = normalizeProfileColumns(profileQuickbaseConfig.customColumns || profileQuickbaseConfig.qb_custom_columns || profile.qb_custom_columns);
    const mappedProfileColumns = profileCustomColumns
      .map((id) => {
        const found = allAvailableFields.find((f) => Number(f.id) === Number(id));
        return found ? { id: Number(found.id), label: found.label } : null;
      })
      .filter(Boolean);

    const wantedFieldSelection = wantedLabels
      .map((label) => ({ label, id: resolveFieldId(label) }))
      .filter((x) => Number.isFinite(x.id));

    const selectedFields = mappedProfileColumns.length ? mappedProfileColumns : wantedFieldSelection;

    if (!hasPersonalQuickbaseQuery && !selectedFields.length) {
      return sendJson(res, 500, {
        ok: false,
        error: 'quickbase_fields_not_mapped',
        message: 'Unable to map required Quickbase fields by label.'
      });
    }

    const typeFieldId = resolveFieldId('Type');
    const endUserFieldId = resolveFieldId('End User');
    const statusFieldId = resolveFieldId('Case Status');
    const assignedToFieldId = resolveFieldId('Assigned to');

    const defaultSettings = {
      dynamicFilters: ['Assigned to', 'Case Status', 'Type'],
      sortBy: ['End User ASC', 'Type ASC']
    };

    const typeFilter = parseCsvOrArray(req?.query?.type);
    const endUserFilter = parseCsvOrArray(req?.query?.endUser);
    const assignedToFilter = parseCsvOrArray(req?.query?.assignedTo);
    const caseStatusFilter = parseCsvOrArray(req?.query?.caseStatus);
    const excludeStatus = parseCsvOrArray(req?.query?.excludeStatus);
    const search = String(req?.query?.search || '').trim();
    const requestedSearchFieldIds = parseSearchFieldIds(req?.query?.searchFields);

    const whereClauses = [];

    if (!hasPersonalQuickbaseQuery) {
      const typeClause = buildAnyEqualsClause(typeFieldId, typeFilter);
      if (typeClause) whereClauses.push(typeClause);

      const endUserClause = buildAnyEqualsClause(endUserFieldId, endUserFilter);
      if (endUserClause) whereClauses.push(endUserClause);

      const assignedToClause = buildAnyEqualsClause(assignedToFieldId, assignedToFilter);
      if (assignedToClause) whereClauses.push(assignedToClause);

      const caseStatusClause = buildAnyEqualsClause(statusFieldId, caseStatusFilter);
      if (caseStatusClause) whereClauses.push(caseStatusClause);

      excludeStatus.forEach((status) => {
        if (!Number.isFinite(statusFieldId) || !status) return;
        whereClauses.push(`{${statusFieldId}.XEX.'${encodeQuickbaseLiteral(status)}'}`);
      });
    }

    const profileFilterClauses = buildProfileFilterClauses(profileQuickbaseConfig.customFilters || profileQuickbaseConfig.qb_custom_filters || profile.qb_custom_filters);
    const profileFilterMatch = normalizeFilterMatch(profileQuickbaseConfig.filterMatch || profileQuickbaseConfig.qb_filter_match || profile.qb_filter_match || profile.qb_custom_filter_match);

    const routeWhere = String(req?.query?.where || '').trim();
    // FIX: Detect when client sends an explicit ?where= (tab-specific filters already built
    // by the corrected buildQuickbaseWhere on the frontend). When this flag is true, we must
    // NOT additionally inject profileFilterClauses — those always reflect Tab 1's profile
    // settings, and stacking them on Tab 2+ filters creates an impossible compound condition
    // resulting in 0 records for all tabs beyond Tab 1.
    const hasExplicitWhereParam = !!routeWhere;
    const manualWhere = whereClauses.length > 0 ? whereClauses.join(' AND ') : '';
    const routedWhere = [routeWhere, manualWhere].filter(Boolean).join(' AND ');
    const effectiveWhere = routedWhere || null;

    let reportMetadata = null;
    if (hasPersonalQuickbaseQuery) {
      reportMetadata = await getQuickbaseReportMetadata({ config: userQuickbaseConfig, qid });
    }

    // BYPASS NOTE: For bypass mode, reportMetadata.filter is the primary WHERE clause.
    // If reportMetadata failed (token wrong, realm error, etc.) log a warning and proceed
    // with empty conditions — the user will see all table records, which is still better
    // than a hard error. The console error from getQuickbaseReportMetadata tells them why.
    if (bypassGlobal && hasPersonalQuickbaseQuery && !reportMetadata) {
      console.warn('[QB Bypass] Could not fetch report metadata — proceeding without report filter. Check token and realm.');
    }

    const selectFields = hasPersonalQuickbaseQuery && reportMetadata?.fields?.length
      ? (mappedProfileColumns.length ? mappedProfileColumns.map((f) => f.id) : reportMetadata.fields)
      : selectedFields.map((f) => f.id);

    const searchableFieldIds = requestedSearchFieldIds.length ? requestedSearchFieldIds : selectFields;
    const searchClause = buildSearchClause(search, searchableFieldIds);

    const conditions = [];

    // PRIVACY FILTER — global mode only (bypass exits early above via runQuickbaseReport)
    if (!bypassGlobal && userQbName && Number.isFinite(assignedToFieldId)) {
      conditions.push(`{${assignedToFieldId}.EX.'${encodeQuickbaseLiteral(userQbName)}'}`);
    }

    // 1. Report Filters (from QB report metadata — global mode only)
    if (!bypassGlobal && hasPersonalQuickbaseQuery && reportMetadata?.filter) {
      conditions.push(String(reportMetadata.filter).trim());
    }
    // 2. Manual/Route Overrides
    if (typeof manualWhere !== 'undefined' && manualWhere) conditions.push(manualWhere);
    if (typeof routeWhere !== 'undefined' && routeWhere) conditions.push(routeWhere);
    // ── BYPASS MODE: Use /v1/reports/{reportId}/run — the ONLY reliable way ──────
    // to get exactly the same records as the Quickbase web UI shows.
    // The /v1/records/query approach fails because:
    //   1. Report's filter formula is NOT always in metadata response
    //   2. queryId in records/query is a DIFFERENT ID system from ?qid= in browser URL
    // runQuickbaseReport() calls POST /v1/reports/{id}/run?tableId=... which runs
    // the report server-side in Quickbase with ALL its built-in filters intact.
    if (bypassGlobal && qid) {
      // Build extraWhere only from search (report's own filters run on QB side)
      const bypassConditions = [];
      if (searchClause) bypassConditions.push(searchClause);
      const bypassExtraWhere = bypassConditions.filter(Boolean).join(' AND ') || undefined;

      const runOut = await runQuickbaseReport({
        realm,
        token: activeToken,
        tableId,
        reportId: qid,
        limit: Number(req?.query?.limit) || 500,
        extraWhere: bypassExtraWhere
      });

      if (!runOut.ok) {
        return sendJson(res, runOut.status || 500, {
          ok: false,
          error: 'bypass_report_run_failed',
          message: runOut.message || 'Failed to run Quickbase report. Check your Personal QB Token and Report URL.'
        });
      }

      // runOut.fields contains the report's column definitions (id + label)
      const runFields = Array.isArray(runOut.fields) && runOut.fields.length
        ? runOut.fields
        : allAvailableFields.slice(0, 10);

      // If user configured custom columns, apply ordering; otherwise use report's columns
      const bypassEffectiveFields = mappedProfileColumns.length
        ? mappedProfileColumns
        : runFields;

      const bypassCaseIdFieldId = resolveFieldId('Case #') || 3;
      const bypassFieldsMetaById = Object.create(null);
      (allAvailableFields || []).forEach((f) => {
        bypassFieldsMetaById[String(f.id)] = { id: Number(f.id), label: String(f.label) };
      });
      runFields.forEach((f) => {
        if (!bypassFieldsMetaById[String(f.id)]) bypassFieldsMetaById[String(f.id)] = f;
      });

      const bypassOrderedFields = sortFieldsByProfileOrder(bypassEffectiveFields, profileQuickbaseConfig.customColumns || profileQuickbaseConfig.qb_custom_columns || profile.qb_custom_columns);

      const bypassColumns = bypassOrderedFields
        .filter((f) => String(f.label || '').toLowerCase() !== 'case #' && Number(f.id) !== Number(bypassCaseIdFieldId))
        .map((f) => ({ id: String(f.id), label: String(f.label) }));

      const bypassRecords = (Array.isArray(runOut.records) ? runOut.records : []).map((row) => {
        const normalized = {};
        const fieldIds = bypassOrderedFields.length
          ? bypassOrderedFields.map((f) => String(f.id))
          : Object.keys(row || {}).filter(k => k !== 'recordId');

        fieldIds.forEach((fid) => {
          const fieldId = String(fid);
          const cell = row?.[fieldId];
          const rawVal = (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value'))
            ? cell.value : cell;
          normalized[fieldId] = { value: normalizeQuickbaseCellValue(rawVal) ?? '' };
        });

        const caseIdCell = row?.[String(bypassCaseIdFieldId)];
        const qbRecordId = (caseIdCell && typeof caseIdCell === 'object' ? caseIdCell.value : caseIdCell)
          || row?.recordId || 'N/A';

        return { qbRecordId: String(qbRecordId), fields: normalized };
      });

      return sendJson(res, 200, {
        ok: true,
        columns: bypassColumns,
        records: bypassRecords,
        allAvailableFields,
        settings: {
          ...defaultSettings,
          appliedWhere: bypassExtraWhere || null,
          bypassMode: true
        }
      });
    }

    // ── GLOBAL MODE (non-bypass): existing path unchanged ──────────────────────
    // 3. Custom Counters / Profile Filters
    if (!hasExplicitWhereParam && typeof profileFilterClauses !== 'undefined' && profileFilterClauses.length > 0) {
      const groupedProfileClause = profileFilterClauses.length === 1
        ? profileFilterClauses[0]
        : `(${profileFilterClauses.join(` ${profileFilterMatch === 'ANY' ? 'OR' : 'AND'} `)})`;
      if (groupedProfileClause) conditions.push(groupedProfileClause);
    }
    // 4. Search Bar Logic
    if (typeof searchClause !== 'undefined' && searchClause) {
      conditions.push(searchClause);
    }
    // 5. Clean Final Assembly
    const finalWhere = conditions.filter(Boolean).join(' AND ') || null;

    const out = await queryQuickbaseRecords({
      config: userQuickbaseConfig,
      where: finalWhere || undefined,
      limit: req?.query?.limit || 500,
      select: selectFields,
      allowEmptySelect: hasPersonalQuickbaseQuery && !reportMetadata,
      enableQueryIdFallback: !hasPersonalQuickbaseQuery,
      sortBy: reportMetadata?.sortBy || [
        { fieldId: endUserFieldId || resolveFieldId('Case #') || 3, order: 'ASC' },
        { fieldId: typeFieldId || resolveFieldId('Case #') || 3, order: 'ASC' }
      ]
    });

    if (!out.ok) {
      return sendJson(res, out.status || 500, {
        ok: false,
        error: out.error || 'quickbase_failed',
        message: out.message || 'Quickbase request failed'
      });
    }

    const caseIdFieldId = resolveFieldId('Case #') || 3;
    const fieldsMetaById = Object.create(null);
    (allAvailableFields || []).forEach((f) => {
      fieldsMetaById[String(f.id)] = { id: Number(f.id), label: String(f.label) };
    });

    const firstRecord = Array.isArray(out.records) && out.records.length ? out.records[0] : null;
    const dynamicFieldIds = hasPersonalQuickbaseQuery && firstRecord
      ? Object.keys(firstRecord)
          .map((fidRaw) => Number(fidRaw))
          .filter((fidNum) => Number.isFinite(fidNum))
          .map((fidNum) => String(fidNum))
      : [];

    const effectiveFields = hasPersonalQuickbaseQuery
      ? (mappedProfileColumns.length
          ? mappedProfileColumns
          : dynamicFieldIds.map((fid) => fieldsMetaById[fid]).filter(Boolean))
      : selectedFields
          .map((f) => fieldsMetaById[String(f.id)] || { id: Number(f.id), label: String(f.label || '').trim() })
          .filter((f) => Number.isFinite(f.id) && String(f.label || '').trim());

    const orderedEffectiveFields = sortFieldsByProfileOrder(effectiveFields, profileQuickbaseConfig.customColumns || profileQuickbaseConfig.qb_custom_columns || profile.qb_custom_columns);

    const columns = (Array.isArray(out.records) && out.records.length)
      ? orderedEffectiveFields
          .filter((f) => String(f.label).toLowerCase() !== 'case #' && Number(f.id) !== Number(caseIdFieldId))
          .map((f) => ({ id: String(f.id), label: String(f.label) }))
      : [];

    const mappedSource = Array.isArray(out.mappedRecords) && out.mappedRecords.length ? out.mappedRecords : [];

    const records = (Array.isArray(out.records) ? out.records : []).map((row, idx) => {
      const mappedRow = (mappedSource[idx] && typeof mappedSource[idx] === 'object') ? mappedSource[idx] : {};
      const normalized = {};
      const fieldList = hasPersonalQuickbaseQuery
        ? (orderedEffectiveFields.length ? orderedEffectiveFields.map((f) => String(f.id)) : dynamicFieldIds)
        : orderedEffectiveFields.map((f) => String(f.id));

      fieldList.forEach((fid) => {
        const fieldId = String(fid);
        const nestedField = row?.[fieldId];
        const nestedValue = nestedField && typeof nestedField === 'object' && Object.prototype.hasOwnProperty.call(nestedField, 'value')
          ? nestedField.value
          : nestedField;
        const mappedValue = Object.prototype.hasOwnProperty.call(mappedRow, fieldId) ? mappedRow[fieldId] : nestedValue;
        const normalizedValue = normalizeQuickbaseCellValue(mappedValue);
        normalized[fieldId] = { value: normalizedValue == null ? '' : normalizedValue };
      });

      const mappedRecordId = Object.prototype.hasOwnProperty.call(mappedRow, String(caseIdFieldId)) ? mappedRow[String(caseIdFieldId)] : '';
      const nestedRecordId = row?.[String(caseIdFieldId)]?.value || row?.[String(3)]?.value || '';

      return {
        qbRecordId: mappedRecordId || nestedRecordId || row?.recordId || 'N/A',
        fields: normalized
      };
    });

    return sendJson(res, 200, {
      ok: true,
      columns,
      records,
      allAvailableFields,
      settings: {
        ...defaultSettings,
        fieldIds: {
          type: typeFieldId || null,
          endUser: endUserFieldId || null,
          assignedTo: assignedToFieldId || null,
          caseStatus: statusFieldId || null
        },
        appliedWhere: finalWhere || null,
        appliedDynamicFilters: {
          assignedTo: assignedToFilter,
          caseStatus: caseStatusFilter,
          type: typeFilter,
          custom: profileFilterClauses,
          customMatch: profileFilterMatch,
          search,
          searchFieldIds: searchableFieldIds
        }
      }
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: 'quickbase_handler_failed',
      message: String(err?.message || err)
    });
  }
};
