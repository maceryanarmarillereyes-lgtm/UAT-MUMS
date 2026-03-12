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
assert.ok(hooks && typeof hooks.normalizeQuickbaseSettingsWithTabs === 'function', 'normalizeQuickbaseSettingsWithTabs helper should be exposed');

const fallbackConfig = {
  reportLink: 'https://legacy.quickbase.com/db/legacy?a=q&qid=-9',
  qid: '-9',
  tableId: 'legacy',
  realm: 'legacy.quickbase.com',
  customColumns: ['3'],
  customFilters: [{ fieldId: '6', operator: 'EX', value: 'Legacy' }],
  filterMatch: 'ANY',
  dashboardCounters: [{ fieldId: '7', operator: 'EX', value: 'old' }]
};

const normalized = hooks.normalizeQuickbaseSettingsWithTabs({
  activeTabIndex: 1,
  tabs: [
    {
      id: 'tab-a',
      tabName: 'Tab A',
      reportLink: 'https://realm-a.quickbase.com/db/aaa?a=q&qid=-1',
      qid: '-1',
      tableId: 'aaa'
    },
    {
      id: 'tab-b',
      tabName: 'Tab B'
    }
  ]
}, fallbackConfig);

assert.strictEqual(normalized.tabs[1].reportLink, '', 'new tab should stay blank and must not inherit fallback report link');
assert.strictEqual(normalized.tabs[1].qid, '', 'new tab should stay blank and must not inherit fallback qid');
assert.strictEqual(normalized.tabs[1].tableId, '', 'new tab should stay blank and must not inherit fallback table id');
assert.strictEqual(normalized.tabs[1].realm, '', 'new tab should stay blank and must not inherit fallback realm');
assert.strictEqual(JSON.stringify(normalized.tabs[1].customColumns), '[]', 'new tab custom columns should start empty');
assert.strictEqual(JSON.stringify(normalized.tabs[1].customFilters), '[]', 'new tab custom filters should start empty');
assert.strictEqual(normalized.tabs[1].filterMatch, 'ALL', 'new tab filter match should default to ALL');

console.log('my_quickbase tab isolation normalization test passed');
