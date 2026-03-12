/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const assert = require('assert');
const Module = require('module');

function loadRouteWithMocks(mocks) {
  const routePath = require.resolve('../server/routes/quickbase/monitoring');
  delete require.cache[routePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../tasks/_common') {
      return {
        sendJson: mocks.sendJson,
        requireAuthedUser: mocks.requireAuthedUser
      };
    }
    if (request === '../../lib/quickbase') {
      return {
        listQuickbaseFields: mocks.listQuickbaseFields,
        queryQuickbaseRecords: mocks.queryQuickbaseRecords,
        normalizeQuickbaseCellValue: mocks.normalizeQuickbaseCellValue || ((v) => v)
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../server/routes/quickbase/monitoring');
  } finally {
    Module._load = originalLoad;
  }
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; return this; }
  };
}

async function run() {
  const calls = [];

  const route = loadRouteWithMocks({
    async requireAuthedUser() {
      return {
        id: 'u-1',
        profile: {
          qb_token: 'token',
          qb_realm: 'realm.quickbase.com',
          qb_table_id: 'tbl123',
          qb_qid: '-2021117'
        }
      };
    },
    sendJson(res, code, payload) {
      res.statusCode = code;
      res.body = JSON.stringify(payload);
      return res;
    },
    async listQuickbaseFields() {
      return {
        ok: true,
        fields: [
          { id: 3, label: 'Case #' },
          { id: 7, label: 'End User' },
          { id: 8, label: 'Short Description or New "Concern" That Is Not in The KB' },
          { id: 9, label: 'Case Status' },
          { id: 10, label: 'Assigned to' },
          { id: 11, label: 'Last Update Days' },
          { id: 12, label: 'Age' },
          { id: 13, label: 'Type' }
        ]
      };
    },
    normalizeQuickbaseCellValue(value) {
      if (value && typeof value === 'object' && value.name) return value.name;
      return value;
    },
    async queryQuickbaseRecords(opts) {
      calls.push(opts);
      return {
        ok: true,
        records: [
          {
            '3': { value: 'CASE-1' },
            '7': { value: 'Woolworths' },
            '8': { value: 'Issue 1' },
            '9': { value: 'A - Active' },
            '10': { value: { name: 'Agent 1', email: 'agent1@example.com' } },
            '11': { value: '2' },
            '12': { value: '5' },
            '13': { value: 'Graphical Screen Service' }
          }
        ]
      };
    }
  });

  const req = { method: 'GET', query: {} };
  const res = makeRes();
  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1, 'queryQuickbaseRecords should be called once');
  const where = String(calls[0].where || '');
  assert.equal(Array.isArray(calls[0].select), true, 'select should be provided');
  assert.equal(calls[0].select.length, 8, 'QID-backed query without report metadata should fallback to mapped selected fields');
  assert.equal(calls[0].allowEmptySelect, true, 'allowEmptySelect should stay enabled for QID-backed query');
  assert.equal(calls[0].enableQueryIdFallback, false, 'QID-backed query must not fall back to table-wide query');
  assert.equal(typeof where, 'string');
  assert.equal(where.includes('Owner Email'), false, 'QID-backed query should not force owner email clause');

  const payload = JSON.parse(res.body || '{}');
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.columns), true);
  assert.equal(payload.settings.fieldIds.type, 13);
  assert.equal(payload.records[0].qbRecordId, 'CASE-1');
  assert.equal(payload.records[0].fields['8'].value, 'Issue 1');
  assert.equal(payload.records[0].fields['10'].value, 'Agent 1');

  console.log('quickbase monitoring route defaults test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
