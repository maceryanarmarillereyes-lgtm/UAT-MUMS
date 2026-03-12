/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
const { test, expect } = require('@playwright/test');

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

test('Members paint dropdown + fullscreen controls', async ({ page }) => {
  const baseUrl = normalizeBaseUrl(
    process.env.MEMBERS_BASE_URL || process.env.VERCEL_URL || process.env.CLOUDFLARE_URL
  );
  const email = process.env.MEMBERS_USER_EMAIL || process.env.UAT_USER_EMAIL || process.env.PROD_USER_EMAIL;
  const password = process.env.MEMBERS_USER_PASSWORD || process.env.UAT_USER_PASSWORD || process.env.PROD_USER_PASSWORD;

  test.skip(!baseUrl || !email || !password, 'Missing MEMBERS_* or deploy login environment variables.');

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login', email);
  await page.fill('#password', password);
  await page.click('#loginBtn');

  await expect(page.locator('#logoutBtn')).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseUrl}/#members`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#membersAppWrap')).toBeVisible({ timeout: 20000 });

  const fullscreenBtn = page.locator('#membersFullscreenBtn');
  const analyticsRail = page.locator('#membersAnalyticsRail');
  await expect(analyticsRail).toBeHidden();

  const segCount = await page.locator('.timeline .seg').count();
  expect(segCount).toBeGreaterThan(0);
  const segsHaveLabels = await page.$$eval('.timeline .seg', segs =>
    segs.every(seg => seg.querySelectorAll('.seg-time').length > 0)
  );
  expect(segsHaveLabels).toBeTruthy();

  const progressMeta = page.locator('.member-progress .progress-meta').first();
  await expect(progressMeta).toBeVisible();
  const progressAligned = await progressMeta.evaluate((meta) => {
    const tooltip = meta.querySelector('.progress-tooltip');
    const text = meta.querySelector('.progress-text');
    if (!tooltip || !text) return false;
    const a = tooltip.getBoundingClientRect();
    const b = text.getBoundingClientRect();
    const centerDiff = Math.abs((a.top + a.height / 2) - (b.top + b.height / 2));
    return centerDiff <= 2;
  });
  expect(progressAligned).toBeTruthy();

  await fullscreenBtn.click();
  await expect(page.locator('body')).toHaveClass(/members-fullscreen-active/);
  await expect(analyticsRail).toBeVisible();

  const paintToggle = page.locator('#paintToggle');
  await paintToggle.click();
  await expect(paintToggle).toHaveAttribute('aria-pressed', 'true');

  const selectionToggle = page.locator('#selectionToggle');
  await selectionToggle.click();
  await expect(selectionToggle).toHaveAttribute('aria-pressed', 'true');

  const options = page.locator('#paintRole option');
  const optionCount = await options.count();
  expect(optionCount).toBeGreaterThan(0);

  for (let i = 0; i < optionCount; i += 1) {
    const style = await options.nth(i).getAttribute('style');
    expect(style || '').toContain('radial-gradient');
  }

  await fullscreenBtn.click();
  await expect(page.locator('body')).not.toHaveClass(/members-fullscreen-active/);
  await expect(analyticsRail).toBeHidden();
});

