const assert = require('assert');
const { normalizeSettings } = require('../server/lib/normalize_settings');

const sameObj = { a: 1 };
assert.strictEqual(normalizeSettings(sameObj), sameObj, 'object input should return same object reference');

const parsed = normalizeSettings('{"enabled":true,"team":"ops"}');
assert.deepStrictEqual(parsed, { enabled: true, team: 'ops' }, 'valid JSON string should parse into object');

const invalid = normalizeSettings('{invalid json');
assert.deepStrictEqual(invalid, {}, 'invalid string should fall back to empty object');

console.log('settings normalize tests passed');
