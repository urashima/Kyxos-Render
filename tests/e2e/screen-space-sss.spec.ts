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
    quality: 'medium',
    markedMaterials: 1,
    eligibleMaterials: 1,
    lastError: null,
  });

  const updated = await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ strength: 0.35, quality: 'low' }),
  );
  expect(updated).toMatchObject({ enabled: true, strength: 0.35, quality: 'low', lastError: null });

  const disabled = await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ enabled: false }),
  );
  expect(disabled).toMatchObject({ enabled: false, markedMaterials: 0, lastError: null });

  await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.set({ enabled: true }));
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
