const assert = require('assert');
const svc = require('../server/services/quickbaseSync');

(function testParseQbUrl(){
  const parsed = svc.parseQbUrl('https://copeland.quickbase.com/nav/app/abc/table/bcd123?action=td&qid=-7');
  assert.equal(parsed.realm, 'copeland.quickbase.com');
  assert.equal(parsed.tableId, 'bcd123');
  assert.equal(parsed.qid, '-7');
})();

(function testNormalizeUrl(){
  const a = svc.normalizeUrl('/up/b/abc/a/r1/e1/v0', 'copeland.quickbase.com');
  assert.ok(a.startsWith('https://copeland.quickbase.com/'));
})();

(function testMapAndDedupe(){
  const fields = { '20': 'Download Link' };
  const recordA = { '3': { value: 10 }, '6': { value: 'Doc A' }, '20': { value: 'https://copeland.quickbase.com/file/a.pdf' } };
  const recordB = { '3': { value: 10 }, '6': { value: 'Doc A Updated' }, '20': { value: 'https://copeland.quickbase.com/file/b.pdf' } };
  const a = svc.mapRecordToKbItem(recordA, fields, { quickbaseRealm: 'copeland.quickbase.com', quickbaseAppUrl: 'https://x' });
  const b = svc.mapRecordToKbItem(recordB, fields, { quickbaseRealm: 'copeland.quickbase.com', quickbaseAppUrl: 'https://x' });
  const deduped = svc.dedupeById([a,b]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].download_url.length, 1);
})();

console.log('quickbaseSync.service.test.js passed');
