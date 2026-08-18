import {
  normalizeAdvancedRenderSettings,
  type SceneAdvancedRenderSettings,
} from '@kyxos/scene-contract/advanced-render-settings';
import { Vector2 } from 'three/webgpu';
import { mix, renderOutput, sample, screenUV, texture, uniform, vec4 } from 'three/tsl';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { extractAdvancedSceneAsync } from './render/advanced/sceneExtraction';
import {
  RealtimeRtFeaturePassV3,
  type RealtimeRtSkipReason,
} from './render/advanced/realtimeHybridRtFeaturePassV3';

interface AdvancedMethods {
  setRenderingMode: (mode: 'realtime' | 'cinematic' | 'pathTracing') => void;
  setAdvancedRenderSettings: (settings: Partial<SceneAdvancedRenderSettings>) => void;
  getAdvancedRenderSettings: () => SceneAdvancedRenderSettings;
  getAdvancedRenderStatus: () => any;
  resetAccumulation: (reason?: string) => void;
  dispose: (...args: any[]) => any;
}

const states = new WeakMap<any, RealtimeRtControllerV3>();
const installKey = Symbol.for('kyxos.viewer.realtime-rt-v3');

function mergeSettings(current: SceneAdvancedRenderSettings, update: Partial<SceneAdvancedRenderSettings>): SceneAdvancedRenderSettings {
  return normalizeAdvancedRenderSettings({
    ...current,
    ...update,
    lightSampling: { ...current.lightSampling, ...(update.lightSampling ?? {}) },
    rayTracing: { ...current.rayTracing, ...(update.rayTracing ?? {}) },
    restirDI: { ...current.restirDI, ...(update.restirDI ?? {}) },
    radianceCache: { ...current.radianceCache, ...(update.radianceCache ?? {}) },
    pathTracing: { ...current.pathTracing, ...(update.pathTracing ?? {}) },
  });
}

class RealtimeRtControllerV3 {
  private readonly viewer: any;
  private readonly methods: AdvancedMethods;
  private settings: SceneAdvancedRenderSettings;
  private featurePass: RealtimeRtFeaturePassV3 | null = null;
  private active = false;
  private sceneDirty = true;
  private sceneGeneration = 0;
  private sceneBuild: Promise<void> | null = null;
  private initialization: Promise<void> | null = null;
  private readyUniform = uniform(0);
  private runtimeState: 'idle' | 'initializing' | 'building' | 'rendering' | 'fallback' | 'error' = 'idle';
  private message: string | null = null;
  private frameIndex = 0;
  private cpuFrameTimeMs = 0;
  private triangles = 0;
  private bvhNodes = 0;
  private lights = 0;
  private hookFrames = 0;
  private frameAttempts = 0;
  private frameSubmitted = 0;
  private lastSkipReason = 'not-started';
  private disposed = false;

  constructor(viewer: any, methods: AdvancedMethods) {
    this.viewer = viewer;
    this.methods = methods;
    this.settings = normalizeAdvancedRenderSettings(methods.getAdvancedRenderSettings.call(viewer));
  }

  getSettings(): SceneAdvancedRenderSettings {
    return structuredClone(this.settings);
  }

  private wantsRealtimeRt(): boolean {
    return this.settings.renderingMode !== 'pathTracing' && this.settings.rayTracing.enabled;
  }

  private passRealtimeSettings(): void {
    this.methods.setAdvancedRenderSettings.call(this.viewer, {
      ...this.settings,
      renderingMode: 'realtime',
    });
  }

  private recordFrameReason(reason: string): void {
    this.lastSkipReason = reason;
    const canvas = this.viewer.canvas as HTMLCanvasElement;
    canvas.dataset.realtimeRtHookFrames = String(this.hookFrames);
    canvas.dataset.realtimeRtFrameAttempts = String(this.frameAttempts);
    canvas.dataset.realtimeRtFrameSubmitted = String(this.frameSubmitted);
    canvas.dataset.realtimeRtSkipReason = reason;
  }

