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

test('WebGL 2 rebuilt debug outputs remain visible', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready());
  await page.evaluate(() => {
    window.__kyxosTestApi.setQuality('low');
    window.__kyxosTestApi.setEffect('fxaa', { enabled: false });
    window.__kyxosTestApi.setEffect('gtao', { enabled: false });
  });
  await page.waitForTimeout(1500);

  const views = ['beauty', 'normal', 'diffuseColor', 'depth', 'velocity', 'metalness', 'roughness'] as const;
  for (const view of views) {
    await page.evaluate((nextView) => window.__kyxosTestApi.setDebugView(nextView), view);
    await page.waitForTimeout(1200);
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
        if (data[index] + data[index + 1] + data[index + 2] > 12 && data[index + 3] > 0) {
          visible += 1;
        }
      }
      return { visible, total: copy.width * copy.height };
    });
    expect(pixels.visible, `${view} visible pixels`).toBeGreaterThan(pixels.total * 0.02);
  }
  expect(pageErrors).toEqual([]);
});

test('TRAA and depth of field stay visible while the camera moves', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The GitHub runner uses a CPU software renderer. Keep enough pixels to
  // detect a black frame while avoiding multi-minute 80-tap DoF frames.
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  await page.evaluate(() => {
    window.__kyxosTestApi.setQuality('low');
    window.__kyxosTestApi.setEffect('fxaa', { enabled: false });
    window.__kyxosTestApi.setEffect('gtao', { enabled: false });
    window.__kyxosTestApi.setEffect('traa', { enabled: true });
    window.__kyxosTestApi.setEffect('dof', {
      enabled: true,
      focusDistance: 4,
      focalLength: 45,
      bokehScale: 1.5,
    });
  });
  await page.waitForTimeout(2500);

  const canvas = page.locator('#viewport');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Viewport bounds unavailable.');

  const sampleVisibleRatio = async () => {
    // WebGL does not preserve the previous drawing buffer, so copying the
    // source canvas outside its render callback can return all zeroes even
    // while the browser visibly composites a correct frame. Sample the
    // composited bottom-right canvas region instead of the discarded buffer.
    const clip = {
      x: bounds.x + bounds.width * 0.58,
      y: bounds.y + bounds.height * 0.48,
      width: bounds.width * 0.38,
      height: bounds.height * 0.46,
    };
    const screenshot = await page.screenshot({ clip });
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const copy = document.createElement('canvas');
      copy.width = 96;
      copy.height = 54;
      const context = copy.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context unavailable.');
      context.drawImage(image, 0, 0, copy.width, copy.height);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) {
          visible += 1;
        }
      }
      return visible / (copy.width * copy.height);
    }, screenshot.toString('base64'));
  };

  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.5;
  const ratios: number[] = [];
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(centerX + step * 10, centerY + Math.sin(step * 0.5) * 24);
    await page.waitForTimeout(90);
    ratios.push(await sampleVisibleRatio());
  }
  await page.mouse.up();
  await page.waitForTimeout(1000);
  ratios.push(await sampleVisibleRatio());

  const state = await page.evaluate(() => ({
    error: window.__kyxosTestApi.getLastError(),
    warnings: window.__kyxosTestApi.getWarnings(),
  }));
  expect(Math.min(...ratios), `camera-motion visible ratios: ${ratios.join(', ')}`).toBeGreaterThan(0.03);
  expect(state.error).toBeNull();
  expect(state.warnings.join('\n')).not.toContain('Render pipeline error');
  expect(pageErrors).toEqual([]);
});

test('standalone TRAA and depth of field do not flash white when camera gestures end', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  const canvas = page.locator('#viewport');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Viewport bounds unavailable.');

  const sampleCompositedFrame = async () => {
    const screenshot = await page.screenshot({
      clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const copy = document.createElement('canvas');
      copy.width = 64;
      copy.height = 36;
      const context = copy.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context unavailable.');
      context.drawImage(image, 0, 0, copy.width, copy.height);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let visible = 0;
      let clippedWhite = 0;
      let luminanceSum = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        luminanceSum += luminance;
        if (red + green + blue > 24 && data[index + 3] > 0) visible += 1;
        if (red > 245 && green > 245 && blue > 245) clippedWhite += 1;
      }
      const total = copy.width * copy.height;
      return {
        visibleRatio: visible / total,
        clippedWhiteRatio: clippedWhite / total,
        meanLuminance: luminanceSum / total,
      };
    }, screenshot.toString('base64'));
  };

  const runMode = async (mode: 'traa' | 'dof') => {
    await page.evaluate((effectMode) => {
      window.__kyxosTestApi.setQuality('low');
      window.__kyxosTestApi.setEffect('fxaa', { enabled: false });
      window.__kyxosTestApi.setEffect('gtao', { enabled: false });
      window.__kyxosTestApi.setEffect('ssao', { enabled: false });
      window.__kyxosTestApi.setEffect('ssgi', { enabled: false });
      window.__kyxosTestApi.setEffect('ssr', { enabled: false });
      window.__kyxosTestApi.setEffect('motionBlur', { enabled: false });
      window.__kyxosTestApi.setEffect('bloom', { enabled: false });
      window.__kyxosTestApi.setEffect('sparkle', { enabled: false });
      window.__kyxosTestApi.setEffect('traa', { enabled: effectMode === 'traa' });
      window.__kyxosTestApi.setEffect('dof', {
        enabled: effectMode === 'dof',
        focusDistance: 4,
        focalLength: 45,
        bokehScale: 1.5,
      });
    }, mode);
    await page.waitForTimeout(1800);

    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.5;
    const frames = [await sampleCompositedFrame()];
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(centerX + step * 20, centerY + Math.sin(step) * 18);
      await page.waitForTimeout(80);
      frames.push(await sampleCompositedFrame());
    }
    await page.mouse.up();
    frames.push(await sampleCompositedFrame());
    await page.waitForTimeout(20);
    frames.push(await sampleCompositedFrame());
    await page.waitForTimeout(60);
    frames.push(await sampleCompositedFrame());

    const minVisible = Math.min(...frames.map((frame) => frame.visibleRatio));
    const maxWhite = Math.max(...frames.map((frame) => frame.clippedWhiteRatio));
    const maxMean = Math.max(...frames.map((frame) => frame.meanLuminance));
    expect(minVisible, `${mode} frames: ${JSON.stringify(frames)}`).toBeGreaterThan(0.03);
    expect(maxWhite, `${mode} frames: ${JSON.stringify(frames)}`).toBeLessThan(0.7);
    expect(maxMean, `${mode} frames: ${JSON.stringify(frames)}`).toBeLessThan(245);
  };

  await runMode('traa');
  await runMode('dof');

  const state = await page.evaluate(() => ({
    error: window.__kyxosTestApi.getLastError(),
    warnings: window.__kyxosTestApi.getWarnings(),
  }));
  expect(state.error).toBeNull();
  expect(state.warnings.join('\n')).not.toContain('Render pipeline error');
  expect(pageErrors).toEqual([]);
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
