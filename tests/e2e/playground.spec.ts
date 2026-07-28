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

test('WebGL 2 medium mode renders visible final pixels', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  const backend = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.backend);
  expect(backend).toBe('webgl2');
  await page.waitForTimeout(750);

  const pixels = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const source = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!source) throw new Error('Viewport canvas not found.');
    const copy = document.createElement('canvas');
    copy.width = 96;
    copy.height = 64;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D verification context unavailable.');
    context.drawImage(source, 0, 0, copy.width, copy.height);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let visible = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) visible += 1;
    }
    return { visible, total: copy.width * copy.height };
  });

  expect(pixels.visible).toBeGreaterThan(pixels.total * 0.1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => message.includes('colorNode.sample'))).toEqual([]);
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
