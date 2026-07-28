from pathlib import Path

path = Path('tests/e2e/webgpu.spec.ts')
text = path.read_text()

marker = """  ];

  for (const stage of stages) {
"""
replacement = """  ];

  const failures: string[] = [];

  for (const stage of stages) {
"""
if text.count(marker) != 1:
    raise SystemExit(f'Expected one stage-loop marker, found {text.count(marker)}')
text = text.replace(marker, replacement, 1)

backend_assert = """    expect(backend, `${stage.name} backend`).toBe('webgpu');
"""
backend_collect = """    if (backend !== 'webgpu') failures.push(`${stage.name}: backend=${String(backend)}`);
"""
if text.count(backend_assert) != 1:
    raise SystemExit('Backend assertion did not match')
text = text.replace(backend_assert, backend_collect, 1)

baseline_block = """    const baseline = await sampleVisiblePixels(page);
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
"""
baseline_collect = """    const baseline = await sampleVisiblePixels(page);
    const baselineState = await page.evaluate(() => ({
      error: window.__kyxosTestApi.getLastError(),
      warnings: window.__kyxosTestApi.getWarnings(),
    }));
    if (baseline.visible <= baseline.total * 0.05) {
      failures.push(`${stage.name}: Beauty baseline black (${baseline.visible}/${baseline.total})`);
    }
    if (baselineState.error) failures.push(`${stage.name}: baseline error ${baselineState.error}`);
    if (baselineState.warnings.join('\\n').includes('was isolated and disabled')) {
      failures.push(`${stage.name}: baseline isolated effect ${baselineState.warnings.join(' | ')}`);
    }
    if (pageErrors.length > 0) failures.push(`${stage.name}: baseline page errors ${pageErrors.join(' | ')}`);
"""
if text.count(baseline_block) != 1:
    raise SystemExit('Baseline assertion block did not match')
text = text.replace(baseline_block, baseline_collect, 1)

stage_block = """    expect(pixels.visible, `${stage.name} visible pixels`).toBeGreaterThan(pixels.total * 0.05);
    expect(pixels.luminance, `${stage.name} luminance`).toBeGreaterThan(pixels.total * 24);
    expect(state.error, `${stage.name} runtime error`).toBeNull();
    expect(state.warnings.join('\\n'), `${stage.name} Safe Beauty warning`).not.toContain('Safe Beauty');
    expect(state.warnings.join('\\n'), `${stage.name} isolated effect`).not.toContain('was isolated and disabled');
    expect(pageErrors, `${stage.name} page errors`).toEqual([]);
    expect(
      consoleErrors.filter((message) =>
        /sample is not a function|render pipeline error|gpuvalidationerror|validation error/i.test(message),
      ),
      `${stage.name} console errors`,
    ).toEqual([]);
  }
});
"""
stage_collect = """    const filteredConsoleErrors = consoleErrors.filter((message) =>
      /sample is not a function|render pipeline error|gpuvalidationerror|validation error/i.test(message),
    );
    if (pixels.visible <= pixels.total * 0.05) {
      failures.push(`${stage.name}: black (${pixels.visible}/${pixels.total})`);
    }
    if (pixels.luminance <= pixels.total * 24) {
      failures.push(`${stage.name}: insufficient luminance ${pixels.luminance}`);
    }
    if (state.error) failures.push(`${stage.name}: runtime error ${state.error}`);
    if (state.warnings.join('\\n').includes('Safe Beauty')) {
      failures.push(`${stage.name}: Safe Beauty remained active`);
    }
    if (state.warnings.join('\\n').includes('was isolated and disabled')) {
      failures.push(`${stage.name}: isolated effect ${state.warnings.join(' | ')}`);
    }
    if (pageErrors.length > 0) failures.push(`${stage.name}: page errors ${pageErrors.join(' | ')}`);
    if (filteredConsoleErrors.length > 0) {
      failures.push(`${stage.name}: console errors ${filteredConsoleErrors.join(' | ')}`);
    }
    console.log(
      `[WebGPU matrix] ${stage.name}: visible=${pixels.visible}/${pixels.total}, luminance=${pixels.luminance}, failures=${failures.length}`,
    );
  }

  expect(failures, failures.join('\\n')).toEqual([]);
});
"""
if text.count(stage_block) != 1:
    raise SystemExit('Stage assertion block did not match')
text = text.replace(stage_block, stage_collect, 1)
path.write_text(text)
