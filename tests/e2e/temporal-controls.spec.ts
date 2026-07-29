import { expect, test } from '@playwright/test';

const fatalPattern =
  /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i;

test('SSR temporal controls activate a real dependency chain', async ({ page }) => {
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

  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  await page.evaluate(() => window.__kyxosTestApi.setQuality('low'));
  await page.waitForTimeout(1200);
  const baselineTargets = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.renderTargets ?? 0);

  await page.evaluate(() =>
    window.__kyxosTestApi.setEffect('temporalReprojection', {
      enabled: true,
      maxFrames: 8,
      clampIntensity: 0.25,
      flickerSuppression: 1,
    }),
  );
  await page.waitForTimeout(3000);
  const reprojection = await page.evaluate(() => ({
    effects: window.__kyxosTestApi.getEffects(),
    metrics: window.__kyxosTestApi.getMetrics(),
    error: window.__kyxosTestApi.getLastError(),
  }));
  expect(reprojection.effects?.ssr.enabled).toBe(true);
  expect(reprojection.effects?.temporalReprojection.enabled).toBe(true);
  expect(reprojection.effects?.temporalDenoise.enabled).toBe(false);
  expect(reprojection.metrics?.renderTargets ?? 0).toBeGreaterThan(baselineTargets);
  expect(reprojection.metrics?.drawCalls ?? 0).toBeGreaterThan(0);

  await page.evaluate(() =>
    window.__kyxosTestApi.setEffect('temporalDenoise', {
      enabled: true,
      radius: 1.5,
      strength: 0.725,
      adaptiveTrust: 1,
    }),
  );
  await page.waitForTimeout(3000);
  const denoise = await page.evaluate(() => ({
    effects: window.__kyxosTestApi.getEffects(),
    metrics: window.__kyxosTestApi.getMetrics(),
    error: window.__kyxosTestApi.getLastError(),
    warnings: window.__kyxosTestApi.getWarnings(),
  }));
  expect(denoise.effects?.ssr.enabled).toBe(true);
  expect(denoise.effects?.temporalReprojection.enabled).toBe(true);
  expect(denoise.effects?.temporalDenoise.enabled).toBe(true);
  expect(denoise.metrics?.drawCalls ?? 0).toBeGreaterThan(0);
  expect(denoise.error).toBeNull();

  await page.evaluate(() => window.__kyxosTestApi.setEffect('ssr', { enabled: false }));
  await page.waitForTimeout(1000);
  const disabled = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(disabled?.ssr.enabled).toBe(false);
  expect(disabled?.temporalReprojection.enabled).toBe(false);
  expect(disabled?.temporalDenoise.enabled).toBe(false);

  expect(crashed).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => fatalPattern.test(message))).toEqual([]);
});
