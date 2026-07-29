import { expect, test } from '@playwright/test';

const fatalPattern =
  /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i;

test('SSGI, SSGI temporal filtering and TRAA remain independent', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let crashed = false;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('crash', () => {
    crashed = true;
  });

  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  await page.selectOption('#quality-select', 'low');
  await page.waitForTimeout(1000);

  const ssgiToggle = page.locator('[data-effect-toggle="ssgi"]');
  const traaToggle = page.locator('[data-effect-toggle="traa"]');
  const temporalFiltering = page.locator('[data-ssgi-temporal-filtering]');

  await expect(temporalFiltering).toHaveCount(1);
  await expect(temporalFiltering).toBeDisabled();

  await ssgiToggle.check();
  await expect(temporalFiltering).toBeEnabled();
  await expect(temporalFiltering).toBeChecked();
  await page.waitForTimeout(1500);

  let effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(true);
  expect(effects?.traa.enabled).toBe(false);
  expect(effects?.fxaa.enabled).toBe(true);

  await temporalFiltering.uncheck();
  await page.waitForTimeout(1000);
  effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(false);
  expect(effects?.traa.enabled).toBe(false);

  await traaToggle.check();
  await page.waitForTimeout(1500);
  effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.traa.enabled).toBe(true);
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(false);

  await traaToggle.uncheck();
  await page.waitForTimeout(1000);
  effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.traa.enabled).toBe(false);
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(false);

  expect(crashed).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => fatalPattern.test(message))).toEqual([]);
});
