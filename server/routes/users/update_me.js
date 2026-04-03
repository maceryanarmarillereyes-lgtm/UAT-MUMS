/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { getUserFromJwt, getProfileForUserId, serviceUpdate, serviceSelect } = require('../../lib/supabase');
const { normalizeFilters } = require('../../lib/quickbase-utils');
const { escapeQuickbaseValue } = require('../../lib/escape');
const { ensureQuickbaseSettingsColumn } = require('../../startup/schema-check');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object' && !Array.isArray(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return reject(e); }
        }
      }
    } catch (_) {}

    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}


function normalizeQuickbaseOperator(value) {
  const key = String(value == null ? 'EX' : value).trim().toUpperCase();
  const mapped = {
    'IS EQUAL TO': 'EX',
    'IS (EXACT)': 'EX',
    EX: 'EX',
    '=': 'EX',
    'IS NOT': 'XEX',
    'NOT EQUAL TO': 'XEX',
    'IS NOT EQUAL TO': 'XEX',
    XEX: 'XEX',
    '!=': 'XEX',
    '<>': 'XEX',
    CONTAINS: 'CT',
    CT: 'CT',
    'DOES NOT CONTAIN': 'XCT',
    XCT: 'XCT'
  };
  return mapped[key] || key || 'EX';
}



function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => deepClone(item));
  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) cloned[key] = deepClone(obj[key]);
  }
  return cloned;
}

function parseQuickbaseConfigInput(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeQuickbaseConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const customColumns = Array.isArray(src.customColumns || src.qb_custom_columns)
    ? (src.customColumns || src.qb_custom_columns)
        .map((v) => String(v == null ? '' : v).trim())
        .filter(Boolean)
        .slice(0, 200)
    : [];
  const customFilters = Array.isArray(src.customFilters || src.qb_custom_filters)
    ? (src.customFilters || src.qb_custom_filters)
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          fieldId: String((f.fieldId ?? f.field_id ?? f.fid ?? f.id ?? '')).trim(),
          operator: normalizeQuickbaseOperator(f.operator),
          value: String((f.value ?? '')).trim()
        }))
        .filter((f) => f.fieldId && f.value)
        .slice(0, 200)
    : [];

  const filterMatchRaw = String(src.filterMatch || src.qb_filter_match || '').trim().toUpperCase();
  const filterMatch = filterMatchRaw === 'ANY' ? 'ANY' : 'ALL';

  let dashboardCounters = [];
  if (Array.isArray(src.dashboardCounters) || typeof src.dashboardCounters === 'string') {
    try {
      dashboardCounters = Array.isArray(src.dashboardCounters)
        ? src.dashboardCounters
        : JSON.parse(src.dashboardCounters || '[]');
    } catch (_) {
      dashboardCounters = [];
    }
  } else if (Array.isArray(src.dashboard_counters) || typeof src.dashboard_counters === 'string') {
    try {
      dashboardCounters = Array.isArray(src.dashboard_counters)
        ? src.dashboard_counters
        : JSON.parse(src.dashboard_counters || '[]');
    } catch (_) {
      dashboardCounters = [];
    }
  } else if (Array.isArray(src.qb_dashboard_counters) || typeof src.qb_dashboard_counters === 'string') {
    try {
      dashboardCounters = Array.isArray(src.qb_dashboard_counters)
        ? src.qb_dashboard_counters
        : JSON.parse(src.qb_dashboard_counters || '[]');
    } catch (_) {
      dashboardCounters = [];
    }
  }

  return {
    reportLink: String(src.reportLink || src.qb_report_link || '').trim(),
    qid: String(src.qid || src.qb_qid || '').trim(),
    realm: String(src.realm || src.qb_realm || '').trim().toLowerCase(),
    tableId: String(src.tableId || src.qb_table_id || '').trim(),
    // BYPASS FIX: preserve bypassGlobal flag — must survive server normalization round-trip
    bypassGlobal: !!(src.bypassGlobal || src.bypass_global || false),
    customColumns,
    customFilters,
    filterMatch,
    dashboardCounters,
    // VIRTUAL COLUMN: pass through as-is — validated at tab level in normalizeQuickbaseSettingsPayload
    virtualColumn: (src.virtualColumn && typeof src.virtualColumn === 'object' && !Array.isArray(src.virtualColumn))
      ? src.virtualColumn
      : undefined
  };
}


