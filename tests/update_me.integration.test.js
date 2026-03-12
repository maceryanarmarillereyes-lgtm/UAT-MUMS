const assert = require('assert');
const Module = require('module');

function loadRoute({ supabaseMocks, schemaMocks }) {
  const routePath = require.resolve('../server/routes/users/update_me');
  delete require.cache[routePath];

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === '../../lib/supabase') return supabaseMocks;
    if (request === '../../startup/schema-check') return schemaMocks;
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

async function testNormalizeAndEscape() {
  const calls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-1' }),
      getProfileForUserId: async () => ({ user_id: 'u-1', role: 'MEMBER' }),
      serviceSelect: async () => ({ ok: true, json: [{ column_name: 'quickbase_settings' }] }),
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async () => true
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: JSON.stringify({
        qid: '7',
        filters: [{ fid: '6', operator: 'Is Not', value: "O'Reilly" }]
      })
    }
  };
  const res = makeRes();

  await route(req, res);
  const payload = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quickbase_settings.customFilters[0].fieldId, '6');
  assert.equal(calls[0].quickbase_settings.customFilters[0].operator, 'XEX');
  assert.equal(calls[0].quickbase_settings.customFilters[0].value, "O''Reilly");
}

async function testFallbackColumnMissing() {
  const calls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-2' }),
      getProfileForUserId: async () => ({ user_id: 'u-2', role: 'MEMBER' }),
      serviceSelect: async () => ({ ok: true, json: [] }),
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async () => false
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: {
        qid: '9',
        filters: [{ fid: '10', operator: 'Contains', value: "Kid's" }]
      }
    }
  };
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].quickbase_settings, 'undefined');
  assert.ok(calls[0].quickbase_config);
}

async function testQuickbaseSettingsTabsArePreserved() {
  const calls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-3' }),
      getProfileForUserId: async () => ({ user_id: 'u-3', role: 'MEMBER' }),
      serviceSelect: async () => ({ ok: true, json: [{ column_name: 'quickbase_settings' }] }),
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async () => true
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: {
        activeTabIndex: 1,
        tabs: [
          { id: 't-1', tabName: 'Main', reportLink: 'https://sample.quickbase.com/db/aaa?a=q&qid=1', qid: '1', customFilters: [{ fieldId: '6', operator: 'EX', value: 'A' }] },
          { id: 't-2', tabName: 'Second', reportLink: 'https://sample.quickbase.com/db/bbb?a=q&qid=2', qid: '2', customFilters: [{ fieldId: '7', operator: 'Contains', value: "Kid's" }] }
        ]
      }
    }
  };
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(Array.isArray(calls[0].quickbase_settings.tabs), true);
  assert.equal(calls[0].quickbase_settings.tabs.length, 2);
  assert.equal(calls[0].quickbase_settings.activeTabIndex, 1);
  assert.equal(calls[0].quickbase_settings.tabs[1].customFilters[0].value, "Kid's");
  assert.equal(calls[0].qb_qid, '2');
}

async function testQuickbaseConfigDoesNotOverrideTabbedSettings() {
  const calls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-4' }),
      getProfileForUserId: async () => ({ user_id: 'u-4', role: 'MEMBER' }),
      serviceSelect: async () => ({ ok: true, json: [{ column_name: 'quickbase_settings' }] }),
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async () => true
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: {
        activeTabIndex: 1,
        tabs: [
          { id: 't-1', tabName: 'Main', qid: '1', tableId: 'aaa' },
          { id: 't-2', tabName: 'Second', qid: '2', tableId: 'bbb' }
        ]
      },
      quickbase_config: {
        qid: 'fallback-qid',
        tableId: 'fallback-table'
      }
    }
  };
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(Array.isArray(calls[0].quickbase_settings.tabs), true);
  assert.equal(calls[0].quickbase_settings.activeTabIndex, 1);
  assert.equal(calls[0].quickbase_settings.tabs[1].qid, '2');
}

