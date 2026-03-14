/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
function getEnv(name) {
  try {
    if (globalThis && globalThis.__MUMS_ENV && Object.prototype.hasOwnProperty.call(globalThis.__MUMS_ENV, name)) {
      const v = globalThis.__MUMS_ENV[name];
      return v == null ? '' : String(v);
    }
  } catch (_) {}
  try {
    if (typeof process !== 'undefined' && process.env && Object.prototype.hasOwnProperty.call(process.env, name)) {
      const v = process.env[name];
      return v == null ? '' : String(v);
    }
  } catch (_) {}
  return '';
}

function extractQuickbaseInfoFromLink(linkRaw) {
  const link = String(linkRaw || '').trim();
  if (!link) return { realm: '', tableId: '', queryId: '' };

  let realm = '';
  let tableId = '';
  let queryId = '';
  try {
    const parsed = new URL(link);
    realm = String(parsed.hostname || '').trim();
    queryId = String(parsed.searchParams.get('qid') || '').trim();

    if (!queryId) {
      const reportMatch = String(parsed.pathname || '').match(/\/report\/(-?\d+)/i);
      if (reportMatch && reportMatch[1]) queryId = String(reportMatch[1]).trim();
    }
  } catch (_) {}

  const dbMatch = link.match(/\/db\/([a-zA-Z0-9]+)/i);
  if (dbMatch && dbMatch[1]) {
    tableId = String(dbMatch[1]).trim();
  }

  if (!tableId) {
    const tableMatch = link.match(/\/table\/([a-zA-Z0-9]+)/i);
    if (tableMatch && tableMatch[1]) {
      tableId = String(tableMatch[1]).trim();
    }
  }

  if (!queryId) {
    const reportMatch = link.match(/\/report\/(-?\d+)/i);
    if (reportMatch && reportMatch[1]) queryId = String(reportMatch[1]).trim();
  }

  return { realm, tableId, queryId };
}

function normalizeRealmHostname(rawRealm, fallbackLink) {
  const direct = String(rawRealm || '').trim();
  const fallback = String(fallbackLink || '').trim();
  const candidate = direct || fallback;
  if (!candidate) return '';

  try {
    const hasScheme = /^https?:\/\//i.test(candidate);
    const parsed = new URL(hasScheme ? candidate : `https://${candidate}`);
    return String(parsed.hostname || '').trim().toLowerCase();
  } catch (_) {
    return String(candidate)
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*/, '')
      .trim()
      .toLowerCase();
  }
}

function queryIdVariants(rawQid, allowFallback) {
  const qid = String(rawQid || '').trim();
  if (!qid) return [''];
  
  // For QID-based queries, use ONLY the exact QID - no variants
  if (!allowFallback) {
    console.log('[Quickbase] Using exact QID (no variants):', qid);
    return [qid];
  }
  
  // Legacy fallback mode for non-QID queries
  const variants = [];
  variants.push(qid);
  
  if (/^-\d+$/.test(qid)) variants.push(qid.slice(1));
  variants.push('');
  
  console.log('[Quickbase] Using QID variants (legacy mode):', variants);
  return Array.from(new Set(variants));
}

function readQuickbaseConfig(override) {
  const envRealm = getEnv('QB_REALM') || getEnv('QUICKBASE_REALM');
  const envToken = getEnv('QB_USER_TOKEN') || getEnv('QUICKBASE_TOKEN');
  const envTableId = getEnv('QB_TABLE_ID') || getEnv('QUICKBASE_TABLE_ID');
  const envQid = getEnv('QB_QUERY_ID') || getEnv('QUICKBASE_QUERY_ID') || '-2021117';

  const o = override && typeof override === 'object' ? override : {};
  const fromLink = extractQuickbaseInfoFromLink(o.reportLink || o.qb_report_link || '');

  const realm = normalizeRealmHostname(
    o.realm || o.qb_realm || fromLink.realm || envRealm || '',
    o.reportLink || o.qb_report_link || ''
  );
  const token = String(o.token || o.qb_token || envToken || '').trim();
  const tableId = String(o.tableId || o.qb_table_id || fromLink.tableId || envTableId || '').trim();
  const qid = String(o.queryId || o.qb_qid || fromLink.queryId || envQid || '-2021117').trim() || '-2021117';

  return { realm, token, tableId, qid };
}

function normalizeQuickbaseCellValue(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return input;

  const objectValue = input;
  const displayKeys = [
    'displayValue',
    'display',
    'text',
    'name',
    'fullName',
    'label',
    'email',
    'value'
  ];

  for (const key of displayKeys) {
    if (!Object.prototype.hasOwnProperty.call(objectValue, key)) continue;
    const candidate = normalizeQuickbaseCellValue(objectValue[key]);
    if (candidate == null) continue;
    if (typeof candidate === 'string' && !candidate.trim()) continue;
    return candidate;
  }

  if (Array.isArray(objectValue)) {
    const flattened = objectValue
      .map((item) => normalizeQuickbaseCellValue(item))
      .filter((item) => !(item == null || (typeof item === 'string' && !item.trim())));
    return flattened.join(', ');
  }

  return '';
}

