import { expect, test, type Page } from '@playwright/test';

const allEffects = [
  'traa',
  'fxaa',
  'smaa',
  'ssaa',
  'gtao',
  'ssao',
  'ssr',
  'ssgi',
  'temporalReprojection',
  'poissonDenoise',
  'temporalDenoise',
  'motionBlur',
  'bloom',
  'dof',
  'lut',
  'lensDistortion',
  'sharpness',
  'sparkle',
] as const;

async function waitUntilReady(page: Page) {
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
}

async function configureCombination(page: Page, temporalFiltering: boolean) {
  await page.evaluate(
    ({ effects, temporal }) => {
      window.__kyxosTestApi.setQuality('low');
      for (const effect of effects) {
        window.__kyxosTestApi.setEffect(effect as never, { enabled: false });
      }
      window.__kyxosTestApi.setEffect('ssgi', {
        enabled: true,
        temporalFiltering: temporal,
        resolutionScale: 0.5,
        sliceCount: 1,
        stepCount: 6,
        radius: 8,
        intensity: 1,
      });
      window.__kyxosTestApi.setEffect('dof', {
        enabled: true,
        focusDistance: 4,
        focalLength: 45,
        bokehScale: 1.5,
      });
    },
    { effects: allEffects, temporal: temporalFiltering },
  );
}

async function sampleCompositedFrame(page: Page) {
  const viewport = page.locator('#viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds unavailable.');
  const screenshot = await page.screenshot({
    clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  });
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
    let white = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (red + green + blue > 24 && data[index + 3] > 0) visible += 1;
      if (red > 245 && green > 245 && blue > 245) white += 1;
    }
    const total = copy.width * copy.height;
    return { visibleRatio: visible / total, whiteRatio: white / total };
  }, screenshot.toString('base64'));
}

for (const temporalFiltering of [false, true]) {
  test(`SSGI temporal ${temporalFiltering ? 'on' : 'off'} with DoF stays alive`, async ({ page }) => {
    test.setTimeout(240_000);
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

    await page.setViewportSize({ width: 480, height: 270 });
    await page.goto('/overview/');
    await waitUntilReady(page);
    await configureCombination(page, temporalFiltering);
    await page.waitForTimeout(5000);

    const viewport = page.locator('#viewport');
    const bounds = await viewport.boundingBox();
    if (!bounds) throw new Error('Viewport bounds unavailable.');
    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.5;
    const frames = [await sampleCompositedFrame(page)];

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(centerX + step * 18, centerY + Math.sin(step * 0.7) * 20);
      await page.waitForTimeout(120);
      frames.push(await sampleCompositedFrame(page));
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    frames.push(await sampleCompositedFrame(page));

    const state = await page.evaluate(() => ({
      backend: window.__kyxosTestApi.getMetrics()?.backend,
      effects: window.__kyxosTestApi.getEffects(),
      error: window.__kyxosTestApi.getLastError(),
      warnings: window.__kyxosTestApi.getWarnings(),
    }));

    console.log(
      JSON.stringify(
        { temporalFiltering, crashed, pageErrors, consoleErrors, frames, state },
        null,
        2,
      ),
    );

    expect(crashed).toBe(false);
    expect(state.error).toBeNull();
    expect(pageErrors).toEqual([]);
    expect(
      consoleErrors.filter((message) =>
        /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i.test(
          message,
        ),
      ),
    ).toEqual([]);
    expect(Math.min(...frames.map((frame) => frame.visibleRatio))).toBeGreaterThan(0.03);
    expect(Math.max(...frames.map((frame) => frame.whiteRatio))).toBeLessThan(0.8);
  });
}
