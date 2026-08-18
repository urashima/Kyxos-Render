import { expect, test } from '@playwright/test';

test('Hybrid RT stays inside the realtime WebGPU viewport while the camera moves', async ({ page }) => {
  const pageErrors: string[] = [];
  const gpuErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /wgsl|gpuvalidation|computepipeline|bindgroup|validation error/i.test(message.text())) {
      gpuErrors.push(message.text());
    }
  });

  await page.goto('/rt-lab/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 120_000 });
  expect(await page.evaluate(() => Boolean((navigator as Navigator & { gpu?: unknown }).gpu))).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__kyxosTestApi.getMetrics?.().backend), { timeout: 60_000 }).toBe('webgpu');
  await expect(page.locator('#advanced-render-mode')).toHaveValue('cinematic');

  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
    return canvas?.dataset.advancedRenderState === 'rendering' &&
      canvas.dataset.advancedRenderMode === 'cinematic' &&
      canvas.dataset.advancedRenderArchitecture === 'realtime-hybrid-feature-pass';
  }, null, { timeout: 120_000 });

  const viewport = page.locator('#viewport');
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const x = box.x + box.width * 0.52;
    const y = box.y + box.height * 0.48;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(x + step * 9, y + Math.sin(step * 0.8) * 10, { steps: 2 });
    }
    const moving = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
      const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]');
      return {
        state: canvas.dataset.advancedRenderState,
        mode: canvas.dataset.advancedRenderMode,
        architecture: canvas.dataset.advancedRenderArchitecture,
        overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden' : false,
      };
    });
    expect(moving.state).toBe('rendering');
    expect(moving.mode).toBe('cinematic');
    expect(moving.architecture).toBe('realtime-hybrid-feature-pass');
    expect(moving.overlayVisible).toBe(false);
    await page.mouse.up();
  }

  await page.waitForTimeout(500);
  const settled = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
    const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]');
    return {
      state: canvas.dataset.advancedRenderState,
      architecture: canvas.dataset.advancedRenderArchitecture,
      overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden' : false,
    };
  });
  expect(settled.state).toBe('rendering');
  expect(settled.architecture).toBe('realtime-hybrid-feature-pass');
  expect(settled.overlayVisible).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(gpuErrors).toEqual([]);
});

test('progressive PT hides reset accumulation during camera motion and reveals only stable samples', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/path-tracing/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 120_000 });
  await expect.poll(async () => page.evaluate(() => window.__kyxosTestApi.getMetrics?.().backend), { timeout: 60_000 }).toBe('webgpu');

  const viewport = page.locator('#viewport');
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 18, { steps: 10 });
    const visibleWhileMoving = await page.evaluate(() => {
      const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]');
      return overlay ? getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden' : false;
    });
    expect(visibleWhileMoving).toBe(false);
    await page.mouse.up();
  }

  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
    const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]');
    const overlayVisible = overlay ? getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden' : false;
    return canvas?.dataset.advancedRenderState === 'rendering' &&
      canvas.dataset.advancedRenderMode === 'pathTracing' && overlayVisible;
  }, null, { timeout: 120_000 });
  expect(pageErrors).toEqual([]);
});
