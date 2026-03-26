#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { normalizeSettings } = require('../lib/normalizeSettings');

const READ_ONLY_CHECK_SQL = "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='mums_profiles' ORDER BY column_name;";
const CONDITIONAL_RENAME_SQL = `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mums_profiles' AND column_name = 'settings_json'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mums_profiles' AND column_name = 'settings'
  ) THEN
    ALTER TABLE public.mums_profiles RENAME COLUMN settings_json TO settings;
  END IF;
END$$;`;
const SAFE_DROP_SQL = 'ALTER TABLE public.mums_profiles DROP COLUMN IF EXISTS settings;';
const BATCH_SIZE = 500;
const REPORT_PATH = path.join(process.cwd(), 'migration_report.json');

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    apply: false,
    db: process.env.DATABASE_URL || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') flags.dryRun = true;
    if (arg === '--apply') flags.apply = true;
    if (arg === '--db') {
      flags.db = argv[i + 1] || '';
      i += 1;
    }
  }

  if (!flags.apply && !flags.dryRun) {
    flags.dryRun = true;
  }

  if (flags.apply && flags.dryRun) {
    throw new Error('Use either --dry-run or --apply, not both.');
  }

  return flags;
}

function detectColumnState(rows) {
  const names = new Set((rows || []).map((row) => row.column_name));
  return {
    settings_exists: names.has('settings'),
    settings_json_exists: names.has('settings_json'),
  };
}

function safeSerialize(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

async function loadColumns(client) {
  const result = await client.query(READ_ONLY_CHECK_SQL);
  return result.rows;
}

async function migrateSettingsToSettingsJson(client, report) {
  report.executed_actions.push('Ensuring settings_json column exists');
  await client.query('ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS settings_json jsonb;');

  let offset = 0;
  while (true) {
    const batch = await client.query(
      'SELECT ctid::text AS _ctid, settings FROM public.mums_profiles WHERE settings IS NOT NULL ORDER BY ctid LIMIT $1 OFFSET $2;',
      [BATCH_SIZE, offset],
    );

    if (!batch.rows.length) break;

    for (let idx = 0; idx < batch.rows.length; idx += 1) {
      const row = batch.rows[idx];
      const savepointName = `sp_${offset}_${idx}`.replace(/[^a-zA-Z0-9_]/g, '_');
      const normalized = normalizeSettings(row.settings);

      if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
        report.failures.push(`Skipped ctid=${row._ctid}: normalized value is not a JSON object`);
        continue;
      }

      const payload = safeSerialize(normalized);
      if (!payload) {
        report.failures.push(`Skipped ctid=${row._ctid}: failed to serialize normalized payload`);
        continue;
      }

      try {
        await client.query(`SAVEPOINT ${savepointName}`);
        await client.query(
          'UPDATE public.mums_profiles SET settings_json = $1::jsonb WHERE ctid = $2::tid;',
          [payload, row._ctid],
        );
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (error) {
        report.failures.push(`Update failed for ctid=${row._ctid}: ${error.message}`);
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      }
    }

    offset += batch.rows.length;
  }

  report.executed_actions.push('Dropping settings column with IF EXISTS safeguard');
  await client.query(SAFE_DROP_SQL);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db) {
    throw new Error('Database connection string is required via --db or DATABASE_URL');
  }

  const report = {
    settings_exists: false,
    settings_json_exists: false,
    planned_actions: [],
    executed_actions: [],
    failures: [],
  };

  const { Client } = require('pg');
  const client = new Client({ connectionString: args.db });

  try {
    await client.connect();
    const columns = await loadColumns(client);
    const state = detectColumnState(columns);
    report.settings_exists = state.settings_exists;
    report.settings_json_exists = state.settings_json_exists;

    if (state.settings_json_exists && !state.settings_exists) {
      report.planned_actions.push('Run conditional rename DO block (settings_json -> settings when settings missing)');
    }

    if (state.settings_exists) {
      report.planned_actions.push('Ensure settings_json exists, migrate settings rows in batches of 500, then drop settings safely');
    }

    if (!state.settings_exists && !state.settings_json_exists) {
      report.planned_actions.push('No settings/settings_json columns found; no-op');
    }

    if (args.apply) {
      await client.query('BEGIN');
      try {
        if (state.settings_json_exists && !state.settings_exists) {
          report.executed_actions.push('Executing conditional rename DO block');
          await client.query(CONDITIONAL_RENAME_SQL);
          report.settings_exists = true;
          report.settings_json_exists = false;
        }

        const latestState = detectColumnState(await loadColumns(client));
        report.settings_exists = latestState.settings_exists;
        report.settings_json_exists = latestState.settings_json_exists;

        if (latestState.settings_exists) {
          await migrateSettingsToSettingsJson(client, report);
          const finalState = detectColumnState(await loadColumns(client));
          report.settings_exists = finalState.settings_exists;
          report.settings_json_exists = finalState.settings_json_exists;
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    await client.end().catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  console.log(`Migration report written to ${REPORT_PATH}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  detectColumnState,
  READ_ONLY_CHECK_SQL,
  CONDITIONAL_RENAME_SQL,
  SAFE_DROP_SQL,
};
