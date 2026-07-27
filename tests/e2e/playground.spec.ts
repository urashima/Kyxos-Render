import { expect, test } from '@playwright/test';

const routes = [
  'overview',
  'pbr',
  'buffers',
  'aa',
  'traa',
  'temporal',
  'gtao',
  'ssao',
  'ssr',
  'ssgi',
  'motion-blur',
  'denoise',
  'sharpness',
  'lens-distortion',
  'background',
  'sparkle',
  'full-stack',
  'performance',
  'lifecycle',
];

test('all demo routes are served by the single playground', async ({ request }) => {
  for (const route of routes) {
    const response = await request.get(`/${route}/`);
    expect(response.ok(), route).toBe(true);
  }
});

test('viewer initializes through the WebGPU renderer fallback stack', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/overview/');
  await expect(page.locator('#viewport')).toBeVisible();
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  const result = await page.evaluate(() => ({
    metrics: window.__kyxosTestApi.getMetrics(),
    lastError: window.__kyxosTestApi.getLastError(),
  }));

  expect(result.metrics?.backend).toMatch(/webgpu|webgl2/);
  expect(result.metrics?.width).toBeGreaterThan(100);
  expect(result.metrics?.height).toBeGreaterThan(100);
  expect(result.lastError).toBeNull();
  expect(pageErrors).toEqual([]);
});

test('buffer views, AA exclusivity and lifecycle hooks remain callable', async ({ page }) => {
  await page.goto('/lifecycle/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  const result = await page.evaluate(async () => {
    window.__kyxosTestApi.setDebugView('normal');
    window.__kyxosTestApi.setEffect('traa', { enabled: true });
    window.__kyxosTestApi.setEffect('fxaa', { enabled: true });
    const resize = await window.__kyxosTestApi.runStress('resize', 10);
    const toggle = await window.__kyxosTestApi.runStress('toggle', 10);
    return { resize, toggle, error: window.__kyxosTestApi.getLastError() };
  });

  expect(result.resize.passed).toBe(true);
  expect(result.toggle.passed).toBe(true);
  expect(result.error).toBeNull();
});

test.describe('full lifecycle acceptance', () => {
  test.skip(!process.env.FULL_ACCEPTANCE, 'Run with FULL_ACCEPTANCE=1 for the release gate.');
  test.setTimeout(20 * 60_000);

  test('passes the specified resource stability counts', async ({ page }) => {
    await page.goto('/lifecycle/');
    await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
    const result = await page.evaluate(async () => ({
      resize: await window.__kyxosTestApi.runStress('resize', 100),
      toggle: await window.__kyxosTestApi.runStress('toggle', 100),
      model: await window.__kyxosTestApi.runStress('model', 50),
      environment: await window.__kyxosTestApi.runStress('environment', 50),
      recreate: await window.__kyxosTestApi.recreate(50),
    }));
    expect(result.resize.passed).toBe(true);
    expect(result.toggle.passed).toBe(true);
    expect(result.model.passed).toBe(true);
    expect(result.environment.passed).toBe(true);
    expect(result.recreate.passed).toBe(true);
  });
});
