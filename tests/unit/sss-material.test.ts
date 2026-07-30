import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SSS_MATERIAL_SETTINGS,
  resolveSSSMaterialSettings,
} from '../../packages/viewer/src/materials/sssMaterial';

describe('Three.js SSS material settings', () => {
  it('uses the official example-inspired defaults', () => {
    expect(resolveSSSMaterialSettings()).toEqual(DEFAULT_SSS_MATERIAL_SETTINGS);
  });

  it('preserves valid user parameters', () => {
    expect(
      resolveSSSMaterialSettings({
        enabled: true,
        color: '#ff3366',
        distortion: 0.25,
        ambient: 0.75,
        attenuation: 1.2,
        power: 4,
        scale: 24,
      }),
    ).toEqual({
      enabled: true,
      color: '#ff3366',
      distortion: 0.25,
      ambient: 0.75,
      attenuation: 1.2,
      power: 4,
      scale: 24,
    });
  });

  it('clamps unsafe values to the Playground ranges', () => {
    expect(
      resolveSSSMaterialSettings({
        distortion: -10,
        ambient: 99,
        attenuation: 0,
        power: 100,
        scale: Number.NaN,
      }),
    ).toMatchObject({
      distortion: 0.01,
      ambient: 5,
      attenuation: 0.01,
      power: 16,
      scale: DEFAULT_SSS_MATERIAL_SETTINGS.scale,
    });
  });
});
