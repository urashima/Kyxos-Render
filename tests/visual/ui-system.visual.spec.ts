import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
];

test('captures deterministic Moss and Graphite UI Lab evidence', async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/studio/ui-lab/');
    await expect(page.getByText('Kyxos UI Lab')).toBeVisible();
    await page.locator('select[aria-label="Theme"]').selectOption('moss');
    await testInfo.attach(`${viewport.name}-moss`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.locator('select[aria-label="Theme"]').selectOption('graphite');
    await testInfo.attach(`${viewport.name}-graphite`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
});