function parseQuickbaseIdentifiersFromLink(linkRaw) {
  const link = String(linkRaw || '').trim();
  if (!link) return { qid: '', tableId: '' };

  let qid = '';
  let tableId = '';
  try {
    const parsed = new URL(link);
    qid = String(parsed.searchParams.get('qid') || '').trim();
    if (!qid) {
      const reportMatch = String(parsed.pathname || '').match(/\/report\/(-?\d+)/i);
      if (reportMatch && reportMatch[1]) qid = String(reportMatch[1]).trim();
    }
  } catch (_) {}

  const dbMatch = link.match(/\/db\/([a-zA-Z0-9]+)/i);
  if (dbMatch && dbMatch[1]) tableId = String(dbMatch[1]).trim();
  if (!tableId) {
    const tableMatch = link.match(/\/table\/([a-zA-Z0-9]+)/i);
    if (tableMatch && tableMatch[1]) tableId = String(tableMatch[1]).trim();
  }

  return { qid, tableId };
}

function normalizeQuickbaseSettingsPayload(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hasTabs = Array.isArray(src.tabs);
  if (!hasTabs) return normalizeQuickbaseConfig(src);

  const tabs = src.tabs
    .filter((tab) => tab && typeof tab === 'object')
    .map((tab) => {
      const normalizedTab = normalizeQuickbaseConfig(tab);
      const parsed = parseQuickbaseIdentifiersFromLink(normalizedTab.reportLink);
      const reportLink = String(normalizedTab.reportLink || '').trim();
      const qid = String(normalizedTab.qid || parsed.qid || '').trim();
      const tableId = String(normalizedTab.tableId || parsed.tableId || '').trim();
      // BYPASS FIX: do NOT reject bypass tabs — they are allowed to have a reportLink
      // with partial qid/tableId if URL parsing fails. Non-bypass tabs still require both.
      const isBypassTab = !!(tab.bypassGlobal || normalizedTab.bypassGlobal || false);
      if (reportLink && !isBypassTab && (!qid || !tableId)) return null;

      // VIRTUAL COLUMN FIX: preserve virtualColumn through server normalization.
      // Previously this field was stripped entirely — causing wipe-on-save from server.
      const rawVc = tab.virtualColumn;
      const virtualColumn = (rawVc && typeof rawVc === 'object' && !Array.isArray(rawVc))
        ? {
            enabled: !!(rawVc.enabled || false),
            label: String(rawVc.label || 'Status').trim() || 'Status',
            items: Array.isArray(rawVc.items)
              ? rawVc.items.map((i) => String(i || '').trim()).filter(Boolean).slice(0, 100)
              : [],
            conditionalRules: Array.isArray(rawVc.conditionalRules)
              ? rawVc.conditionalRules
                  .filter((r) => r && typeof r === 'object' && r.value)
                  .map((r) => ({
                    value: String(r.value || '').trim(),
                    bgColor: String(r.bgColor || '').trim(),
                    textColor: String(r.textColor || '').trim(),
                    fontWeight: String(r.fontWeight || 'normal').trim(),
                    fontStyle: String(r.fontStyle || 'normal').trim(),
                    textDecoration: String(r.textDecoration || 'none').trim(),
                    fontSize: String(r.fontSize || '12px').trim(),
                    textAlign: String(r.textAlign || 'left').trim()
                  }))
                  .slice(0, 100)
              : []
          }
        : { enabled: false, label: 'Status', items: [], conditionalRules: [] };

      return {
        id: String(tab.id || '').trim(),
        tabName: String(tab.tabName || tab.name || '').trim() || 'Main Report',
        reportLink,
        qid,
        tableId,
        realm: String(normalizedTab.realm || '').trim(),
        // BYPASS FIX: always persist bypassGlobal so toggle state survives save/reload
        bypassGlobal: isBypassTab,
        customColumns: deepClone(normalizedTab.customColumns || []),
        customFilters: deepClone(normalizedTab.customFilters || []),
        filterMatch: normalizedTab.filterMatch,
        dashboard_counters: deepClone(normalizedTab.dashboardCounters || []),
        // VIRTUAL COLUMN: persisted through server — never stripped
        virtualColumn: deepClone(virtualColumn)
      };
    })
    .filter(Boolean)
    .slice(0, 25);

  const safeTabs = tabs.length ? tabs : [{
    id: '',
    tabName: 'Main Report',
    reportLink: '',
    qid: '',
    tableId: '',
    realm: '',
    bypassGlobal: false,
    customColumns: [],
    customFilters: [],
    filterMatch: 'ALL',
    dashboard_counters: []
  }];
  const maxIndex = safeTabs.length - 1;
  const activeTabIndex = Math.min(Math.max(Number(src.activeTabIndex || 0), 0), maxIndex);
  return {
    activeTabIndex,
    tabs: safeTabs
  };
}

