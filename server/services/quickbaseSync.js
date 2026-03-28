// ─────────────────────────────────────────────────────────────────
//  quickbaseSync.js  — Knowledge Base sync service
//  FIXED v2.2:
//    FIX#2 - normalizeUrl: reject bare numbers/words, only accept
//            real URLs (https://) or QB relative paths (/xxx).
//            AUTO-APPEND .quickbase.com when realm is a bare subdomain.
//    FIX#3 - mapRecordToKbItem: fully label-based field discovery,
//            no hardcoded field IDs 9/10/13/14
//    FIX#4 - pickFieldValue: handle QB file attachment versions[].url
//    FIX#5 - extractDownloadLinks: prioritize direct-download URLs
//            (/up/* and /db/* with download params) over /files/*.
//    FIX#6 - extractUrlsFromCell: traverse value.versions[].url so
//            the correct /up/ direct-download URL from file-attachment
//            cells is always collected (was silently dropped before).
// ─────────────────────────────────────────────────────────────────
const { serviceSelect, serviceUpsert } = require('../lib/supabase');
const { decryptText } = require('../lib/crypto');

const KB_SETTINGS_KEY = 'ss_kb_settings';
const KB_ITEMS_KEY = 'ss_kb_items';
const QB_DBID_RE = /\b[bt][a-z0-9]{8,14}\b/i;

// ── FIX#2 / FIX#6: ensure realm always has the full QB hostname ────────────
function _ensureQbRealm(realm) {
  const r = String(realm || '').trim();
  if (!r) return r;
  // If realm has no dot it is a bare subdomain — append .quickbase.com
  if (!r.includes('.')) return `${r}.quickbase.com`;
  return r;
}

// ── Convert QB REST /files/ URL → /up/ direct-download URL ────────────────
// QB REST API v1 returns file attachment URLs in /files/ format:
//   /files/tableId/recordId/fieldId/version
// QB browser/UI uses /up/ format for direct authenticated downloads:
//   /up/tableId/a/r/recordId/e/fieldId/version
//
// Both require the user to be logged into QB in their browser.
// /up/ format is preferred — it matches what QB shows in its own UI
// and works reliably with QB browser session cookies.
//
// Example:
//   IN:  https://realm/files/bk249j98b/1/7/1
//   OUT: https://realm/up/bk249j98b/a/r/1/e/7/1
function _filesUrlToUp(url) {
  try {
    const u = new URL(String(url || ''));
    const segs = u.pathname.split('/').filter(Boolean);
    // Only process /files/tableId/recordId/fieldId[/version]
    if (segs[0] !== 'files' || segs.length < 4) return url;
    const [, tableId, recordId, fieldId, version] = segs;
    if (!tableId || !recordId || !fieldId) return url;
    const ver = version || '1';
    // Rebuild as /up/tableId/a/r/recordId/e/fieldId/version
    return `${u.protocol}//${u.host}/up/${tableId}/a/r/${recordId}/e/${fieldId}/${ver}`;
  } catch (_) { return url; }
}

function normalizeUrl(raw, realm) {
  const val = String(raw || '').trim();
  if (!val) return '';
  if (/^https?:\/\//i.test(val)) {
    try {
      return new URL(val).toString();
    } catch (_) {
      return '';
    }
  }
  if (/^\/[a-zA-Z]/.test(val)) {
    const safeRealm = _ensureQbRealm(realm);
    if (!safeRealm) return '';
    try {
      return new URL(val, `https://${safeRealm}`).toString();
    } catch (_) {
      return '';
    }
  }
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
    const tableIdx = segs.findIndex((s) => String(s).toLowerCase() === 'table');
    if (tableIdx >= 0 && segs[tableIdx + 1]) out.tableId = firstDbid(segs[tableIdx + 1]);
    const appIdx = segs.findIndex((s) => String(s).toLowerCase() === 'app');
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
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' ? x.url || x.value || x.name || '' : String(x || '')))
      .filter(Boolean)
      .join(' | ');
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.versions) && v.versions.length) {
      for (let i = v.versions.length - 1; i >= 0; i -= 1) {
        const ver = v.versions[i];
        if (ver && ver.url) return String(ver.url);
      }
    }
    if (v.url) return String(v.url);
    return String(v.value || v.name || v.text || '');
  }
  return '';
}

