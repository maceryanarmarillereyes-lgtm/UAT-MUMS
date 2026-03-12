/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  function encodeQuickbaseLiteral(value) {
    return String(value == null ? '' : value).replace(/'/g, "\\'");
  }

  function normalizeQuickbaseOperator(value) {
    const key = String(value == null ? 'EX' : value).trim().toUpperCase();
    const map = {
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
    return map[key] || key || 'EX';
  }

  function parseQuickbaseSettings(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }


  function hasOwnKeys(obj) {
    return !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;
  }

  function buildQuickbaseWhere(filters, matchMode) {
    if (!Array.isArray(filters) || !filters.length) return '';

    // INCLUSION operators: same-field values are OR'd together.
    //   e.g. Type=A + Type=B → (Type=A OR Type=B) [record matches any value]
    // EXCLUSION operators: each condition is kept as its own AND clause.
    //   e.g. Status!=Resolved + Status!=Bug → Status!=Resolved AND Status!=Bug
    //   Grouping XEX with OR is logically always-true (a record is always "not"
    //   at least one of N values) so exclusions must NEVER be OR-grouped.
    var INCLUSION_OPS = { EX: 1, CT: 1, SW: 1, BF: 1, AF: 1, LT: 1, LTE: 1, GT: 1, GTE: 1, IR: 1, TV: 1 };
    var isAny = String(matchMode || '').trim().toUpperCase() === 'ANY';

    // Group INCLUSION filters by fieldId
    var inclusionByField = new Map();
    // Keep EXCLUSION filters flat
    var exclusionClauses = [];

    filters
      .filter(function(f){ return f && typeof f === 'object'; })
      .forEach(function(f){
        var fid = String(f.fieldId != null ? f.fieldId : (f.field_id != null ? f.field_id : (f.fid != null ? f.fid : (f.id != null ? f.id : '')))).trim();
        var value = String(f.value != null ? f.value : '').trim();
        var operator = normalizeQuickbaseOperator(f.operator);
        if (!fid || !value) return;
        var clause = '{' + fid + '.' + operator + '.\'' + encodeQuickbaseLiteral(value) + '\'}';
        if (INCLUSION_OPS[operator]) {
          if (!inclusionByField.has(fid)) inclusionByField.set(fid, []);
          inclusionByField.get(fid).push(clause);
        } else {
          exclusionClauses.push(clause);
        }
      });

    // Build per-field inclusion clauses (OR within same field)
    var inclusionFieldClauses = [];
    inclusionByField.forEach(function(clauses) {
      if (!clauses.length) return;
      inclusionFieldClauses.push(clauses.length === 1 ? clauses[0] : '(' + clauses.join(' OR ') + ')');
    });

    var allParts = [];

    if (isAny) {
      // ANY mode: all inclusion field-groups joined with OR
      if (inclusionFieldClauses.length > 0) {
        allParts.push(inclusionFieldClauses.length === 1
          ? inclusionFieldClauses[0]
          : '(' + inclusionFieldClauses.join(' OR ') + ')');
      }
    } else {
      // ALL mode: each inclusion field-group AND'd with the next
      inclusionFieldClauses.forEach(function(c) { allParts.push(c); });
    }

    // Exclusion clauses always AND'd individually (regardless of matchMode)
    exclusionClauses.forEach(function(c) { allParts.push(c); });

    if (!allParts.length) return '';
    return allParts.join(' AND ');
  }

  function appendParam(params, key, value) {
    const clean = String(value == null ? '' : value).trim();
    if (!clean) return;
    params.set(key, clean);
  }

  function normalizeMonitoringLimit(rawLimit) {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed <= 0) return 100;
    return Math.min(100, Math.floor(parsed));
  }

  function getToken() {
    try {
      if (window.CloudAuth && typeof CloudAuth.accessToken === 'function') {
        const t = CloudAuth.accessToken();
        if (t) return String(t);
      }
    } catch (_) {}
    try {
      if (window.Store && typeof Store.getSession === 'function') {
        const s = Store.getSession();
        const t = s && (s.access_token || (s.session && s.session.access_token) || (s.data && s.data.session && s.data.session.access_token));
        if (t) return String(t);
      }
    } catch (_) {}
    try {
      const raw = window.localStorage && window.localStorage.getItem('mums_supabase_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        const t = parsed && (parsed.access_token || (parsed.session && parsed.session.access_token));
        if (t) return String(t);
      }
    } catch (_) {}
    return '';
  }


  function flattenFidFields(fields) {
    const src = fields && typeof fields === 'object' ? fields : {};
    const mapped = {};
    Object.keys(src).forEach(function(fid){
      if (!fid) return;
      const raw = src[fid];
      const value = (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value'))
        ? raw.value
        : raw;
      mapped[String(fid)] = value == null ? '' : value;
    });
    return mapped;
  }

  function toSafePayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const rows = Array.isArray(src.records)
      ? src.records
      : (Array.isArray(src.rows) ? src.rows : []);
    const columns = Array.isArray(src.columns) ? src.columns : [];
    const normalizedRows = rows.map(function(r){
      const normalizedFields = flattenFidFields(r && r.fields);
      const fallbackRecordId = normalizedFields['3'];
      const qbRecordId = String((r && r.qbRecordId) || fallbackRecordId || 'N/A');
      const fields = {};
      Object.keys(normalizedFields).forEach(function(fid){
        fields[fid] = { value: normalizedFields[fid] == null ? '' : normalizedFields[fid] };
      });
      return {
        qbRecordId: qbRecordId,
        fields: fields
      };
    });

    return {
      ok: !!src.ok,
      warning: String(src.warning || ''),
      columns: columns.map(function(c){
        return {
          id: String((c && c.id) || ''),
          label: String((c && c.label) || '')
        };
      }).filter(function(c){ return !!c.id; }),
      rows: normalizedRows,
      records: normalizedRows,
      allAvailableFields: Array.isArray(src.allAvailableFields) ? src.allAvailableFields : [],
      settings: (src.settings && typeof src.settings === 'object') ? src.settings : {}
    };
  }

  async function fetchMonitoringData(overrideParams) {
    const token = getToken();
    if (!token) {
      throw new Error('Quickbase auth token missing. Please login again.');
    }

    // Get user profile for QID settings
    let qid = '';
    let tableId = '';
    let realm = '';
    let profileQuickbaseConfig = null;

    if (overrideParams && typeof overrideParams === 'object') {
      qid = String(overrideParams.qid || '').trim();
      tableId = String(overrideParams.tableId || '').trim();
      realm = String(overrideParams.realm || '').trim();
    }

    // Fallback to stored profile if not provided
    if (!qid || !tableId || !realm) {
      try {
        const me = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
        if (me && window.Store && Store.getProfile) {
          const profile = Store.getProfile(me.id);
          if (profile) {
            profileQuickbaseConfig = parseQuickbaseSettings(profile.quickbase_settings);
            if (!profileQuickbaseConfig || !Object.keys(profileQuickbaseConfig).length) {
              profileQuickbaseConfig = parseQuickbaseSettings(profile.quickbase_config);
            }
            qid = qid || String((profileQuickbaseConfig && (profileQuickbaseConfig.qid || profileQuickbaseConfig.qb_qid)) || profile.qb_qid || profile.quickbase_qid || '').trim();
            tableId = tableId || String((profileQuickbaseConfig && (profileQuickbaseConfig.tableId || profileQuickbaseConfig.qb_table_id)) || profile.qb_table_id || profile.quickbase_table_id || '').trim();
            realm = realm || String((profileQuickbaseConfig && (profileQuickbaseConfig.realm || profileQuickbaseConfig.qb_realm)) || profile.qb_realm || profile.quickbase_realm || '').trim();
          }
        }
      } catch (_) {}
    }


    const normalizedSettings = parseQuickbaseSettings(profileQuickbaseConfig);
    const normalizedSearch = String((overrideParams && overrideParams.search) || '').trim();
    const hasCustomFilters = Array.isArray(overrideParams && overrideParams.customFilters) && (overrideParams.customFilters || []).length > 0;
    const shouldUseDefaultReport = !hasOwnKeys(normalizedSettings) && !normalizedSearch && !hasCustomFilters;

    // Validate required params
    if (!qid || !tableId || !realm) {
      const missingErr = new Error('Quickbase settings not configured. Please set your QID, Table ID, and Realm in My Quickbase Settings.');
      missingErr.code = 'quickbase_credentials_missing';
      throw missingErr;
    }

    const headers = {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token
    };

    // Construct URL with query parameters
    const queryParams = new URLSearchParams({
      qid: qid,
      tableId: tableId,
      realm: realm
    });

    const extraWhere = shouldUseDefaultReport ? '' : buildQuickbaseWhere(overrideParams && overrideParams.customFilters, overrideParams && overrideParams.filterMatch);
    appendParam(queryParams, 'where', (overrideParams && overrideParams.where) || extraWhere);
    appendParam(queryParams, 'search', normalizedSearch);
    appendParam(queryParams, 'searchFields', Array.isArray(overrideParams && overrideParams.searchFields)
      ? (overrideParams.searchFields || []).map(function(v){ return String(v || '').trim(); }).filter(Boolean).join(',')
      : '');
    appendParam(queryParams, 'limit', normalizeMonitoringLimit(overrideParams && overrideParams.limit));

    const candidates = [
      '/api/quickbase/monitoring?' + queryParams.toString(),
      '/functions/quickbase/monitoring?' + queryParams.toString()
    ];

    let lastErr = null;

    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
        const data = await res.json().catch(function(){ return {}; });

        if (!res.ok) {
          const message = data && data.message ? String(data.message) : ('Endpoint ' + url + ' failed with ' + res.status);
          lastErr = new Error(message);
          continue;
        }

        const safePayload = toSafePayload(data);

        if (safePayload.warning === 'quickbase_credentials_missing') {
          const missingCredsErr = new Error('Missing Quickbase Credentials: Token or Realm not found. Please verify your Profile Settings.');
          missingCredsErr.code = 'quickbase_credentials_missing';
          throw missingCredsErr;
        }

        try {
          console.info('[Enterprise DB] Quickbase Payload (QID: ' + qid + '):', safePayload.rows);
        } catch (_) {}

        return safePayload;
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('Quickbase endpoint unreachable');
  }

  window.QuickbaseAdapter = {
    fetchMonitoringData: fetchMonitoringData
  };
})();
