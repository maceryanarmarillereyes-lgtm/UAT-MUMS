// ─────────────────────────────────────────────────────────────────
//  quickbaseSync.js  — Knowledge Base sync service
//  FIXED v2:
//    FIX#2 - normalizeUrl: reject bare numbers/words, only accept
//            real URLs (https://) or QB relative paths (/xxx)
//    FIX#3 - mapRecordToKbItem: fully label-based field discovery,
//            no hardcoded field IDs 9/10/13/14
//    FIX#4 - pickFieldValue: handle QB file attachment versions[].url
//    FIX#4 - extractDownloadLinks: added "attach" keyword + strict URL
// ─────────────────────────────────────────────────────────────────
const { serviceSelect, serviceUpsert } = require('../lib/supabase');
const { decryptText } = require('../lib/crypto');

const KB_SETTINGS_KEY = 'ss_kb_settings';
const KB_ITEMS_KEY    = 'ss_kb_items';
const QB_DBID_RE      = /\b[bt][a-z0-9]{8,14}\b/i;

// ── FIX #2: normalizeUrl ──────────────────────────────────────────
// BEFORE: normalizeUrl("1", realm) → "https://realm/1"  ← WRONG
//         (new URL("1", base) is valid JS, produced garbage URLs)
// AFTER:  normalizeUrl("1", realm) → ""                 ← CORRECT
//         Only accepts: absolute https:// URLs or /path QB routes
function normalizeUrl(raw, realm) {
  const val = String(raw || '').trim();
  if (!val) return '';
  // Case 1: absolute URL — validate fully
  if (/^https?:\/\//i.test(val)) {
    try { return new URL(val).toString(); } catch (_) { return ''; }
  }
  // Case 2: QB relative path (must start /letter, e.g. /up/, /db/, /nav/)
  if (/^\/[a-zA-Z]/.test(val)) {
    if (!realm) return '';
    try { return new URL(val, `https://${realm}`).toString(); } catch (_) { return ''; }
  }
  // Anything else (bare number, word, partial fragment) → reject
  return '';
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

// ── FIX #4a: pickFieldValue ───────────────────────────────────────
// ADDED: QB file-attachment response shape handling
//   QB REST v1 file attachment: { value: { url: "...", versions: [{url,versionNumber}] } }
//   Before: fell through to `String(v.value || v.name || v.text || '')` → empty
//   After:  checks v.url first, then latest in versions[]
function pickFieldValue(record, fid) {
  const c = record && record[String(fid)];
  const v = c && typeof c === 'object' ? c.value : '';
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    return v.map(x => (x && typeof x === 'object' ? (x.url || x.value || x.name || '') : String(x || '')))
            .filter(Boolean).join(' | ');
  }
  if (typeof v === 'object') {
    // QB file attachment versions array — newest version is last element
    if (Array.isArray(v.versions) && v.versions.length) {
      for (let i = v.versions.length - 1; i >= 0; i--) {
        const ver = v.versions[i];
        if (ver && ver.url) return String(ver.url);
      }
    }
    // Direct URL property (QB URL fields, file attachments)
    if (v.url) return String(v.url);
    return String(v.value || v.name || v.text || '');
  }
  return '';
}