function getLegacyQuickbaseConfigFromSettings(settings) {
  const normalizedSettings = settings && typeof settings === 'object' ? settings : {};
  if (!Array.isArray(normalizedSettings.tabs)) return normalizeQuickbaseConfig(normalizedSettings);
  const tabs = normalizedSettings.tabs;
  if (!tabs.length) return normalizeQuickbaseConfig({});
  const activeTabIndex = Math.min(Math.max(Number(normalizedSettings.activeTabIndex || 0), 0), tabs.length - 1);
  return normalizeQuickbaseConfig(tabs[activeTabIndex] || tabs[0]);
}

function toBool(v){
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === 'off') return false;
  return undefined;
}

function createServiceSupabaseAdapter() {
  return {
    from(tableName) {
      const mappedTable = tableName === 'profiles' ? 'mums_profiles' : tableName;
      return {
        update(updates) {
          return {
            async eq(column, value) {
              const mappedColumn = mappedTable === 'mums_profiles' && column === 'id' ? 'user_id' : column;
              const out = await serviceUpdate(mappedTable, updates || {}, { [mappedColumn]: `eq.${value}` });
              return {
                data: out && out.ok ? out.json : null,
                error: out && out.ok ? null : (out.json || out.text || { message: 'unknown_update_error' })
              };
            }
          };
        }
      };
    }
  };
}

