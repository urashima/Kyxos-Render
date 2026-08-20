import {
  normalizeAdvancedRenderSettings,
  type SceneAdvancedRenderSettings,
} from '@kyxos/scene-contract/advanced-render-settings';
import { mix, renderOutput, sample, screenUV, texture, uniform, vec4 } from 'three/tsl';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { extractAdvancedSceneAsync } from './render/advanced/sceneExtraction';
import { RealtimeHybridRtFeaturePassV2 } from './render/advanced/realtimeHybridRtFeaturePassV2';

interface AdvancedMethods {
  setRenderingMode: (mode: 'realtime' | 'cinematic' | 'pathTracing') => void;
  setAdvancedRenderSettings: (settings: Partial<SceneAdvancedRenderSettings>) => void;
  getAdvancedRenderSettings: () => SceneAdvancedRenderSettings;
  getAdvancedRenderStatus: () => any;
  resetAccumulation: (reason?: string) => void;
  dispose: (...args: any[]) => any;
}

const states = new WeakMap<any, RealtimeHybridRtControllerV2>();
const installKey = Symbol.for('kyxos.viewer.realtime-hybrid-rt-v2');
const STABLE_FRAMES_BEFORE_RT = 2;

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

function cameraSignature(camera: any): string {
  camera.updateMatrixWorld?.(true);
  const world = camera.matrixWorld?.elements ?? [];
  const projection = camera.projectionMatrix?.elements ?? [];
  return [...world, ...projection].map((value) => Number(value).toFixed(5)).join('|');
}

class RealtimeHybridRtControllerV2 {
  private readonly viewer: any;
  private readonly methods: AdvancedMethods;
  private settings: SceneAdvancedRenderSettings;
  private featurePass: RealtimeHybridRtFeaturePassV2 | null = null;
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
  private originalControlsUpdate: ((...args: any[]) => any) | null = null;
  private controlsObject: any = null;
  private stableFrames = 0;
  private lastCameraSignature = '';
  private disposed = false;

  constructor(viewer: any, methods: AdvancedMethods) {
    this.viewer = viewer;
    this.methods = methods;
    this.settings = normalizeAdvancedRenderSettings(methods.getAdvancedRenderSettings.call(viewer));
  }

  getSettings(): SceneAdvancedRenderSettings {
    return structuredClone(this.settings);
  }

  setSettings(update: Partial<SceneAdvancedRenderSettings>): void {
    const previousMode = this.settings.renderingMode;
    this.settings = mergeSettings(this.settings, update);
    this.featurePass?.setSettings(this.settings);
    if (previousMode !== this.settings.renderingMode) this.readyUniform.value = 0;
    if (this.settings.renderingMode === 'cinematic') {
      this.active = true;
      this.methods.setAdvancedRenderSettings.call(this.viewer, { ...this.settings, renderingMode: 'realtime' });
      void this.activate('settings');
    } else {
      this.deactivateHybrid();
      this.methods.setAdvancedRenderSettings.call(this.viewer, this.settings);
    }
  }

  setMode(mode: 'realtime' | 'cinematic' | 'pathTracing'): void {
    this.settings = mergeSettings(this.settings, { renderingMode: mode });
    if (mode === 'cinematic') {
      this.active = true;
      this.methods.setRenderingMode.call(this.viewer, 'realtime');
      void this.activate('mode');
      return;
    }
    this.deactivateHybrid();
    this.methods.setRenderingMode.call(this.viewer, mode);
  }

