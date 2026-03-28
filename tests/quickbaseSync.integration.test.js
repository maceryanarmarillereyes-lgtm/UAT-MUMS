const assert = require('assert');
const svc = require('../server/services/quickbaseSync');

(async function testFetchAllQuickbaseRecordsPagination(){
  const oldFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body || '{}');
    const skip = body.options && body.options.skip || 0;
    const rows = skip === 0
      ? new Array(250).fill(0).map((_, i) => ({ '3': { value: i + 1 }, '6': { value: `Row ${i+1}` } }))
      : [{ '3': { value: 251 }, '6': { value: 'Row 251' } }];
    return {
      ok: true,
      json: async () => ({ data: rows, fields: [{ id: 6, label: 'Name' }, { id: 20, label: 'Download Link' }] })
    };
  };

  const out = await svc.fetchAllQuickbaseRecords({
    quickbaseTableId: 'tbl',
    quickbaseRealm: 'copeland.quickbase.com',
    quickbaseUserToken: 'token',
    quickbaseQid: '-7'
  });

  assert.equal(calls, 2);
  assert.equal(out.records.length, 251);
  assert.ok(out.fields['6']);
  global.fetch = oldFetch;
})();

console.log('quickbaseSync.integration.test.js passed');
