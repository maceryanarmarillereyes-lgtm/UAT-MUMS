/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { sendJson, requireAuthedUser } = require('../tasks/_common');
const { queryQuickbaseRecords, listQuickbaseFields, normalizeQuickbaseCellValue } = require('../../lib/quickbase');
const { normalizeSettings } = require('../../lib/normalize_settings');

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

async function getQuickbaseReportMetadata({ config, qid }) {
  const cacheKey = [config.qb_realm, config.qb_table_id, qid].join('|');
  const cached = readCache(reportMetaCache, cacheKey, REPORT_META_CACHE_TTL_MS);
  if (cached) return cached;
  const cfg = {
    qb_token: config.qb_token,
    qb_realm: config.qb_realm,
    qb_table_id: config.qb_table_id
  };

  try {
    const url = `https://api.quickbase.com/v1/reports/${qid}?tableId=${config.qb_table_id}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'QB-Realm-Hostname': cfg.qb_realm,
        Authorization: `QB-USER-TOKEN ${cfg.qb_token}`,
        'Content-Type': 'application/json'
      }
    });

    const json = await response.json();
    if (!response.ok) return null;

    const columnFieldIds = (json.query?.fields || [])
      .map((f) => Number(f))
      .filter((id) => Number.isFinite(id));

    const payload = {
      fields: columnFieldIds,
      filter: json.query?.filter || '',
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
    const profileQuickbaseSettings = parseQuickbaseSettings(profile.quickbase_settings, auth.id);
    const profileQuickbaseConfigRaw = parseQuickbaseSettings(profile.quickbase_config, auth.id);
    const profileQuickbaseConfig = Object.keys(profileQuickbaseSettings).length
      ? profileQuickbaseSettings
      : profileQuickbaseConfigRaw;
    const profileToken = String(profile.qb_token || profile.quickbase_token || profile.quickbase_user_token || '').trim();
    const profileLink = String(profileQuickbaseConfig.reportLink || profileQuickbaseConfig.qb_report_link || profile.qb_report_link || profile.quickbase_url || profile.quickbase_report_link || '').trim();
    const profileRealm = String(profileQuickbaseConfig.realm || profileQuickbaseConfig.qb_realm || profile.qb_realm || profile.quickbase_realm || '').trim();
    const profileQid = String(profileQuickbaseConfig.qid || profileQuickbaseConfig.qb_qid || profile.qb_qid || profile.quickbase_qid || '').trim();
    const profileTableId = String(profileQuickbaseConfig.tableId || profileQuickbaseConfig.qb_table_id || profile.qb_table_id || profile.quickbase_table_id || '').trim();

    let qid = String(req?.query?.qid || req?.query?.qId || '').trim();
    let tableId = String(req?.query?.tableId || req?.query?.table_id || '').trim();
    let realm = String(req?.query?.realm || '').trim();

    if (!qid || !tableId || !realm) {
      qid = qid || profileQid;
      tableId = tableId || profileTableId;
      realm = realm || profileRealm;
    }

    if (!qid || !tableId || !realm) {
      return sendJson(res, 400, {
        ok: false,
        warning: 'quickbase_credentials_missing',
        message: 'Missing Quickbase configuration. Please configure your QID in My Quickbase Settings.'
      });
    }

    const userQuickbaseConfig = {
      qb_token: profileToken,
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

    const selectFields = hasPersonalQuickbaseQuery && reportMetadata?.fields?.length
      ? (mappedProfileColumns.length ? mappedProfileColumns.map((f) => f.id) : reportMetadata.fields)
      : selectedFields.map((f) => f.id);

    const searchableFieldIds = requestedSearchFieldIds.length ? requestedSearchFieldIds : selectFields;
    const searchClause = buildSearchClause(search, searchableFieldIds);

    const conditions = [];
    // 1. Report Filters
    if (hasPersonalQuickbaseQuery && reportMetadata?.filter) {
      conditions.push(String(reportMetadata.filter).trim());
    }
    // 2. Manual/Route Overrides
    if (typeof manualWhere !== 'undefined' && manualWhere) conditions.push(manualWhere);
    if (typeof routeWhere !== 'undefined' && routeWhere) conditions.push(routeWhere);
    // 3. Custom Counters / Profile Filters
    // GUARD: Skip profileFilterClauses when the client already sent an explicit ?where= param.
    // This prevents Tab 1's stored filters from contaminating Tab 2+ queries.
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
