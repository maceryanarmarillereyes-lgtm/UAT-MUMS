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
assert.ok(hooks && typeof hooks.shouldApplyInitialFilters === 'function', 'should expose initial-load helper');
assert.strictEqual(hooks.shouldApplyInitialFilters(''), false, 'empty search should render default report');
assert.strictEqual(hooks.shouldApplyInitialFilters('   '), false, 'whitespace-only search should render default report');
assert.strictEqual(hooks.shouldApplyInitialFilters('abc'), true, 'non-empty search should apply filters');

console.log('my_quickbase initial load helper test passed');
