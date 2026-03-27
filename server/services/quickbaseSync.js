const { serviceSelect, serviceUpsert } = require('../lib/supabase');
const { decryptText } = require('../lib/crypto');

const KB_SETTINGS_KEY = 'ss_kb_settings';
const KB_ITEMS_KEY = 'ss_kb_items';
const QB_DBID_RE = /\b[bt][a-z0-9]{8,14}\b/i;

function normalizeUrl(raw, realm) {
  const val = String(raw || '').trim();
  if (!val) return '';

  try {
    return new URL(val).toString();
  } catch (_) {
    if (!realm) return '';
    try {
      return new URL(val.replace(/^\/+/, ''), `https://${realm}`).toString();
    } catch (__) {
      return '';
    }
  }
}

function firstDbid(input) {
  const txt = String(input || '');
  const m = txt.match(QB_DBID_RE);
  return m ? String(m[0]).toLowerCase() : '';
}

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '', appId: '' };

  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '');
    const m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
    if (m) out.realm = `${m[1]}.quickbase.com`;

    const segs = u.pathname.split('/').filter(Boolean);

    const tableIdx = segs.findIndex((s) => String(s).toLowerCase() === 'table');
    if (tableIdx >= 0 && segs[tableIdx + 1]) {
      out.tableId = firstDbid(segs[tableIdx + 1]);
    }

    const appIdx = segs.findIndex((s) => String(s).toLowerCase() === 'app');
    if (appIdx >= 0 && segs[appIdx + 1]) {
      out.appId = firstDbid(segs[appIdx + 1]);
    }

    if (!out.tableId) {
      const dbPathId = firstDbid(segs.find((s) => String(s).toLowerCase() === 'db') ? segs[segs.findIndex((s) => String(s).toLowerCase() === 'db') + 1] : '');
      if (dbPathId) out.tableId = dbPathId;
    }

    // Common Quickbase nav links can only expose app dbid; fallback to app id.
    if (!out.tableId && out.appId) {
      out.tableId = out.appId;
    }

    const qidMatch = String(u.searchParams.get('qid') || '').match(/-?\d+/);
    if (qidMatch) out.qid = qidMatch[0];
  } catch (_) {
    // noop
  }

  return out;
}

function pickFieldValue(record, fid) {
  const c = record && record[String(fid)];
  const v = c && typeof c === 'object' ? c.value : '';
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' ? (x.url || x.value || x.name || '') : String(x || '')))
      .filter(Boolean)
      .join(' | ');
  }
  if (typeof v === 'object') return String(v.url || v.value || v.name || v.text || '');
  return '';
}

function extractDownloadLinks(record, fields, realm) {
  const links = [];
  Object.entries(fields || {}).forEach(([fid, label]) => {
    const low = String(label || '').toLowerCase();
    if (!low.includes('link') && !low.includes('download') && !low.includes('file')) return;
    const v = pickFieldValue(record, fid);
    if (!v) return;

    String(v)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((candidate) => {
        const safe = normalizeUrl(candidate, realm);
        if (safe) links.push(safe);
      });
  });

  return Array.from(new Set(links));
}

async function readSettings() {
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_SETTINGS_KEY)}&limit=1`
  );
  if (!out.ok) return { ok: false, settings: {} };

  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const raw = row && row.value && typeof row.value === 'object' ? row.value : {};
  const parsed = parseQbUrl(raw.quickbaseAppUrl || '');

  return {
    ok: true,
    settings: {
      quickbaseAppUrl: String(raw.quickbaseAppUrl || '').trim(),
      quickbaseRealm: String(raw.quickbaseRealm || parsed.realm || '').trim(),
      quickbaseTableId: String(raw.quickbaseTableId || parsed.tableId || '').trim(),
      quickbaseAppId: String(raw.quickbaseAppId || parsed.appId || '').trim(),
      quickbaseQid: String(raw.quickbaseQid || parsed.qid || '').trim(),
      quickbaseUserToken: decryptText(raw.quickbaseUserToken || ''),
      syncSchedule: String(raw.syncSchedule || '').trim(),
      lastSyncedAt: raw.lastSyncedAt || null
    }
  };
}

async function readItems() {
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_ITEMS_KEY)}&limit=1`
  );
  if (!out.ok) return { ok: false, items: [] };

  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  return {
    ok: true,
    items: Array.isArray(row && row.value && row.value.items) ? row.value.items : [],
    syncedAt: row && row.value ? row.value.syncedAt || row.updated_at : null
  };
}

async function writeItems(items, actor) {
  return serviceUpsert(
    'mums_documents',
    [{ key: KB_ITEMS_KEY, value: { items, count: items.length, syncedAt: new Date().toISOString(), updatedByName: actor || null }, updated_at: new Date().toISOString(), updated_by_name: actor || null }],
    'key'
  );
}

function quickbaseHeaders(realm, token) {
  return {
    'QB-Realm-Hostname': realm,
    Authorization: `QB-USER-TOKEN ${token}`,
    'Content-Type': 'application/json'
  };
}

function getTableIdFromMeta(table) {
  if (!table || typeof table !== 'object') return '';
  return String(table.id || table.dbid || table.tableId || '').trim();
}

