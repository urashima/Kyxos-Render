import { expect, test } from '@playwright/test';

for (const route of ['rt-lab', 'path-tracing'] as const) {
  test(`${route} exposes the advanced rendering lab without breaking the viewer`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`/${route}/`);
    await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
    await expect(page.locator('#advanced-lab-panel')).toBeVisible();
    await expect(page.locator('#advanced-lab-mode')).toHaveValue(route === 'path-tracing' ? 'pathTracing' : 'cinematic');
    await expect(page.locator('#advanced-lab-restir')).toHaveValue('temporalSpatial');

    const result = await page.evaluate(() => ({
      backend: window.__kyxosTestApi.getMetrics()?.backend,
      state: document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderState ?? null,
      mode: document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderMode ?? null,
    }));
    expect(result.backend).toMatch(/webgpu|webgl2/);
    expect(result.state).toMatch(/idle|initializing|building|rendering|fallback|error/);
    expect(result.mode).toMatch(/realtime|cinematic|pathTracing/);
    expect(pageErrors).toEqual([]);
  });
}

test('path tracing request gracefully falls back when WebGPU is unavailable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });
  await page.goto('/path-tracing/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  await expect(page.locator('#advanced-lab-panel')).toBeVisible();
  await expect(page.locator('#advanced-lab-warning')).toContainText(/WebGPU|fallback|requires/i);

  const result = await page.evaluate(() => ({
    backend: window.__kyxosTestApi.getMetrics()?.backend,
    state: document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderState ?? null,
    mode: document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderMode ?? null,
  }));
  expect(result.backend).toBe('webgl2');
  expect(result.state).toBe('fallback');
  expect(result.mode).toBe('realtime');
  expect(pageErrors).toEqual([]);
});
