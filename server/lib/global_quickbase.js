/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/lib/global_quickbase.js
// Reads/writes Global Quickbase Settings from the mums_documents key-value table.
// Key: 'mums_global_quickbase_settings'
// SUPER_ADMIN only write. All authenticated users can read.

const { serviceSelect, serviceUpsert } = require('./supabase');

const GLOBAL_QB_DOC_KEY = 'mums_global_quickbase_settings';

function normalizeGlobalQbSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    reportLink:   String(src.reportLink   || src.qb_report_link  || '').trim(),
    realm:        String(src.realm        || src.qb_realm        || '').trim(),
    tableId:      String(src.tableId      || src.qb_table_id     || '').trim(),
    qid:          String(src.qid          || src.qb_qid          || '').trim(),
    qbToken:      String(src.qbToken      || src.qb_token        || '').trim(),
    customColumns: Array.isArray(src.customColumns) ? src.customColumns.map(Number).filter(n => isFinite(n)) : [],
    filterConfig:  Array.isArray(src.filterConfig)  ? src.filterConfig  : [],
    filterMatch:   String(src.filterMatch || 'ALL').toUpperCase() === 'ANY' ? 'ANY' : 'ALL',
    updatedAt:    src.updatedAt || null,
    updatedByName: src.updatedByName || null
  };
}

async function readGlobalQuickbaseSettings() {
  const q = `select=key,value,updated_at,updated_by_name,updated_by_user_id&key=eq.${encodeURIComponent(GLOBAL_QB_DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: normalizeGlobalQbSettings({}) };
  }
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeGlobalQbSettings(row && row.value);
  return { ok: true, status: 200, row, settings };
}

async function writeGlobalQuickbaseSettings(nextSettings, actor) {
  const clean = normalizeGlobalQbSettings(nextSettings);
  const nowIso = new Date().toISOString();
  const row = {
    key: GLOBAL_QB_DOC_KEY,
    value: clean,
    updated_at: nowIso,
    updated_by_user_id: actor && actor.userId ? String(actor.userId) : null,
    updated_by_name:    actor && actor.name   ? String(actor.name)   : null,
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
  GLOBAL_QB_DOC_KEY,
  normalizeGlobalQbSettings,
  readGlobalQuickbaseSettings,
  writeGlobalQuickbaseSettings
};
