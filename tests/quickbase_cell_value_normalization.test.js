const assert = require('assert');
const { normalizeQuickbaseCellValue } = require('../server/lib/quickbase');

assert.equal(
  normalizeQuickbaseCellValue({ value: { name: 'Mace Ryan Reyes', id: 'u1' } }),
  'Mace Ryan Reyes'
);

assert.equal(
  normalizeQuickbaseCellValue({ value: { email: 'agent@example.com' } }),
  'agent@example.com'
);

assert.equal(
  normalizeQuickbaseCellValue({ value: [{ name: 'A' }, { displayValue: 'B' }] }),
  'A, B'
);

assert.equal(
  normalizeQuickbaseCellValue({ value: {} }),
  ''
);

console.log('quickbase cell value normalization test passed');