  private async activate(reason: string): Promise<void> {
    if (this.disposed || !this.active || this.settings.renderingMode !== 'cinematic') return;
    if (this.viewer.backend !== 'webgpu' || this.viewer.renderer?.backend?.isWebGPUBackend !== true) {
      this.setState('fallback', 'Hybrid RT requires the active WebGPU realtime renderer; realtime raster remains active.');
      return;
    }
    const capabilities = this.viewer.getAdvancedCapabilities?.();
    if (capabilities && capabilities.softwareRayQuery === false) {
      this.setState('fallback', capabilities.reason ?? 'Software ray query is unavailable on this WebGPU device.');
      return;
    }

    this.patchControls();
    if (!this.featurePass) {
      if (this.initialization) return this.initialization;
      this.initialization = (async () => {
        this.setState('initializing', 'Initializing interaction-safe same-device Hybrid RT.');
        const pass = new RealtimeHybridRtFeaturePassV2(this.viewer, this.settings);
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
          this.setState('fallback', `Hybrid RT initialization failed: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      })().finally(() => { this.initialization = null; });
      await this.initialization;
    }
    if (!this.featurePass || !this.active) return;
    if (this.sceneDirty) await this.rebuildScene();
    if (!this.sceneDirty && this.featurePass) {
      this.readyUniform.value = 0;
      this.stableFrames = 0;
      this.lastCameraSignature = cameraSignature(this.viewer.camera);
      this.viewer.queuePipelineRebuild?.(`hybrid-rt-v2:${reason}`);
      this.setState('rendering', 'Realtime primary image active; Hybrid RT engages from spare GPU budget after interaction settles.');
    }
  }

  private async rebuildScene(): Promise<void> {
    if (!this.featurePass || this.sceneBuild || this.disposed) return this.sceneBuild ?? undefined;
    const generation = this.sceneGeneration;
    this.sceneDirty = false;
    this.setState('building', 'Building Hybrid RT software BVH while realtime remains visible.');
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
        this.message = `Hybrid RT BVH ready · ${scene.triangleCount} triangles · ${scene.lightCount} lights.`;
      } catch (error) {
        this.sceneDirty = true;
        this.setState('error', `Hybrid RT scene build failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })().finally(() => { this.sceneBuild = null; });
    return this.sceneBuild;
  }

  markSceneDirty(): void {
    this.sceneDirty = true;
    this.sceneGeneration += 1;
    this.readyUniform.value = 0;
    this.stableFrames = 0;
    this.featurePass?.resetHistory();
    if (this.active) void this.rebuildScene().then(() => {
      if (this.active && !this.sceneDirty) this.viewer.queuePipelineRebuild?.('hybrid-rt-v2-scene-change');
    });
  }

  resetHistory(reason = 'manual'): void {
    this.featurePass?.resetHistory();
    this.readyUniform.value = 0;
    this.stableFrames = 0;
    this.message = `Hybrid RT history reset: ${reason}. Realtime remains active.`;
    this.emitStatus();
  }

  private patchControls(): void {
    const controls = this.viewer.controls;
    if (!controls || this.controlsObject === controls) return;
    if (this.controlsObject && this.originalControlsUpdate) this.controlsObject.update = this.originalControlsUpdate;
    this.controlsObject = controls;
    this.originalControlsUpdate = controls.update.bind(controls);
    this.lastCameraSignature = cameraSignature(this.viewer.camera);

    controls.update = (...args: any[]) => {
      const before = this.lastCameraSignature;
      const result = this.originalControlsUpdate?.(...args);
      const after = cameraSignature(this.viewer.camera);
      const moved = result === true || (before.length > 0 && after !== before);
      this.lastCameraSignature = after;

      if (moved) {
        if (this.stableFrames > 0 || Number(this.readyUniform.value) > 0) this.featurePass?.resetHistory();
        this.stableFrames = 0;
        this.readyUniform.value = 0;
        this.frameIndex = 0;
        if (this.runtimeState === 'rendering') {
          this.message = 'Camera active · pure Realtime frame; Hybrid RT is suspended instead of blocking the GPU queue.';
        }
        return result;
      }

      this.stableFrames += 1;
      if (this.stableFrames >= STABLE_FRAMES_BEFORE_RT) this.renderFeatureFrame();
      return result;
    };
  }

  private currentFrameInputs(): { depth: any; normal: any; metalRough: any; width: number; height: number } | null {
    const prePass = this.viewer.nodes?.find?.((node: any) => node?.name === 'Kyxos.PrePassMRT');
    if (!prePass) return null;
    const depth = prePass.getTexture?.('depth');
    const normal = prePass.getTexture?.('output');
    const metalRough = prePass.getTexture?.('metalrough');
    if (!depth || !normal || !metalRough) return null;
    const size = this.viewer.renderer?.getDrawingBufferSize?.({
      width: 1, height: 1,
      set(x: number, y: number) { this.width = x; this.height = y; return this; },
    }) ?? { width: normal.image?.width ?? 1, height: normal.image?.height ?? 1 };
    return {
      depth,
      normal,
      metalRough,
      width: Math.max(1, Number(size.width ?? normal.image?.width ?? 1)),
      height: Math.max(1, Number(size.height ?? normal.image?.height ?? 1)),
    };
  }

  private renderFeatureFrame(): void {
    if (!this.active || !this.featurePass || this.sceneDirty || this.sceneBuild || this.disposed) return;
    if (this.viewer.animationEnabled) {
      this.readyUniform.value = 0;
      this.message = 'Animated geometry active · Realtime remains authoritative until the software BVH pose can be updated safely.';
      return;
    }
    const inputs = this.currentFrameInputs();
    if (!inputs) return;
    try {
      const frame = this.featurePass.render(this.viewer.camera, inputs);
      this.frameIndex = frame.frameIndex;
      this.cpuFrameTimeMs = frame.cpuFrameTimeMs;
      if (frame.ready) {
        this.readyUniform.value = 1;
        this.message = frame.submitted
          ? 'Hybrid RT checkerboard phase submitted; temporal filtering resolves inside Realtime.'
          : 'Hybrid RT GPU work still in flight; Realtime continues without queue backlog.';
      }
    } catch (error) {
      this.readyUniform.value = 0;
      this.setState('fallback', `Hybrid RT frame failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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

    const visibilityTemporal: any = temporalReproject(
      visibilityRaw,
      depth,
      normalPacked,
      velocityNode,
      this.viewer.camera,
      { mode: 'diffuse', accumulate: true },
    );
    visibilityTemporal.maxFrames.value = 16;
    visibilityTemporal.flickerSuppression.value = 1;
    visibilityTemporal.clampIntensity.value = 1;

    const useRecurrentDenoise = this.settings.pathTracing.denoise;
    const reflectionTemporal: any = temporalReproject(
      reflectionRaw,
      depth,
      normalPacked,
      velocityNode,
      this.viewer.camera,
      { mode: 'specular', accumulate: !useRecurrentDenoise },
    );
    reflectionTemporal.maxFrames.value = 16;
    reflectionTemporal.flickerSuppression.value = 1;
    reflectionTemporal.clampIntensity.value = 1;

    let reflectionFiltered: any = reflectionTemporal;
    this.viewer.nodes.push(visibilityTemporal, reflectionTemporal);
    if (useRecurrentDenoise) {
      const denoiser: any = recurrentDenoise(reflectionTemporal, this.viewer.camera, {
        depth,
        normal: normalPacked,
        raw: reflectionRaw,
        metalRoughness,
        mode: 'specular',
        accumulate: true,
      });
      denoiser.alphaSource = 'raylength';
      denoiser.radius.value = Math.max(0.5, Number(this.settings.pathTracing.denoiseRadius || 1));
      denoiser.strength.value = Math.max(0, Math.min(1, Number(this.settings.pathTracing.denoiseStrength)));
      denoiser.lumaPhi.value = 0.75;
      denoiser.depthPhi.value = 20;
      denoiser.normalPhi.value = 0.3;
      denoiser.roughnessPhi.value = 100;
      denoiser.alphaPhi.value = 5;
      denoiser.adapt.value = 0.65;
      denoiser.smoothDisocclusions.value = true;
      denoiser.flickerSuppression.value = 1;
      denoiser.adaptiveTrust.value = 1;
      reflectionTemporal.setHistoryTexture(denoiser);
      reflectionFiltered = denoiser;
      this.viewer.nodes.push(denoiser);
    }

    const ready = this.readyUniform;
    const visibility = mix(1, visibilityTemporal.r, ready);
    const material = metalRough.sample(screenUV).rg;
    const reflectionWeight = material.r.mul(0.7).add(0.03).mul(material.g.oneMinus()).mul(ready);
    const reflectionDisplay = renderOutput(vec4(reflectionFiltered.rgb, 1));
    const realtimeWithVisibility = baseFinal.rgb.mul(visibility);
    const hybridRgb = mix(realtimeWithVisibility, reflectionDisplay.rgb, reflectionWeight);
    const hybridFinal = vec4(hybridRgb, baseFinal.a);

    this.viewer.finalNode = hybridFinal;
    this.viewer.debugNodes?.set?.('final', hybridFinal);
    this.viewer.applyOutputSelection?.();
    pipeline.needsUpdate = true;
    this.viewer.canvas.dataset.advancedRenderArchitecture = 'realtime-hybrid-feature-pass-v2';
  }

  getStatus(): any {
    const underlying = this.methods.getAdvancedRenderStatus.call(this.viewer);
    if (this.settings.renderingMode !== 'cinematic') return underlying;
    const enabledFeatures = ['environmentImportance', 'softwareRayQuery', 'interactionSafeHybrid'];
    if (this.settings.rayTracing.shadows) enabledFeatures.push('rayShadow');
    if (this.settings.rayTracing.ambientOcclusion) enabledFeatures.push('rayAO');
    if (this.settings.rayTracing.reflections) enabledFeatures.push('rayReflection');
    if (this.settings.restirDI.mode !== 'off') enabledFeatures.push('restirDI');
    return {
      ...underlying,
      requestedMode: 'cinematic',
      effectiveMode: this.runtimeState === 'rendering' ? 'cinematic' : 'realtime',
      state: this.runtimeState,
      message: this.message,
      samples: this.frameIndex,
      triangles: this.triangles,
      bvhNodes: this.bvhNodes,
      lights: this.lights,
      cpuFrameTimeMs: this.cpuFrameTimeMs,
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
    if (this.settings.renderingMode !== 'cinematic') return;
    this.viewer.canvas.dataset.advancedRenderMode = this.runtimeState === 'rendering' ? 'cinematic' : 'realtime';
    this.viewer.canvas.dataset.advancedRenderState = this.runtimeState;
    this.viewer.canvas.dispatchEvent(new CustomEvent('kyxos-advanced-render-status', { detail: this.getStatus() }));
  }

  private deactivateHybrid(): void {
    this.active = false;
    this.readyUniform.value = 0;
    this.stableFrames = 0;
    this.runtimeState = 'idle';
    delete this.viewer.canvas.dataset.advancedRenderArchitecture;
    this.viewer.queuePipelineRebuild?.('hybrid-rt-v2-disabled');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.featurePass?.dispose();
    this.featurePass = null;
    if (this.controlsObject && this.originalControlsUpdate) this.controlsObject.update = this.originalControlsUpdate;
    this.controlsObject = null;
    this.originalControlsUpdate = null;
  }
}

export function installRealtimeHybridRtExtensionV2(ViewerClass: { prototype: any }): void {
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

  const state = (viewer: any): RealtimeHybridRtControllerV2 => {
    let value = states.get(viewer);
    if (!value) {
      value = new RealtimeHybridRtControllerV2(viewer, methods);
      states.set(viewer, value);
    }
    return value;
  };

  prototype.setRenderingMode = function setHybridAwareRenderingMode(mode: 'realtime' | 'cinematic' | 'pathTracing'): void {
    state(this).setMode(mode);
  };
  prototype.setAdvancedRenderSettings = function setHybridAwareAdvancedSettings(settings: Partial<SceneAdvancedRenderSettings>): void {
    state(this).setSettings(settings);
  };
  prototype.getAdvancedRenderSettings = function getHybridAwareAdvancedSettings(): SceneAdvancedRenderSettings {
    return state(this).getSettings();
  };
  prototype.getAdvancedRenderStatus = function getHybridAwareAdvancedStatus(): any {
    return state(this).getStatus();
  };
  prototype.resetAccumulation = function resetHybridAwareHistory(reason = 'manual'): void {
    const value = state(this);
    if (value.getSettings().renderingMode === 'cinematic') value.resetHistory(reason);
    else methods.resetAccumulation.call(this, reason);
  };

  if (typeof originalBuildPipeline === 'function') {
    prototype.buildPipeline = function buildPipelineWithHybridRT(...args: any[]): any {
      const result = originalBuildPipeline.apply(this, args);
      states.get(this)?.decoratePipeline();
      return result;
    };
  }

  const wrapDirty = (name: string) => {
    const original = prototype[name];
    if (typeof original !== 'function') return;
    prototype[name] = function hybridRtDirtyWrapper(...args: any[]): any {
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

  prototype.dispose = function disposeRealtimeHybridRT(...args: any[]): any {
    states.get(this)?.dispose();
    states.delete(this);
    return methods.dispose.apply(this, args);
  };

  prototype[installKey] = true;
}
