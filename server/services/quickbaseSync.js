// ─────────────────────────────────────────────────────────────────
//  quickbaseSync.js  — Knowledge Base sync service
//  FIXED v2.1:
//    FIX#2 - normalizeUrl: reject bare numbers/words, only accept
//            real URLs (https://) or QB relative paths (/xxx)
//    FIX#3 - mapRecordToKbItem: fully label-based field discovery,
//            no hardcoded field IDs 9/10/13/14
//    FIX#4 - pickFieldValue: handle QB file attachment versions[].url
//    FIX#5 - extractDownloadLinks: Prioritize /up/ links for direct downloads
//            and handle /db/ with download parameters.
// ─────────────────────────────────────────────────────────────────
const { serviceSelect, serviceUpsert } = require('../lib/supabase');
const { decryptText } = require('../lib/crypto');

const KB_SETTINGS_KEY = 'ss_kb_settings';
const KB_ITEMS_KEY    = 'ss_kb_items';
const QB_DBID_RE      = /\b[bt][a-z0-9]{8,14}\b/i;

// ── FIX #2: normalizeUrl ──────────────────────────────────────────
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
    if (Array.isArray(v.versions) && v.versions.length) {
      for (let i = v.versions.length - 1; i >= 0; i--) {
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

  const hrefRe = /href\s*=\s*["']([^"']+)["']/ig;
  let m;
  while ((m = hrefRe.exec(txt))) out.push(m[1]);
  const hrefBareRe = /href\s*=\s*([^"'\s>]+)/ig;
  while ((m = hrefBareRe.exec(txt))) out.push(m[1]);

  const absRe = /\bhttps?:\/\/[^\s"'<>]+/ig;
  while ((m = absRe.exec(txt))) out.push(m[0]);

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
    push(value.url || value.href || value.link || value.value || value.name || value.text || '');
    if (Array.isArray(value.versions)) {
      value.versions.forEach((ver) => {
        if (!ver || typeof ver !== 'object') return;
        push(ver.url || ver.href || ver.link || '');
      });
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

// ── FIX #5: extractDownloadLinks ────────────────────────────────
function extractDownloadLinks(record, fields, realm) {
  const collected = [];
  const seen = new Set();

  const pushUnique = (url, sourceWeight) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    collected.push({ url, sourceWeight });
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
      String(raw).split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean).forEach(v => candidates.add(v));
      extractUrlsFromText(raw).forEach(v => candidates.add(v));
    }

    Array.from(candidates).forEach(candidate => {
      const safe = normalizeUrl(candidate, realm);
      if (!safe || !/^https?:\/\/[^/]+\.[^/]+/i.test(safe)) return;
      const sourceWeight = isLinkField ? 30 : 10;
      pushUnique(safe, sourceWeight);
    });
  });

  const score = (entry) => {
    const u = String(entry && entry.url || '').toLowerCase();
    let routeWeight = 50;
    // Prioritize /up/ routes (Direct Download)
    if (u.includes('/up/')) routeWeight = 1000;
    // Handle /db/ routes with download parameters
    else if (u.includes('/db/') && (u.includes('a=d') || u.includes('act=download'))) routeWeight = 900;
    else if (u.includes('/db/')) routeWeight = 100;
    else if (u.includes('/nav/')) routeWeight = 80;
    // Penalize /files/ routes as they are often generic viewers requiring login
    else if (u.includes('/files/')) routeWeight = 10;

    return routeWeight + Number(entry && entry.sourceWeight || 0);
  };

  return collected
    .slice()
    .sort((a, b) => score(b) - score(a))
    .map((entry) => entry.url);
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
    value: { items, tables, syncedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
    actor: actor || 'system'
  }]);
}

module.exports = {
  readSettings,
  readItems,
  writeItems,
  normalizeUrl,
  extractDownloadLinks,
  parseQbUrl
};