function extractUrlsFromText(input) {
  const txt = String(input || '').trim();
  if (!txt) return [];
  const out = [];

  // HTML anchor href (formula URL/rich text fields)
  const hrefRe = /href\s*=\s*["']([^"']+)["']/ig;
  let m;
  while ((m = hrefRe.exec(txt))) out.push(m[1]);
  // Unquoted href support: href=/up/... (seen in some QB-rendered formula fields)
  const hrefBareRe = /href\s*=\s*([^"'\s>]+)/ig;
  while ((m = hrefBareRe.exec(txt))) out.push(m[1]);

  // Plain absolute URLs
  const absRe = /\bhttps?:\/\/[^\s"'<>]+/ig;
  while ((m = absRe.exec(txt))) out.push(m[0]);

  // Common Quickbase relative paths seen in formula links
  const relRe = /\/(?:up|db|nav|files)\/[^\s"'<>]+/ig;
  while ((m = relRe.exec(txt))) out.push(m[0]);

  return out;
}

function extractUrlsFromCell(record, fid) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const s = String(u || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const cell = record && record[String(fid)];
  const value = cell && typeof cell === 'object' ? cell.value : cell;
  if (value == null) return out;

  if (typeof value === 'string' || typeof value === 'number') {
    const str = String(value);
    push(str);
    extractUrlsFromText(str).forEach(push);
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        push(entry.url || entry.href || entry.link || entry.value || entry.name || entry.text || '');
        if (entry.url) extractUrlsFromText(entry.url).forEach(push);
        if (entry.href) extractUrlsFromText(entry.href).forEach(push);
      } else {
        const str = String(entry || '');
        push(str);
        extractUrlsFromText(str).forEach(push);
      }
    });
    return out;
  }

  if (typeof value === 'object') {
    // Known QB attachment/formula-url object shapes
    push(value.url || value.href || value.link || value.value || value.name || value.text || '');
    if (Array.isArray(value.versions)) {
      value.versions.forEach((ver) => {
        if (!ver || typeof ver !== 'object') return;
        push(ver.url || ver.href || ver.link || '');
      });
    }
    // Last-chance scan of shallow string values
    Object.values(value).forEach((v) => {
      if (typeof v === 'string') {
        push(v);
        extractUrlsFromText(v).forEach(push);
      }
    });
    return out;
  }

  const fallback = String(value || '');
  push(fallback);
  extractUrlsFromText(fallback).forEach(push);
  return out;
}

// ── FIX #4b: extractDownloadLinks ────────────────────────────────
// ADDED: 'attach' keyword to catch QB "File Attachment" typed fields
// ADDED: strict URL validation — only keep fully formed absolute URLs
function extractDownloadLinks(record, fields, realm) {
  const preferred = [];
  const fallback = [];
  const seen = new Set();

  const pushUnique = (bucket, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    bucket.push(url);
  };

  Object.entries(fields || {}).forEach(([fid, label]) => {
    const low = String(label || '').toLowerCase();
    const isLinkField = low.includes('link') || low.includes('download');
    const isAttachmentField = low.includes('file') || low.includes('url') || low.includes('attach');
    if (!isLinkField && !isAttachmentField) return;

    const candidates = new Set();
    extractUrlsFromCell(record, fid).forEach(v => candidates.add(v));
    const raw = pickFieldValue(record, fid);
    if (raw) {
      // Split on pipe separator (QB can store multiple file URLs)
      String(raw).split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean).forEach(v => candidates.add(v));
      extractUrlsFromText(raw).forEach(v => candidates.add(v));
    }

    Array.from(candidates).forEach(candidate => {
      const safe = normalizeUrl(candidate, realm);
      if (!safe || !/^https?:\/\/[^/]+\.[^/]+/i.test(safe)) return;
      if (isLinkField) pushUnique(preferred, safe);
      else pushUnique(fallback, safe);
    });
  });

  const score = (url) => {
    const u = String(url || '').toLowerCase();
    if (u.includes('/up/')) return 100;
    if (u.includes('/db/')) return 90;
    if (u.includes('/nav/')) return 80;
    if (u.includes('/files/')) return 40;
    return 10;
  };

  // Permanent preference: if Link/Download field exists, use those exactly.
  // Secondary preference: choose Quickbase-native route style (/up/, /db/, /nav/) ahead of /files/.
  const chosen = preferred.length ? preferred : fallback;
  return chosen.slice().sort((a, b) => score(b) - score(a));
}

