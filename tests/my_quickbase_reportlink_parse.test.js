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
assert.ok(hooks && typeof hooks.normalizeQuickbaseSettingsWithTabs === 'function', 'normalize helper should be exposed');

const normalized = hooks.normalizeQuickbaseSettingsWithTabs({
  activeTabIndex: 0,
  tabs: [
    {
      id: 'tab-main',
      tabName: 'Custom Screen Triage',
      reportLink: 'https://copeland-coldchainservices.quickbase.com/nav/app/bpvmztzkw/table/bpvm1212tzr5/action/q?qid=123',
      qid: '',
      tableId: ''
    }
  ]
}, {});

assert.strictEqual(normalized.tabs[0].qid, '123', 'qid should be extracted from reportLink');
assert.strictEqual(normalized.tabs[0].tableId, 'bpvm1212tzr5', 'tableId should be extracted from reportLink');

console.log('my_quickbase reportLink parsing test passed');
