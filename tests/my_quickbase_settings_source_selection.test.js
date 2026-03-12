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
assert.ok(hooks && typeof hooks.chooseInitialQuickbaseSettingsSource === 'function', 'should expose source chooser helper');

const backendWithTabs = {
  activeTabIndex: 0,
  tabs: [{ id: 'backend-tab', tabName: 'Backend Tab', reportLink: 'https://sample.quickbase.com/db/aaa?a=q&qid=10', qid: '10' }],
  settingsByTabId: { 'backend-tab': { qid: '10' } }
};
const windowWithTabs = {
  activeTabIndex: 0,
  tabs: [{ id: 'window-tab', tabName: 'Window Tab', reportLink: 'https://sample.quickbase.com/db/bbb?a=q&qid=20', qid: '20' }],
  settingsByTabId: { 'window-tab': { qid: '20' } }
};

const pickBackend = hooks.chooseInitialQuickbaseSettingsSource({
  backendQuickbaseSettings: backendWithTabs,
  windowMeQuickbaseSettings: windowWithTabs,
  localQuickbaseSettings: { activeTabIndex: 0, tabs: [{ id: 'local-tab', tabName: 'Local', reportLink: 'https://sample.quickbase.com/db/ccc?a=q&qid=30', qid: '30' }], settingsByTabId: {} }
});

assert.equal(pickBackend.tabs[0].id, 'backend-tab', 'backend settings should win over stale window.me snapshot');

const pickWindow = hooks.chooseInitialQuickbaseSettingsSource({
  backendQuickbaseSettings: { activeTabIndex: 0, tabs: [], settingsByTabId: {} },
  windowMeQuickbaseSettings: windowWithTabs,
  localQuickbaseSettings: null
});
assert.equal(pickWindow.tabs[0].id, 'window-tab', 'window.me settings should be used when backend has no tabs');

const pickLocalFallback = hooks.chooseInitialQuickbaseSettingsSource({
  backendQuickbaseSettings: { activeTabIndex: 0, tabs: [], settingsByTabId: {} },
  windowMeQuickbaseSettings: { activeTabIndex: 0, tabs: [], settingsByTabId: {} },
  localQuickbaseSettings: { activeTabIndex: 0, tabs: [{ id: 'local-tab', tabName: 'Local', reportLink: 'https://sample.quickbase.com/db/ccc?a=q&qid=30', qid: '30' }], settingsByTabId: { 'local-tab': { qid: '30' } } }
});
assert.equal(pickLocalFallback.tabs[0].id, 'local-tab', 'local cache should be the final fallback');

assert.equal(hooks.hasUsableQuickbaseSettings({}), false, 'empty settings object is not usable');
assert.equal(hooks.hasUsableQuickbaseSettings({ qid: '100288' }), true, 'flat quickbase settings with qid is usable');
assert.equal(hooks.hasUsableQuickbaseSettings({ tabs: [{ id: 't1', tabName: 'Main' }] }), true, 'tabbed settings are usable');

console.log('my_quickbase settings source selection tests passed');