  setSettings(update: Partial<SceneAdvancedRenderSettings>): void {
    const previous = this.settings;
    this.settings = mergeSettings(this.settings, update);
    this.featurePass?.setSettings(this.settings);

    if (this.settings.renderingMode === 'pathTracing') {
      this.deactivateRealtimeRt(false);
      this.methods.setAdvancedRenderSettings.call(this.viewer, this.settings);
      return;
    }

    if (this.wantsRealtimeRt()) {
      this.active = true;
      this.passRealtimeSettings();
      void this.activate('settings');
      const structuralChange =
        previous.rayTracing.realtimeDenoise !== this.settings.rayTracing.realtimeDenoise ||
        previous.rayTracing.realtimeFusion !== this.settings.rayTracing.realtimeFusion ||
        previous.rayTracing.refractions !== this.settings.rayTracing.refractions;
      if (structuralChange && this.featurePass) this.viewer.queuePipelineRebuild?.('realtime-rt-v3-settings');
      return;
    }

    this.deactivateRealtimeRt(true);
    this.methods.setAdvancedRenderSettings.call(this.viewer, this.settings);
  }

  setMode(mode: 'realtime' | 'cinematic' | 'pathTracing'): void {
    this.settings = mergeSettings(this.settings, {
      renderingMode: mode,
      ...(mode === 'cinematic' ? { rayTracing: { ...this.settings.rayTracing, enabled: true } } : {}),
    });

    if (mode === 'pathTracing') {
      this.deactivateRealtimeRt(false);
      this.methods.setRenderingMode.call(this.viewer, 'pathTracing');
      return;
    }

    if (this.settings.rayTracing.enabled) {
      this.active = true;
      this.methods.setRenderingMode.call(this.viewer, 'realtime');
      void this.activate('mode');
      return;
    }

    this.deactivateRealtimeRt(false);
    this.methods.setRenderingMode.call(this.viewer, 'realtime');
  }

