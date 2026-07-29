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

for (const temporalFiltering of [false, true]) {
  test(`SSGI temporal ${temporalFiltering ? 'on' : 'off'} with DoF stays alive`, async ({ page }) => {
    test.setTimeout(90_000);
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

    await page.setViewportSize({ width: 240, height: 135 });
    await page.goto('/overview/');
    await waitUntilReady(page);
    await configureCombination(page, temporalFiltering);
    await page.waitForTimeout(3000);

    const viewport = page.locator('#viewport');
    const bounds = await viewport.boundingBox();
    if (!bounds) throw new Error('Viewport bounds unavailable.');
    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.5;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(centerX + step * 14, centerY + Math.sin(step * 0.7) * 12);
      await page.waitForTimeout(100);
    }
    await page.mouse.up();
    await page.waitForTimeout(750);

    const state = await page.evaluate(() => ({
      backend: window.__kyxosTestApi.getMetrics()?.backend,
      metrics: window.__kyxosTestApi.getMetrics(),
      effects: window.__kyxosTestApi.getEffects(),
      error: window.__kyxosTestApi.getLastError(),
      warnings: window.__kyxosTestApi.getWarnings(),
    }));

    console.log(
      JSON.stringify(
        { temporalFiltering, crashed, pageErrors, consoleErrors, state },
        null,
        2,
      ),
    );

    expect(crashed).toBe(false);
    expect(state.metrics?.drawCalls).toBeGreaterThan(0);
    expect(state.error).toBeNull();
    expect(pageErrors).toEqual([]);
    expect(
      consoleErrors.filter((message) =>
        /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i.test(
          message,
        ),
      ),
    ).toEqual([]);
  });
}
