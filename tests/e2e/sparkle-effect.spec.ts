import { expect, test, type Page } from '@playwright/test';

async function selectModel(page: Page, value: string) {
  await page.locator<HTMLSelectElement>('#model-select').evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('Sparkle uses the official Three.js anamorphic highlight pass', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto('/lifecycle/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  await selectModel(page, 'procedural:chrome');
  await page.evaluate(() => window.__kyxosTestApi.setEffect('sparkle', { enabled: false }));
  await page.waitForTimeout(1200);

  const viewport = page.locator('#viewport');
  const disabled = await viewport.screenshot();

  await page.evaluate(() => window.__kyxosTestApi.setEffect('sparkle', { enabled: true }));
  await page.waitForTimeout(900);
  const enabled = await viewport.screenshot();

  const effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  const lastError = await page.evaluate(() => window.__kyxosTestApi.getLastError());

  expect(effects?.sparkle.enabled).toBe(true);
  expect(effects?.sparkle.intensity).toBe(5);
  expect(effects?.sparkle.threshold).toBe(0.3);
  expect(effects?.sparkle.radius).toBe(0);
  expect(effects?.sparkle.samples).toBe(80);
  expect(lastError).toBeNull();
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      /sparkle|anamorphic|render pipeline error|gpuvalidationerror|validation error|device lost|out of memory/i.test(
        message,
      ),
    ),
  ).toEqual([]);
  expect(enabled.equals(disabled)).toBe(false);

  await page.goto('/sparkle/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  await expect(page.locator('[data-focus-effect="sparkle"]')).toContainText('Three.js Anamorphic');
  await page.locator('[data-focus-effect="sparkle"]').click();
  await expect(page.locator('#parameter-title')).toContainText('Three.js Anamorphic Lensflare');
  await expect(page.locator('[data-effect-parameter="intensity"]')).toHaveAttribute('max', '10');
  await expect(page.locator('[data-effect-parameter="threshold"]')).toHaveAttribute('min', '0');
});
