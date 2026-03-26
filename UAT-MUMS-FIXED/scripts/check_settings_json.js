#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { serviceSelect, serviceUpdate, serviceFetch } = require('../server/lib/supabase');
const { normalizeSettings } = require('../server/lib/normalize_settings');

const APPLY = process.argv.includes('--apply');
const REPORT_PATH = path.join(process.cwd(), 'migration_report.json');

async function ensureColumn() {
  const sql = 'ALTER TABLE mums_profiles ADD COLUMN IF NOT EXISTS settings_json jsonb;';
  const encoded = encodeURIComponent(sql);
  return serviceFetch(`/rest/v1/rpc/exec_sql?sql=${encoded}`, { method: 'POST' });
}

function classify(raw, normalized) {
  if (!raw) return 'empty';
  if (typeof raw === 'object') return 'object';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return 'empty-string';
    if (!Object.keys(normalized || {}).length) return 'invalid-string';
    return 'parsed-string';
  }
  return 'unsupported';
}

async function main() {
  const select = await serviceSelect('mums_profiles', 'select=user_id,settings,settings_json&limit=5000');
  if (!select.ok) throw new Error(`Failed to read mums_profiles: ${select.status}`);

  const rows = Array.isArray(select.json) ? select.json : [];
  const report = [];

  if (APPLY) {
    try { await ensureColumn(); } catch (_) {}
  }

  for (const row of rows) {
    const userId = String(row.user_id || '');
    const raw = row.settings;
    const normalized = normalizeSettings(raw);
    const status = classify(raw, normalized);
    const item = { id: userId, status };

    if (APPLY && Object.keys(normalized).length) {
      const out = await serviceUpdate('mums_profiles', { settings_json: normalized }, { user_id: `eq.${encodeURIComponent(userId)}` });
      item.applied = !!out.ok;
    }

    report.push(item);
    console.log(`${userId || 'unknown'}: ${status}`);
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote ${REPORT_PATH} (${report.length} rows)`);
  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write parsed JSON into settings_json.');
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
