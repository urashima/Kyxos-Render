import { expect, test } from '@playwright/test';

test.describe.configure({ retries: 0, timeout: 90_000 });

async function diagnostic(page: any) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
    const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-kyxos-advanced-renderer="webgpu"]');
    const warning = document.querySelector('#advanced-render-warning');
    const status = document.querySelector('#advanced-render-status');
    const phases = Number(document.querySelector('#advanced-render-samples')?.textContent?.replace(/,/g, '') ?? 0);
    return {
      backend: window.__kyxosTestApi.getMetrics?.().backend ?? null,
      fps: window.__kyxosTestApi.getMetrics?.().fps ?? 0,
      state: canvas?.dataset.advancedRenderState ?? null,
      mode: canvas?.dataset.advancedRenderMode ?? null,
      architecture: canvas?.dataset.advancedRenderArchitecture ?? null,
      warning: warning?.textContent?.trim() ?? '',
      status: status?.textContent?.trim() ?? '',
      phases,
      overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' && getComputedStyle(overlay).visibility !== 'hidden' : false,
    };
  });
}

async function viewportChecksum(page: any) {
  return page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!source) return 0;
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = 18;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(source, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    let checksum = 0;
    for (let index = 0; index < data.length; index += 4) {
      checksum = (checksum + data[index] * 3 + data[index + 1] * 5 + data[index + 2] * 7 + data[index + 3]) >>> 0;
    }
    return checksum;
  });
}

test('Realtime RT stays fused into the WebGPU viewport while the camera moves', async ({ page }) => {
  const pageErrors: string[] = [];
  const gpuErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /wgsl|gpuvalidation|computepipeline|bindgroup|validation error/i.test(message.text())) {
      gpuErrors.push(message.text());
    }
  });

  await page.goto('/rt-lab/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 60_000 });
  expect(await page.evaluate(() => Boolean((navigator as Navigator & { gpu?: unknown }).gpu))).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__kyxosTestApi.getMetrics?.().backend), { timeout: 30_000 }).toBe('webgpu');
  await expect(page.locator('#advanced-render-mode')).toHaveValue('realtime');
  await expect(page.locator('#advanced-rt-enabled')).toBeChecked();
  await expect(page.locator('#advanced-rt-denoise-enabled')).toBeChecked();
  await expect(page.locator('#advanced-rt-fusion-enabled')).toBeChecked();

  await page.waitForTimeout(15_000);
  const initial = await diagnostic(page);
  console.log(`REALTIME_RT_WEBGPU_DIAGNOSTIC ${JSON.stringify({ ...initial, pageErrors, gpuErrors })}`);
  expect(initial, `Realtime RT did not enter the realtime feature path: ${JSON.stringify({ ...initial, pageErrors, gpuErrors })}`).toMatchObject({
    backend: 'webgpu',
    state: 'rendering',
    mode: 'realtime',
    architecture: 'realtime-rt-feature-pass-v3',
    overlayVisible: false,
  });
  expect(initial.phases).toBeGreaterThan(0);

  const beforeChecksum = await viewportChecksum(page);
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
    await page.waitForTimeout(300);
    const moving = await diagnostic(page);
    const movingChecksum = await viewportChecksum(page);
    expect(moving, `Realtime RT left the feature path during camera motion: ${JSON.stringify(moving)}`).toMatchObject({
      state: 'rendering',
      mode: 'realtime',
      architecture: 'realtime-rt-feature-pass-v3',
      overlayVisible: false,
    });
    expect(moving.warning).not.toMatch(/suspend|pure Realtime|after interaction settles/i);
    expect(moving.fps).toBeGreaterThan(0);
    expect(movingChecksum, 'Realtime viewport did not visibly update while realtime RT was enabled.').not.toBe(beforeChecksum);
    await page.mouse.up();
  }

  await page.waitForTimeout(750);
  const settled = await diagnostic(page);
  expect(settled.state).toBe('rendering');
  expect(settled.architecture).toBe('realtime-rt-feature-pass-v3');
  expect(settled.overlayVisible).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(gpuErrors).toEqual([]);
});

test('progressive PT hides reset accumulation during camera motion and reveals only stable samples', async ({ page }) => {
  const pageErrors: string[] = [];
  const gpuErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /wgsl|gpuvalidation|computepipeline|bindgroup|validation error/i.test(message.text())) {
      gpuErrors.push(message.text());
    }
  });
  await page.goto('/path-tracing/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 60_000 });
  await expect.poll(async () => page.evaluate(() => window.__kyxosTestApi.getMetrics?.().backend), { timeout: 30_000 }).toBe('webgpu');

  const viewport = page.locator('#viewport');
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 18, { steps: 10 });
    const moving = await diagnostic(page);
    expect(moving.overlayVisible).toBe(false);
    await page.mouse.up();
  }

  await page.waitForTimeout(20_000);
  const settled = await diagnostic(page);
  console.log(`PT_WEBGPU_DIAGNOSTIC ${JSON.stringify({ ...settled, pageErrors, gpuErrors })}`);
  expect(settled, `PT did not reach stable progressive presentation: ${JSON.stringify({ ...settled, pageErrors, gpuErrors })}`).toMatchObject({
    backend: 'webgpu',
    state: 'rendering',
    mode: 'pathTracing',
    overlayVisible: true,
  });
  expect(pageErrors).toEqual([]);
  expect(gpuErrors).toEqual([]);
});
