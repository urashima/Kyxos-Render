import { describe, expect, it } from 'vitest';
import {
  createEmptySceneContract,
  validateSceneContract,
  type SceneRenderSettings,
  type ViewerCapabilityDescription,
} from '@kyxos/scene-contract';
import { DEFAULT_ADVANCED_RENDER_SETTINGS } from '@kyxos/scene-contract/advanced-render-settings';

describe('advanced rendering Scene Contract', () => {
  it('adds backend-independent advanced defaults to new scenes', () => {
    const scene = createEmptySceneContract('Advanced Scene');
    expect(scene.renderSettings.advanced).toEqual(DEFAULT_ADVANCED_RENDER_SETTINGS);
    expect(validateSceneContract(scene).valid).toBe(true);
  });

  it('keeps legacy scenes without advanced settings valid', () => {
    const scene = createEmptySceneContract('Legacy-compatible Scene');
    delete scene.renderSettings.advanced;
    expect(validateSceneContract(scene).valid).toBe(true);
  });

  it('rejects malformed advanced render settings without normalizing persisted data silently', () => {
    const scene = createEmptySceneContract('Invalid Advanced Scene');
    scene.renderSettings.advanced = {
      ...DEFAULT_ADVANCED_RENDER_SETTINGS,
      pathTracing: {
        ...DEFAULT_ADVANCED_RENDER_SETTINGS.pathTracing,
        maxBounces: 99,
      },
    };
    const result = validateSceneContract(scene);
    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.path === '/renderSettings/advanced/pathTracing/maxBounces')).toBe(true);
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
