from pathlib import Path

path = Path('tests/e2e/webgpu.spec.ts')
text = path.read_text()

initial = """  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 120_000 });
  const backend = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.backend);
  expect(backend).toBe('webgpu');

"""
if initial not in text:
    raise SystemExit('Initial WebGPU page block did not match')
text = text.replace(initial, '', 1)

loop = """  for (const stage of stages) {
    pageErrors.length = 0;
    consoleErrors.length = 0;

    await page.evaluate(
      ({ effects, quality, all }) => {
        window.__kyxosTestApi.setQuality(quality ?? 'low');
        if (!quality) {
          for (const effect of all) window.__kyxosTestApi.setEffect(effect as never, { enabled: false });
          for (const [effect, settings] of effects ?? []) {
            window.__kyxosTestApi.setEffect(effect as never, settings as never);
          }
        }
      },
      { effects: stage.effects, quality: stage.quality, all: allEffects },
    );

    await page.waitForTimeout(stage.settle ?? 1800);
"""
replacement = """  for (const stage of stages) {
    pageErrors.length = 0;
    consoleErrors.length = 0;

    // Start every effect from a fresh, fully rendered Low pipeline. WebGPU
    // pipeline compilation is asynchronous, so reusing one instance while
    // repeatedly disposing complex graphs can invalidate Dawn error scopes.
    await page.goto('/aa/');
    await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 120_000 });
    const backend = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.backend);
    expect(backend, `${stage.name} backend`).toBe('webgpu');
    await page.waitForTimeout(1800);

    const baseline = await sampleVisiblePixels(page);
    expect(baseline.visible, `${stage.name} baseline visible pixels`).toBeGreaterThan(
      baseline.total * 0.05,
    );
    const baselineState = await page.evaluate(() => ({
      error: window.__kyxosTestApi.getLastError(),
      warnings: window.__kyxosTestApi.getWarnings(),
    }));
    expect(baselineState.error, `${stage.name} baseline runtime error`).toBeNull();
    expect(
      baselineState.warnings.join('\\n'),
      `${stage.name} baseline isolated effect`,
    ).not.toContain('was isolated and disabled');
    expect(pageErrors, `${stage.name} baseline page errors`).toEqual([]);

    pageErrors.length = 0;
    consoleErrors.length = 0;

    await page.evaluate(
      ({ effects, quality, all }) => {
        if (quality) {
          window.__kyxosTestApi.setQuality(quality);
        } else {
          for (const effect of all) window.__kyxosTestApi.setEffect(effect as never, { enabled: false });
          for (const [effect, settings] of effects ?? []) {
            window.__kyxosTestApi.setEffect(effect as never, settings as never);
          }
        }
      },
      { effects: stage.effects, quality: stage.quality, all: allEffects },
    );

    await page.waitForTimeout(stage.settle ?? 2200);
"""
if loop not in text:
    raise SystemExit('WebGPU stage loop did not match')
text = text.replace(loop, replacement, 1)
path.write_text(text)
