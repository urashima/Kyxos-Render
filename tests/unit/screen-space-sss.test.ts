import { describe, expect, it } from 'vitest';

import { getScreenSpaceSSSSamplesPerFrame } from '../../packages/viewer/src/effects/screenSpaceSSSNode';
import {
  DEFAULT_SCREEN_SPACE_SSS_SETTINGS,
  resolveScreenSpaceSSSSettings,
} from '../../packages/viewer/src/materials/screenSpaceSSS';

describe('deferred screen-space SSS settings', () => {
  it('uses the low-cost stochastic temporal defaults', () => {
    expect(resolveScreenSpaceSSSSettings()).toEqual(DEFAULT_SCREEN_SPACE_SSS_SETTINGS);
    expect(DEFAULT_SCREEN_SPACE_SSS_SETTINGS.quality).toBe('low');
    expect(DEFAULT_SCREEN_SPACE_SSS_SETTINGS.temporalFiltering).toBe(true);
    expect(DEFAULT_SCREEN_SPACE_SSS_SETTINGS.temporalMaxFrames).toBe(16);
    expect(getScreenSpaceSSSSamplesPerFrame('low')).toBe(2);
    expect(getScreenSpaceSSSSamplesPerFrame('medium')).toBe(4);
    expect(getScreenSpaceSSSSamplesPerFrame('high')).toBe(6);
  });

  it('preserves valid Sketchfab-style material and temporal controls', () => {
    expect(
      resolveScreenSpaceSSSSettings({
        enabled: true,
        color: '#aaffcc',
        strength: 0.9,
        radius: 12,
        falloff: [0.3, 1, 0.5],
        thickness: 0.8,
        depthFalloff: 90,
        normalThreshold: 0.5,
        quality: 'high',
        temporalFiltering: true,
        temporalMaxFrames: 24,
        temporalClamp: 0.7,
        temporalFlickerSuppression: 1.25,
        materialNames: ['Skin', 'Ears', 'Skin'],
      }),
    ).toEqual({
      enabled: true,
      color: '#aaffcc',
      strength: 0.9,
      radius: 12,
      falloff: [0.3, 1, 0.5],
      thickness: 0.8,
      depthFalloff: 90,
      normalThreshold: 0.5,
      quality: 'high',
      temporalFiltering: true,
      temporalMaxFrames: 24,
      temporalClamp: 0.7,
      temporalFlickerSuppression: 1.25,
      materialNames: ['Skin', 'Ears'],
    });
  });

  it('clamps unsafe values and rejects malformed profiles', () => {
    expect(
      resolveScreenSpaceSSSSettings({
        color: 'red',
        strength: 99,
        radius: -2,
        falloff: [Number.NaN, -1, 8],
        thickness: 5,
        depthFalloff: 0,
        normalThreshold: 10,
        quality: 'ultra' as never,
        temporalMaxFrames: 999,
        temporalClamp: -1,
        temporalFlickerSuppression: 99,
        materialNames: [],
      }),
    ).toMatchObject({
      color: DEFAULT_SCREEN_SPACE_SSS_SETTINGS.color,
      strength: 1.5,
      radius: 0.25,
      falloff: [DEFAULT_SCREEN_SPACE_SSS_SETTINGS.falloff[0], 0, 2],
      thickness: 1,
      depthFalloff: 1,
      normalThreshold: 0.99,
      quality: 'low',
      temporalFiltering: true,
      temporalMaxFrames: 64,
      temporalClamp: 0,
      temporalFlickerSuppression: 4,
      materialNames: null,
    });
  });
});
