const assert = require('assert');
const { detectColumnState, parseArgs } = require('../scripts/safe_settings_migration');

assert.deepStrictEqual(
  detectColumnState([
    { column_name: 'id' },
    { column_name: 'settings' },
  ]),
  { settings_exists: true, settings_json_exists: false },
  'should detect settings column',
);

assert.deepStrictEqual(
  detectColumnState([
    { column_name: 'settings_json' },
  ]),
  { settings_exists: false, settings_json_exists: true },
  'should detect settings_json column',
);

const dryRun = parseArgs(['--dry-run', '--db', 'postgres://localhost/test']);
assert.strictEqual(dryRun.dryRun, true, 'dry run flag should be set');
assert.strictEqual(dryRun.apply, false, 'apply flag should be off in dry run');

const apply = parseArgs(['--apply', '--db', 'postgres://localhost/test']);
assert.strictEqual(apply.apply, true, 'apply flag should be set');
assert.strictEqual(apply.dryRun, false, 'dry-run should be false in apply mode');

console.log('safe settings migration detection tests passed');
