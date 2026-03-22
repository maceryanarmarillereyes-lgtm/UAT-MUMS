// server/lib/studio_quickbase.js
// Reads/writes per-user Studio Quickbase Settings from mums_documents.
// Key format: 'ss_qb_settings_{userId}'
// ISOLATED from global QB settings — Support Studio use only.

const { serviceSelect, serviceUpsert } = require('./supabase');

const STUDIO_QB_KEY_PREFIX = 'ss_qb_settings_';

function studioQbKey(userId) {
  return STUDIO_QB_KEY_PREFIX + String(userId || 'global').trim();
}

function normalizeStudioQbSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    reportLink:    String(src.reportLink   || '').trim(),
    realm:         String(src.realm        || '').trim(),
    tableId:       String(src.tableId      || '').trim(),
    qid:           String(src.qid          || '').trim(),
    qbToken:       String(src.qbToken      || '').trim(),
    customColumns: Array.isArray(src.customColumns) ? src.customColumns.map(Number).filter(n => Number.isFinite(n)) : [],
    filterConfig:  Array.isArray(src.filterConfig)  ? src.filterConfig  : [],
    filterMatch:   String(src.filterMatch || 'ALL').toUpperCase() === 'ANY' ? 'ANY' : 'ALL',
    tabs:          Array.isArray(src.tabs) ? src.tabs : [],
    updatedAt:     src.updatedAt || null,
  };
}

async function readStudioQbSettings(userId) {
  const key = studioQbKey(userId);
  const q = `select=key,value,updated_at&key=eq.${encodeURIComponent(key)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) {
    return { ok: false, status: out.status || 500, settings: normalizeStudioQbSettings({}) };
  }
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeStudioQbSettings(row && row.value);
  return { ok: true, status: 200, row, settings };
}

async function writeStudioQbSettings(userId, nextSettings, actorName) {
  const clean = normalizeStudioQbSettings(nextSettings);
  const nowIso = new Date().toISOString();
  const row = {
    key: studioQbKey(userId),
    value: { ...clean, updatedAt: nowIso, updatedByName: actorName || null },
    updated_at: nowIso,
    updated_by_user_id: String(userId || ''),
    updated_by_name: actorName || null,
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
};