async function queryQuickbaseRecords(opts = {}) {
  const cfg = readQuickbaseConfig(opts.config);
  if (!cfg.realm || !cfg.token || !cfg.tableId) {
    return {
      ok: false,
      status: 500,
      error: 'quickbase_env_missing',
      message: 'Quickbase environment variables are missing.'
    };
  }

  const limit = Number(opts.limit);
  const select = Array.isArray(opts.select)
    ? Array.from(new Set(opts.select.map((id) => Number(id)).filter((id) => Number.isFinite(id))))
    : [];

  // Quickbase can return empty row payloads when no `select` fields are sent.
  // Keep a deterministic fallback to include the Case # fid unless caller opts into
  // dynamic report-defined fields (qid-aware queries).
  if (!select.length && !opts.allowEmptySelect) select.push(3);

  const baseBody = {
    from: cfg.tableId,
    select,
    options: {
      top: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100,
      skip: 0
    }
  };

  const whereClause = String(opts.where || '').trim();
  if (whereClause) {
    baseBody.where = whereClause;
    console.log('[Quickbase] Applying WHERE:', whereClause);
  } else {
    console.log('[Quickbase] No WHERE clause - using report/QID filters only');
  }
  if (Array.isArray(opts.sortBy) && opts.sortBy.length) {
    baseBody.sortBy = opts.sortBy
      .map((entry) => ({
        fieldId: Number(entry && entry.fieldId),
        order: String(entry && entry.order || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
      }))
      .filter((entry) => Number.isFinite(entry.fieldId));
  }

  const variants = queryIdVariants(cfg.qid, !!opts.enableQueryIdFallback);
  if (!variants.length) variants.push('');

  let records = [];
  let lastFailure = null;

  for (const qidVariant of variants) {
    const body = Object.assign({}, baseBody);
    if (qidVariant) body.queryId = qidVariant;

    console.log('[Quickbase] Trying QID variant:', qidVariant || '(base table)', {
      hasWhere: !!body.where,
      selectCount: body.select?.length || 0
    });

    const response = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': cfg.realm,
        Authorization: `QB-USER-TOKEN ${cfg.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const rawText = await response.text();
    let json;
    try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }

    if (!response.ok) {
      console.error('[Quickbase] Variant failed:', qidVariant, '- Status:', response.status);
      lastFailure = {
        ok: false,
        status: response.status || 502,
        error: 'quickbase_query_failed',
        message: json.message || `Quickbase query failed with status ${response.status}`
      };
      continue;
    }

    records = Array.isArray(json.data) ? json.data : [];
    console.log('[Quickbase] ✅ Variant success:', qidVariant || '(base)', '- Records:', records.length);
    if (records.length > 0 || qidVariant === variants[variants.length - 1]) {
      lastFailure = null;
      break;
    }
  }

  if (lastFailure) return lastFailure;

  const mappedRecords = records.map((record) => {
    const src = record && typeof record === 'object' ? record : {};
    const mapped = {};
    Object.keys(src).forEach((key) => {
      const fid = String(key || '');
      if (!fid) return;
      const raw = src[fid];
      const value = (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value'))
        ? raw.value
        : raw;
      const normalizedValue = normalizeQuickbaseCellValue(value);
      mapped[fid] = normalizedValue == null ? '' : normalizedValue;
    });
    return mapped;
  });

  return { ok: true, status: 200, records, mappedRecords };
}

async function listQuickbaseFields() {
  const cfg = readQuickbaseConfig(arguments[0] && arguments[0].config);
  if (!cfg.realm || !cfg.token || !cfg.tableId) {
    return {
      ok: false,
      status: 500,
      error: 'quickbase_env_missing',
      message: 'Quickbase environment variables are missing.'
    };
  }

  const url = `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(cfg.tableId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'QB-Realm-Hostname': cfg.realm,
      Authorization: `QB-USER-TOKEN ${cfg.token}`,
      'Content-Type': 'application/json'
    }
  });

  const rawText = await response.text();
  let json;
  try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status || 502,
      error: 'quickbase_fields_failed',
      message: json.message || `Quickbase fields lookup failed with status ${response.status}`
    };
  }

  const fields = Array.isArray(json) ? json : (Array.isArray(json.fields) ? json.fields : []);
  return { ok: true, status: 200, fields };
}

module.exports = {
  queryQuickbaseRecords,
  listQuickbaseFields,
  normalizeQuickbaseCellValue
};
