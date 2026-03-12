/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const assert = require('assert');
const Module = require('module');

function loadRouteWithMocks(mocks) {
  const routePath = require.resolve('../server/routes/users/create');
  delete require.cache[routePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../../lib/supabase') {
      return {
        getUserFromJwt: mocks.getUserFromJwt,
        getProfileForUserId: mocks.getProfileForUserId,
        serviceSelect: mocks.serviceSelect,
        serviceInsert: mocks.serviceInsert
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../server/routes/users/create');
  } finally {
    Module._load = originalLoad;
  }
}

function makeReq(body) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer jwt' },
    body
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; }
  };
}

async function run() {
  const inserts = [];

  const route = loadRouteWithMocks({
    async getUserFromJwt() { return { id: 'creator-1' }; },
    async getProfileForUserId() { return { role: 'SUPER_ADMIN', team_id: null }; },
    async serviceSelect(_table, query) {
      if (String(query).includes('username=eq.')) return { ok: true, json: [] };
      if (String(query).includes('email=eq.')) return { ok: true, json: [] };
      return { ok: true, json: [] };
    },
    async serviceInsert(_table, rows) {
      inserts.push(rows[0]);
      if (inserts.length === 1) {
        return {
          ok: false,
          status: 400,
          json: { code: '23502', message: 'null value in column "user_id" of relation "mums_profiles" violates not-null constraint' }
        };
      }
      return {
        ok: true,
        status: 201,
        json: [{ ...rows[0], id: 123 }]
      };
    }
  });

  const req = makeReq({
    email: 'new.user@example.com',
    username: 'newuser',
    full_name: 'New User',
    role: 'MEMBER',
    team_id: 'morning'
  });
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(inserts.length, 2, 'should retry insert with generated user_id for legacy schema');
  assert.equal(typeof inserts[1].user_id, 'string');
  assert.equal(inserts[1].user_id.length > 8, true);

  const payload = JSON.parse(res.body || '{}');
  assert.equal(payload.ok, true);
  assert.equal(payload.error, undefined);

  console.log('users/create legacy user_id fallback test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