function extractUrlsFromText(input) {
  const txt = String(input || '').trim();
  if (!txt) return [];
  const out = [];

  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(txt))) out.push(m[1]);

  const hrefBareRe = /href\s*=\s*([^"'\s>]+)/gi;
  while ((m = hrefBareRe.exec(txt))) out.push(m[1]);

  const absRe = /\bhttps?:\/\/[^\s"'<>]+/gi;
  while ((m = absRe.exec(txt))) out.push(m[0]);

  const relRe = /\/(?:up|db|nav|files)\/[^\s"'<>]+/gi;
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
    // ── PRIORITY ORDER: value.url FIRST, then versions[] ──────────────────
    // QB file-attachment REST response shape:
    //   value.url      = "https://realm/up/tableId/g/rb/eh/vb"  ← QB canonical URL (what QB UI shows)
    //   versions[].url = "/up/tableId/a/r/recordId/e/fieldId/1" ← versioned record URL
    //
    // BOTH contain /up/ so they score equally in ranking.
    // FIRST-pushed wins the tie. We MUST push value.url first so the
    // canonical QB URL (matching what QB shows on hover) is the winner.
    //
    // BUG WAS: versions[] pushed first → versioned URL won → mismatch with QB UI
    // FIX:     value.url pushed first  → canonical URL wins → matches QB UI ✓
    const canonicalUrl = value.url || value.href || value.link || '';
    if (canonicalUrl) {
      push(canonicalUrl);
      extractUrlsFromText(canonicalUrl).forEach(push);
    }

    // versions[] — added as fallback only (will lose tie-break since pushed after canonical)
    if (Array.isArray(value.versions) && value.versions.length) {
      for (let i = value.versions.length - 1; i >= 0; i -= 1) {
        const ver = value.versions[i];
        if (ver && ver.url) {
          push(ver.url);
          extractUrlsFromText(ver.url).forEach(push);
        }
      }
    }

    // Remaining string values on the object
    if (!canonicalUrl) {
      push(value.value || value.name || value.text || '');
    }
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

function extractDownloadLinks(record, fields, realm) {
  const collected = [];
  const seen = new Set();

  const pushUnique = (url, sourceWeight) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    collected.push({ url, sourceWeight });
  };

  const safeRealm = _ensureQbRealm(realm);

  Object.entries(fields || {}).forEach(([fid, label]) => {
    const low = String(label || '').toLowerCase();
    const isLinkField = low.includes('link') || low.includes('download');
    const isAttachmentField = low.includes('file') || low.includes('url') || low.includes('attach');
    if (!isLinkField && !isAttachmentField) return;

    const candidates = new Set();
    extractUrlsFromCell(record, fid).forEach((v) => candidates.add(v));
    const raw = pickFieldValue(record, fid);
    if (raw) {
      String(raw)
        .split(/\s*\|\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((v) => candidates.add(v));
      extractUrlsFromText(raw).forEach((v) => candidates.add(v));
    }

    Array.from(candidates).forEach((candidate) => {
      const safe = normalizeUrl(candidate, safeRealm);
      if (!safe || !/^https?:\/\/[^/]+\.[^/]+/i.test(safe)) return;
      // FIX: convert QB REST /files/ URLs → /up/ direct-download format
      // so stored URLs always match what QB shows in its own UI
      const upUrl = _filesUrlToUp(safe);
      const sourceWeight = isLinkField ? 30 : 10;
      pushUnique(upUrl, sourceWeight);
    });
  });

  const score = (entry) => {
    const u = String((entry && entry.url) || '').toLowerCase();
    let routeWeight = 50;
    if (u.includes('/up/')) {
      // QB canonical attachment viewer URL (/up/tableId/g/...) scores highest
      // QB versioned record URL (/up/tableId/a/r/...) scores slightly lower
      // Both are /up/ but we must prefer QB's own canonical URL format
      routeWeight = u.includes('/up/') && u.match(/\/up\/[^/]+\/g\//) ? 1200 : 1000;
    } else if (u.includes('/db/') && (u.includes('a=d') || u.includes('act=download'))) routeWeight = 900;
    else if (u.includes('/db/')) routeWeight = 100;
    else if (u.includes('/nav/')) routeWeight = 80;
    else if (u.includes('/files/')) routeWeight = 10;
    return routeWeight + Number((entry && entry.sourceWeight) || 0);
  };

  const ranked = collected.slice().sort((a, b) => score(b) - score(a));

  const isDirect = (url) => {
    const u = String(url || '').toLowerCase();
    return u.includes('/up/') || (u.includes('/db/') && (u.includes('a=d') || u.includes('act=download')));
  };

  const directOnly = ranked.filter((entry) => isDirect(entry.url)).map((entry) => entry.url);
  if (directOnly.length) return directOnly;

  return ranked.map((entry) => entry.url);
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
      lastSyncedAt: raw.lastSyncedAt || null,
    },
  };
}

async function readItems() {
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_ITEMS_KEY)}&limit=1`
  );
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
  return serviceUpsert(
    'mums_documents',
    [
      {
        key: KB_ITEMS_KEY,
        value: {
          items,
          tables,
          count: items.length,
          syncedAt: new Date().toISOString(),
          updatedByName: actor || null,
        },
        updated_at: new Date().toISOString(),
        updated_by_name: actor || null,
      },
    ],
    'key'
  );
}

function quickbaseHeaders(realm, token) {
  return {
    'QB-Realm-Hostname': realm,
    Authorization: `QB-USER-TOKEN ${token}`,
    'Content-Type': 'application/json',
  };
}

function scoreKnowledgeTable(table) {
  const txt = [table && table.name, table && table.description, table && table.alias]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
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
    const resp = await fetch(`https://api.quickbase.com/v1/tables?appId=${encodeURIComponent(appId)}`, {
      method: 'GET',
      headers: quickbaseHeaders(realm, token),
    });
    if (!resp.ok) return [];
    const json = await resp.json().catch(() => null);
    const tables = Array.isArray(json) ? json : Array.isArray(json && json.tables) ? json.tables : [];
    return tables;
  } catch (_) {
    return [];
  }
}