async function readSettings() {
  const out = await serviceSelect('mums_documents', `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_SETTINGS_KEY)}&limit=1`);
  if (!out.ok) return { ok: false, settings: {} };
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const raw = row && row.value && typeof row.value === 'object' ? row.value : {};
  const parsed = parseQbUrl(raw.quickbaseAppUrl || '');
  return {
    ok: true,
    settings: {
      quickbaseAppUrl:    String(raw.quickbaseAppUrl    || '').trim(),
      quickbaseRealm:     String(raw.quickbaseRealm     || parsed.realm    || '').trim(),
      quickbaseTableId:   String(raw.quickbaseTableId   || parsed.tableId  || '').trim(),
      quickbaseAppId:     String(raw.quickbaseAppId     || parsed.appId    || '').trim(),
      quickbaseQid:       String(raw.quickbaseQid       || parsed.qid      || '').trim(),
      quickbaseUserToken: decryptText(raw.quickbaseUserToken || ''),
      syncSchedule:       String(raw.syncSchedule || '').trim(),
      lastSyncedAt:       raw.lastSyncedAt || null,
    },
  };
}
async function readItems() {
  const out = await serviceSelect('mums_documents', `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_ITEMS_KEY)}&limit=1`);
  if (!out.ok) return { ok: false, items: [], tables: [] };
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const val = row && row.value ? row.value : {};
  return {
    ok: true,
    items: Array.isArray(val.items) ? val.items : [],
    tables: Array.isArray(val.tables) ? val.tables : [],
    syncedAt: val.syncedAt || (row && row.updated_at) || null,
  };
}
async function writeItems(items, tables, actor) {
  return serviceUpsert('mums_documents', [{
    key: KB_ITEMS_KEY,
    value: { items, tables, count: items.length, syncedAt: new Date().toISOString(), updatedByName: actor || null },
    updated_at: new Date().toISOString(),
    updated_by_name: actor || null,
  }], 'key');
}
function quickbaseHeaders(realm, token) {
  return { 'QB-Realm-Hostname': realm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' };
}
function scoreKnowledgeTable(table) {
  const txt = [table && table.name, table && table.description, table && table.alias]
    .map(x => String(x || '').toLowerCase()).join(' ');
  if (!txt) return 0;
  let score = 0;
  if (txt.includes('knowledge'))     score += 100;
  if (txt.includes('troubleshoot'))  score += 80;
  if (txt.includes('work instruct')) score += 70;
  if (txt.includes('instruction'))   score += 60;
  if (txt.includes('documentation')) score += 50;
  if (txt.includes('course'))        score += 40;
  if (txt.includes('training'))      score += 40;
  if (txt.includes('education'))     score += 40;
  if (txt.includes('material'))      score += 30;
  if (txt.includes('product'))       score += 20;
  if (txt.includes('drawing'))       score += 15;
  if (txt.includes('scope'))         score += 15;
  if (txt.includes('faq'))           score += 15;
  if (txt.includes('video'))         score += 10;
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
  return allTables.map(t => ({ ...t, _score: scoreKnowledgeTable(t) }))
    .filter(t => t._score >= min).sort((a, b) => b._score - a._score);
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
    const resp = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST', headers: quickbaseHeaders(realm, token), body: JSON.stringify(body),
    });
    if (!resp.ok) break;
    const json = await resp.json().catch(() => ({}));
    if (json && json.fields) {
      (Array.isArray(json.fields) ? json.fields : []).forEach(f => {
        if (f && f.id != null) fields[String(f.id)] = String(f.label || f.name || '');
      });
    }
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

// ── FIX #3 helper: label-based field lookup (exact then partial) ──
// Replaces all hardcoded field ID guesses (9, 10, 13, 14)
function findFieldByLabel(fields, patterns) {
  const pats = (Array.isArray(patterns) ? patterns : [patterns])
    .map(p => p instanceof RegExp ? p : new RegExp(String(p), 'i'));
  // First pass: exact label match
  for (const [fid, label] of Object.entries(fields || {})) {
    const lbl = String(label || '').toLowerCase().trim();
    for (const p of pats) {
      const src = p.source.replace(/^\^|\$$/g, '').replace(/\\s\*/g, ' ').trim();
      if (lbl === src.toLowerCase()) return fid;
    }
  }
  // Second pass: partial / regex match
  for (const [fid, label] of Object.entries(fields || {})) {
    const lbl = String(label || '').toLowerCase().trim();
    for (const p of pats) {
      if (p.test(lbl)) return fid;
    }
  }
  return null;
}

