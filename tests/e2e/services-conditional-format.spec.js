const { test, expect } = require('@playwright/test');

test('test:color-swatch-selection', async ({ page }) => {
  await page.setContent('<html><body><table id="svcGrid"><tbody></tbody></table></body></html>');
  await page.addScriptTag({ path: 'public/js/services-conditional-format.js' });
  await page.evaluate(() => {
    window.servicesGrid = {
      getState: () => ({ sheet: { id: 's1', column_defs: [{ key: 'status', label: 'Status', conditionalRules: [] }] }, rows: [] }),
      render: () => {},
      load: async () => {}
    };
    window.servicesDB = { updateColumns: async () => ({}) };
    window.svcConditionalFormat.open(0, 'status', 'Status', [{ type: 'single_color', operator: 'contains', param1: '', bgColor: '#fef08a' }]);
  });
  await expect(page.locator('.cf-color-btn.active').first()).toBeVisible();
});
