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
assert.ok(hooks && typeof hooks.filterRecordsBySearch === 'function', 'should expose search filter helper');
assert.ok(hooks && typeof hooks.filterRecordsByCounter === 'function', 'should expose counter filter helper');
assert.ok(hooks && typeof hooks.shouldApplyServerFilters === 'function', 'should expose server filter toggle helper');


const serverFilterByUserAction = hooks.shouldApplyServerFilters({ applyFilters: true });
assert.equal(serverFilterByUserAction, true, 'server filters should only apply when explicitly requested');

const serverFilterByCounterOnly = hooks.shouldApplyServerFilters({ applyFilters: false, activeCounterIndex: 2 });
assert.equal(serverFilterByCounterOnly, false, 'counter-only selection must stay client-side to avoid server-side empty resets');

const payload = {
  columns: [
    { id: '7', label: 'End User' },
    { id: '8', label: 'Case Status' },
    { id: '9', label: 'Type' }
  ],
  records: [
    {
      qbRecordId: 'C-1001',
      fields: {
        '7': { value: 'Countdown' },
        '8': { value: 'O - Waiting for Customer' },
        '9': { value: 'CS Triaging' }
      }
    },
    {
      qbRecordId: 'C-1002',
      fields: {
        '7': { value: 'Woolworths' },
        '8': { value: 'O - Investigating' },
        '9': { value: 'Graphical Screen Service' }
      }
    },
    {
      qbRecordId: 'C-2000',
      fields: {
        '7': { value: 'Countdown' },
        '8': { value: 'Resolved' },
        '9': { value: 'CS Triaging' }
      }
    }
  ]
};

const counterExact = hooks.filterRecordsByCounter(payload, { fieldId: '7', operator: 'EX', value: 'Countdown' });
assert.equal(counterExact.records.length, 2, 'EX counter should filter by exact value');

const counterContains = hooks.filterRecordsByCounter(payload, { fieldId: '8', operator: 'CT', value: 'waiting' });
assert.equal(counterContains.records.length, 1, 'CT counter should support case-insensitive contains');
assert.equal(counterContains.records[0].qbRecordId, 'C-1001');

const counterNot = hooks.filterRecordsByCounter(payload, { fieldId: '7', operator: 'XEX', value: 'Countdown' });
assert.equal(counterNot.records.length, 1, 'XEX counter should exclude exact value');
assert.equal(counterNot.records[0].qbRecordId, 'C-1002');

const wideSearch = hooks.filterRecordsBySearch(payload, 'screen service');
assert.equal(wideSearch.records.length, 1, 'search should match any visible column content');
assert.equal(wideSearch.records[0].qbRecordId, 'C-1002');

const caseSearch = hooks.filterRecordsBySearch(payload, 'c-2000');
assert.equal(caseSearch.records.length, 1, 'search should also match Case #');
assert.equal(caseSearch.records[0].qbRecordId, 'C-2000');

console.log('my_quickbase counter + search filters test passed');