async function testColumnProbeUsesMumsProfilesInsteadOfInformationSchema() {
  const calls = [];
  const serviceSelectCalls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-5' }),
      getProfileForUserId: async () => ({ user_id: 'u-5', role: 'MEMBER' }),
      serviceSelect: async (tableOrPath, query) => {
        serviceSelectCalls.push({ tableOrPath, query });
        if (tableOrPath === 'mums_profiles' && String(query || '').includes('select=quickbase_settings')) {
          return { ok: true, json: [{ quickbase_settings: null }] };
        }
        return { ok: false, json: [] };
      },
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async (db) => {
        const rows = await db.query();
        return Array.isArray(rows) && rows.length > 0;
      }
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: {
        qid: '11',
        filters: [{ fid: '10', operator: 'Contains', value: 'Case' }]
      }
    }
  };
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(calls[0], 'quickbase_settings'));
  assert.equal(typeof calls[0].quickbase_config, 'object');
  assert.equal(
    serviceSelectCalls.some((c) => c.tableOrPath === 'mums_profiles' && String(c.query || '').includes('select=quickbase_settings')),
    true
  );
  assert.equal(serviceSelectCalls.some((c) => String(c.tableOrPath || '').includes('information_schema.columns')), false);
}

async function testRetryPreservesQuickbaseSettingsWhenOnlyLegacyColumnsAreMissing() {
  const calls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-6' }),
      getProfileForUserId: async () => ({ user_id: 'u-6', role: 'MEMBER' }),
      serviceSelect: async () => ({ ok: true, json: [{ column_name: 'quickbase_settings' }] }),
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        if (calls.length === 1) {
          return {
            ok: false,
            json: {
              message: 'column "qb_custom_columns" does not exist'
            }
          };
        }
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async () => true
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: {
        activeTabIndex: 0,
        tabs: [
          {
            id: 'tab-main',
            tabName: 'Main Report',
            reportLink: 'https://sample.quickbase.com/db/aaa?a=q&qid=11',
            qid: '11',
            tableId: 'aaa',
            customColumns: ['6', '7'],
            customFilters: [{ fieldId: '6', operator: 'EX', value: 'OPEN' }],
            dashboard_counters: [{ fieldId: '6', operator: 'EX', value: 'OPEN', label: 'Open' }]
          }
        ]
      }
    }
  };
  const res = makeRes();

  await route(req, res);
  const payload = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.equal(Array.isArray(calls[0].qb_custom_columns), true);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1], 'qb_custom_columns'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1], 'quickbase_settings'), true);
  assert.equal(Array.isArray(calls[1].quickbase_settings.tabs), true);
  assert.equal(calls[1].quickbase_settings.tabs[0].qid, '11');
  assert.equal(payload.ok, true);
}


async function testInvalidReportTabsAreDroppedBeforePersist() {
  const calls = [];
  const route = loadRoute({
    supabaseMocks: {
      getUserFromJwt: async () => ({ id: 'u-7' }),
      getProfileForUserId: async () => ({ user_id: 'u-7', role: 'MEMBER' }),
      serviceSelect: async () => ({ ok: true, json: [{ column_name: 'quickbase_settings' }] }),
      serviceUpdate: async (_table, patch) => {
        calls.push(patch);
        return { ok: true, json: [patch] };
      }
    },
    schemaMocks: {
      ensureQuickbaseSettingsColumn: async () => true
    }
  });

  const req = {
    method: 'PATCH',
    headers: { authorization: 'Bearer token' },
    body: {
      quickbase_settings: {
        activeTabIndex: 1,
        tabs: [
          { id: 'bad-tab', tabName: 'Broken', reportLink: 'https://sample.quickbase.com/db/aaa?a=q', qid: '', tableId: '' },
          { id: 'good-tab', tabName: 'Working', reportLink: 'https://sample.quickbase.com/db/bbb?a=q&qid=22' }
        ]
      }
    }
  };
  const res = makeRes();

  await route(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quickbase_settings.tabs.length, 1);
  assert.equal(calls[0].quickbase_settings.tabs[0].id, 'good-tab');
  assert.equal(calls[0].quickbase_settings.tabs[0].qid, '22');
  assert.equal(calls[0].quickbase_settings.tabs[0].tableId, 'bbb');
  assert.equal(calls[0].quickbase_settings.activeTabIndex, 0);
}

async function run() {
  await testNormalizeAndEscape();
  await testFallbackColumnMissing();
  await testQuickbaseSettingsTabsArePreserved();
  await testQuickbaseConfigDoesNotOverrideTabbedSettings();
  await testColumnProbeUsesMumsProfilesInsteadOfInformationSchema();
  await testRetryPreservesQuickbaseSettingsWhenOnlyLegacyColumnsAreMissing();
  await testInvalidReportTabsAreDroppedBeforePersist();
  console.log('update_me integration tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
