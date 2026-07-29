from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "packages/viewer/src/presets.ts",
    """  temporalReprojection: { enabled: false, strength: 1 },
  poissonDenoise: { enabled: false, radius: 2, strength: 1 },
  temporalDenoise: { enabled: false, radius: 1.5, strength: 0.725 },
""",
    """  temporalReprojection: {
    enabled: false,
    maxFrames: 16,
    clampIntensity: 0.25,
    flickerSuppression: 1,
    hitPointReprojection: true,
  },
  poissonDenoise: { enabled: false, radius: 2, strength: 1 },
  temporalDenoise: {
    enabled: false,
    radius: 1.5,
    strength: 0.725,
    lumaPhi: 0.75,
    depthPhi: 20,
    normalPhi: 0.3,
    roughnessPhi: 100,
    alphaPhi: 5,
    adapt: 0.5,
    smoothDisocclusions: true,
    flickerSuppression: 1,
    adaptiveTrust: 1,
  },
""",
)

replace_once(
    "packages/viewer/src/presets.ts",
    """  if (next.ssgi.enabled && next.ssgi.temporalFiltering !== false) {
    next.traa.enabled = true;
    next.fxaa.enabled = false;
    next.smaa.enabled = false;
    next.ssaa.enabled = false;
  }

  if (next.ssaa.enabled) {
""",
    """  if (next.ssgi.enabled && next.ssgi.temporalFiltering !== false) {
    next.traa.enabled = true;
    next.fxaa.enabled = false;
    next.smaa.enabled = false;
    next.ssaa.enabled = false;
  }

  // TemporalReprojectNode and RecurrentDenoiseNode are SSR filters, not
  // independent full-frame post effects. Keep the public switches honest by
  // establishing the required chain automatically.
  if (changed === 'ssr' && !next.ssr.enabled) {
    next.temporalReprojection.enabled = false;
    next.temporalDenoise.enabled = false;
  } else {
    if (changed === 'temporalReprojection' && !next.temporalReprojection.enabled) {
      next.temporalDenoise.enabled = false;
    }
    if (next.temporalDenoise.enabled) next.temporalReprojection.enabled = true;
    if (next.temporalReprojection.enabled) next.ssr.enabled = true;
    if (!next.temporalReprojection.enabled) next.temporalDenoise.enabled = false;
  }

  if (next.ssaa.enabled) {
""",
)

replace_once(
    "packages/viewer/src/KyxosViewer.ts",
    """          const settings = this.effects.ssr;
          // SSR internally samples its color input, so keep the original Scene Pass texture here.
          const ssrNode = ssr(beauty, depth, sceneNormal, {
            camera: this.camera,
            // Stochastic SSR requires an original equirectangular HDR texture for misses.
            // The active studio environment is PMREM, so use the official mirror/blur path.
            stochastic: false,
""",
    """          const settings = this.effects.ssr;
          const temporalEnabled = this.effects.temporalReprojection.enabled;
          const temporalDenoiseEnabled = temporalEnabled && this.effects.temporalDenoise.enabled;
          // SSR internally samples its color input, so keep the original Scene Pass texture here.
          // Temporal reprojection/denoise are designed for the stochastic GGX path. The
          // deterministic mirror/blur path is already stable and makes both controls appear
          // ineffective, so only switch to stochastic SSR when the temporal chain is active.
          const ssrNode = ssr(beauty, depth, sceneNormal, {
            camera: this.camera,
            stochastic: temporalEnabled,
""",
)

