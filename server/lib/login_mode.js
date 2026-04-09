/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { serviceSelect, serviceUpsert } = require('./supabase');

const LOGIN_MODE_DOC_KEY = 'mums_login_mode_settings';

// Valid modes:
//  'password'   — Email/password only; Microsoft button hidden on login page
//  'microsoft'  — Microsoft OAuth only (original behaviour); password login still works
//                 for admin-created users but Microsoft button is shown prominently
//  'both'       — Both options shown (default when no setting stored)
const VALID_MODES = new Set(['password', 'microsoft', 'both']);
const DEFAULT_MODE = 'both';

function normalizeMode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return VALID_MODES.has(s) ? s : DEFAULT_MODE;
}

function normalizeLoginModePayload(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    mode: normalizeMode(src.mode),
    updatedAt: src.updatedAt || null,
    updatedByName: src.updatedByName || null
  };
}

async function readLoginModeSettings() {
  const q = `select=key,value,updated_at,updated_by_name,updated_by_user_id&key=eq.${encodeURIComponent(LOGIN_MODE_DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) {
    // Table may not exist yet — return default gracefully
    return { ok: true, status: 200, row: null, settings: normalizeLoginModePayload({}) };
  }
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeLoginModePayload(row && row.value);
  return { ok: true, status: 200, row, settings };
}

async function writeLoginModeSettings(nextSettings, actor) {
  const clean = normalizeLoginModePayload(nextSettings);
  const nowIso = new Date().toISOString();
  clean.updatedAt = nowIso;
  clean.updatedByName = (actor && actor.name) ? String(actor.name) : null;

  const row = {
    key: LOGIN_MODE_DOC_KEY,
    value: clean,
    updated_at: nowIso,
    updated_by_user_id: (actor && actor.userId) ? String(actor.userId) : null,
    updated_by_name: (actor && actor.name) ? String(actor.name) : null,
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
  LOGIN_MODE_DOC_KEY,
  DEFAULT_MODE,
  VALID_MODES,
  normalizeMode,
  readLoginModeSettings,
  writeLoginModeSettings
};
