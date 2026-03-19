const assert = require('assert');
const route = require('../server/routes/auth/password_login');

function createRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    end(payload) {
      this.body = String(payload || '');
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()] || '';
    }
  };
}

async function testMissingCredentials() {
  const req = { method: 'POST', body: { email: '', password: '' } };
  const res = createRes();
  await route(req, res);
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'missing_credentials');
}

async function testProxySuccess() {
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify({ access_token: 'token123', user: { id: 'u1' } })
  });

  try {
    const req = { method: 'POST', body: { email: 'a@b.com', password: 'pw123' } };
    const res = createRes();
    await route(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.access_token, 'token123');
    assert.equal(body.user.id, 'u1');
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  await testMissingCredentials();
  await testProxySuccess();
  console.log('auth password_login route tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
