import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS,
  RENDER_EFFECT_LABELS,
  RENDER_EFFECT_ORDER,
  RENDER_EFFECT_PARAMETERS,
  RENDER_QUALITY_OPTIONS,
  SCREEN_SPACE_SSS_PARAMETERS,
  createCanonicalQualityPreset,
  enforceCanonicalEffectRules,
  resolveScreenSpaceSssRenderSettings,
} from '@kyxos/scene-contract/render-settings';

describe('canonical render settings parity', () => {
  it('covers every Playground effect with one shared label and switch/slider schema', () => {
    expect(RENDER_EFFECT_ORDER).toHaveLength(19);
    for (const effect of RENDER_EFFECT_ORDER) {
      expect(RENDER_EFFECT_LABELS[effect]).toBeTruthy();
      for (const parameter of RENDER_EFFECT_PARAMETERS[effect] ?? []) {
        expect(['number', 'boolean']).toContain(parameter.kind);
        if (parameter.kind === 'number') {
          expect(Number.isFinite(parameter.min)).toBe(true);
          expect(Number.isFinite(parameter.max)).toBe(true);
          expect(Number.isFinite(parameter.step)).toBe(true);
        }
      }
    }
    expect(RENDER_QUALITY_OPTIONS.map((entry) => entry.value)).toEqual([
      'low',
      'medium',
      'high',
      'cinematic',
      'capture',
    ]);
  });

  it('keeps Playground preset dependency rules canonical', () => {
    const high = createCanonicalQualityPreset('high');
    expect(high.traa.enabled).toBe(true);
    expect(high.ssgi.enabled).toBe(true);
    expect(high.temporalReprojection.enabled).toBe(true);
    expect(high.temporalDenoise.enabled).toBe(true);

    const ssaa = enforceCanonicalEffectRules({
      ...high,
      ssaa: { ...high.ssaa, enabled: true },
    }, 'ssaa');
    expect(ssaa.ssaa.enabled).toBe(true);
    expect(ssaa.traa.enabled).toBe(false);
    expect(ssaa.fxaa.enabled).toBe(false);
    expect(ssaa.smaa.enabled).toBe(false);
  });

  it('normalizes the complete screen-space SSS settings used by every product', () => {
    expect(SCREEN_SPACE_SSS_PARAMETERS.some((entry) => entry.key === 'temporalFiltering')).toBe(true);
    const settings = resolveScreenSpaceSssRenderSettings({
      enabled: true,
      quality: 'high',
      falloff: [0.5],
    });
    expect(settings.enabled).toBe(true);
    expect(settings.quality).toBe('high');
    expect(settings.falloff).toHaveLength(3);
    expect(settings.temporalMaxFrames).toBe(
      DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS.temporalMaxFrames,
    );
  });
});
