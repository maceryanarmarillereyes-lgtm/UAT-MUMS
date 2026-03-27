const { serviceSelect, serviceUpsert } = require('../lib/supabase');
const { decryptText } = require('../lib/crypto');

const KB_SETTINGS_KEY = 'ss_kb_settings';
const KB_ITEMS_KEY    = 'ss_kb_items';
const QB_DBID_RE      = /\b[bt][a-z0-9]{8,14}\b/i;

function normalizeUrl(raw, realm) {
  const val = String(raw || '').trim();
  if (!val) return '';
  try { return new URL(val).toString(); } catch (_) {
    if (!realm) return '';
    try { return new URL(val.replace(/^\/+/, ''), `https://${realm}`).toString(); } catch (__) { return ''; }
  }
}
function firstDbid(input) {
  const m = String(input || '').match(QB_DBID_RE);
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
    const tableIdx = segs.findIndex(s => String(s).toLowerCase() === 'table');
    if (tableIdx >= 0 && segs[tableIdx + 1]) out.tableId = firstDbid(segs[tableIdx + 1]);
    const appIdx = segs.findIndex(s => String(s).toLowerCase() === 'app');
    if (appIdx >= 0 && segs[appIdx + 1]) out.appId = firstDbid(segs[appIdx + 1]);
    if (!out.tableId && out.appId) out.tableId = out.appId;
    const qidMatch = String(u.searchParams.get('qid') || '').match(/-?\d+/);
    if (qidMatch) out.qid = qidMatch[0];
  } catch (_) {}
  return out;
}
function pickFieldValue(record, fid) {
  const c = record && record[String(fid)];
  const v = c && typeof c === 'object' ? c.value : '';
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? (x.url || x.value || x.name || '') : String(x || ''))).filter(Boolean).join(' | ');
  if (typeof v === 'object') return String(v.url || v.value || v.name || v.text || '');
  return '';
}
function extractDownloadLinks(record, fields, realm) {
  const links = [];
  Object.entries(fields || {}).forEach(([fid, label]) => {
    const low = String(label || '').toLowerCase();
    if (!low.includes('link') && !low.includes('download') && !low.includes('file') && !low.includes('url')) return;
    const v = pickFieldValue(record, fid);
    if (!v) return;
    String(v).split('|').map(s => s.trim()).filter(Boolean).forEach(candidate => {
      const safe = normalizeUrl(candidate, realm);
      if (safe) links.push(safe);
    });
  });
  return Array.from(new Set(links));
}
async function readSettings() {
  const out = await serviceSelect('mums_documents', `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_SETTINGS_KEY)}&limit=1`);
  if (!out.ok) return { ok: false, settings: {} };
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const raw = row && row.value && typeof row.value === 'object' ? row.value : {};
  const parsed = parseQbUrl(raw.quickbaseAppUrl || '');
  return { ok: true, settings: { quickbaseAppUrl: String(raw.quickbaseAppUrl || '').trim(), quickbaseRealm: String(raw.quickbaseRealm || parsed.realm || '').trim(), quickbaseTableId: String(raw.quickbaseTableId || parsed.tableId || '').trim(), quickbaseAppId: String(raw.quickbaseAppId || parsed.appId || '').trim(), quickbaseQid: String(raw.quickbaseQid || parsed.qid || '').trim(), quickbaseUserToken: decryptText(raw.quickbaseUserToken || ''), syncSchedule: String(raw.syncSchedule || '').trim(), lastSyncedAt: raw.lastSyncedAt || null } };
}
async function readItems() {
  const out = await serviceSelect('mums_documents', `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_ITEMS_KEY)}&limit=1`);
  if (!out.ok) return { ok: false, items: [], tables: [] };
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const val = row && row.value ? row.value : {};
  return { ok: true, items: Array.isArray(val.items) ? val.items : [], tables: Array.isArray(val.tables) ? val.tables : [], syncedAt: val.syncedAt || (row && row.updated_at) || null };
}
async function writeItems(items, tables, actor) {
  return serviceUpsert('mums_documents', [{ key: KB_ITEMS_KEY, value: { items, tables, count: items.length, syncedAt: new Date().toISOString(), updatedByName: actor || null }, updated_at: new Date().toISOString(), updated_by_name: actor || null }], 'key');
}
function quickbaseHeaders(realm, token) {
  return { 'QB-Realm-Hostname': realm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' };
}
function scoreKnowledgeTable(table) {
  const txt = [table && table.name, table && table.description, table && table.alias].map(x => String(x || '').toLowerCase()).join(' ');
  if (!txt) return 0;
  let score = 0;
  if (txt.includes('knowledge')) score += 100;
  if (txt.includes('troubleshoot')) score += 80;
  if (txt.includes('work instruct')) score += 70;
  if (txt.includes('instruction')) score += 60;
  if (txt.includes('documentation')) score += 50;
  if (txt.includes('course')) score += 40;
  if (txt.includes('training')) score += 40;
  if (txt.includes('education')) score += 40;
  if (txt.includes('material')) score += 30;
  if (txt.includes('product')) score += 20;
  if (txt.includes('drawing')) score += 15;
  if (txt.includes('scope')) score += 15;
  if (txt.includes('faq')) score += 15;
  if (txt.includes('video')) score += 10;
  if (txt.includes('log') || txt.includes('audit') || txt.includes('error')) score -= 20;
  return score;
}
async function fetchAppTables({ realm, token, appId }) {
  if (!realm || !token || !appId) return [];
  try {
    const resp = await fetch(`https://api.quickbase.com/v1/tables?appId=${encodeURIComponent(appId)}`, { method: 'GET', headers: quickbaseHeaders(realm, token) });
    if (!resp.ok) return [];
    const json = await resp.json().catch(() => null);
    const tables = Array.isArray(json) ? json : Array.isArray(json && json.tables) ? json.tables : [];
    return tables;
  } catch (_) { return []; }
}
function selectKnowledgeTables(allTables, minScore) {
  const min = (minScore === undefined) ? 10 : minScore;
  return allTables.map(t => ({ ...t, _score: scoreKnowledgeTable(t) })).filter(t => t._score >= min).sort((a, b) => b._score - a._score);
}
async function fetchTableRecords({ tableId, qid, realm, token }, opts) {
  const sleepMs = (opts && opts.sleepMs) || 0;
  let skip = 0;
  const top = 250;
  const all = [];
  let fields = {};
  for (let page = 0; page < 120; page++) {
    const body = { from: tableId, options: { skip, top } };
    if (qid) body.queryId = qid;
    const resp = await fetch('https://api.quickbase.com/v1/records/query', { method: 'POST', headers: quickbaseHeaders(realm, token), body: JSON.stringify(body) });
    if (!resp.ok) break;
    const json = await resp.json().catch(() => ({}));
    if (json && json.fields) { (Array.isArray(json.fields) ? json.fields : []).forEach(f => { if (f && f.id != null) fields[String(f.id)] = String(f.label || f.name || ''); }); }
    const rows = Array.isArray(json && json.data) ? json.data : [];
    all.push(...rows);
    if (rows.length < top) break;
    skip += rows.length;
    if (sleepMs) await new Promise(r => setTimeout(r, sleepMs));
  }
  return { records: all, fields };
}
async function fetchAllQuickbaseRecords(settings, opts) {
  const { quickbaseTableId, quickbaseAppId, quickbaseAppUrl, quickbaseRealm: realm, quickbaseUserToken: token, quickbaseQid: qid } = settings || {};
  const parsedUrl = parseQbUrl(quickbaseAppUrl || '');
  let tableId = String(quickbaseTableId || parsedUrl.tableId || '').trim();
  const appId = String(quickbaseAppId || parsedUrl.appId || '').trim();
  if (!realm || !token) throw new Error('quickbase_config_missing');
  if (!tableId && appId) {
    const tables = await fetchAppTables({ realm, token, appId });
    const scored = selectKnowledgeTables(tables);
    tableId = scored[0] ? String(scored[0].id || scored[0].dbid || '').trim() : '';
  }
  if (!tableId) throw new Error('quickbase_table_missing');
  const { records, fields } = await fetchTableRecords({ tableId, qid, realm, token }, opts);
  return { records, fields, resolvedTableId: tableId };
}
function mapRecordToKbItem(record, fields, settings, tableId, tableName) {
  const id = pickFieldValue(record, 3) || `row-${Math.random().toString(36).slice(2, 9)}`;
  let title = pickFieldValue(record, 6) || pickFieldValue(record, 7);
  if (!title) {
    const nameKeys = Object.entries(fields).filter(([, lbl]) => /name|title|subject/i.test(lbl)).map(([fid]) => fid);
    for (const fid of nameKeys) { const v = pickFieldValue(record, fid); if (v) { title = v; break; } }
  }
  if (!title) title = `Record ${id}`;
  let type = pickFieldValue(record, 10);
  if (!type) { const typeKey = Object.entries(fields).find(([, lbl]) => /type|category/i.test(lbl)); if (typeKey) type = pickFieldValue(record, typeKey[0]); }
  if (!type) type = tableName || 'Knowledge Base';
  let relatedProduct = pickFieldValue(record, 9);
  let productFamily = pickFieldValue(record, 13) || pickFieldValue(record, 14);
  if (!relatedProduct) { const pk = Object.entries(fields).find(([, lbl]) => /product\s*name|related\s*product/i.test(lbl)); if (pk) relatedProduct = pickFieldValue(record, pk[0]); }
  if (!productFamily) { const fk = Object.entries(fields).find(([, lbl]) => /family|product\s*family/i.test(lbl)); if (fk) productFamily = pickFieldValue(record, fk[0]); }
  let docNumber = '';
  const numKey = Object.entries(fields).find(([, lbl]) => /\bnumber\b|\bcode\b|\bref\b|\bnum\b/i.test(lbl));
  if (numKey) docNumber = pickFieldValue(record, numKey[0]);
  const downloadUrls = extractDownloadLinks(record, fields, settings && settings.quickbaseRealm);
  let sourceLink = '';
  if (settings && settings.quickbaseRealm && tableId) {
    const recId = pickFieldValue(record, 3);
    if (recId && settings.quickbaseAppId) sourceLink = `https://${settings.quickbaseRealm}/nav/app/${settings.quickbaseAppId}/table/${tableId}/record/${recId}`;
  }
  if (!sourceLink && settings) sourceLink = settings.quickbaseAppUrl || '';
  return { id: `${tableId}-${String(id)}`, title, type, doc_number: docNumber, related_product: relatedProduct, product_family: productFamily, download_url: downloadUrls, source_link: sourceLink, table_id: tableId, table_name: tableName || '', created_at: pickFieldValue(record, 1) || null };
}
function dedupeById(items) {
  const m = new Map();
  (items || []).forEach(it => { if (it && it.id) m.set(String(it.id), it); });
  return Array.from(m.values());
}
async function runKnowledgeBaseSync({ actorName } = {}) {
  const settingsOut = await readSettings();
  if (!settingsOut.ok) throw new Error('settings_read_failed');
  const { quickbaseRealm: realm, quickbaseUserToken: token, quickbaseAppId, quickbaseAppUrl, quickbaseQid: qid } = settingsOut.settings;
  if (!realm || !token) throw new Error('quickbase_config_missing');
  const parsedUrl = parseQbUrl(quickbaseAppUrl || '');
  const appId = String(quickbaseAppId || parsedUrl.appId || '').trim();
  const allTables = appId ? await fetchAppTables({ realm, token, appId }) : [];
  let knowledgeTables = selectKnowledgeTables(allTables);
  if (!knowledgeTables.length) {
    let fallbackId = String(settingsOut.settings.quickbaseTableId || parsedUrl.tableId || '').trim();
    if (!fallbackId && appId) {
      const scored = allTables.map(t => ({ ...t, _score: scoreKnowledgeTable(t) })).sort((a, b) => b._score - a._score);
      fallbackId = scored[0] ? String(scored[0].id || scored[0].dbid || '').trim() : '';
    }
    if (fallbackId) knowledgeTables = [{ id: fallbackId, name: 'Knowledge Base', _score: 100 }];
  }
  if (!knowledgeTables.length) throw new Error('quickbase_table_missing');
  const allItems = [];
  const tablesMeta = [];
  for (const table of knowledgeTables) {
    const tableId = String(table.id || table.dbid || '').trim();
    const tableName = String(table.name || '').trim();
    if (!tableId) continue;
    try {
      const { records, fields } = await fetchTableRecords({ tableId, qid: '', realm, token }, { sleepMs: 80 });
      const items = records.map(r => mapRecordToKbItem(r, fields, settingsOut.settings, tableId, tableName));
      allItems.push(...items);
      tablesMeta.push({ id: tableId, name: tableName, score: table._score || 0, count: records.length });
    } catch (tableErr) {
      console.warn(`[quickbaseSync] Skipped table ${tableId} (${tableName}):`, String(tableErr && tableErr.message || tableErr));
    }
  }
  const deduped = dedupeById(allItems);
  const w = await writeItems(deduped, tablesMeta, actorName || 'system');
  if (!w.ok) throw new Error('kb_items_write_failed');
  return { ok: true, count: deduped.length, items: deduped, tables: tablesMeta, syncedAt: new Date().toISOString(), resolvedTableIds: tablesMeta.map(t => t.id) };
}
module.exports = { KB_SETTINGS_KEY, KB_ITEMS_KEY, parseQbUrl, normalizeUrl, readSettings, readItems, fetchAllQuickbaseRecords, mapRecordToKbItem, dedupeById, runKnowledgeBaseSync };
