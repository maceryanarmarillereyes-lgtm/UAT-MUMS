/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// mailbox_status.js — Mailbox Feature Enable/Disable Control (Super Admin only)
// Uses the mums_documents Supabase table, exactly like login_mode.js.
// Stored value: { disabled: boolean, updatedAt: ISO, updatedByName: string }
// When disabled=true → mailbox page shows "temporarily disabled" banner,
// ALL Supabase/Cloudflare requests originating from the mailbox feature are suppressed.

const { serviceSelect, serviceUpsert } = require('./supabase');

const MAILBOX_STATUS_DOC_KEY = 'mums_mailbox_status';

function normalizeMailboxStatus(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    disabled: src.disabled === true,       // false = enabled (default)
    updatedAt: src.updatedAt || null,
    updatedByName: src.updatedByName || null
  };
}

async function readMailboxStatus() {
  const q = `select=key,value,updated_at,updated_by_name,updated_by_user_id&key=eq.${encodeURIComponent(MAILBOX_STATUS_DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) {
    // Table may not exist yet — return default (enabled) gracefully
    return { ok: true, status: 200, row: null, settings: normalizeMailboxStatus({}) };
  }
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeMailboxStatus(row && row.value);
  return { ok: true, status: 200, row, settings };
}

async function writeMailboxStatus(nextSettings, actor) {
  const clean = normalizeMailboxStatus(nextSettings);
  const nowIso = new Date().toISOString();
  clean.updatedAt = nowIso;
  clean.updatedByName = (actor && actor.name) ? String(actor.name) : null;

  const row = {
    key: MAILBOX_STATUS_DOC_KEY,
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
  MAILBOX_STATUS_DOC_KEY,
  normalizeMailboxStatus,
  readMailboxStatus,
  writeMailboxStatus
};
