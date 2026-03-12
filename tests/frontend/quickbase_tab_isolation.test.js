const assert = require('assert');

const TabManager = require('../../public/js/pages/my_quickbase_tab_manager.js');

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  };
}

async function run() {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        if (String(url).includes('/api/quickbase_tabs?')) return { ok: true, rows: [] };
        return { ok: true, row: { tab_id: 'ok' } };
      }
    };
  };

  global.localStorage = createMemoryStorage();
  global.document = { querySelector() { return null; } };
  global.structuredClone = (v) => JSON.parse(JSON.stringify(v));

  TabManager.init({ userId: 'user-1', apiBaseUrl: '/api' });

  const tabA = TabManager.createTab({ tabName: 'Tab A' });
  TabManager.updateTabLocal(tabA, { reportLink: 'https://a', qid: '101', tableId: 'tbl-a' });
  await TabManager.saveTab(tabA);

  const tabB = TabManager.createTab({ tabName: 'Tab B' });
  TabManager.updateTabLocal(tabB, { reportLink: 'https://b', qid: '202', tableId: 'tbl-b' });
  await TabManager.saveTab(tabB);

  const a = TabManager.getTab(tabA).settings;
  const b = TabManager.getTab(tabB).settings;

  assert.strictEqual(a.reportLink, 'https://a');
  assert.strictEqual(a.qid, '101');
  assert.strictEqual(a.tableId, 'tbl-a');

  assert.strictEqual(b.reportLink, 'https://b');
  assert.strictEqual(b.qid, '202');
  assert.strictEqual(b.tableId, 'tbl-b');

  assert.notStrictEqual(a, b, 'tabs must not share references');
  assert.strictEqual(calls.filter((c) => String(c.url).includes('/quickbase_tabs/upsert')).length, 2);

  console.log('frontend quickbase tab isolation test passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