// ── FIX #3: mapRecordToKbItem — label-based, zero hardcoded IDs ──
// BEFORE: pickFieldValue(record, 9)  → returned "15" (numeric counter)
//         pickFieldValue(record, 10) → returned wrong type
//         etc.
// AFTER:  all fields resolved by matching QB field labels
function mapRecordToKbItem(record, fields, settings, tableId, tableName) {
  const id = pickFieldValue(record, 3) || `row-${Math.random().toString(36).slice(2, 9)}`;

  // Title — look for Name/Title/Subject-labeled fields
  let title = '';
  const titleFid = findFieldByLabel(fields, [
    /^name$/, /^title$/, /^subject$/,
    /^work\s+instruction\s+name$/i,
    /^document\s+name$/i,
    /name|title|subject/i,
  ]);
  if (titleFid) title = pickFieldValue(record, titleFid);
  // Fallback: QB commonly uses FID 6 or 7 for name in older apps
  if (!title) title = pickFieldValue(record, 6) || pickFieldValue(record, 7);
  if (!title) title = `Record ${id}`;

  // Document / reference number
  let docNumber = '';
  const numFid = findFieldByLabel(fields, [
    /^(doc\s*#|doc\s*number|document\s*number|reference\s*number|number|num|ref|code)$/i,
    /\bnumber\b|\bcode\b|\bref\b|\bnum\b/i,
  ]);
  if (numFid) docNumber = pickFieldValue(record, numFid);

  // Type / category — used for badge in the KB table
  let type = '';
  const typeFid = findFieldByLabel(fields, [
    /^(type|doc\s*type|document\s*type|category|classification)$/i,
    /^instruction\s*(&|and)\s*template/i,
    /\btype\b|\bcategory\b|\bclassif/i,
  ]);
  if (typeFid) {
    const tv = pickFieldValue(record, typeFid);
    // Only use if it's a meaningful text label, not a numeric count
    if (tv && !/^\d+$/.test(String(tv).trim())) type = tv;
  }
  if (!type) type = tableName || 'Knowledge Base';

  // Related product — multi-pass with numeric guard
  // ROOT CAUSE FIX: QB "Related Product" fields are often RELATIONSHIP COUNT fields
  // (returns "1", "2", etc. = number of related records) while "Product Name" is
  // the actual text field. findFieldByLabel returns the LOWER field ID first (JS
  // iterates integer-keyed objects in ascending order), so "Related Product" (fid 9)
  // was found before "Product Name" (fid 11) → showed "1" instead of "XR Prime".
  let relatedProduct = '';

  // Guard: reject pure-numeric values (QB relationship count fields)
  const isTextValue = v => v && !/^\d+$/.test(String(v).trim());

  // PASS 1: exact "Product Name" label (highest priority — text, not count)
  const pNameFid = findFieldByLabel(fields, /^product\s*name$/i);
  if (pNameFid) {
    const v = pickFieldValue(record, pNameFid);
    if (isTextValue(v)) relatedProduct = v;
  }

  // PASS 2: "Related Product" — only accept if it's TEXT (not a QB count like "1")
  if (!relatedProduct) {
    const relProdFid = findFieldByLabel(fields, /^related\s*product$/i);
    if (relProdFid) {
      const v = pickFieldValue(record, relProdFid);
      if (isTextValue(v)) relatedProduct = v;
    }
  }

  // PASS 3: any field labeled with "product" that isn't a family/doc/drawing/video field
  if (!relatedProduct) {
    for (const [fid, label] of Object.entries(fields || {})) {
      const lbl = String(label || '').toLowerCase().trim();
      if (/\bproduct\b/.test(lbl) && !/family|drawing|doc(umentation)?|video|count/.test(lbl)) {
        const v = pickFieldValue(record, fid);
        if (isTextValue(v)) { relatedProduct = v; break; }
      }
    }
  }

  // Product family — label-based with numeric guard
  let productFamily = '';
  const familyFid = findFieldByLabel(fields, [
    /^(product\s*family|family)$/i,
    /product\s*family|\bfamily\b/i,
  ]);
  if (familyFid) {
    const v = pickFieldValue(record, familyFid);
    if (isTextValue(v)) productFamily = v;
  }

  // Download URLs — direct original QB links (no proxy needed)
  // FIX #1 context: stored as original QB URLs so frontend opens them directly
  const downloadUrls = extractDownloadLinks(record, fields, settings && settings.quickbaseRealm);

  // Source permalink for the "Open" button
  let sourceLink = '';
  const recId = pickFieldValue(record, 3);
  if (recId && settings && settings.quickbaseRealm && settings.quickbaseAppId && tableId) {
    sourceLink = `https://${settings.quickbaseRealm}/nav/app/${settings.quickbaseAppId}/table/${tableId}/record/${recId}`;
  }
  if (!sourceLink && settings) sourceLink = settings.quickbaseAppUrl || '';

  return {
    id:              `${tableId}-${String(id)}`,
    title,
    type,
    doc_number:      docNumber,
    related_product: relatedProduct,
    product_family:  productFamily,
    download_url:    downloadUrls,
    source_link:     sourceLink,
    table_id:        tableId,
    table_name:      tableName || '',
    created_at:      pickFieldValue(record, 1) || null,
  };
}

function dedupeById(items) {
  const m = new Map();
  (items || []).forEach(it => { if (it && it.id) m.set(String(it.id), it); });
  return Array.from(m.values());
}

async function runKnowledgeBaseSync({ actorName } = {}) {
  const settingsOut = await readSettings();
  if (!settingsOut.ok) throw new Error('settings_read_failed');
  const { quickbaseRealm: realm, quickbaseUserToken: token, quickbaseAppId, quickbaseAppUrl } = settingsOut.settings;
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

module.exports = {
  KB_SETTINGS_KEY, KB_ITEMS_KEY,
  parseQbUrl, normalizeUrl,
  readSettings, readItems,
  fetchAllQuickbaseRecords,
  mapRecordToKbItem,
  dedupeById,
  runKnowledgeBaseSync,
};
