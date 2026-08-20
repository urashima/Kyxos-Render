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
const viewerSource = fs.readFileSync(
  new URL('../../packages/viewer/src/KyxosViewer.ts', import.meta.url),
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
    const rasterCall = extensionSource.indexOf('result = originalRender(...args);');
    const rtCall = extensionSource.indexOf('this.renderFeatureFrame();', rasterCall);
    expect(rasterCall).toBeGreaterThan(-1);
    expect(rtCall).toBeGreaterThan(rasterCall);
  });

  it('injects RT in HDR before TRAA and display-referred renderOutput', () => {
    const injection = viewerSource.indexOf('source = this.hdrFeatureInjector({');
    const traaCall = viewerSource.indexOf('const traaNode = traa(source');
    const displayTransform = viewerSource.indexOf('source = renderOutput(source);');
    expect(viewerSource).toContain('setInternalHdrFeatureInjector');
    expect(viewerSource).toContain("hdrFeatureInjectionStage = 'pre-temporal'");
    expect(injection).toBeGreaterThan(-1);
    expect(traaCall).toBeGreaterThan(injection);
    expect(displayTransform).toBeGreaterThan(traaCall);
    expect(extensionSource).toContain('preparePipelineInjection(): void');
    expect(extensionSource).toContain('return vec4(hybridRgb, source.a);');
    expect(extensionSource).not.toContain('renderOutput(');
  });

  it('keeps realtime fusion strength hot through persistent uniforms', () => {
    expect(extensionSource).toContain('private fusionUniform = uniform(0)');
    expect(extensionSource).toContain('private refractionStrengthUniform = uniform(0)');
    expect(extensionSource).toContain('this.syncFusionUniforms();');
    expect(extensionSource).toContain('this.readyUniform.mul(this.fusionUniform)');
    expect(extensionSource).toContain('.mul(this.refractionStrengthUniform)');
  });

  it('initializes storage outputs once per resize instead of resetting phases until raw textures appear', () => {
    expect(passSource).toContain('private outputInitPending = false');
    expect(passSource).toContain('this.beginOutputInitialization(nextWidth, nextHeight);');
    expect(passSource).toContain("return 'output-initializing';");
    expect(passSource).toContain('Promise.all(tasks)');
    expect(passSource).not.toContain('this.rawTexture(this.visibilityTexture) &&\n      this.rawTexture(this.reflectionTexture)');
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
