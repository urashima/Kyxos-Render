import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
} from '../../packages/scene-contract/src/advanced-render-settings';
import { realtimeHybridRtWGSL } from '../../packages/viewer/src/render/advanced/realtimeHybridRtShaderV3';
import fs from 'node:fs';

const extensionSource = fs.readFileSync(
  new URL('../../packages/viewer/src/realtimeHybridRtExtensionV3.ts', import.meta.url),
  'utf8',
);
const passSource = fs.readFileSync(
  new URL('../../packages/viewer/src/render/advanced/realtimeHybridRtFeaturePassV3.ts', import.meta.url),
  'utf8',
);
const sharedPtSource = fs.readFileSync(
  new URL('../../packages/viewer/src/render/advanced/webgpuSharedPackedRenderer.ts', import.meta.url),
  'utf8',
);

describe('Realtime RT V3', () => {
  it('keeps RT independent from progressive rendering mode', () => {
    const settings = normalizeAdvancedRenderSettings({
      ...DEFAULT_ADVANCED_RENDER_SETTINGS,
      renderingMode: 'realtime',
      rayTracing: {
        ...DEFAULT_ADVANCED_RENDER_SETTINGS.rayTracing,
        enabled: true,
        ambientOcclusion: true,
        refractions: true,
      },
    });
    expect(settings.renderingMode).toBe('realtime');
    expect(settings.rayTracing.enabled).toBe(true);
    expect(settings.rayTracing.ambientOcclusion).toBe(true);
    expect(settings.rayTracing.refractions).toBe(true);
    expect(settings.rayTracing.realtimeDenoise).toBe(true);
    expect(settings.rayTracing.realtimeFusion).toBe(true);
  });

  it('uses three realtime feature outputs including material-aware refraction', () => {
    expect(realtimeHybridRtWGSL).toContain('@binding(6) var visibilityOutput');
    expect(realtimeHybridRtWGSL).toContain('@binding(7) var reflectionOutput');
    expect(realtimeHybridRtWGSL).toContain('@binding(8) var refractionOutput');
    expect(realtimeHybridRtWGSL).toContain('transmissionValue');
    expect(realtimeHybridRtWGSL).toContain('refract(rayValue.xyz');
    expect(realtimeHybridRtWGSL).toContain('textureStore(refractionOutput');
    expect(realtimeHybridRtWGSL).toContain('vec4<f32>(1.0, 1.0, 1.0, 0.0)');
    expect(realtimeHybridRtWGSL).not.toContain('vec4<f32>(1.0, 1.0, 1.0, 1.0)');
    expect(realtimeHybridRtWGSL).not.toContain('.negate()');
  });

  it('never gates interactive RT on camera stability or four-phase convergence', () => {
    expect(extensionSource).not.toContain('STABLE_FRAMES_BEFORE_RT');
    expect(extensionSource).not.toContain('cameraSignature(');
    expect(extensionSource).not.toContain('pure Realtime frame');
    expect(extensionSource).toContain('this.renderFeatureFrame();');
    expect(extensionSource).toContain("advancedRenderArchitecture = 'realtime-rt-feature-pass-v3'");
    expect(passSource).toContain('return { ready: true');
    expect(passSource).toContain('this.gpuBusy');
    expect(passSource).not.toContain('READY_PHASE_COUNT');
  });

  it('submits RT after raster so GBuffer and camera are from the same frame', () => {
    const rasterCall = extensionSource.indexOf('const result = originalRender(...args);');
    const rtCall = extensionSource.indexOf('this.renderFeatureFrame();', rasterCall);
    expect(rasterCall).toBeGreaterThan(-1);
    expect(rtCall).toBeGreaterThan(rasterCall);
  });

  it('keeps explicit shared-device layouts instead of requesting external pipeline handles', () => {
    expect(passSource).toContain('private bindGroupLayout');
    expect(passSource).toContain('this.device.createComputePipeline({');
    expect(passSource).not.toContain('this.device.createComputePipelineAsync(');
    expect(passSource).not.toContain('this.pipeline.getBindGroupLayout(');
    expect(sharedPtSource).toContain('private sharedComputeLayout');
    expect(sharedPtSource).toContain('private sharedDisplayLayout');
    expect(sharedPtSource).not.toContain('this.device.createComputePipelineAsync(');
    expect(sharedPtSource).not.toContain('.getBindGroupLayout(0)');
    expect(sharedPtSource).not.toContain('this.device.pushErrorScope');
    expect(sharedPtSource).not.toContain('this.device.popErrorScope');
  });
});