test('Members schedule notification popout', async ({ page }) => {
  const baseUrl = normalizeBaseUrl(
    process.env.MEMBERS_BASE_URL || process.env.VERCEL_URL || process.env.CLOUDFLARE_URL
  );
  const email = process.env.MEMBERS_USER_EMAIL || process.env.UAT_USER_EMAIL || process.env.PROD_USER_EMAIL;
  const password = process.env.MEMBERS_USER_PASSWORD || process.env.UAT_USER_PASSWORD || process.env.PROD_USER_PASSWORD;

  test.skip(!baseUrl || !email || !password, 'Missing MEMBERS_* or deploy login environment variables.');

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login', email);
  await page.fill('#password', password);
  await page.click('#loginBtn');

  await expect(page.locator('#logoutBtn')).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseUrl}/#members`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#membersAppWrap')).toBeVisible({ timeout: 20000 });

  const me = await page.evaluate(() => {
    if (!window.Auth || !window.Auth.getUser) return null;
    return window.Auth.getUser();
  });
  expect(me).not.toBeNull();

  const notif = {
    id: `test-${Date.now()}`,
    ts: Date.now(),
    teamId: me.teamId,
    weekStartISO: '2026-02-08',
    fromId: me.id,
    fromName: 'Team Lead QA',
    title: 'Schedule Updated',
    body: 'Schedule updates were applied for week of 2026-02-08. Please acknowledge.',
    recipients: [me.id],
    acks: {},
    userMessages: {
      [me.id]: 'Schedule Updated: Call Available added on Sunday, February 08, 2026.'
    },
    userSummaries: {
      [me.id]: {
        iso: '2026-02-08',
        dateLabel: 'February 08, 2026',
        items: [
          { start: '6:00 AM', end: '9:00 AM', label: 'Mailbox Manager' },
          { start: '9:00 AM', end: '11:00 AM', label: 'Call Available' },
          { start: '11:00 AM', end: '12:00 PM', label: 'Lunch' },
          { start: '12:00 PM', end: '3:00 PM', label: 'Back Office' }
        ]
      }
    }
  };

  await page.evaluate((payload) => {
    if (window.UI && window.Auth && window.UI.startScheduleNotifListener) {
      window.UI.startScheduleNotifListener(window.Auth.getUser());
    }
    window.Store.addNotif(payload);
  }, notif);

  const modal = page.locator('#schedNotifModal');
  await expect(modal).toHaveClass(/open/, { timeout: 15000 });
  const memberName = me.name || me.username;
  await expect(page.locator('#schedNotifMember')).toHaveText(memberName);

  const summary = page.locator('.notif-summary');
  await expect(summary).toContainText('Date: February 08, 2026');
  await expect(summary).toContainText('6:00 AM to 9:00 AM = Mailbox Manager');
  await expect(summary).toContainText('9:00 AM to 11:00 AM = Call Available');
  await expect(summary).toContainText('11:00 AM to 12:00 PM = Lunch');
  await expect(summary).toContainText('12:00 PM to 3:00 PM = Back Office');

  const bulletColors = await page.$$eval('.notif-task-bullet', (els) =>
    els.map((el) => getComputedStyle(el).backgroundColor)
  );
  const expectedColors = await page.evaluate(() => {
    const user = window.Auth && window.Auth.getUser ? window.Auth.getUser() : null;
    const tasks = (window.Store && user) ? (Store.getTeamTasks(user.teamId) || []) : [];
    const colorByLabel = (label) => {
      const lbl = String(label || '').trim().toLowerCase();
      const hit = tasks.find((t) => String(t.label || t.name || '').trim().toLowerCase() === lbl);
      return (hit && hit.color) ? hit.color : '#64748b';
    };
    const toRgb = (hex) => {
      const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
      if (!m) return 'rgb(100, 116, 139)';
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return `rgb(${r}, ${g}, ${b})`;
    };
    return ['Mailbox Manager', 'Call Available', 'Lunch', 'Back Office'].map((label) =>
      toRgb(colorByLabel(label))
    );
  });
  expect(bulletColors).toEqual(expectedColors);

  const zIndex = await page.evaluate(() => {
    const modalEl = document.getElementById('schedNotifModal');
    return modalEl ? Number(getComputedStyle(modalEl).zIndex || 0) : 0;
  });
  expect(zIndex).toBeGreaterThan(12000);

  await page.click('#schedNotifAck');
  await expect(modal).not.toHaveClass(/open/);

  const acked = await page.evaluate((notifId, userId) => {
    const list = window.Store.getNotifs();
    const found = list.find((n) => n && n.id === notifId);
    return !!(found && found.acks && found.acks[userId]);
  }, notif.id, me.id);
  expect(acked).toBeTruthy();
});
