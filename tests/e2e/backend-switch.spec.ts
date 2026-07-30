import { expect, test } from '@playwright/test';

test('switching to WebGL 2 recreates the viewer on a fresh canvas', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  await page.evaluate(() => {
    (document.querySelector('#viewport') as HTMLCanvasElement & { __kyxosContextOwner?: boolean }).__kyxosContextOwner =
      true;
  });

  await page.selectOption('#backend-select', 'webgl2');
  await page.waitForFunction(
    () => window.__kyxosTestApi?.ready() && window.__kyxosTestApi.getMetrics()?.backend === 'webgl2',
    null,
    { timeout: 90_000 },
  );

  const result = await page.evaluate(() => ({
    backend: window.__kyxosTestApi.getMetrics()?.backend,
    lastError: window.__kyxosTestApi.getLastError(),
    canvasWasReplaced: !(document.querySelector('#viewport') as HTMLCanvasElement & {
      __kyxosContextOwner?: boolean;
    }).__kyxosContextOwner,
  }));

  expect(result.backend).toBe('webgl2');
  expect(result.lastError).toBeNull();
  expect(result.canvasWasReplaced).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) => /WebGL 2 context creation failed|Viewer initialization failed/i.test(message)),
  ).toEqual([]);
});
