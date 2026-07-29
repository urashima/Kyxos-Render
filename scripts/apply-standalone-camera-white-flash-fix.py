from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
viewer = viewer_path.read_text()
old_listener = "    this.controls.addEventListener('end', () => this.resetTemporal('camera-cut'));\n"
new_listener = """    // OrbitControls emits `end` for every normal orbit, pan and zoom gesture.\n    // Rebuilding the complete RenderPipeline there reallocates TRAA and DoF\n    // half-float render targets and can expose an uninitialized bright frame.\n    // Continuous camera motion is already represented by velocity/depth; reserve\n    // resetTemporal() for explicit scene, resize and programmatic camera cuts.\n"""
if viewer.count(old_listener) != 1:
    raise SystemExit(f'Expected one OrbitControls temporal-reset listener, found {viewer.count(old_listener)}')
viewer_path.write_text(viewer.replace(old_listener, new_listener, 1))

test_path = Path('tests/e2e/playground.spec.ts')
tests = test_path.read_text()
anchor = "\n\ntest.describe('full lifecycle acceptance', () => {"
if tests.count(anchor) != 1:
    raise SystemExit(f'Expected one lifecycle test anchor, found {tests.count(anchor)}')

regression = r'''

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
'''

test_path.write_text(tests.replace(anchor, regression + anchor, 1))