replace_once(
    "packages/viewer/src/KyxosViewer.ts",
    """          let reflection: any = ssrNode;
          if (this.effects.temporalReprojection.enabled) {
            const temporal = temporalReproject(ssrNode, depth, normalPacked, velocityNode, this.camera, {
              mode: 'specular',
              accumulate: false,
            });
            reflection = temporal;
            this.nodes.push(temporal);

            if (this.effects.temporalDenoise.enabled) {
              const denoiser = recurrentDenoise(temporal, this.camera, {
                depth,
                normal: normalPacked,
                raw: ssrNode,
                metalRoughness,
                mode: 'specular',
                accumulate: true,
              });
              denoiser.alphaSource = 'raylength';
              denoiser.radius.value = Number(this.effects.temporalDenoise.radius ?? 1.5);
              denoiser.strength.value = Number(this.effects.temporalDenoise.strength ?? 0.725);
              ssrNode.setHistory(denoiser, velocityNode);
              temporal.setHistoryTexture(denoiser);
              reflection = denoiser;
              this.nodes.push(denoiser);
            }
          } else if (this.effects.poissonDenoise.enabled) {
""",
    """          let reflection: any = ssrNode;
          if (temporalEnabled) {
            const temporalSettings = this.effects.temporalReprojection;
            const temporal = temporalReproject(ssrNode, depth, normalPacked, velocityNode, this.camera, {
              mode: 'specular',
              // Standalone reprojection must own and update its history. When the
              // recurrent denoiser is active, its output becomes the external history.
              accumulate: !temporalDenoiseEnabled,
            });
            temporal.maxFrames.value = Number(temporalSettings.maxFrames ?? 16);
            temporal.clampIntensity.value = Number(temporalSettings.clampIntensity ?? 0.25);
            temporal.flickerSuppression.value = Number(temporalSettings.flickerSuppression ?? 1);
            temporal.hitPointReprojection.value = temporalSettings.hitPointReprojection !== false;
            reflection = temporal;
            this.nodes.push(temporal);

            if (temporalDenoiseEnabled) {
              const denoiseSettings = this.effects.temporalDenoise;
              const denoiser = recurrentDenoise(temporal, this.camera, {
                depth,
                normal: normalPacked,
                raw: ssrNode,
                metalRoughness,
                mode: 'specular',
                accumulate: true,
              });
              denoiser.alphaSource = 'raylength';
              denoiser.radius.value = Number(denoiseSettings.radius ?? 1.5);
              denoiser.strength.value = Number(denoiseSettings.strength ?? 0.725);
              denoiser.lumaPhi.value = Number(denoiseSettings.lumaPhi ?? 0.75);
              denoiser.depthPhi.value = Number(denoiseSettings.depthPhi ?? 20);
              denoiser.normalPhi.value = Number(denoiseSettings.normalPhi ?? 0.3);
              denoiser.roughnessPhi.value = Number(denoiseSettings.roughnessPhi ?? 100);
              denoiser.alphaPhi.value = Number(denoiseSettings.alphaPhi ?? 5);
              denoiser.adapt.value = Number(denoiseSettings.adapt ?? 0.5);
              denoiser.smoothDisocclusions.value = denoiseSettings.smoothDisocclusions !== false;
              denoiser.flickerSuppression.value = Number(denoiseSettings.flickerSuppression ?? 1);
              denoiser.adaptiveTrust.value = Number(denoiseSettings.adaptiveTrust ?? 1);
              ssrNode.setHistory(denoiser, velocityNode);
              temporal.setHistoryTexture(denoiser);
              reflection = denoiser;
              this.nodes.push(denoiser);
            }
          } else if (this.effects.poissonDenoise.enabled) {
""",
)

replace_once(
    "apps/playground/src/main.ts",
    """  type EffectName,
  type EffectSettings,
  type QualityPresetName,
""",
    """  type EffectName,
  type EffectSettings,
  type EffectsState,
  type QualityPresetName,
""",
)

replace_once(
    "apps/playground/src/main.ts",
    """  temporalReprojection: 'Temporal Reprojection',
  poissonDenoise: 'Poisson Denoise',
  temporalDenoise: 'Temporal Denoise',
""",
    """  temporalReprojection: 'SSR Temporal Reprojection',
  poissonDenoise: 'Poisson Denoise',
  temporalDenoise: 'SSR Recurrent Denoise',
""",
)

