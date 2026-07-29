import { describe, expect, it } from 'vitest';
import {
  createQualityPreset,
  enforceEffectRules,
  mergeEffectSettings,
} from '../../packages/viewer/src/presets';

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

  it('matches the required cinematic stack', () => {
    const preset = createQualityPreset('cinematic');
    expect(preset.traa.enabled).toBe(true);
    expect(preset.gtao.enabled).toBe(true);
    expect(preset.ssr.enabled).toBe(true);
    expect(preset.ssgi.enabled).toBe(true);
    expect(preset.motionBlur.enabled).toBe(true);
    expect(preset.bloom.enabled).toBe(true);
    expect(preset.dof.enabled).toBe(true);
    expect(preset.lut.enabled).toBe(true);
    expect(preset.lensDistortion.enabled).toBe(true);
  });

  it('keeps anti-aliasing modes mutually exclusive', () => {
    let state = createQualityPreset('low');
    state = mergeEffectSettings(state, 'traa', { enabled: true });
    expect(state.traa.enabled).toBe(true);
    expect(state.fxaa.enabled).toBe(false);
    expect(state.smaa.enabled).toBe(false);
    expect(state.ssaa.enabled).toBe(false);
  });

  it('forces TRAA for temporal SSGI filtering', () => {
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
});
