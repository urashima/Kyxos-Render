import { describe, expect, it } from 'vitest';
import { createQualityPreset, mergeEffectSettings } from '../../packages/viewer/src/presets';

describe('quality presets', () => {
  it('matches the required low preset', () => {
    const preset = createQualityPreset('low');
    expect(preset.fxaa.enabled || preset.smaa.enabled).toBe(true);
    expect(preset.gtao.enabled).toBe(true);
    expect(preset.gtao.resolutionScale).toBe(0.5);
    expect(preset.ssr.enabled).toBe(false);
    expect(preset.ssgi.enabled).toBe(false);
    expect(preset.motionBlur.enabled).toBe(false);
  });

  it('keeps SSGI and TRAA enabled in the high preset', () => {
    const preset = createQualityPreset('high');
    expect(preset.traa.enabled).toBe(true);
    expect(preset.ssgi.enabled).toBe(true);
    expect(preset.ssgi.temporalFiltering).toBe(true);
  });

  it('matches the required cinematic stack', () => {
    const preset = createQualityPreset('cinematic');
    expect(preset.traa.enabled).toBe(true);
    expect(preset.gtao.enabled).toBe(true);
    expect(preset.ssr.enabled).toBe(true);
    expect(preset.ssgi.enabled).toBe(true);
    expect(preset.ssgi.temporalFiltering).toBe(true);
    expect(preset.motionBlur.enabled).toBe(true);
    expect(preset.bloom.enabled).toBe(true);
    expect(preset.dof.enabled).toBe(true);
    expect(preset.lut.enabled).toBe(true);
    expect(preset.lensDistortion.enabled).toBe(true);
    expect(preset.sparkle.enabled).toBe(true);
    expect(preset.sparkle.intensity).toBe(5);
    expect(preset.sparkle.threshold).toBe(0.3);
    expect(preset.sparkle.radius).toBe(0);
    expect(preset.sparkle.samples).toBe(80);
  });

  it('keeps anti-aliasing modes mutually exclusive', () => {
    let state = createQualityPreset('low');
    state = mergeEffectSettings(state, 'traa', { enabled: true });
    expect(state.traa.enabled).toBe(true);
    expect(state.fxaa.enabled).toBe(false);
    expect(state.smaa.enabled).toBe(false);
    expect(state.ssaa.enabled).toBe(false);
  });

  it('keeps SSGI independent from TRAA', () => {
    let state = createQualityPreset('low');
    state = mergeEffectSettings(state, 'ssgi', { enabled: true });
    expect(state.ssgi.enabled).toBe(true);
    expect(state.ssgi.temporalFiltering).toBe(true);
    expect(state.traa.enabled).toBe(false);
    expect(state.fxaa.enabled).toBe(true);

    state = mergeEffectSettings(state, 'traa', { enabled: true });
    expect(state.traa.enabled).toBe(true);
    expect(state.ssgi.enabled).toBe(true);

    state = mergeEffectSettings(state, 'traa', { enabled: false });
    expect(state.traa.enabled).toBe(false);
    expect(state.ssgi.enabled).toBe(true);
  });

  it('keeps SSGI temporal filtering as an independent child setting', () => {
    let state = createQualityPreset('high');
    state = mergeEffectSettings(state, 'ssgi', { temporalFiltering: false });
    expect(state.ssgi.enabled).toBe(true);
    expect(state.ssgi.temporalFiltering).toBe(false);
    expect(state.traa.enabled).toBe(true);

    state = mergeEffectSettings(state, 'traa', { enabled: false });
    expect(state.ssgi.enabled).toBe(true);
    expect(state.ssgi.temporalFiltering).toBe(false);
    expect(state.traa.enabled).toBe(false);
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
});
