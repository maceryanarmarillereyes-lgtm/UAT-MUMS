const assert = require('assert');
const { normalizeSettings } = require('../lib/normalizeSettings');

const same = { enabled: true };
assert.strictEqual(normalizeSettings(same), same, 'object must be returned as-is');
assert.deepStrictEqual(normalizeSettings('{"team":"ops"}'), { team: 'ops' }, 'JSON object string should parse');
assert.deepStrictEqual(normalizeSettings('[1,2,3]'), [1, 2, 3], 'JSON array string should parse');
assert.deepStrictEqual(normalizeSettings('alerts, reports'), { alerts: true, reports: true }, 'CSV string should become flag map');
assert.deepStrictEqual(normalizeSettings('{broken json'), {}, 'invalid JSON should return empty object');
assert.deepStrictEqual(normalizeSettings(''), {}, 'empty string should return empty object');

console.log('normalizeSettings tests passed');
