/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const assert = require('assert');
const Module = require('module');

function loadRouteWithMocks(mocks) {
  const routePath = require.resolve('../server/routes/member_schedule');
  delete require.cache[routePath];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../lib/supabase') return mocks;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../server/routes/member_schedule');
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
    async getUserFromJwt() { return { id: 'admin-1' }; },
    async getProfileForUserId(uid) {
      if (uid === 'admin-1') return { user_id: 'admin-1', role: 'SUPER_ADMIN', team_id: null };
      if (uid === 'u-1') return { user_id: 'u-1', role: 'MEMBER', team_id: 'night_shift' };
      return null;
    },
    async serviceSelect(table, q) {
      calls.push({ table, q });
      if (table === 'mums_documents' && q.includes('mums_schedule_blocks')) {
        return {
          ok: true,
          json: [{
            key: 'mums_schedule_blocks',
            value: {
              'u-1': { days: { '1': [{ start: '22:00', end: '23:00', schedule: 'Back Office' }] } },
              'u-3': { days: { '1': [{ start: '22:00', end: '23:00', schedule: 'Call Available' }] } }
            }
          }]
        };
      }
      if (table === 'mums_team_task_colors') return { ok: true, json: [] };
      if (table === 'mums_profiles' && q.includes('team_id=eq.night_shift')) {
        return {
          ok: true,
          json: [
            { user_id: 'u-1', name: 'Member One', team_id: 'night_shift', role: 'MEMBER', deleted_at: null },
            { user_id: 'u-3', name: 'Member Three', team_id: 'night_shift', role: 'MEMBER', deleted_at: null }
          ]
        };
      }
      if (table === 'mums_documents' && q.includes('mums_team_config')) return { ok: true, json: [] };
      return { ok: true, json: [] };
    }
  });

  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer test-token' },
    query: { includeTeam: '1' }
  };
  const res = makeRes();
  await route(req, res, { memberId: 'u-1' });

  assert.equal(res.statusCode, 200, 'expected success response');
  const payload = JSON.parse(res.body || '{}');
  assert.equal(payload.ok, true, 'payload should be ok');
  assert.equal(payload.teamId, 'night_shift', 'target team should be returned');
  assert.equal(Array.isArray(payload.teamMembers), true, 'teamMembers should be returned');
  assert.equal(payload.teamMembers.length, 2, 'privileged actor should receive full team roster');
  assert.equal(Array.isArray(payload.teamScheduleBlocks), true, 'team schedule blocks should be returned');
  assert.equal(payload.teamScheduleBlocks.length, 2, 'team schedule blocks should include teammates');

  assert.equal(
    calls.some((c) => c.table === 'mums_profiles' && c.q.includes('team_id=eq.night_shift')),
    true,
    'expected team member query by target team id'
  );

  console.log('member_schedule route team visibility test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
