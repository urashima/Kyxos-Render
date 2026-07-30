import { expect, test } from '@playwright/test';

test('deferred screen-space SSS enables, updates and restores safely', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto('/sss/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  await page.waitForFunction(
    () => window.__kyxosScreenSpaceSSSTestApi?.getStatus()?.markedMaterials === 1,
    null,
    { timeout: 90_000 },
  );

  const initial = await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.getStatus());
  expect(initial).toMatchObject({
    enabled: true,
    quality: 'high',
    markedMaterials: 1,
    eligibleMaterials: 1,
    lastError: null,
  });

  await page.locator('#sss-strength').fill('0.35');
  await page.locator('#sss-strength').dispatchEvent('change');
  await page.locator('#sss-quality').selectOption('low');
  await page.waitForTimeout(200);

  const updated = await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.getStatus());
  expect(updated).toMatchObject({ enabled: true, strength: 0.35, quality: 'low', lastError: null });

  await page.locator('#sss-enabled').uncheck();
  await page.waitForTimeout(200);
  const disabled = await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.getStatus());
  expect(disabled).toMatchObject({ enabled: false, markedMaterials: 0, lastError: null });

  await page.locator('#sss-enabled').check();
  await page.waitForFunction(
    () => window.__kyxosScreenSpaceSSSTestApi.getStatus()?.markedMaterials === 1,
    null,
    { timeout: 30_000 },
  );

  expect(await page.locator('#sss-status').textContent()).toContain('Enabled');
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) => /Screen-space SSS|Viewer initialization failed|validation error/i.test(message)),
  ).toEqual([]);
});
