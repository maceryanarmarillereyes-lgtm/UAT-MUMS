const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('services-grid stamps data-row-id and row highlight css variable hook', () => {
  const src = fs.readFileSync('public/js/services-grid.js', 'utf8');
  assert.match(src, /tr\.dataset\.rowId\s*=\s*rowData\s*&&\s*rowData\.id/);
  assert.match(src, /tr\.classList\.add\('cf-row-highlighted'\)/);
  assert.match(src, /tr\.style\.setProperty\('--cf-row-bg'/);
});

test('conditional format paint maps row highlight by data-row-id', () => {
  const src = fs.readFileSync('public/js/services-conditional-format.js', 'utf8');
  assert.match(src, /querySelector\('tr\[data-row-id="' \+ rowKey \+ '"\]'\)/);
  assert.match(src, /rowRef\.__cfRowBg\s*=\s*semiBg/);
});