// PATCH /api/users/update_me
// Updates the authenticated user's profile (server-side, service key).
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'PATCH' && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readBody(req);
    const { quickbase_settings } = body || {};
    req.user = req.user || { id: authed.id };
    const patch = {};

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = String(body.name || '').trim();
      if (name && name.length > 80) return sendJson(res, 400, { ok: false, error: 'invalid_name' });
      if (name) patch.name = name;
    }

    // Allow duty update (optional); UI may use it.
    if (Object.prototype.hasOwnProperty.call(body, 'duty')) {
      const duty = String(body.duty || '').trim();
      if (duty.length > 120) return sendJson(res, 400, { ok: false, error: 'invalid_duty' });
      patch.duty = duty;
    }

    // QB Name — SUPER_ADMIN only. Sets the "Assigned To" filter name for My Quickbase page.
    if (Object.prototype.hasOwnProperty.call(body, 'qb_name') || Object.prototype.hasOwnProperty.call(body, 'qbName')) {
      const profCheck = await getProfileForUserId(authed.id);
      const roleCheck = String((profCheck && profCheck.role) || '').trim().toUpperCase();
      if (roleCheck !== 'SUPER_ADMIN') return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only Super Admin can set QB Name.' });
      const qbNameVal = String(body.qb_name !== undefined ? body.qb_name : (body.qbName || '')).trim();
      if (qbNameVal.length > 120) return sendJson(res, 400, { ok: false, error: 'invalid_qb_name' });
      patch.qb_name = qbNameVal;
    }

    // Personal Quickbase config updates (save via server/service-role to avoid client RLS failures).
    if (Object.prototype.hasOwnProperty.call(body, 'qb_token')) {
      const qbToken = String(body.qb_token || '').trim();
      if (qbToken.length > 255) return sendJson(res, 400, { ok: false, error: 'invalid_qb_token' });
      patch.qb_token = qbToken;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'qb_report_link')) {
      const link = String(body.qb_report_link || '').trim();
      if (link.length > 2000) return sendJson(res, 400, { ok: false, error: 'invalid_qb_report_link' });
      patch.qb_report_link = link;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'qb_qid')) {
      const qid = String(body.qb_qid || '').trim();
      if (qid.length > 120) return sendJson(res, 400, { ok: false, error: 'invalid_qb_qid' });
      patch.qb_qid = qid;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'qb_realm')) {
      const realm = String(body.qb_realm || '').trim().toLowerCase();
      if (realm.length > 255) return sendJson(res, 400, { ok: false, error: 'invalid_qb_realm' });
      patch.qb_realm = realm;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'qb_table_id')) {
      const tableId = String(body.qb_table_id || '').trim();
      if (tableId.length > 80) return sendJson(res, 400, { ok: false, error: 'invalid_qb_table_id' });
      patch.qb_table_id = tableId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'qb_custom_columns')) {
      const cols = Array.isArray(body.qb_custom_columns) ? body.qb_custom_columns : [];
      const normalized = cols
        .map((v) => String(v == null ? '' : v).trim())
        .filter(Boolean)
        .slice(0, 200);
      patch.qb_custom_columns = normalized;
    }

    // === QUICKBASE SETTINGS PERSISTENCE FIX ===
    if (Object.prototype.hasOwnProperty.call(body, 'quickbase_settings')) {
      try {
        await ensureQuickbaseSettingsColumn();

        const rawSettings = body.quickbase_settings;
        let normalizedPayload;

        // Handle string input (double-serialized JSON)
        if (typeof rawSettings === 'string') {
          try {
            normalizedPayload = JSON.parse(rawSettings);
          } catch (parseErr) {
            console.error('[update_me] Failed to parse quickbase_settings string:', parseErr.message);
            return sendJson(res, 400, { ok: false, error: 'invalid_quickbase_settings_format' });
          }
        } else {
          normalizedPayload = rawSettings;
        }

        if (!normalizedPayload || typeof normalizedPayload !== 'object' || Array.isArray(normalizedPayload)) {
          return sendJson(res, 400, { ok: false, error: 'invalid_quickbase_settings_format' });
        }

        if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'filters')) {
          if (!Array.isArray(normalizedPayload.filters)) {
            return sendJson(res, 400, { error: 'invalid_payload', detail: 'quickbase_settings.filters must be an array' });
          }
          try {
            const normalizedFilters = normalizeFilters(normalizedPayload.filters)
              .map((filter) => ({
                ...filter,
                value: escapeQuickbaseValue(filter.value)
              }));
            normalizedPayload.filters = normalizedFilters;
            normalizedPayload.qb_custom_filters = normalizedFilters;
            console.info('[users.update] quickbase filter normalization applied', { count: normalizedFilters.length });
          } catch (err) {
            return sendJson(res, 400, { error: 'invalid_payload', detail: String(err && err.message ? err.message : err) });
          }
        }

        // Normalize the payload structure
        const finalPayload = normalizeQuickbaseSettingsPayload(normalizedPayload);

        // Deep clone to prevent reference issues
        patch.quickbase_settings = deepClone(finalPayload);

        // Also update legacy quickbase_config for backward compatibility
        const legacyConfig = getLegacyQuickbaseConfigFromSettings(finalPayload);
        patch.quickbase_config = deepClone(legacyConfig);

        // Update individual legacy columns for queries
        if (legacyConfig.reportLink) patch.qb_report_link = legacyConfig.reportLink;
        if (legacyConfig.qid) patch.qb_qid = legacyConfig.qid;
        if (legacyConfig.tableId) patch.qb_table_id = legacyConfig.tableId;
        if (legacyConfig.realm) patch.qb_realm = legacyConfig.realm;
        if (Array.isArray(legacyConfig.customColumns)) {
          patch.qb_custom_columns = JSON.stringify(legacyConfig.customColumns);
        }
        if (Array.isArray(legacyConfig.customFilters)) {
          patch.qb_custom_filters = JSON.stringify(legacyConfig.customFilters);
        }
        if (legacyConfig.filterMatch) patch.qb_filter_match = legacyConfig.filterMatch;
        if (Array.isArray(legacyConfig.dashboardCounters)) {
          patch.qb_dashboard_counters = JSON.stringify(legacyConfig.dashboardCounters);
        }

        console.log('[update_me] Saving quickbase_settings:', JSON.stringify(finalPayload).substring(0, 500));
      } catch (settingsErr) {
        console.error('[update_me] quickbase_settings processing error:', settingsErr);
        return sendJson(res, 500, { ok: false, error: 'quickbase_settings_save_failed', message: settingsErr.message });
      }
    }
    // === END QUICKBASE SETTINGS PERSISTENCE FIX ===

    if (Object.prototype.hasOwnProperty.call(body, 'quickbase_config')) {
      const normalizedConfig = normalizeQuickbaseConfig(parseQuickbaseConfigInput(body.quickbase_config));
      patch.quickbase_config = normalizedConfig;
      if (!Object.prototype.hasOwnProperty.call(body, 'quickbase_settings')) {
        patch.quickbase_settings = normalizedConfig;
      }

      // Keep legacy columns in sync for backward compatibility.
      patch.qb_report_link = normalizedConfig.reportLink;
      patch.qb_qid = normalizedConfig.qid;
      patch.qb_realm = normalizedConfig.realm;
      patch.qb_table_id = normalizedConfig.tableId;
      patch.qb_custom_columns = normalizedConfig.customColumns;
      patch.qb_custom_filters = normalizedConfig.customFilters;
      patch.qb_filter_match = normalizedConfig.filterMatch;
      patch.qb_dashboard_counters = normalizedConfig.dashboardCounters;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'qb_filter_match')) {
      const match = String(body.qb_filter_match || '').trim().toUpperCase();
      patch.qb_filter_match = match === 'ANY' ? 'ANY' : 'ALL';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'qb_custom_filters')) {
      const filters = Array.isArray(body.qb_custom_filters) ? body.qb_custom_filters : [];
      const normalized = filters
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          fieldId: String((f.fieldId ?? f.field_id ?? '')).trim(),
          operator: normalizeQuickbaseOperator(f.operator),
          value: String((f.value ?? '')).trim()
        }))
        .filter((f) => f.fieldId && f.value)
        .slice(0, 200);
      patch.qb_custom_filters = normalized;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'qb_dashboard_counters')) {
      const source = body.qb_dashboard_counters;
      if (Array.isArray(source)) {
        patch.qb_dashboard_counters = source;
      } else if (typeof source === 'string') {
        try {
          patch.qb_dashboard_counters = JSON.parse(source || '[]');
        } catch (_) {
          patch.qb_dashboard_counters = [];
        }
      } else {
        patch.qb_dashboard_counters = [];
      }
    }
    const prof = await getProfileForUserId(authed.id);
    if (!prof) return sendJson(res, 404, { ok: false, error: 'profile_missing', message: 'Profile not found. Call /api/users/me first.' });

    // SUPER_ADMIN + SUPER_USER team override
    // - team_override=false => team_id NULL (Developer Access)
    // - team_override=true  => team_id one of the configured shift buckets (morning/mid/night)
    const wantsTeam = (
      Object.prototype.hasOwnProperty.call(body, 'team_id') ||
      Object.prototype.hasOwnProperty.call(body, 'teamId') ||
      Object.prototype.hasOwnProperty.call(body, 'team_override') ||
      Object.prototype.hasOwnProperty.call(body, 'teamOverride')
    );

    if (wantsTeam) {
      const roleUpper = String(prof.role || '').trim().toUpperCase();
      const canChangeTeam = (roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER_USER');
      if (!canChangeTeam) return sendJson(res, 403, { ok: false, error: 'forbidden_team_change' });

      const allowed = new Set(['morning','mid','night']);
      const teamIn = (Object.prototype.hasOwnProperty.call(body, 'team_id') ? body.team_id : body.teamId);
      const overrideIn = (Object.prototype.hasOwnProperty.call(body, 'team_override') ? body.team_override : body.teamOverride);
      const overrideBool = toBool(overrideIn);

      let teamId = (teamIn === null || teamIn === undefined) ? '' : String(teamIn).trim();
      if (teamId === 'null') teamId = '';
      if (teamId && teamId.includes('@')) teamId = teamId.split('@')[0];

      // Determine desired state.
      let wantOverride;
      let wantTeam;

      if (overrideBool !== undefined) {
        wantOverride = overrideBool;
        if (!wantOverride) {
          wantTeam = null;
        } else {
          if (!teamId) return sendJson(res, 400, { ok: false, error: 'invalid_team', message: 'team_id required when team_override=true' });
          if (!allowed.has(teamId)) return sendJson(res, 400, { ok: false, error: 'invalid_team' });
          wantTeam = teamId;
        }
      } else {
        // If no explicit override flag is sent, infer it from team_id.
        if (!teamId) {
          wantOverride = false;
          wantTeam = null;
        } else {
          if (!allowed.has(teamId)) return sendJson(res, 400, { ok: false, error: 'invalid_team' });
          wantOverride = true;
          wantTeam = teamId;
        }
      }

      patch.team_override = !!wantOverride;
      patch.team_id = wantTeam;
    }

    if (!Object.keys(patch).length) return sendJson(res, 200, { ok: true, updated: false, profile: null });

    let out;
    const quickbaseSettingsFilters = getLegacyQuickbaseConfigFromSettings(patch.quickbase_settings || {});
    const filtersCount = Array.isArray(quickbaseSettingsFilters.customFilters)
      ? quickbaseSettingsFilters.customFilters.length
      : 0;

    const db = {
      async query() {
        // Detect column availability by selecting it directly from mums_profiles.
        // information_schema is commonly blocked in hosted PostgREST/RLS setups,
        // which caused false negatives and forced a quickbase_config fallback.
        const probeOut = await serviceSelect('mums_profiles', 'select=quickbase_settings&limit=1');
        return (probeOut && probeOut.ok)
          ? [{ column_name: 'quickbase_settings' }]
          : [];
      }
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'quickbase_settings')) {
      const hasQuickbaseSettingsColumn = await ensureQuickbaseSettingsColumn(db);
      if (!hasQuickbaseSettingsColumn) {
        console.warn('[users.update] quickbase_settings column missing; writing to quickbase_config fallback');
        patch.quickbase_config = patch.quickbase_settings;
        delete patch.quickbase_settings;
      }
    }

    const allowedFields = [
      'name',
      'duty',
      'qb_name',      // SUPER_ADMIN: Quickbase "Assigned To" display name
      'qb_token',
      'qb_report_link',
      'qb_qid',
      'qb_realm',
      'qb_table_id',
      'qb_custom_columns',
      'qb_custom_filters',
      'qb_filter_match',
      'qb_dashboard_counters',
      'quickbase_config',
      'quickbase_settings',
      'team_override',
      'team_id'
    ];
    const updates = allowedFields.reduce((acc, key) => {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) return acc;
      let value = patch[key];
      if (key === 'quickbase_settings') {
        if (typeof value === 'string') {
          try {
            value = value ? JSON.parse(value) : {};
          } catch (_) {
            value = {};
          }
        }
        value = (value && typeof value === 'object' && !Array.isArray(value))
          ? deepClone(value)
          : {};
      }
      acc[key] = value;
      return acc;
    }, {});

    const supabase = createServiceSupabaseAdapter();
    try {
      console.log('[Update Me Route] Received quickbase_settings:', quickbase_settings);
      out = await supabase.from('profiles').update(updates).eq('id', req.user.id);
      if (out && out.error) {
        console.error('Supabase Update Error:', out.error);
      }
    } catch (err) {
      console.error('[users.update] DB_WRITE_FAILED', err);
      return sendJson(res, 500, { error: 'update_failed', code: 'DB_WRITE_FAILED' });
    }

    // Backward-compatible fallback:
    // If environment DB is missing some legacy Quickbase columns, retry update
    // by removing only the missing keys so quickbase_settings can still persist.
    if (out && out.error) {
      const detailBlob = JSON.stringify(out.error || '').toLowerCase();
      const columnToPatchKey = {
        qb_custom_columns: 'qb_custom_columns',
        qb_custom_filters: 'qb_custom_filters',
        qb_dashboard_counters: 'qb_dashboard_counters',
        quickbase_config: 'quickbase_config',
        quickbase_settings: 'quickbase_settings'
      };
      const missingPatchKeys = Object.keys(columnToPatchKey)
        .filter((column) => detailBlob.includes(column))
        .map((column) => columnToPatchKey[column]);

      if (missingPatchKeys.length) {
        const retryPatch = { ...updates };
        missingPatchKeys.forEach((key) => { delete retryPatch[key]; });

        if (Object.keys(retryPatch).length > 0) {
          const retryOut = await supabase.from('profiles').update(retryPatch).eq('id', req.user.id);
          if (!retryOut.error) {
            const retainedSettings = Object.prototype.hasOwnProperty.call(retryPatch, 'quickbase_settings');
            return sendJson(res, 200, {
              ok: true,
              updated: true,
              patch: retryPatch,
              warning: 'quickbase_columns_or_config_missing_in_db',
              message: retainedSettings
                ? 'Saved Quickbase settings. Some legacy columns are missing; run latest migrations to restore full backward compatibility.'
                : 'Saved core Quickbase settings. Run latest migrations to enable full custom settings persistence.'
            });
          }
        }
      }
      console.error('[users.update] DB_WRITE_FAILED', out.error || 'unknown');
      return sendJson(res, 500, { error: 'update_failed', code: 'DB_WRITE_FAILED' });
    }
    console.info('[users.update] quickbase_settings saved', { userId: authed.id, filtersCount });
    return sendJson(res, 200, { ok: true, updated: true, patch });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'update_me_failed', message: String(err && err.message ? err.message : err) });
  }
};
