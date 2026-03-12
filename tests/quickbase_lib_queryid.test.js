/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const assert = require('assert');
const { queryQuickbaseRecords } = require('../server/lib/quickbase');

async function run() {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (_url, opts) => {
    const body = JSON.parse(String(opts && opts.body || '{}'));
    calls.push(body.queryId);

    if (String(body.queryId) === '-2021130') {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({ message: 'Invalid queryId' });
        }
      };
    }

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [
            {
              '3': { value: 'CASE-1' },
              '7': { value: 'Demo' }
            }
          ]
        });
      }
    };
  };

  try {
    const out = await queryQuickbaseRecords({
      config: {
        qb_realm: 'realm.quickbase.com',
        qb_token: 'token',
        qb_table_id: 'tbl123',
        qb_qid: '-2021130'
      },
      select: [3, 7],
      enableQueryIdFallback: true
    });

    assert.equal(out.ok, true, 'fallback variant should recover query');
    assert.deepEqual(calls, ['-2021130', '2021130']);
    assert.equal(out.records.length, 1);
    assert.equal(out.mappedRecords[0]['3'], 'CASE-1');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('quickbase queryId fallback test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
