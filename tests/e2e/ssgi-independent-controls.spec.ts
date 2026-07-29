import { expect, test, type Page } from '@playwright/test';

const fatalPattern =
  /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i;

async function setStyledSwitch(page: Page, selector: string, checked: boolean) {
  await page.locator(selector).evaluate((element, value) => {
    const input = element as HTMLInputElement;
    input.checked = Boolean(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

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

  const temporalFiltering = page.locator('[data-ssgi-temporal-filtering]');

  await expect(temporalFiltering).toHaveCount(1);
  await expect(temporalFiltering).toBeDisabled();

  // The native inputs are intentionally hidden behind styled switches. Dispatch
  // their real change event so the production listeners and rerender path run.
  await setStyledSwitch(page, '[data-effect-toggle="ssgi"]', true);
  await expect(temporalFiltering).toBeEnabled();
  await expect(temporalFiltering).toBeChecked();
  await page.waitForTimeout(1500);

  let effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(true);
  expect(effects?.traa.enabled).toBe(false);
  expect(effects?.fxaa.enabled).toBe(true);

  await setStyledSwitch(page, '[data-ssgi-temporal-filtering]', false);
  await page.waitForTimeout(1000);
  effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(false);
  expect(effects?.traa.enabled).toBe(false);

  await setStyledSwitch(page, '[data-effect-toggle="traa"]', true);
  await page.waitForTimeout(1500);
  effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.traa.enabled).toBe(true);
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(false);

  await setStyledSwitch(page, '[data-effect-toggle="traa"]', false);
  await page.waitForTimeout(1000);
  effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(effects?.traa.enabled).toBe(false);
  expect(effects?.ssgi.enabled).toBe(true);
  expect(effects?.ssgi.temporalFiltering).toBe(false);

  expect(crashed).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => fatalPattern.test(message))).toEqual([]);
});
