/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const assert = require('assert');
const { _test } = require('../server/routes/overall_stats');

function run() {
  assert.strictEqual(_test.parseIsoDate('2026-02-10'), '2026-02-10');
  assert.strictEqual(_test.parseIsoDate('2026-2-10'), null);
  assert.strictEqual(_test.addDays('2026-02-10', 1), '2026-02-11');
  assert.strictEqual(_test.addDays('2026-02-10', -1), '2026-02-09');

  const range = _test.rangeDays('2026-02-10', '2026-02-16');
  assert.strictEqual(range, 7);

  assert.strictEqual(_test.weekStartIso('2026-02-10'), '2026-02-09'); // Tuesday -> Monday of same week
  assert.strictEqual(_test.weekStartIso('2026-02-09'), '2026-02-09'); // Monday
  assert.strictEqual(_test.weekStartIso('2026-02-08'), '2026-02-02'); // Sunday -> previous Monday

  assert.strictEqual(_test.dayIndexFromIso('2026-02-08'), 0);
  assert.strictEqual(_test.dayIndexFromIso('2026-02-09'), 1);
}

try {
  run();
  console.log('overall_stats_date.test.js: ok');
} catch (err) {
  console.error('overall_stats_date.test.js: failed');
  console.error(err);
  process.exit(1);
}