function selectKnowledgeTables(allTables, minScore) {
  const min = minScore === undefined ? 10 : minScore;
  return allTables
    .map((t) => ({ ...t, _score: scoreKnowledgeTable(t) }))
    .filter((t) => t._score >= min)
    .sort((a, b) => b._score - a._score);
}

async function fetchTableRecords({ tableId, qid, realm, token }, opts) {
  const sleepMs = (opts && opts.sleepMs) || 0;
  let skip = 0;
  const top = 250;
  const all = [];
  let fields = {};
  for (let page = 0; page < 120; page += 1) {
    const body = { from: tableId, options: { skip, top } };
    if (qid) body.queryId = qid;
    const resp = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: quickbaseHeaders(realm, token),
      body: JSON.stringify(body),
    });
    if (!resp.ok) break;
    const json = await resp.json().catch(() => ({}));
    if (json && json.fields) {
      (Array.isArray(json.fields) ? json.fields : []).forEach((f) => {
        if (f && f.id != null) fields[String(f.id)] = String(f.label || f.name || '');
      });
    }
    const rows = Array.isArray(json && json.data) ? json.data : [];
    all.push(...rows);
    if (rows.length < top) break;
    skip += rows.length;
    if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));
  }
  return { records: all, fields };
}

async function fetchAllQuickbaseRecords(settings, opts) {
  const {
    quickbaseTableId,
    quickbaseAppId,
    quickbaseAppUrl,
    quickbaseRealm: realm,
    quickbaseUserToken: token,
    quickbaseQid: qid,
  } = settings || {};
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

function findFieldByLabel(fields, patterns) {
  const pats = (Array.isArray(patterns) ? patterns : [patterns]).map((p) =>
    p instanceof RegExp ? p : new RegExp(String(p), 'i')
  );

  for (const [fid, label] of Object.entries(fields || {})) {
    const lbl = String(label || '').toLowerCase().trim();
    for (const p of pats) {
      const src = p.source.replace(/^\^|\$$/g, '').replace(/\\s\*/g, ' ').trim();
      if (lbl === src.toLowerCase()) return fid;
    }
  }

  for (const [fid, label] of Object.entries(fields || {})) {
    const lbl = String(label || '').toLowerCase().trim();
    for (const p of pats) {
      if (p.test(lbl)) return fid;
    }
  }

  return null;
}

function mapRecordToKbItem(record, fields, settings, tableId, tableName) {
  const id = pickFieldValue(record, 3) || `row-${Math.random().toString(36).slice(2, 9)}`;

  let title = '';
  const titleFid = findFieldByLabel(fields, [
    /^name$/,
    /^title$/,
    /^subject$/,
    /^work\s+instruction\s+name$/i,
    /^document\s+name$/i,
    /name|title|subject/i,
  ]);
  if (titleFid) title = pickFieldValue(record, titleFid);
  if (!title) title = pickFieldValue(record, 6) || pickFieldValue(record, 7);
  if (!title) title = `Record ${id}`;

  let docNumber = '';
  const numFid = findFieldByLabel(fields, [
    /^(doc\s*#|doc\s*number|document\s*number|reference\s*number|number|num|ref|code)$/i,
    /\bnumber\b|\bcode\b|\bref\b|\bnum\b/i,
  ]);
  if (numFid) docNumber = pickFieldValue(record, numFid);

  let type = '';
  const typeFid = findFieldByLabel(fields, [
    /^(type|doc\s*type|document\s*type|category|classification)$/i,
    /^instruction\s*(&|and)\s*template/i,
    /\btype\b|\bcategory\b|\bclassif/i,
  ]);
  if (typeFid) {
    const tv = pickFieldValue(record, typeFid);
    if (tv && !/^\d+$/.test(String(tv).trim())) type = tv;
  }
  if (!type) type = tableName || 'Knowledge Base';

  let relatedProduct = '';
  const isTextValue = (v) => v && !/^\d+$/.test(String(v).trim());

  const pNameFid = findFieldByLabel(fields, /^product\s*name$/i);
  if (pNameFid) {
    const v = pickFieldValue(record, pNameFid);
    if (isTextValue(v)) relatedProduct = v;
  }

  if (!relatedProduct) {
    const relProdFid = findFieldByLabel(fields, /^related\s*product$/i);
    if (relProdFid) {
      const v = pickFieldValue(record, relProdFid);
      if (isTextValue(v)) relatedProduct = v;
    }
  }

  if (!relatedProduct) {
    for (const [fid, label] of Object.entries(fields || {})) {
      const lbl = String(label || '').toLowerCase().trim();
      if (/\bproduct\b/.test(lbl) && !/family|drawing|doc(umentation)?|video|count/.test(lbl)) {
        const v = pickFieldValue(record, fid);
        if (isTextValue(v)) {
          relatedProduct = v;
          break;
        }
      }
    }
  }

  let productFamily = '';
  const familyFid = findFieldByLabel(fields, [/^(product\s*family|family)$/i, /product\s*family|\bfamily\b/i]);
  if (familyFid) {
    const v = pickFieldValue(record, familyFid);
    if (isTextValue(v)) productFamily = v;
  }

  const safeRealm = _ensureQbRealm(settings && settings.quickbaseRealm);
  const downloadUrls = extractDownloadLinks(record, fields, safeRealm);

  let sourceLink = '';
  const recId = pickFieldValue(record, 3);
  if (recId && safeRealm && settings && settings.quickbaseAppId && tableId) {
    sourceLink = `https://${safeRealm}/nav/app/${settings.quickbaseAppId}/table/${tableId}/record/${recId}`;
  }
  if (!sourceLink && settings) sourceLink = settings.quickbaseAppUrl || '';

  return {
    id: `${tableId}-${String(id)}`,
    title,
    type,
    doc_number: docNumber,
    related_product: relatedProduct,
    product_family: productFamily,
    download_url: downloadUrls,
    source_link: sourceLink,
    table_id: tableId,
    table_name: tableName || '',
    created_at: pickFieldValue(record, 1) || null,
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
  const {
    quickbaseRealm: realm,
    quickbaseUserToken: token,
    quickbaseAppId,
    quickbaseAppUrl,
  } = settingsOut.settings;
  if (!realm || !token) throw new Error('quickbase_config_missing');

  const parsedUrl = parseQbUrl(quickbaseAppUrl || '');
  const appId = String(quickbaseAppId || parsedUrl.appId || '').trim();
  const allTables = appId ? await fetchAppTables({ realm, token, appId }) : [];

  let knowledgeTables = selectKnowledgeTables(allTables);
  if (!knowledgeTables.length) {
    let fallbackId = String(settingsOut.settings.quickbaseTableId || parsedUrl.tableId || '').trim();
    if (!fallbackId && appId) {
      const scored = allTables
        .map((t) => ({ ...t, _score: scoreKnowledgeTable(t) }))
        .sort((a, b) => b._score - a._score);
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
      const items = records.map((r) => mapRecordToKbItem(r, fields, settingsOut.settings, tableId, tableName));
      allItems.push(...items);
      tablesMeta.push({ id: tableId, name: tableName, score: table._score || 0, count: records.length });
    } catch (tableErr) {
      console.warn(
        `[quickbaseSync] Skipped table ${tableId} (${tableName}):`,
        String((tableErr && tableErr.message) || tableErr)
      );
    }
  }

  const deduped = dedupeById(allItems);
  const w = await writeItems(deduped, tablesMeta, actorName || 'system');
  if (!w.ok) throw new Error('kb_items_write_failed');

  return {
    ok: true,
    count: deduped.length,
    items: deduped,
    tables: tablesMeta,
    syncedAt: new Date().toISOString(),
    resolvedTableIds: tablesMeta.map((t) => t.id),
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
  runKnowledgeBaseSync,
  extractDownloadLinks,
};