replace_once(
    "apps/playground/src/main.ts",
    """  poissonDenoise: [{ key: 'radius', label: 'Radius', min: 0, max: 5, step: 0.1 }],
  temporalDenoise: [
    { key: 'radius', label: 'Radius', min: 0, max: 3, step: 0.05 },
    { key: 'strength', label: 'Strength', min: 0.5, max: 0.95, step: 0.005 },
  ],
""",
    """  temporalReprojection: [
    { key: 'maxFrames', label: 'History frames', min: 1, max: 64, step: 1 },
    { key: 'clampIntensity', label: 'History clamp', min: 0, max: 2, step: 0.05 },
    { key: 'flickerSuppression', label: 'Flicker suppression', min: 0, max: 2, step: 0.05 },
  ],
  poissonDenoise: [{ key: 'radius', label: 'Radius', min: 0, max: 5, step: 0.1 }],
  temporalDenoise: [
    { key: 'radius', label: 'Radius', min: 0, max: 3, step: 0.05 },
    { key: 'strength', label: 'History strength', min: 0.05, max: 1.5, step: 0.025 },
    { key: 'lumaPhi', label: 'Luma edge stop', min: 0.05, max: 10, step: 0.05 },
    { key: 'depthPhi', label: 'Depth edge stop', min: 1, max: 50, step: 1 },
    { key: 'adaptiveTrust', label: 'Adaptive trust', min: 0, max: 1, step: 0.05 },
  ],
""",
)

replace_once(
    "apps/playground/src/main.ts",
    """  getMetrics: () => ViewerMetrics | null;
  getWarnings: () => string[];
""",
    """  getMetrics: () => ViewerMetrics | null;
  getEffects: () => EffectsState | null;
  getWarnings: () => string[];
""",
)

replace_once(
    "apps/playground/src/main.ts",
    """  getMetrics: () => viewer?.getMetrics() ?? null,
  getWarnings: () => viewer?.getWarnings() ?? [],
""",
    """  getMetrics: () => viewer?.getMetrics() ?? null,
  getEffects: () => viewer?.getEffects() ?? null,
  getWarnings: () => viewer?.getWarnings() ?? [],
""",
)

replace_once(
    "apps/playground/src/routes.ts",
    """    description: 'Official TemporalReprojectNode and unified reset behavior for cuts, resize and asset changes.',
    quality: 'high',
    focus: 'temporalReprojection',
""",
    """    description: 'Stochastic SSR is reprojected through an internal history buffer, with reset behavior for cuts, resize and asset changes.',
    quality: 'high',
    focus: 'temporalReprojection',
    animate: true,
""",
)

replace_once(
    "apps/playground/src/routes.ts",
    """    description: 'Poisson-style DenoiseNode and RecurrentDenoiseNode are available as independent controls.',
    quality: 'high',
    focus: 'temporalDenoise',
""",
    """    description: 'Official recurrent denoising feeds filtered stochastic SSR back into temporal reprojection; Poisson remains an independent spatial filter.',
    quality: 'high',
    focus: 'temporalDenoise',
    animate: true,
""",
)

