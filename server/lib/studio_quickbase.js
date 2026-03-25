// server/lib/studio_quickbase.js
// Reads/writes per-user Studio Quickbase Settings from mums_documents.
// Key format: 'ss_qb_settings_{userId}'
// Global fallback: 'ss_qb_settings_global'
// ISOLATED from global QB settings — Support Studio use only.

const { serviceSelect, serviceUpsert } = require('./supabase');

const STUDIO_QB_KEY_PREFIX = 'ss_qb_settings_';
const STUDIO_QB_GLOBAL_KEY = 'ss_qb_settings_global';

function studioQbKey(userId) {
  return STUDIO_QB_KEY_PREFIX + String(userId || 'global').trim();
}

function normalizeStudioQbSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    reportLink:    String(src.reportLink    || '').trim(),
    realm:         String(src.realm         || '').trim(),
    tableId:       String(src.tableId       || '').trim(),
    qid:           String(src.qid           || '').trim(),
    qbToken:       String(src.qbToken       || '').trim(),
    customColumns: Array.isArray(src.customColumns)
      ? src.customColumns.map(Number).filter(n => Number.isFinite(n))
      : [],
    filterConfig:  Array.isArray(src.filterConfig) ? src.filterConfig : [],
    filterMatch:   String(src.filterMatch || 'ALL').toUpperCase() === 'ANY' ? 'ANY' : 'ALL',
    tabs:          Array.isArray(src.tabs) ? src.tabs : [],
    updatedAt:     src.updatedAt || null,
  };
}

function isEmptySettings(s) {
  return !s.reportLink && !s.qbToken && !s.realm && !s.tableId && !s.qid;
}

async function readStudioQbSettings(userId) {
  const userKey   = studioQbKey(userId);
  const globalKey = STUDIO_QB_GLOBAL_KEY;

  // Fetch both user-specific and global keys in one round-trip.
  const keysParam = `key=in.(${encodeURIComponent(userKey)},${encodeURIComponent(globalKey)})`;
  const q         = `select=key,value,updated_at&${keysParam}&limit=2`;
  const out       = await serviceSelect('mums_documents', q);

  if (!out.ok) {
    return { ok: false, status: out.status || 500, settings: normalizeStudioQbSettings({}) };
  }

  const rows = Array.isArray(out.json) ? out.json : [];

  const userRow   = rows.find(r => r.key === userKey)   || null;
  const globalRow = rows.find(r => r.key === globalKey) || null;

  const userSettings   = normalizeStudioQbSettings(userRow   && userRow.value);
  const globalSettings = normalizeStudioQbSettings(globalRow && globalRow.value);

  // Use user settings if configured; otherwise fall back to global.
  const effective = isEmptySettings(userSettings) ? globalSettings : userSettings;
  const sourceRow = isEmptySettings(userSettings) ? globalRow      : userRow;

  return { ok: true, status: 200, row: sourceRow, settings: effective };
}

async function writeStudioQbSettings(userId, nextSettings, actorName) {
  const clean  = normalizeStudioQbSettings(nextSettings);
  const nowIso = new Date().toISOString();
  const row    = {
    key:                  studioQbKey(userId),
    value:                { ...clean, updatedAt: nowIso, updatedByName: actorName || null },
    updated_at:           nowIso,
    updated_by_user_id:   String(userId || ''),
    updated_by_name:      actorName || null,
    updated_by_client_id: null,
  };
  const out = await serviceUpsert('mums_documents', [row], 'key');
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: clean };
  }
  return { ok: true, status: 200, settings: clean };
}

async function writeGlobalStudioQbSettings(nextSettings, actorName) {
  const clean  = normalizeStudioQbSettings(nextSettings);
  const nowIso = new Date().toISOString();
  const row    = {
    key:                  STUDIO_QB_GLOBAL_KEY,
    value:                { ...clean, updatedAt: nowIso, updatedByName: actorName || null },
    updated_at:           nowIso,
    updated_by_user_id:   null,
    updated_by_name:      actorName || null,
    updated_by_client_id: null,
  };
  const out = await serviceUpsert('mums_documents', [row], 'key');
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: clean };
  }
  return { ok: true, status: 200, settings: clean };
}

module.exports = {
  normalizeStudioQbSettings,
  readStudioQbSettings,
  writeStudioQbSettings,
  writeGlobalStudioQbSettings,
};