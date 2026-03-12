const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/js/pages/my_quickbase.js', 'utf8');

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); }
  };
}

const sandbox = {
  window: {
    Pages: {},
    __MUMS_TEST_HOOKS__: {},
    localStorage: createStorage()
  },
  localStorage: null,
  document: {},
  console,
  setTimeout,
  clearTimeout
};
sandbox.localStorage = sandbox.window.localStorage;

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const hooks = sandbox.window.__MUMS_TEST_HOOKS__.myQuickbase;
assert.ok(hooks && typeof hooks.writeQuickbaseSettingsLocal === 'function', 'should expose local settings helpers');

const key = hooks.getQuickbaseSettingsLocalKey('user-1');
assert.strictEqual(key, 'mums_my_quickbase_settings:user-1');
assert.strictEqual(hooks.getQuickbaseTabsLocalKey('user-1'), 'myQuickbase.tabs:user-1');
assert.strictEqual(hooks.getQuickbaseTabSettingsLocalKey('user-1', 'tab-1'), 'myQuickbase.tab.user-1.tab-1.settings');

const settings = {
  activeTabIndex: 0,
  tabs: [{ tabName: 'Main Report', qid: '-1', tableId: 'abc123', reportLink: 'https://realm.quickbase.com/db/abc123?a=q&qid=-1' }]
};
hooks.writeQuickbaseSettingsLocal('user-1', settings);
const loaded = hooks.readQuickbaseSettingsLocal('user-1');
assert.ok(loaded && Array.isArray(loaded.tabs), 'loaded settings should include tabs');
assert.strictEqual(loaded.tabs[0].qid, '-1');
assert.strictEqual(loaded.tabs[0].tableId, 'abc123');

const perTabSettingsKey = hooks.getQuickbaseTabSettingsLocalKey('user-1', loaded.tabs[0].id);
assert.ok(sandbox.window.localStorage.getItem(perTabSettingsKey), 'tab settings should be stored under per-tab key');


const staleSettings = {
  activeTabIndex: 0,
  tabs: [{ tabName: 'Main Report', qid: '1000288', tableId: 'bpmvztr5', reportLink: '' }]
};
hooks.writeQuickbaseSettingsLocal('user-2', staleSettings);
const loadedStale = hooks.readQuickbaseSettingsLocal('user-2');
assert.ok(loadedStale && loadedStale.tabs && loadedStale.tabs[0], 'loaded stale settings should include first tab');
assert.strictEqual(loadedStale.tabs[0].reportLink, '');
assert.strictEqual(loadedStale.tabs[0].qid, '', 'qid should be cleared when report link is empty');
assert.strictEqual(loadedStale.tabs[0].tableId, '', 'tableId should be cleared when report link is empty');

console.log('my_quickbase local settings helper test passed');
