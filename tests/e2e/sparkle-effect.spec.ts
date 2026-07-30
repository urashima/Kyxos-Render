import { expect, test, type Page } from '@playwright/test';

type CanvasSignature = {
  luminance: number;
  highlights: number;
};

async function readCanvasSignature(page: Page): Promise<CanvasSignature> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!canvas) throw new Error('Viewport canvas is missing.');

    const width = 180;
    const height = 100;
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D sampling context is unavailable.');

    context.drawImage(canvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let luminance = 0;
    let highlights = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      luminance += r + g + b;
      if (r + g + b > 660) highlights += 1;
    }

    return { luminance, highlights };
  });
}

async function selectModel(page: Page, value: string) {
  await page.locator<HTMLSelectElement>('#model-select').evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('Sparkle toggle visibly changes polished highlights', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto('/sparkle/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  // Isolate Sparkle from the animated cinematic stack and use the polished
  // procedural model so the default highlight threshold has deterministic input.
  await page.evaluate(() => window.__kyxosTestApi.setQuality('low'));
  await selectModel(page, 'procedural:chrome');
  await page.evaluate(() => window.__kyxosTestApi.setEffect('sparkle', { enabled: false }));
  await page.waitForTimeout(1200);

  const disabled = await readCanvasSignature(page);

  await page.evaluate(() => window.__kyxosTestApi.setEffect('sparkle', { enabled: true }));
  await page.waitForTimeout(500);

  const samples: CanvasSignature[] = [];
  for (let index = 0; index < 10; index += 1) {
    await page.waitForTimeout(140);
    samples.push(await readCanvasSignature(page));
  }

  const enabled = samples.reduce((best, sample) =>
    sample.luminance > best.luminance ? sample : best,
  );
  const effects = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  const lastError = await page.evaluate(() => window.__kyxosTestApi.getLastError());

  expect(effects?.sparkle.enabled).toBe(true);
  expect(effects?.sparkle.intensity).toBe(0.8);
  expect(effects?.sparkle.threshold).toBe(0.78);
  expect(lastError).toBeNull();
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) => /sparkle|shader|render pipeline|validation error/i.test(message)),
  ).toEqual([]);
  expect(
    enabled.luminance > disabled.luminance + 1000 ||
      enabled.highlights > disabled.highlights + 2,
  ).toBe(true);
});
