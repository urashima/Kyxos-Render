from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
text = viewer_path.read_text()

source_marker = """    let source: any = beauty;

    if (useSSAA) {
"""
source_replacement = """    let source: any = beauty;

    // TRAA jitters every scene pass while resolving its color back to stable
    // screen coordinates. Feeding that resolved color into DoF together with
    // the current jittered View-Z makes the CoC composite sample two different
    // coordinate spaces during camera motion. Keep standalone DoF in its
    // existing location, but when TRAA is active build DoF from the same
    // jittered color/depth frame and let TRAA resolve the combined result.
    const dofBeforeTraa = !useSSAA && this.effects.dof.enabled && this.effects.traa.enabled;
    const applyDepthOfField = () => {
      if (!this.effects.dof.enabled || useSSAA) return;
      try {
        source = dof(
          source,
          viewZ,
          uniform(Number(this.effects.dof.focusDistance ?? 4)),
          uniform(Number(this.effects.dof.focalLength ?? 45)),
          uniform(Number(this.effects.dof.bokehScale ?? 1.5)),
        );
      } catch (error) {
        this.effectFailure('dof', error);
      }
    };

    if (useSSAA) {
"""
if text.count(source_marker) != 1:
    raise SystemExit(f'Expected one source marker, found {text.count(source_marker)}')
text = text.replace(source_marker, source_replacement, 1)

traa_marker = """      if (this.effects.traa.enabled) {
"""
traa_replacement = """      if (dofBeforeTraa) applyDepthOfField();

      if (this.effects.traa.enabled) {
"""
if text.count(traa_marker) != 1:
    raise SystemExit(f'Expected one TRAA marker, found {text.count(traa_marker)}')
text = text.replace(traa_marker, traa_replacement, 1)

old_dof = """    if (this.effects.dof.enabled && !useSSAA) {
      try {
        source = dof(
          source,
          viewZ,
          uniform(Number(this.effects.dof.focusDistance ?? 4)),
          uniform(Number(this.effects.dof.focalLength ?? 45)),
          uniform(Number(this.effects.dof.bokehScale ?? 1.5)),
        );
      } catch (error) {
        this.effectFailure('dof', error);
      }
    }
"""
new_dof = """    if (!dofBeforeTraa) applyDepthOfField();
"""
if text.count(old_dof) != 1:
    raise SystemExit(f'Expected one existing DoF block, found {text.count(old_dof)}')
text = text.replace(old_dof, new_dof, 1)
viewer_path.write_text(text)

# Add a camera-motion regression that samples every drag step instead of only
# checking the settled frame. This catches one-frame black composites.
test_path = Path('tests/e2e/playground.spec.ts')
tests = test_path.read_text()
anchor = """test.describe('full lifecycle acceptance', () => {
"""
if anchor not in tests:
    raise SystemExit('Lifecycle test anchor was not found')
regression = """test('TRAA and depth of field stay visible while the camera moves', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
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

  const sampleVisibleRatio = async () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const source = document.querySelector<HTMLCanvasElement>('#viewport');
      if (!source) throw new Error('Viewport canvas not found.');
      const copy = document.createElement('canvas');
      copy.width = 96;
      copy.height = 54;
      const context = copy.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context unavailable.');
      context.drawImage(source, 0, 0, copy.width, copy.height);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) {
          visible += 1;
        }
      }
      return visible / (copy.width * copy.height);
    });

  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.5;
  const ratios: number[] = [];
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(centerX + step * 5, centerY + Math.sin(step * 0.4) * 24);
    await page.waitForTimeout(45);
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
  expect(state.warnings.join('\\n')).not.toContain('Render pipeline error');
  expect(pageErrors).toEqual([]);
});

"""
test_path.write_text(tests.replace(anchor, regression + anchor, 1))
