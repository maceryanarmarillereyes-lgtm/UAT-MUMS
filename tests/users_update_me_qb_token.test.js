/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const assert = require('assert');
const Module = require('module');

function loadRouteWithMocks(mocks) {
  const routePath = require.resolve('../server/routes/users/update_me');
  delete require.cache[routePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../../lib/supabase') {
      return {
        getUserFromJwt: mocks.getUserFromJwt,
        getProfileForUserId: mocks.getProfileForUserId,
        serviceUpdate: mocks.serviceUpdate
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../server/routes/users/update_me');
  } finally {
    Module._load = originalLoad;
  }
}

function makeRes() {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; }
  };
}

async function run() {
  let patchSeen = null;

  const route = loadRouteWithMocks({
    async getUserFromJwt() { return { id: 'u-1' }; },
    async getProfileForUserId() { return { user_id: 'u-1', role: 'MEMBER' }; },
    async serviceUpdate(_table, patch) {
      patchSeen = patch;
      return { ok: true, json: [patch] };
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: { qb_token: 'qb-secret-token', name: 'Agent 1' }
  };
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(patchSeen.qb_token, 'qb-secret-token');
  assert.equal(patchSeen.name, 'Agent 1');

  console.log('users/update_me qb_token patch test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
