/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const { test, expect } = require('@playwright/test');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function extractSupabaseRef(supabaseUrl) {
  try {
    const u = new URL(supabaseUrl);
    const host = u.hostname; // <ref>.supabase.co
    const ref = host.split('.')[0];
    return ref || '';
  } catch (_) {
    return '';
  }
}

async function assertEnvEndpoint(page, baseUrl, expectedRefEnvVarName) {
  const res = await page.request.get(`${baseUrl}/api/env`, {
    headers: { 'cache-control': 'no-store' }
  });
  expect(res.status(), `${baseUrl}/api/env should return 200`).toBe(200);

  const json = await res.json();
  expect(json).toBeTruthy();
  expect(json.SUPABASE_URL, 'SUPABASE_URL must be present').toBeTruthy();
  expect(json.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY must be present').toBeTruthy();

  // Optional: assert project ref when EXPECTED_*_REF is provided
  const expectedRef = process.env[expectedRefEnvVarName];
  if (expectedRef) {
    expect(
      String(json.SUPABASE_URL),
      `SUPABASE_URL should contain expected project ref from ${expectedRefEnvVarName}`
    ).toContain(expectedRef);
  }

  // Basic structural sanity check
  const ref = extractSupabaseRef(String(json.SUPABASE_URL));
  expect(ref, 'SUPABASE_URL must look like https://<ref>.supabase.co').toBeTruthy();

  return { json, ref };
}

async function gotoLogin(page, baseUrl) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
}

async function attemptLoginAndAssertNotLocalFallback(page, { emailOrUsername, password }) {
  await page.fill('#login', emailOrUsername);
  await page.fill('#password', password);

  const errBox = page.locator('#err');

  // Click login; then wait for either dashboard navigation or an error.
  await page.click('#loginBtn');

  const outcome = await Promise.race([
    page.waitForURL(/\/dashboard(\/|$)/, { timeout: 20000 }).then(() => ({ ok: true })),
    errBox.waitFor({ state: 'visible', timeout: 20000 }).then(() => ({ ok: false }))
  ]);

  if (outcome.ok) {
    // Logged in – verify logged-in UI and that session mode is supabase
    await expect(page.locator('#logoutBtn')).toBeVisible({ timeout: 20000 });

    const mode = await page.evaluate(() => {
      try {
        return window.Store && window.Store.getSession ? (window.Store.getSession() || {}).mode : null;
      } catch (_) {
        return null;
      }
    });

    expect(mode, 'Session mode should be supabase (not local fallback)').toBe('supabase');
    return;
  }

  // Error path: must NOT be local fallback “User not found.”
  const msg = (await errBox.textContent()) || '';
  expect(msg).not.toMatch(/User not found\.?/i);

  // Prefer a Supabase credential-style error message.
  // Supabase commonly returns “Invalid login credentials”.
  // We accept other auth-related strings to avoid brittle coupling.
  expect(
    msg,
    'Login failure should look like a Supabase Auth error (credentials/invalid/confirm/etc.), not local fallback.'
  ).toMatch(/invalid|credential|confirm|email|password|too many|rate limit|token|auth/i);
}

async function assertRuntimeEnvLoadedInPage(page) {
  // Ensure the runtime loader actually populated MUMS_ENV in the browser.
  await page.waitForFunction(() => {
    try {
      return !!(window.EnvRuntime && window.EnvRuntime.env && window.EnvRuntime.env().SUPABASE_URL && window.EnvRuntime.env().SUPABASE_ANON_KEY);
    } catch (_) {
      return false;
    }
  }, { timeout: 20000 });

  const env = await page.evaluate(() => (window.EnvRuntime && window.EnvRuntime.env) ? window.EnvRuntime.env() : null);
  expect(env).toBeTruthy();
  expect(env.SUPABASE_URL).toBeTruthy();
  expect(env.SUPABASE_ANON_KEY).toBeTruthy();
}

test.describe('MUMS login (dual deploy)', () => {
  test('Cloudflare (Prod) /api/env loads and login succeeds (or fails with Supabase error)', async ({ page }) => {
    const baseUrl = normalizeBaseUrl(requireEnv('CLOUDFLARE_URL'));

    // 1) /api/env must exist and be valid
    await assertEnvEndpoint(page, baseUrl, 'EXPECTED_PROD_REF');

    // 2) Navigate to /login and ensure runtime env is actually loaded into the browser
    await gotoLogin(page, baseUrl);
    await assertRuntimeEnvLoadedInPage(page);

    // 3) Attempt login
    await attemptLoginAndAssertNotLocalFallback(page, {
      emailOrUsername: requireEnv('PROD_USER_EMAIL'),
      password: requireEnv('PROD_USER_PASSWORD')
    });
  });

  test('Vercel (UAT) /api/env loads and login succeeds (or fails with Supabase error)', async ({ page }) => {
    const baseUrl = normalizeBaseUrl(requireEnv('VERCEL_URL'));

    // 1) /api/env must exist and be valid
    await assertEnvEndpoint(page, baseUrl, 'EXPECTED_UAT_REF');

    // 2) Navigate to /login and ensure runtime env is actually loaded into the browser
    await gotoLogin(page, baseUrl);
    await assertRuntimeEnvLoadedInPage(page);

    // 3) Attempt login
    await attemptLoginAndAssertNotLocalFallback(page, {
      emailOrUsername: requireEnv('UAT_USER_EMAIL'),
      password: requireEnv('UAT_USER_PASSWORD')
    });
  });

  test('UAT wrong password shows Supabase credential error (not local fallback)', async ({ page }) => {
    const baseUrl = normalizeBaseUrl(requireEnv('VERCEL_URL'));

    await assertEnvEndpoint(page, baseUrl, 'EXPECTED_UAT_REF');
    await gotoLogin(page, baseUrl);
    await assertRuntimeEnvLoadedInPage(page);

    // Intentionally wrong password
    await attemptLoginAndAssertNotLocalFallback(page, {
      emailOrUsername: requireEnv('UAT_USER_EMAIL'),
      password: `${requireEnv('UAT_USER_PASSWORD')}__wrong`
    });

    // Ensure we stayed on login when failing
    await expect(page.locator('#loginBtn')).toBeVisible();
  });
});
