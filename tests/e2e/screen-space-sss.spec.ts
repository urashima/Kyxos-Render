import { expect, test, type Page } from '@playwright/test';

async function readCanvasVisibility(page: Page) {
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!canvas) throw new Error('Viewport canvas was not found.');

    const width = 48;
    const height = 27;
    const verificationCanvas = document.createElement('canvas');
    verificationCanvas.width = width;
    verificationCanvas.height = height;
    const context = verificationCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D verification context was unavailable.');

    context.drawImage(canvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let visible = 0;
    let luminance = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const sum = pixels[index] + pixels[index + 1] + pixels[index + 2];
      luminance += sum / 3;
      if (sum > 24 && pixels[index + 3] > 0) visible += 1;
    }

    return {
      visibleRatio: visible / (width * height),
      meanLuminance: luminance / (width * height),
    };
  });
}

async function expectVisibleFrame(page: Page) {
  const frame = await readCanvasVisibility(page);
  expect(frame.visibleRatio).toBeGreaterThan(0.02);
  expect(frame.meanLuminance).toBeGreaterThan(2);
}

test('deferred screen-space SSS enables, updates and restores without black output', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto('/sss/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  await page.waitForFunction(
    () => window.__kyxosScreenSpaceSSSTestApi?.getStatus()?.markedMaterials === 1,
    null,
    { timeout: 90_000 },
  );

  const initial = await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.getStatus());
  expect(initial).toMatchObject({
    enabled: true,
    quality: 'medium',
    markedMaterials: 1,
    eligibleMaterials: 1,
    lastError: null,
  });
  await expectVisibleFrame(page);

  const updated = await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ strength: 0.35, quality: 'low' }),
  );
  expect(updated).toMatchObject({ enabled: true, strength: 0.35, quality: 'low', lastError: null });
  await expectVisibleFrame(page);

  const disabled = await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ enabled: false }),
  );
  expect(disabled).toMatchObject({ enabled: false, markedMaterials: 0, lastError: null });
  await expectVisibleFrame(page);

  await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.set({ enabled: true }));
  await page.waitForFunction(
    () => window.__kyxosScreenSpaceSSSTestApi.getStatus()?.markedMaterials === 1,
    null,
    { timeout: 30_000 },
  );
  await expectVisibleFrame(page);

  expect(await page.locator('#sss-status').textContent()).toContain('Enabled');
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      /Screen-space SSS|Viewer initialization failed|validation error|render pipeline error/i.test(message),
    ),
  ).toEqual([]);
});