replace_once(
    "tests/unit/presets.test.ts",
    """  it('forces TRAA for temporal SSGI filtering', () => {
    const state = createQualityPreset('low');
    state.ssgi.enabled = true;
    state.ssgi.temporalFiltering = true;
    const result = enforceEffectRules(state, 'ssgi');
    expect(result.traa.enabled).toBe(true);
    expect(result.fxaa.enabled).toBe(false);
  });
""",
    """  it('forces TRAA for temporal SSGI filtering', () => {
    const state = createQualityPreset('low');
    state.ssgi.enabled = true;
    state.ssgi.temporalFiltering = true;
    const result = enforceEffectRules(state, 'ssgi');
    expect(result.traa.enabled).toBe(true);
    expect(result.fxaa.enabled).toBe(false);
  });

  it('builds the required SSR temporal dependency chain', () => {
    let state = createQualityPreset('low');
    state = mergeEffectSettings(state, 'temporalReprojection', { enabled: true });
    expect(state.ssr.enabled).toBe(true);
    expect(state.temporalReprojection.enabled).toBe(true);
    expect(state.temporalDenoise.enabled).toBe(false);

    state = mergeEffectSettings(state, 'temporalDenoise', { enabled: true });
    expect(state.ssr.enabled).toBe(true);
    expect(state.temporalReprojection.enabled).toBe(true);
    expect(state.temporalDenoise.enabled).toBe(true);
  });

  it('removes dependent temporal filters when their parent is disabled', () => {
    let state = createQualityPreset('high');
    state = mergeEffectSettings(state, 'temporalReprojection', { enabled: false });
    expect(state.temporalDenoise.enabled).toBe(false);
    expect(state.ssr.enabled).toBe(true);

    state = mergeEffectSettings(createQualityPreset('high'), 'ssr', { enabled: false });
    expect(state.temporalReprojection.enabled).toBe(false);
    expect(state.temporalDenoise.enabled).toBe(false);
  });
""",
)

Path("tests/e2e/temporal-controls.spec.ts").write_text(
    """import { expect, test } from '@playwright/test';

const fatalPattern =
  /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i;

test('SSR temporal controls activate a real dependency chain', async ({ page }) => {
  test.setTimeout(120_000);
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

  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });

  await page.evaluate(() => window.__kyxosTestApi.setQuality('low'));
  await page.waitForTimeout(1200);
  const baselineTargets = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.renderTargets ?? 0);

  await page.evaluate(() =>
    window.__kyxosTestApi.setEffect('temporalReprojection', {
      enabled: true,
      maxFrames: 8,
      clampIntensity: 0.25,
      flickerSuppression: 1,
    }),
  );
  await page.waitForTimeout(3000);
  const reprojection = await page.evaluate(() => ({
    effects: window.__kyxosTestApi.getEffects(),
    metrics: window.__kyxosTestApi.getMetrics(),
    error: window.__kyxosTestApi.getLastError(),
  }));
  expect(reprojection.effects?.ssr.enabled).toBe(true);
  expect(reprojection.effects?.temporalReprojection.enabled).toBe(true);
  expect(reprojection.effects?.temporalDenoise.enabled).toBe(false);
  expect(reprojection.metrics?.renderTargets ?? 0).toBeGreaterThan(baselineTargets);
  expect(reprojection.metrics?.drawCalls ?? 0).toBeGreaterThan(0);

  await page.evaluate(() =>
    window.__kyxosTestApi.setEffect('temporalDenoise', {
      enabled: true,
      radius: 1.5,
      strength: 0.725,
      adaptiveTrust: 1,
    }),
  );
  await page.waitForTimeout(3000);
  const denoise = await page.evaluate(() => ({
    effects: window.__kyxosTestApi.getEffects(),
    metrics: window.__kyxosTestApi.getMetrics(),
    error: window.__kyxosTestApi.getLastError(),
    warnings: window.__kyxosTestApi.getWarnings(),
  }));
  expect(denoise.effects?.ssr.enabled).toBe(true);
  expect(denoise.effects?.temporalReprojection.enabled).toBe(true);
  expect(denoise.effects?.temporalDenoise.enabled).toBe(true);
  expect(denoise.metrics?.drawCalls ?? 0).toBeGreaterThan(0);
  expect(denoise.error).toBeNull();

  await page.evaluate(() => window.__kyxosTestApi.setEffect('ssr', { enabled: false }));
  await page.waitForTimeout(1000);
  const disabled = await page.evaluate(() => window.__kyxosTestApi.getEffects());
  expect(disabled?.ssr.enabled).toBe(false);
  expect(disabled?.temporalReprojection.enabled).toBe(false);
  expect(disabled?.temporalDenoise.enabled).toBe(false);

  expect(crashed).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => fatalPattern.test(message))).toEqual([]);
});
"""
)
