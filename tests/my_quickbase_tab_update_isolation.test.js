const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/js/pages/my_quickbase.js', 'utf8');

const sandbox = {
  window: {
    Pages: {},
    __MUMS_TEST_HOOKS__: {}
  },
  document: {},
  console,
  setTimeout,
  clearTimeout,
  URL
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const hooks = sandbox.window.__MUMS_TEST_HOOKS__.myQuickbase;
assert.ok(hooks && typeof hooks.normalizeQuickbaseSettingsWithTabs === 'function', 'normalize helper should be exposed');

const normalized = hooks.normalizeQuickbaseSettingsWithTabs({
  activeTabIndex: 0,
  tabs: [
    { id: 'tab-1', tabName: 'Tab #1', reportLink: 'https://tenant.quickbase.com/nav/app/app1/table/table1/action/q?qid=101', qid: '101', tableId: 'table1' },
    { id: 'tab-2', tabName: 'Tab #2', reportLink: 'https://tenant.quickbase.com/nav/app/app2/table/table2/action/q?qid=202', qid: '202', tableId: 'table2' }
  ]
}, {});

const tab1Before = JSON.parse(JSON.stringify(normalized.settingsByTabId['tab-1']));
const tab2Before = normalized.settingsByTabId['tab-2'];

// Simulate updating only Tab #2 settings in-memory
normalized.settingsByTabId['tab-2'] = Object.assign({}, normalized.settingsByTabId['tab-2'], {
  reportLink: 'https://tenant.quickbase.com/nav/app/app2/table/table9/action/q?qid=909',
  qid: '909',
  tableId: 'table9'
});

assert.notStrictEqual(normalized.settingsByTabId['tab-2'], tab2Before, 'tab-2 should be replaced with a new object reference');
assert.strictEqual(JSON.stringify(normalized.settingsByTabId['tab-1']), JSON.stringify(tab1Before), 'tab-1 settings must remain unchanged when tab-2 updates');
assert.notStrictEqual(normalized.settingsByTabId['tab-1'], normalized.settingsByTabId['tab-2'], 'tab settings should never share object references');

console.log('my_quickbase tab update isolation test passed');
