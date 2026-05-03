/**
 * @file supabase-overload.test.js
 * @description Supabase Overload.Test module
 * @module MUMS/MUMS
 * @version UAT
 */
const assert = require('assert');

process.env.SUPABASE_DB_POOLER_URL = process.env.SUPABASE_DB_POOLER_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key';

const {
  verifyJwtCached,
  __resetAuthCacheForTests,
  __setAuthVerifierForTests
} = require('../server/lib/authCache');
const {
  checkRateLimit,
  record503AndMaybeOpen,
  isCircuitOpen,
  __resetRateLimitForTests
} = require('../server/lib/rateLimit');

async function testAuthCache() {
  __resetAuthCacheForTests();
  let calls = 0;
  __setAuthVerifierForTests(async () => {
    calls += 1;
    return { data: { user: { id: 'u-1' } }, error: null };
  });

  const token = 'token-abc';
  const first = await verifyJwtCached(token);
  const second = await verifyJwtCached(token);

  assert.strictEqual(first.id, 'u-1');
  assert.strictEqual(second.id, 'u-1');
  assert.strictEqual(calls, 1, 'expected verifier to be called once due to cache');
}

function testRateLimitBurst() {
  __resetRateLimitForTests();
  const userId = 'user-rate';
  assert.strictEqual(checkRateLimit(userId, 'sync/pull').allowed, true);
  assert.strictEqual(checkRateLimit(userId, 'sync/pull').allowed, true);
  const hit = checkRateLimit(userId, 'sync/pull');
  assert.strictEqual(hit.allowed, false);
  assert.ok(hit.retryAfterSeconds >= 1);
}

function testCircuitBreaker() {
  __resetRateLimitForTests();
  for (let i = 0; i < 5; i += 1) {
    record503AndMaybeOpen();
  }
  assert.strictEqual(isCircuitOpen(), true, 'breaker should open after threshold');
}

async function testPollerHiddenPause() {
  const { createVisibilityAwarePoller } = await import('../src/utils/poller.js');

  let called = 0;
  global.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const poller = createVisibilityAwarePoller(async () => { called += 1; }, 30000);
  poller.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  poller.stop();

  assert.strictEqual(called, 0, 'poller must pause while tab is hidden');
  delete global.document;
}

(async () => {
  await testAuthCache();
  testRateLimitBurst();
  testCircuitBreaker();
  await testPollerHiddenPause();
  console.log('supabase-overload.test.js passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
