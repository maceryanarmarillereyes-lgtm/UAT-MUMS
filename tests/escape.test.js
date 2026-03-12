const assert = require('assert');
const { escapeQuickbaseValue } = require('../server/lib/escape');

function run() {
  assert.equal(escapeQuickbaseValue("O'Reilly"), "O''Reilly");
  assert.equal(escapeQuickbaseValue(null), null);
  console.log('escapeQuickbaseValue tests passed');
}

run();
