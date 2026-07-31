import { expect, test, type Page } from '@playwright/test';

const FRAME_CLIP = { x: 180, y: 110, width: 360, height: 230 } as const;

async function captureFrame(page: Page) {
  await page.waitForTimeout(650);
  return page.screenshot({ type: 'png', clip: FRAME_CLIP });
}

async function readFrameVisibility(page: Page, screenshot: Buffer) {
  const dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

  return page.evaluate(
    async ({ imageUrl, imageWidth, imageHeight }) => {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();

      const verificationCanvas = document.createElement('canvas');
      verificationCanvas.width = imageWidth;
      verificationCanvas.height = imageHeight;
      const context = verificationCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context was unavailable.');

      context.drawImage(image, 0, 0, imageWidth, imageHeight);
      const pixels = context.getImageData(0, 0, imageWidth, imageHeight).data;
      let visible = 0;
      let luminance = 0;

      for (let index = 0; index < pixels.length; index += 4) {
        const sum = pixels[index] + pixels[index + 1] + pixels[index + 2];
        luminance += sum / 3;
        if (sum > 24 && pixels[index + 3] > 0) visible += 1;
      }

      return {
        visibleRatio: visible / (imageWidth * imageHeight),
        meanLuminance: luminance / (imageWidth * imageHeight),
      };
    },
    { imageUrl: dataUrl, imageWidth: FRAME_CLIP.width, imageHeight: FRAME_CLIP.height },
  );
}

async function measureFrameDifference(page: Page, first: Buffer, second: Buffer) {
  return page.evaluate(
    async ({ firstUrl, secondUrl, width, height }) => {
      const load = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D comparison context was unavailable.');
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };

      const [a, b] = await Promise.all([load(firstUrl), load(secondUrl)]);
      let difference = 0;
      let changed = 0;
      const pixelCount = width * height;

      for (let index = 0; index < a.length; index += 4) {
        const delta =
          (Math.abs(a[index] - b[index]) +
            Math.abs(a[index + 1] - b[index + 1]) +
            Math.abs(a[index + 2] - b[index + 2])) /
          3;
        difference += delta;
        if (delta > 2) changed += 1;
      }

      return {
        meanAbsoluteDifference: difference / pixelCount,
        changedRatio: changed / pixelCount,
      };
    },
    {
      firstUrl: `data:image/png;base64,${first.toString('base64')}`,
      secondUrl: `data:image/png;base64,${second.toString('base64')}`,
      width: FRAME_CLIP.width,
      height: FRAME_CLIP.height,
    },
  );
}

async function expectVisibleFrame(page: Page) {
  const screenshot = await captureFrame(page);
  const frame = await readFrameVisibility(page, screenshot);
  expect(frame.visibleRatio).toBeGreaterThan(0.2);
  expect(frame.meanLuminance).toBeGreaterThan(10);
  return screenshot;
}

test('deferred screen-space SSS defaults to 5 tap, stays visible and exposes debug buffers', async ({
  page,
}) => {
  test.setTimeout(180_000);
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
    () => (window.__kyxosScreenSpaceSSSTestApi?.getStatus()?.markedMaterials ?? 0) >= 5,
    null,
    { timeout: 90_000 },
  );

  await expect(page.locator('#model-select')).toHaveValue('procedural:sss-study');
  await expect(page.locator('#sss-quality')).toHaveValue('low');
  await expect(page.locator('#debug-select option[value="sssMask"]')).toHaveCount(1);
  await expect(page.locator('#debug-select option[value="sssThickness"]')).toHaveCount(1);
  await expect(page.locator('#debug-select option[value="sssDiffusion"]')).toHaveCount(1);
  await expect(page.locator('#debug-select option[value="sssTranslucency"]')).toHaveCount(1);

  const initial = await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.getStatus());
  expect(initial).toMatchObject({
    enabled: true,
    quality: 'low',
    markedMaterials: 5,
    eligibleMaterials: 5,
    lastError: null,
  });
  const enabledFrame = await expectVisibleFrame(page);

  const disabled = await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ enabled: false }),
  );
  expect(disabled).toMatchObject({ enabled: false, markedMaterials: 0, lastError: null });
  const disabledFrame = await expectVisibleFrame(page);

  const toggleDifference = await measureFrameDifference(page, enabledFrame, disabledFrame);
  expect(toggleDifference.meanAbsoluteDifference).toBeGreaterThan(0.25);
  expect(toggleDifference.changedRatio).toBeGreaterThan(0.015);

  await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.set({ enabled: true }));
  await page.waitForFunction(
    () => (window.__kyxosScreenSpaceSSSTestApi.getStatus()?.markedMaterials ?? 0) >= 5,
    null,
    { timeout: 30_000 },
  );

  const debugViews = [
    'sssMask',
    'sssThickness',
    'sssDiffusion',
    'sssTranslucency',
  ] as const;
  let previousDebugFrame: Buffer | null = null;

  for (const view of debugViews) {
    await page.selectOption('#debug-select', view);
    await expect(page.locator('#debug-select')).toHaveValue(view);
    const frame = await captureFrame(page);
    const visibility = await readFrameVisibility(page, frame);
    expect(visibility.visibleRatio).toBeGreaterThan(0.005);
    expect(visibility.meanLuminance).toBeGreaterThan(0.5);

    if (previousDebugFrame) {
      const difference = await measureFrameDifference(page, previousDebugFrame, frame);
      expect(difference.meanAbsoluteDifference).toBeGreaterThan(0.05);
    }
    previousDebugFrame = frame;
  }

  await page.selectOption('#debug-select', 'final');
  await expectVisibleFrame(page);

  const updated = await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ strength: 0.35, quality: 'medium' }),
  );
  expect(updated).toMatchObject({ enabled: true, strength: 0.35, quality: 'medium', lastError: null });
  await expectVisibleFrame(page);

  expect(await page.locator('#sss-status').textContent()).toContain('Enabled');
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      /Screen-space SSS|Viewer initialization failed|validation error|render pipeline error/i.test(message),
    ),
  ).toEqual([]);
});
