/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { serviceSelect, serviceUpsert } = require('./supabase');

const GLOBAL_THEME_DOC_KEY = 'mums_global_theme_settings';
const DEFAULT_THEME_ID = 'aurora_midnight';

function normalizeThemeId(raw) {
  const id = String(raw || '').trim();
  if (!id) return '';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return '';
  return id;
}

function normalizeThemePayload(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const themeId = normalizeThemeId(src.defaultTheme);
  return {
    defaultTheme: themeId || DEFAULT_THEME_ID
  };
}

async function readGlobalThemeSettings() {
  const q = `select=key,value,updated_at,updated_by_name,updated_by_user_id&key=eq.${encodeURIComponent(GLOBAL_THEME_DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: normalizeThemePayload({}) };
  }

  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeThemePayload(row && row.value);
  return { ok: true, status: 200, row, settings };
}

async function writeGlobalThemeSettings(nextSettings, actor) {
  const clean = normalizeThemePayload(nextSettings);
  const nowIso = new Date().toISOString();

  const row = {
    key: GLOBAL_THEME_DOC_KEY,
    value: clean,
    updated_at: nowIso,
    updated_by_user_id: actor && actor.userId ? String(actor.userId) : null,
    updated_by_name: actor && actor.name ? String(actor.name) : null,
    updated_by_client_id: null
  };

  const out = await serviceUpsert('mums_documents', [row], 'key');
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: clean };
  }

  const saved = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : row;
  return { ok: true, status: 200, row: saved, settings: clean };
}

module.exports = {
  GLOBAL_THEME_DOC_KEY,
  DEFAULT_THEME_ID,
  normalizeThemeId,
  normalizeThemePayload,
  readGlobalThemeSettings,
  writeGlobalThemeSettings
};
