/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { serviceSelect, serviceUpsert } = require('./supabase');

const THEME_ACCESS_DOC_KEY = 'mums_theme_access_control';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeThemeMeta(raw) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  const entries = Object.entries(raw).slice(0, 1000);
  for (const [themeId, value] of entries) {
    const id = String(themeId || '').trim();
    if (!id) continue;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) continue;

    const node = isPlainObject(value) ? value : {};
    const hidden = !!node.hidden;
    const deleted = !!node.deleted;

    if (!hidden && !deleted) continue;
    out[id] = { hidden, deleted };
  }
  return out;
}

async function readThemeAccessMeta() {
  const q = `select=key,value,updated_at,updated_by_name,updated_by_user_id&key=eq.${encodeURIComponent(THEME_ACCESS_DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) return { ok: false, status: out.status || 500, details: out.json || out.text, meta: {} };

  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const meta = normalizeThemeMeta(row && row.value);
  return { ok: true, status: 200, row, meta };
}

async function writeThemeAccessMeta(meta, actor) {
  const clean = normalizeThemeMeta(meta);
  const nowIso = new Date().toISOString();
  const row = {
    key: THEME_ACCESS_DOC_KEY,
    value: clean,
    updated_at: nowIso,
    updated_by_user_id: actor && actor.userId ? String(actor.userId) : null,
    updated_by_name: actor && actor.name ? String(actor.name) : null,
    updated_by_client_id: null
  };

  const out = await serviceUpsert('mums_documents', [row], 'key');
  if (!out.ok) return { ok: false, status: out.status || 500, details: out.json || out.text, meta: clean };

  const saved = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : row;
  return { ok: true, status: 200, row: saved, meta: clean };
}

module.exports = {
  THEME_ACCESS_DOC_KEY,
  normalizeThemeMeta,
  readThemeAccessMeta,
  writeThemeAccessMeta
};
