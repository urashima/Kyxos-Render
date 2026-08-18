import { expect, test } from '@playwright/test';

for (const route of ['rt-lab', 'path-tracing'] as const) {
  test(`${route} keeps a visible viewer and exposes advanced controls`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`/${route}/`);
    await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

    await expect(page.locator('#advanced-lab-panel')).toBeVisible();
    await expect(page.locator('#advanced-lab-mode')).toHaveValue(route === 'path-tracing' ? 'pathTracing' : 'cinematic');
    await expect(page.locator('#advanced-lab-restir')).toHaveValue('temporalSpatial');
    await expect(page.locator('#loading')).not.toHaveClass(/fatal/);
    await expect(page.locator('#viewport')).toBeVisible();

    await page.waitForFunction(() => {
      const state = document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderState;
      return state === 'rendering' || state === 'fallback';
    }, null, { timeout: 90_000 });

    const result = await page.evaluate(() => {
      const metrics = window.__kyxosTestApi.getMetrics?.();
      const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
      const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]');
      return {
        backend: metrics?.backend,
        width: metrics?.width ?? 0,
        height: metrics?.height ?? 0,
        drawCalls: metrics?.drawCalls ?? 0,
        triangles: metrics?.triangles ?? 0,
        state: canvas?.dataset.advancedRenderState ?? null,
        mode: canvas?.dataset.advancedRenderMode ?? null,
        canvasWidth: canvas?.width ?? 0,
        canvasHeight: canvas?.height ?? 0,
        overlayDisplay: overlay ? getComputedStyle(overlay).display : 'none',
        overlayVisibility: overlay ? getComputedStyle(overlay).visibility : 'hidden',
      };
    });

    expect(result.backend).toMatch(/webgpu|webgl2/);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.canvasWidth).toBeGreaterThan(0);
    expect(result.canvasHeight).toBeGreaterThan(0);
    expect(result.state).toMatch(/rendering|fallback/);
    expect(result.mode).toMatch(/realtime|cinematic|pathTracing/);

    // If advanced rendering cannot run on the test adapter, the opaque overlay
    // must stay hidden so the healthy raster viewer remains visible.
    if (result.state === 'fallback') {
      expect(result.mode).toBe('realtime');
      expect(result.overlayDisplay === 'none' || result.overlayVisibility === 'hidden').toBe(true);
    }

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
  await expect(page.locator('#advanced-lab-warning')).toContainText(/WebGPU|fallback|requires|raster/i);

  await page.waitForFunction(() =>
    document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderState === 'fallback',
  null, { timeout: 90_000 });

  const result = await page.evaluate(() => ({
    backend: window.__kyxosTestApi.getMetrics()?.backend,
    state: document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderState ?? null,
    mode: document.querySelector<HTMLCanvasElement>('#viewport')?.dataset.advancedRenderMode ?? null,
    overlayDisplay: getComputedStyle(
      document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]') ??
      document.querySelector<HTMLCanvasElement>('#viewport')!,
    ).display,
  }));
  expect(result.backend).toBe('webgl2');
  expect(result.state).toBe('fallback');
  expect(result.mode).toBe('realtime');
  expect(pageErrors).toEqual([]);
});
