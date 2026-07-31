import { expect, test, type Page } from '@playwright/test';

const FRAME_CLIP = { x: 180, y: 110, width: 360, height: 230 } as const;

async function captureFrame(page: Page, delayMs = 650) {
  if (delayMs > 0) await page.waitForTimeout(delayMs);
  return page.screenshot({ type: 'png', clip: FRAME_CLIP });
}

async function loadPixels(page: Page, screenshot: Buffer) {
  return page.evaluate(
    async ({ imageUrl, width, height }) => {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context unavailable.');
      context.drawImage(image, 0, 0, width, height);
      return [...context.getImageData(0, 0, width, height).data];
    },
    {
      imageUrl: `data:image/png;base64,${screenshot.toString('base64')}`,
      width: FRAME_CLIP.width,
      height: FRAME_CLIP.height,
    },
  );
}

async function compareFrames(page: Page, first: Buffer, second: Buffer) {
  const [a, b] = await Promise.all([loadPixels(page, first), loadPixels(page, second)]);
  let absoluteDifference = 0;
  let changed = 0;
  let darkening = 0;
  let darkened = 0;
  let firstLuminance = 0;
  let secondLuminance = 0;
  const pixelCount = FRAME_CLIP.width * FRAME_CLIP.height;

  for (let index = 0; index < a.length; index += 4) {
    const ar = a[index];
    const ag = a[index + 1];
    const ab = a[index + 2];
    const br = b[index];
    const bg = b[index + 1];
    const bb = b[index + 2];
    const firstLuma = ar * 0.2126 + ag * 0.7152 + ab * 0.0722;
    const secondLuma = br * 0.2126 + bg * 0.7152 + bb * 0.0722;
    const delta = (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / 3;
    const darkDelta = Math.max(0, secondLuma - firstLuma);

    firstLuminance += firstLuma;
    secondLuminance += secondLuma;
    absoluteDifference += delta;
    darkening += darkDelta;
    if (delta > 2) changed += 1;
    if (darkDelta > 10) darkened += 1;
  }

  return {
    meanAbsoluteDifference: absoluteDifference / pixelCount,
    changedRatio: changed / pixelCount,
    meanDarkening: darkening / pixelCount,
    darkenedRatio: darkened / pixelCount,
    firstMeanLuminance: firstLuminance / pixelCount,
    secondMeanLuminance: secondLuminance / pixelCount,
  };
}

test('SSS temporal filtering animates only when accumulating and rejects dark motion history', async ({
  page,
}) => {
  test.setTimeout(210_000);
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

  // Temporal ON: the raw stochastic estimate must advance every frame so the
  // history resolve receives independent samples.
  await page.selectOption('#debug-select', 'sssStochastic');
  const animatedA = await captureFrame(page);
  const animatedB = await captureFrame(page);
  const animated = await compareFrames(page, animatedA, animatedB);
  expect(animated.meanAbsoluteDifference).toBeGreaterThan(0.005);

  // Temporal OFF: there is no history to absorb noise, so the sample pattern
  // must freeze instead of turning the switch into a visible shimmer mode.
  await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({ temporalFiltering: false }),
  );
  await page.selectOption('#debug-select', 'sssStochastic');
  const frozenA = await captureFrame(page);
  const frozenB = await captureFrame(page);
  const frozen = await compareFrames(page, frozenA, frozenB);
  expect(frozen.meanAbsoluteDifference).toBeLessThan(0.05);
  expect(frozen.changedRatio).toBeLessThan(0.01);

  await page.evaluate(() =>
    window.__kyxosScreenSpaceSSSTestApi.set({
      temporalFiltering: true,
      temporalMaxFrames: 16,
      temporalClamp: 0.55,
      temporalFlickerSuppression: 1,
      quality: 'low',
      resolutionScale: 0.5,
    }),
  );
  await page.selectOption('#debug-select', 'sssTemporal');
  await page.waitForTimeout(3500);

  const canvas = page.locator('#viewport');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Viewport bounds unavailable.');
  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.5;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(centerX + step * 13, centerY + Math.sin(step * 0.65) * 22);
    await page.waitForTimeout(80);
  }
  await page.mouse.up();

  // Capture while the 16-frame history would still contain the old camera view,
  // then compare with the same final view after convergence. A stale dark history
  // used to make the first frame substantially darker than the settled result.
  const afterMotion = await captureFrame(page, 700);
  await page.waitForTimeout(3200);
  const settled = await captureFrame(page, 0);
  const trail = await compareFrames(page, afterMotion, settled);

  expect(trail.firstMeanLuminance).toBeGreaterThan(trail.secondMeanLuminance * 0.8);
  expect(trail.meanDarkening).toBeLessThan(8);
  expect(trail.darkenedRatio).toBeLessThan(0.25);

  const status = await page.evaluate(() => window.__kyxosScreenSpaceSSSTestApi.getStatus());
  expect(status).toMatchObject({
    temporalFiltering: true,
    temporalActive: true,
    temporalMaxFrames: 16,
    lastError: null,
  });
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      /Screen-space SSS|Viewer initialization failed|validation error|render pipeline error/i.test(message),
    ),
  ).toEqual([]);
});
