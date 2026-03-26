/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
// server/lib/global_calendar.js
// Reads/writes Manila Calendar QB Settings from the mums_documents key-value table.
// Key: 'mums_global_calendar_settings'
// SUPER_ADMIN only write. All authenticated users can read (token stripped for non-admins).

const { serviceSelect, serviceUpsert } = require('./supabase');

const GLOBAL_CAL_DOC_KEY = 'mums_global_calendar_settings';

function normalizeGlobalCalendarSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    reportLink:    String(src.reportLink    || '').trim(),
    realm:         String(src.realm         || '').trim(),
    tableId:       String(src.tableId       || '').trim(),
    qid:           String(src.qid           || '').trim(),
    qbToken:       String(src.qbToken       || '').trim(),
    // Field mappings — defaults match the screenshot columns
    fieldEmployee: String(src.fieldEmployee || '').trim(),
    fieldNote:     String(src.fieldNote     || '').trim(),
    fieldStartDate:String(src.fieldStartDate|| '').trim(),
    fieldEndDate:  String(src.fieldEndDate  || '').trim(),
    updatedAt:     src.updatedAt     || null,
    updatedByName: src.updatedByName || null,
  };
}

async function readGlobalCalendarSettings() {
  const q = `select=key,value,updated_at,updated_by_name,updated_by_user_id&key=eq.${encodeURIComponent(GLOBAL_CAL_DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: normalizeGlobalCalendarSettings({}) };
  }
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeGlobalCalendarSettings(row && row.value);
  return { ok: true, status: 200, row, settings };
}

async function writeGlobalCalendarSettings(nextSettings, actor) {
  const clean = normalizeGlobalCalendarSettings(nextSettings);
  const nowIso = new Date().toISOString();
  const row = {
    key: GLOBAL_CAL_DOC_KEY,
    value: clean,
    updated_at: nowIso,
    updated_by_user_id: actor && actor.userId ? String(actor.userId) : null,
    updated_by_name:    actor && actor.name   ? String(actor.name)   : null,
    updated_by_client_id: null,
  };
  const out = await serviceUpsert('mums_documents', [row], 'key');
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: clean };
  }
  const saved = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : row;
  return { ok: true, status: 200, row: saved, settings: clean };
}

module.exports = {
  GLOBAL_CAL_DOC_KEY,
  normalizeGlobalCalendarSettings,
  readGlobalCalendarSettings,
  writeGlobalCalendarSettings,
};
