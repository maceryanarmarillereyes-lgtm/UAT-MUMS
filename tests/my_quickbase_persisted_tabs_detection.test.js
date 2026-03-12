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
  clearTimeout
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const hooks = sandbox.window.__MUMS_TEST_HOOKS__.myQuickbase;
assert.ok(hooks && typeof hooks.hasPersistedQuickbaseTabs === 'function', 'should expose persisted-tab detector');

assert.strictEqual(hooks.hasPersistedQuickbaseTabs({ tabs: [] }), false, 'empty tabs should not be treated as persisted');
assert.strictEqual(
  hooks.hasPersistedQuickbaseTabs({
    tabs: [
      {
        id: 't-1',
        tabName: 'Main',
        reportLink: '',
        qid: '',
        tableId: '',
        customColumns: [],
        customFilters: [],
        dashboard_counters: []
      }
    ]
  }),
  false,
  'placeholder tab should not be treated as persisted settings'
);
assert.strictEqual(
  hooks.hasPersistedQuickbaseTabs({
    tabs: [
      {
        id: 't-1',
        tabName: 'Main',
        reportLink: '',
        qid: '',
        tableId: '',
        customColumns: ['6'],
        customFilters: [],
        dashboard_counters: []
      }
    ]
  }),
  true,
  'custom columns must count as persisted settings'
);
assert.strictEqual(
  hooks.hasPersistedQuickbaseTabs({
    tabs: [
      {
        id: 't-1',
        tabName: 'Main',
        reportLink: 'https://sample.quickbase.com/db/aaa?a=q&qid=11',
        qid: '11',
        tableId: 'aaa',
        customColumns: [],
        customFilters: [],
        dashboard_counters: []
      }
    ]
  }),
  true,
  'report config must count as persisted settings'
);

console.log('my_quickbase persisted tabs detector test passed');