  private async activate(reason: string): Promise<void> {
    if (this.disposed || !this.active || !this.wantsRealtimeRt()) return;
    if (this.viewer.backend !== 'webgpu' || this.viewer.renderer?.backend?.isWebGPUBackend !== true) {
      this.setState('fallback', 'Realtime RT requires the active WebGPU renderer; raster Realtime remains active.');
      return;
    }
    const capabilities = this.viewer.getAdvancedCapabilities?.();
    if (capabilities && capabilities.softwareRayQuery === false) {
      this.setState('fallback', capabilities.reason ?? 'Software ray queries are unavailable on this WebGPU device.');
      return;
    }

    if (!this.featurePass) {
      if (this.initialization) return this.initialization;
      this.initialization = (async () => {
        this.setState('initializing', 'Initializing realtime RT AO / shadows / reflection / refraction feature passes.');
        const pass = new RealtimeRtFeaturePassV3(this.viewer, this.settings);
        try {
          await pass.initialize();
          if (this.disposed || !this.active) {
            pass.dispose();
            return;
          }
          this.featurePass = pass;
          this.sceneDirty = true;
        } catch (error) {
          pass.dispose();
          this.setState('fallback', `Realtime RT initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })().finally(() => { this.initialization = null; });
      await this.initialization;
    }

    if (!this.featurePass || !this.active) return;
    if (this.sceneDirty) await this.rebuildScene();
    if (!this.sceneDirty && this.featurePass) {
      this.viewer.queuePipelineRebuild?.(`realtime-rt-v3:${reason}`);
      this.setState('rendering', 'Realtime raster + interleaved RT queries + velocity reprojection + realtime denoise/fusion.');
    }
  }

  private async rebuildScene(): Promise<void> {
    if (!this.featurePass || this.sceneBuild || this.disposed) return this.sceneBuild ?? undefined;
    const generation = this.sceneGeneration;
    this.sceneDirty = false;
    this.setState('building', 'Building realtime RT software BVH while raster rendering stays active.');
    this.sceneBuild = (async () => {
      try {
        const scene = await extractAdvancedSceneAsync(this.viewer);
        if (this.disposed || generation !== this.sceneGeneration || !this.featurePass) {
          this.sceneDirty = true;
          return;
        }
        this.featurePass.setScene(scene);
        this.triangles = scene.triangleCount;
        this.bvhNodes = scene.blasNodeCount + scene.tlasNodeCount;
        this.lights = scene.lightCount;
        this.message = `Realtime RT BVH ready · ${scene.triangleCount} triangles · ${scene.lightCount} lights.`;
      } catch (error) {
        this.sceneDirty = true;
        this.setState('error', `Realtime RT scene build failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })().finally(() => { this.sceneBuild = null; });
    return this.sceneBuild;
  }

  markSceneDirty(): void {
    this.sceneDirty = true;
    this.sceneGeneration += 1;
    this.readyUniform.value = 0;
    this.featurePass?.resetHistory();
    if (this.active) void this.rebuildScene().then(() => {
      if (this.active && !this.sceneDirty) this.viewer.queuePipelineRebuild?.('realtime-rt-v3-scene-change');
    });
  }

  resetHistory(reason = 'manual'): void {
    this.featurePass?.resetHistory();
    this.message = `Realtime RT temporal history reset: ${reason}. RT remains an interactive feature pass.`;
    if (this.active) this.viewer.queuePipelineRebuild?.(`realtime-rt-v3-history:${reason}`);
  }

  private currentFrameInputs(): { depth: any; normal: any; metalRough: any; width: number; height: number } | null {
    const prePass = this.viewer.nodes?.find?.((node: any) => node?.name === 'Kyxos.PrePassMRT');
    if (!prePass) return null;
    const depth = prePass.getTexture?.('depth');
    const normal = prePass.getTexture?.('output');
    const metalRough = prePass.getTexture?.('metalrough');
    if (!depth || !normal || !metalRough) return null;
    const drawingBufferSize = new Vector2(1, 1);
    const size = this.viewer.renderer?.getDrawingBufferSize?.(drawingBufferSize) ?? drawingBufferSize;
    return {
      depth,
      normal,
      metalRough,
      width: Math.max(1, Number(size.x ?? normal.image?.width ?? 1)),
      height: Math.max(1, Number(size.y ?? normal.image?.height ?? 1)),
    };
  }

  private renderFeatureFrame(): void {
    this.frameAttempts += 1;
    if (!this.active) { this.recordFrameReason('inactive'); return; }
    if (!this.featurePass) { this.recordFrameReason('no-feature-pass'); return; }
    if (this.sceneDirty) { this.recordFrameReason('scene-dirty'); return; }
    if (this.sceneBuild) { this.recordFrameReason('scene-building'); return; }
    if (this.disposed) { this.recordFrameReason('disposed'); return; }
    if (this.viewer.getAnimationEnabled?.() === true) {
      this.message = 'Realtime RT currently uses a static software BVH; skinned/morph animation stays on raster until realtime BVH refit is added.';
      this.recordFrameReason('animation-bvh-refit-required');
      return;
    }
    const inputs = this.currentFrameInputs();
    if (!inputs) {
      this.recordFrameReason('no-realtime-gbuffer');
      return;
    }
    try {
      const frame = this.featurePass.render(this.viewer.camera, inputs);
      this.frameIndex = frame.frameIndex;
      this.cpuFrameTimeMs = frame.cpuFrameTimeMs;
      if (frame.ready) this.readyUniform.value = 1;
      if (frame.submitted) {
        this.frameSubmitted += 1;
        this.message = 'Realtime RT phase submitted; temporal reprojection and denoise reconstruct continuously during camera motion.';
        this.recordFrameReason('submitted');
        if (frame.frameIndex === 1 || frame.frameIndex % 16 === 0) this.emitStatus();
      } else {
        const reason = frame.skipReason ?? ('unknown-feature-skip' as RealtimeRtSkipReason | 'unknown-feature-skip');
        this.recordFrameReason(reason);
        if (frame.ready) {
          this.message = `Realtime RT reused the filtered history while optional RT work was skipped (${reason}).`;
        }
      }
    } catch (error) {
      this.readyUniform.value = 0;
      this.recordFrameReason('frame-error');
      this.setState('fallback', `Realtime RT frame failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private wrapPipelineRender(pipeline: any): void {
    if (!pipeline || pipeline.__kyxosRealtimeRtV3Wrapped) return;
    const originalRender = pipeline.render.bind(pipeline);
    pipeline.render = (...args: any[]) => {
      this.hookFrames += 1;
      this.recordFrameReason(this.lastSkipReason);
      let result: any;
      try {
        result = originalRender(...args);
      } catch (error) {
        this.recordFrameReason('raster-render-error');
        throw error;
      }
      this.renderFeatureFrame();
      return result;
    };
    pipeline.__kyxosRealtimeRtV3Wrapped = true;
  }

  decoratePipeline(): void {
    if (!this.active || !this.featurePass || this.disposed || this.viewer.debugView !== 'final') return;
    const prePass = this.viewer.nodes?.find?.((node: any) => node?.name === 'Kyxos.PrePassMRT');
    const pipeline = this.viewer.renderPipeline;
    const baseFinal = this.viewer.finalNode;
    if (!prePass || !pipeline || !baseFinal) return;

    const depth = prePass.getTextureNode('depth');
    const normalPacked = prePass.getTextureNode('output');
    const velocityNode = prePass.getTextureNode('velocity');
    const metalRough = prePass.getTextureNode('metalrough');
    const metalRoughness = sample((uv: any) => metalRough.sample(uv).rg);
    const visibilityRaw = texture(this.featurePass.visibilityTexture);
    const reflectionRaw = texture(this.featurePass.reflectionTexture);
    const refractionRaw = texture(this.featurePass.refractionTexture);

    const visibilityTemporal: any = temporalReproject(
      visibilityRaw,
      depth,
      normalPacked,
      velocityNode,
      this.viewer.camera,
      { mode: 'diffuse', accumulate: true },
    );
    visibilityTemporal.maxFrames.value = 8;
    visibilityTemporal.flickerSuppression.value = 1;
    visibilityTemporal.clampIntensity.value = 0.35;

    const denoiseEnabled = this.settings.rayTracing.realtimeDenoise;
    const reflectionTemporal: any = temporalReproject(
      reflectionRaw,
      depth,
      normalPacked,
      velocityNode,
      this.viewer.camera,
      { mode: 'specular', accumulate: !denoiseEnabled },
    );
    reflectionTemporal.maxFrames.value = 8;
    reflectionTemporal.flickerSuppression.value = 1;
    reflectionTemporal.clampIntensity.value = 0.35;

    const refractionTemporal: any = temporalReproject(
      refractionRaw,
      depth,
      normalPacked,
      velocityNode,
      this.viewer.camera,
      { mode: 'specular', accumulate: !denoiseEnabled },
    );
    refractionTemporal.maxFrames.value = 8;
    refractionTemporal.flickerSuppression.value = 1;
    refractionTemporal.clampIntensity.value = 0.35;

    this.viewer.nodes.push(visibilityTemporal, reflectionTemporal, refractionTemporal);
    let reflectionFiltered: any = reflectionTemporal;
    let refractionFiltered: any = refractionTemporal;

    const createSpecularDenoiser = (temporal: any, raw: any): any => {
      const denoiser: any = recurrentDenoise(temporal, this.viewer.camera, {
        depth,
        normal: normalPacked,
        raw,
        metalRoughness,
        mode: 'specular',
        accumulate: true,
      });
      denoiser.alphaSource = 'raylength';
      denoiser.radius.value = Number(this.settings.rayTracing.denoiseRadius);
      denoiser.strength.value = Number(this.settings.rayTracing.denoiseStrength);
      denoiser.lumaPhi.value = 0.75;
      denoiser.depthPhi.value = 20;
      denoiser.normalPhi.value = 0.3;
      denoiser.roughnessPhi.value = 100;
      denoiser.alphaPhi.value = 5;
      denoiser.adapt.value = 0.7;
      denoiser.smoothDisocclusions.value = true;
      denoiser.flickerSuppression.value = 1;
      denoiser.adaptiveTrust.value = 1;
      temporal.setHistoryTexture(denoiser);
      this.viewer.nodes.push(denoiser);
      return denoiser;
    };

    if (denoiseEnabled) {
      reflectionFiltered = createSpecularDenoiser(reflectionTemporal, reflectionRaw);
      refractionFiltered = createSpecularDenoiser(refractionTemporal, refractionRaw);
    }

    const ready = this.readyUniform;
    const fusion = uniform(this.settings.rayTracing.realtimeFusion ? this.settings.rayTracing.fusionStrength : 0);
    const fusionReady = ready.mul(fusion);
    const visibility = mix(1, visibilityTemporal.r, fusionReady);
    const material = metalRough.sample(screenUV).rg;
    const reflectionWeight = material.r.mul(0.7).add(0.03).mul(material.g.oneMinus()).mul(fusionReady);
    const transmission = visibilityTemporal.a.clamp(0, 1);
    const refractionWeight = transmission
      .mul(material.g.oneMinus())
      .mul(this.settings.rayTracing.refractionStrength)
      .mul(fusionReady);

    const reflectionDisplay = renderOutput(vec4(reflectionFiltered.rgb, 1));
    const refractionDisplay = renderOutput(vec4(refractionFiltered.rgb, 1));
    const realtimeWithVisibility = baseFinal.rgb.mul(visibility);
    const withReflection = mix(realtimeWithVisibility, reflectionDisplay.rgb, reflectionWeight);
    const hybridRgb = mix(withReflection, refractionDisplay.rgb, refractionWeight);
    const hybridFinal = vec4(hybridRgb, baseFinal.a);

    this.viewer.finalNode = hybridFinal;
    this.viewer.debugNodes?.set?.('final', hybridFinal);
    this.viewer.applyOutputSelection?.();
    pipeline.needsUpdate = true;
    this.wrapPipelineRender(pipeline);
    this.viewer.canvas.dataset.advancedRenderArchitecture = 'realtime-rt-feature-pass-v3';
    this.recordFrameReason('pipeline-decorated');
  }

  getStatus(): any {
    const underlying = this.methods.getAdvancedRenderStatus.call(this.viewer);
    if (!this.wantsRealtimeRt()) return underlying;
    const enabledFeatures = ['environmentImportance', 'softwareRayQuery', 'realtimeRT'];
    if (this.settings.rayTracing.shadows) enabledFeatures.push('rayShadow');
    if (this.settings.rayTracing.ambientOcclusion) enabledFeatures.push('rayAO');
    if (this.settings.rayTracing.reflections) enabledFeatures.push('rayReflection');
    if (this.settings.rayTracing.refractions) enabledFeatures.push('rayRefraction');
    if (this.settings.rayTracing.realtimeDenoise) enabledFeatures.push('realtimeDenoise');
    if (this.settings.rayTracing.realtimeFusion) enabledFeatures.push('realtimeFusion');
    if (this.settings.restirDI.mode !== 'off') enabledFeatures.push('restirDI');
    return {
      ...underlying,
      requestedMode: this.settings.renderingMode,
      effectiveMode: 'realtime',
      state: this.runtimeState,
      message: this.message,
      samples: this.frameIndex,
      triangles: this.triangles,
      bvhNodes: this.bvhNodes,
      lights: this.lights,
      cpuFrameTimeMs: this.cpuFrameTimeMs,
      rtFrameHookCount: this.hookFrames,
      rtFrameAttempts: this.frameAttempts,
      rtFrameSubmitted: this.frameSubmitted,
      rtFrameSkipReason: this.lastSkipReason,
      enabledFeatures,
      unavailableFeatures: this.settings.radianceCache.enabled ? ['radianceCache'] : [],
    };
  }

  private setState(state: typeof this.runtimeState, message: string | null): void {
    this.runtimeState = state;
    this.message = message;
    this.emitStatus();
  }

  private emitStatus(): void {
    if (!this.wantsRealtimeRt()) return;
    this.viewer.canvas.dataset.advancedRenderMode = this.settings.renderingMode;
    this.viewer.canvas.dataset.advancedRenderState = this.runtimeState;
    this.viewer.canvas.dispatchEvent(new CustomEvent('kyxos-advanced-render-status', { detail: this.getStatus() }));
  }

  private deactivateRealtimeRt(rebuild: boolean): void {
    const wasActive = this.active;
    this.active = false;
    this.readyUniform.value = 0;
    this.runtimeState = 'idle';
    delete this.viewer.canvas.dataset.advancedRenderArchitecture;
    if (rebuild && wasActive) this.viewer.queuePipelineRebuild?.('realtime-rt-v3-disabled');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.featurePass?.dispose();
    this.featurePass = null;
  }
}

export function installRealtimeHybridRtExtensionV3(ViewerClass: { prototype: any }): void {
  const prototype = ViewerClass.prototype;
  if (prototype[installKey]) return;

  const methods: AdvancedMethods = {
    setRenderingMode: prototype.setRenderingMode,
    setAdvancedRenderSettings: prototype.setAdvancedRenderSettings,
    getAdvancedRenderSettings: prototype.getAdvancedRenderSettings,
    getAdvancedRenderStatus: prototype.getAdvancedRenderStatus,
    resetAccumulation: prototype.resetAccumulation,
    dispose: prototype.dispose,
  };
  const originalBuildPipeline = prototype.buildPipeline;

  const state = (viewer: any): RealtimeRtControllerV3 => {
    let value = states.get(viewer);
    if (!value) {
      value = new RealtimeRtControllerV3(viewer, methods);
      states.set(viewer, value);
    }
    return value;
  };

  prototype.setRenderingMode = function setRealtimeRtAwareRenderingMode(mode: 'realtime' | 'cinematic' | 'pathTracing'): void {
    state(this).setMode(mode);
  };
  prototype.setAdvancedRenderSettings = function setRealtimeRtAwareAdvancedSettings(settings: Partial<SceneAdvancedRenderSettings>): void {
    state(this).setSettings(settings);
  };
  prototype.getAdvancedRenderSettings = function getRealtimeRtAwareAdvancedSettings(): SceneAdvancedRenderSettings {
    return state(this).getSettings();
  };
  prototype.getAdvancedRenderStatus = function getRealtimeRtAwareStatus(): any {
    return state(this).getStatus();
  };
  prototype.resetAccumulation = function resetRealtimeRtHistory(reason = 'manual'): void {
    const value = state(this);
    if (value.getSettings().rayTracing.enabled && value.getSettings().renderingMode !== 'pathTracing') value.resetHistory(reason);
    else methods.resetAccumulation.call(this, reason);
  };

  if (typeof originalBuildPipeline === 'function') {
    prototype.buildPipeline = function buildPipelineWithRealtimeRT(...args: any[]): any {
      const result = originalBuildPipeline.apply(this, args);
      states.get(this)?.decoratePipeline();
      return result;
    };
  }

  const wrapDirty = (name: string) => {
    const original = prototype[name];
    if (typeof original !== 'function') return;
    prototype[name] = function realtimeRtDirtyWrapper(...args: any[]): any {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.then((value: any) => {
          states.get(this)?.markSceneDirty();
          return value;
        });
      }
      states.get(this)?.markSceneDirty();
      return result;
    };
  };
  for (const name of ['loadModel', 'loadEnvironment', 'setMaterialTextures', 'setNodeTransform', 'setMaterial', 'setSceneLights', 'setEnvironment']) {
    wrapDirty(name);
  }

  prototype.dispose = function disposeRealtimeRT(...args: any[]): any {
    states.get(this)?.dispose();
    states.delete(this);
    return methods.dispose.apply(this, args);
  };

  prototype[installKey] = true;
}
