const assert = require('assert');
const { normalizeFilters } = require('../server/lib/quickbase-utils');

function testAliasMapping() {
  const out = normalizeFilters([
    { fid: 1, operator: 'Is Not', value: 'x' },
    { fid: 2, operator: 'Contains', value: 'y' },
    { fid: 3, operator: 'Is Not Empty', value: 'z' }
  ]);

  assert.equal(out[0].operator, 'XEX');
  assert.equal(out[1].operator, 'CT');
  assert.equal(out[2].operator, 'XNE');
}

function testUnknownOperatorUnchanged() {
  const out = normalizeFilters([{ fid: 1, operator: 'CUSTOM_OP', value: 'x' }]);
  assert.equal(out[0].operator, 'CUSTOM_OP');
}

function testTooManyFilters() {
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ fid: i + 1, operator: 'Is', value: 'v' }));
  assert.throws(() => normalizeFilters(tooMany), /too_many_filters/);
}

function run() {
  testAliasMapping();
  testUnknownOperatorUnchanged();
  testTooManyFilters();
  console.log('normalizeFilters tests passed');
}

run();
