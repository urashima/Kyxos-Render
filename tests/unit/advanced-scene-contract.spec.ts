import { describe, expect, it } from 'vitest';
import {
  createEmptySceneContract,
  validateSceneContract,
  type SceneRenderSettings,
  type ViewerCapabilityDescription,
} from '../../packages/scene-contract/src/index';
import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
} from '../../packages/scene-contract/src/advanced-render-settings';

describe('advanced rendering Scene Contract', () => {
  it('keeps the legacy scene factory valid and backward compatible', () => {
    const scene = createEmptySceneContract('Legacy-compatible Scene');
    expect(scene.renderSettings.advanced).toBeUndefined();
    expect(validateSceneContract(scene).valid).toBe(true);
  });

  it('normalizes missing advanced settings to backend-independent defaults', () => {
    expect(normalizeAdvancedRenderSettings(undefined)).toEqual(DEFAULT_ADVANCED_RENDER_SETTINGS);
  });

  it('bounds malformed advanced values at the protocol boundary', () => {
    const normalized = normalizeAdvancedRenderSettings({
      renderingMode: 'pathTracing',
      restirDI: { mode: 'temporalSpatial', candidates: 999, spatialSamples: -2 },
      radianceCache: { enabled: true, cellSize: -5, capacity: 1, updateRatio: 4 },
      pathTracing: {
        maxBounces: 99,
        samplesPerFrame: 99,
        denoise: true,
        fireflyClamp: -1,
        resolutionScale: 3,
      },
    });
    expect(normalized.renderingMode).toBe('pathTracing');
    expect(normalized.restirDI.candidates).toBe(32);
    expect(normalized.restirDI.spatialSamples).toBe(0);
    expect(normalized.radianceCache.cellSize).toBe(0.05);
    expect(normalized.radianceCache.capacity).toBe(1024);
    expect(normalized.radianceCache.updateRatio).toBe(1);
    expect(normalized.pathTracing.maxBounces).toBe(16);
    expect(normalized.pathTracing.samplesPerFrame).toBe(4);
    expect(normalized.pathTracing.fireflyClamp).toBe(1);
    expect(normalized.pathTracing.resolutionScale).toBe(1);
  });

  it('exposes advanced settings and capabilities on the canonical root types', () => {
    const renderSettings: SceneRenderSettings = {
      backend: 'auto',
      qualityPreset: 'high',
      exposure: 1,
      toneMapping: 'AgX',
      effects: {},
      advanced: structuredClone(DEFAULT_ADVANCED_RENDER_SETTINGS),
    };
    const capabilities: ViewerCapabilityDescription = {
      viewerApiVersion: '1.1.0',
      sceneContract: { min: '1.0.0', max: '1.1.0' },
      backend: 'webgpu',
      effects: {},
      textureFormats: [],
      maxTextureSize: 8192,
      animation: { clips: true, seek: true, speed: true, stateGraph: true, blendTrees: true },
      picking: { available: true, multiSelect: true },
      advancedRendering: {
        tier: 'webgpu-enhanced',
        compute: true,
        storageBuffer: true,
        softwareRayQuery: true,
        restirDI: true,
        radianceCache: true,
        pathTracing: true,
      },
    };
    expect(renderSettings.advanced?.renderingMode).toBe('realtime');
    expect(capabilities.advancedRendering?.pathTracing).toBe(true);
  });
});
