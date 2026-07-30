import { expect, test, type Page } from '@playwright/test';

async function selectModel(page: Page, value: string) {
  await page.locator<HTMLSelectElement>('#model-select').evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('Sparkle toggle visibly changes polished highlights', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 720, height: 480 });
  // Start from an existing Low route so this test measures Sparkle only and is
  // not polluted by the separate cinematic SSR environment fallback path.
  await page.goto('/lifecycle/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  // Use the polished procedural model so the default highlight threshold has
  // deterministic bright regions without enabling the rest of the cinematic stack.
  await selectModel(page, 'procedural:chrome');
  await page.evaluate(() => window.__kyxosTestApi.setEffect('sparkle', { enabled: false }));
  await page.waitForTimeout(1200);

  const viewport = page.locator('#viewport');
  const disabled = await viewport.screenshot();

  await page.evaluate(() => window.__kyxosTestApi.setEffect('sparkle', { enabled: true }));
  await page.waitForTimeout(500);

  // WebGL does not preserve its drawing buffer by default, so copying the canvas
  // through a temporary 2D context can return an unchanged/empty frame. Playwright
  // screenshots the browser's final composited viewport and therefore observes the
  // same visible star highlights a user sees.
  let visualDifferenceDetected = false;
  for (let index = 0; index < 10; index += 1) {
    await page.waitForTimeout(140);
    const enabled = await viewport.screenshot();
    if (!enabled.equals(disabled)) {
      visualDifferenceDetected = true;
      break;
    }
  }

  const effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  const lastError = await page.evaluate(() => window.__kyxosTestApi.getLastError());

  expect(effects?.sparkle.enabled).toBe(true);
  expect(effects?.sparkle.intensity).toBe(0.8);
  expect(effects?.sparkle.threshold).toBe(0.78);
  expect(lastError).toBeNull();
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      /sparkle|render pipeline error|gpuvalidationerror|validation error|device lost|out of memory/i.test(
        message,
      ),
    ),
  ).toEqual([]);
  expect(visualDifferenceDetected).toBe(true);
});