function scoreKnowledgeTable(table) {
  const txt = [table && table.name, table && table.description, table && table.alias]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  if (!txt) return 0;

  let score = 0;
  if (txt.includes('knowledge')) score += 100;
  if (txt.includes('troubleshoot')) score += 50;
  if (txt.includes('documentation')) score += 50;
  if (txt.includes('course')) score += 40;
  if (txt.includes('training')) score += 40;
  if (txt.includes('material')) score += 30;
  if (txt.includes('product')) score += 20;
  return score;
}

async function resolveTableIdFromApp({ realm, token, appId }) {
  if (!realm || !token || !appId) return '';

  const resp = await fetch(`https://api.quickbase.com/v1/tables?appId=${encodeURIComponent(appId)}`, {
    method: 'GET',
    headers: quickbaseHeaders(realm, token)
  });
  if (!resp.ok) return '';

  const json = await resp.json().catch(() => null);
  const tables = Array.isArray(json) ? json : Array.isArray(json && json.tables) ? json.tables : [];
  if (!tables.length) return '';

  const sorted = [...tables]
    .map((t) => ({ ...t, _score: scoreKnowledgeTable(t) }))
    .sort((a, b) => b._score - a._score);

  return getTableIdFromMeta(sorted[0]);
}

async function queryQuickbasePage({ tableId, qid, realm, token, skip, top }) {
  const body = { from: tableId, options: { skip, top } };
  if (qid) body.queryId = qid;

  return fetch('https://api.quickbase.com/v1/records/query', {
    method: 'POST',
    headers: quickbaseHeaders(realm, token),
    body: JSON.stringify(body)
  });
}

async function fetchAllQuickbaseRecords(settings, opts = {}) {
  const {
    quickbaseTableId,
    quickbaseAppId,
    quickbaseAppUrl,
    quickbaseRealm: realm,
    quickbaseUserToken: token,
    quickbaseQid: qid
  } = settings || {};

  const parsedUrl = parseQbUrl(quickbaseAppUrl || '');
  let tableId = String(quickbaseTableId || parsedUrl.tableId || '').trim();
  const appId = String(quickbaseAppId || parsedUrl.appId || '').trim();

  if (!realm || !token) throw new Error('quickbase_config_missing');

  if (!tableId && appId) {
    tableId = await resolveTableIdFromApp({ realm, token, appId });
  }

  if (!tableId) throw new Error('quickbase_table_missing');

  let skip = 0;
  const top = 250;
  const all = [];
  let fields = {};
  let recoveredTable = false;

  for (let page = 0; page < 120; page += 1) {
    let resp = await queryQuickbasePage({ tableId, qid, realm, token, skip, top });

    // Recovery path: if table id is invalid (common when UI stores app URL), resolve from app and retry once.
    if (!resp.ok && !recoveredTable && appId) {
      const fallbackTableId = await resolveTableIdFromApp({ realm, token, appId });
      if (fallbackTableId && fallbackTableId !== tableId) {
        tableId = fallbackTableId;
        recoveredTable = true;
        resp = await queryQuickbasePage({ tableId, qid, realm, token, skip, top });
      }
    }

    if (!resp.ok) throw new Error(`quickbase_query_failed:${resp.status}`);

    const json = await resp.json();
    if (json && json.fields) fields = json.fields;

    const rows = Array.isArray(json && json.data) ? json.data : [];
    all.push(...rows);

    if (rows.length < top) break;

    skip += rows.length;
    if (opts.sleepMs) await new Promise((r) => setTimeout(r, opts.sleepMs));
  }

  return { records: all, fields, resolvedTableId: tableId };
}

function mapRecordToKbItem(record, fields, settings) {
  const id = pickFieldValue(record, 3) || `row-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id: String(id),
    title: pickFieldValue(record, 6) || pickFieldValue(record, 7) || `Record ${id}`,
    type: pickFieldValue(record, 10) || 'Knowledge Base',
    related_product: pickFieldValue(record, 9),
    product_family: pickFieldValue(record, 13) || pickFieldValue(record, 14),
    download_url: extractDownloadLinks(record, fields, settings.quickbaseRealm),
    source_link: settings.quickbaseAppUrl || '',
    created_at: pickFieldValue(record, 1) || null,
    raw_json: record
  };
}

function dedupeById(items) {
  const m = new Map();
  (items || []).forEach((it) => {
    if (it && it.id) m.set(String(it.id), it);
  });
  return Array.from(m.values());
}

async function runKnowledgeBaseSync({ actorName } = {}) {
  const settingsOut = await readSettings();
  if (!settingsOut.ok) throw new Error('settings_read_failed');

  const quickbase = await fetchAllQuickbaseRecords(settingsOut.settings, { sleepMs: 120 });
  const mapped = dedupeById(
    (quickbase.records || []).map((r) => mapRecordToKbItem(r, quickbase.fields || {}, settingsOut.settings))
  );

  const w = await writeItems(mapped, actorName || 'system');
  if (!w.ok) throw new Error('kb_items_write_failed');

  return {
    ok: true,
    count: mapped.length,
    items: mapped,
    syncedAt: new Date().toISOString(),
    resolvedTableId: quickbase.resolvedTableId || null
  };
}

module.exports = {
  KB_SETTINGS_KEY,
  KB_ITEMS_KEY,
  parseQbUrl,
  normalizeUrl,
  readSettings,
  readItems,
  fetchAllQuickbaseRecords,
  mapRecordToKbItem,
  dedupeById,
  runKnowledgeBaseSync
};
