/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const { test, expect } = require('@playwright/test');

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

test('Overall Stats presets and shortcuts render', async ({ page }) => {
  const baseUrl = normalizeBaseUrl(
    process.env.OVERALL_STATS_BASE_URL || process.env.VERCEL_URL || process.env.CLOUDFLARE_URL
  );
  const email = process.env.OVERALL_STATS_USER_EMAIL || process.env.UAT_USER_EMAIL || process.env.PROD_USER_EMAIL;
  const password = process.env.OVERALL_STATS_USER_PASSWORD || process.env.UAT_USER_PASSWORD || process.env.PROD_USER_PASSWORD;

  test.skip(!baseUrl || !email || !password, 'Missing OVERALL_STATS_* or deploy login environment variables.');

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login', email);
  await page.fill('#password', password);
  await page.click('#loginBtn');

  await expect(page.locator('#logoutBtn')).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseUrl}/#overall_stats`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.overall-stats-page')).toBeVisible({ timeout: 20000 });

  const presetButtons = page.locator('[data-preset]');
  await expect(presetButtons).toHaveCount(4);

  const chip = page.locator('.overall-stats-controls .ux-chip');
  await expect(chip).toBeVisible();

  await page.click('[data-shortcut="last_7_days"]');
  await expect(chip).toContainText('Last 7 days');

  await page.click('[data-preset="current_week"]');
  await expect(chip).toContainText('Current week');
});
