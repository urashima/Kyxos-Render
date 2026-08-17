import type {
  AdvancedRenderingCapabilityDescription,
  AdvancedRenderingMode,
  SceneAdvancedRenderSettings,
  ScenePathTracingSettings,
  SceneRadianceCacheSettings,
  SceneRestirDISettings,
} from '@kyxos/scene-contract/advanced-render-settings';
import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
} from '@kyxos/scene-contract/advanced-render-settings';
import type { KyxosViewer } from './KyxosViewer';
import {
  queryBrowserAdvancedRendererCapabilities,
  resolveAdvancedRendererCapabilities,
  type AdvancedRendererCapabilities,
} from './render/advanced/backendCapabilities';
import { extractAdvancedScene, type ExtractedAdvancedScene } from './render/advanced/sceneExtraction';
import {
  DEFAULT_TEMPORAL_DEPENDENCIES,
  TemporalHistoryRegistry,
  type TemporalRevisionKey,
} from './render/advanced/temporalHistory';
import { WebGpuHybridRenderer, type AdvancedGpuMetrics } from './render/advanced/webgpuHybridRenderer';

export type AdvancedRenderRuntimeState =
  | 'idle'
  | 'initializing'
  | 'building'
  | 'rendering'
  | 'fallback'
  | 'error';

export interface AdvancedRenderStatus {
  requestedMode: AdvancedRenderingMode;
  effectiveMode: AdvancedRenderingMode;
  state: AdvancedRenderRuntimeState;
  message: string | null;
  samples: number;
  triangles: number;
  bvhNodes: number;
  lights: number;
  emissiveLights: number;
  dynamicMeshes: boolean;
  cpuFrameTimeMs: number;
  advancedGpuBytes: number;
  historyBytes: number;
  radianceCacheBytes: number;
}

declare module './KyxosViewer' {
  interface KyxosViewer {
    setRenderingMode(mode: AdvancedRenderingMode): void;
    setAdvancedRenderSettings(settings: Partial<SceneAdvancedRenderSettings> | SceneAdvancedRenderSettings): void;
    setRestirDI(settings: Partial<SceneRestirDISettings>): void;
    setRadianceCache(settings: Partial<SceneRadianceCacheSettings>): void;
    setPathTracing(settings: Partial<ScenePathTracingSettings>): void;
    getAdvancedRenderSettings(): SceneAdvancedRenderSettings;
    getAdvancedRenderStatus(): AdvancedRenderStatus;
    getAdvancedCapabilities(): AdvancedRenderingCapabilityDescription;
    resetAccumulation(reason?: string): void;
  }
}

const controllers = new WeakMap<KyxosViewer, AdvancedRenderingController>();
const installKey = Symbol.for('kyxos.viewer.advanced-rendering');

function cloneSettings(settings: SceneAdvancedRenderSettings): SceneAdvancedRenderSettings {
  return structuredClone(settings);
}

function mergeSettings(
  current: SceneAdvancedRenderSettings,
  update: Partial<SceneAdvancedRenderSettings>,
): SceneAdvancedRenderSettings {
  return normalizeAdvancedRenderSettings({
    ...current,
    ...update,
    restirDI: { ...current.restirDI, ...(update.restirDI ?? {}) },
    radianceCache: { ...current.radianceCache, ...(update.radianceCache ?? {}) },
    pathTracing: { ...current.pathTracing, ...(update.pathTracing ?? {}) },
  });
}

class AdvancedRenderingController {
  private readonly viewer: KyxosViewer;
  private readonly history = new TemporalHistoryRegistry();
  private renderer: WebGpuHybridRenderer | null = null;
  private settings = cloneSettings(DEFAULT_ADVANCED_RENDER_SETTINGS);
  private capabilities: AdvancedRendererCapabilities;
  private status: AdvancedRenderStatus;
  private scene: ExtractedAdvancedScene | null = null;
  private sceneDirty = true;
  private disposed = false;
  private frameHandle = 0;
  private initialization: Promise<void> | null = null;

  constructor(viewer: KyxosViewer) {
    this.viewer = viewer;
    for (const [name, dependencies] of Object.entries(DEFAULT_TEMPORAL_DEPENDENCIES)) {
      this.history.register(name, dependencies);
    }
    const runtime = viewer as any;
    const backend = runtime.backend === 'webgpu' ? 'webgpu' : 'webgl2';
    const limits = runtime.renderer?.backend?.device?.limits ?? runtime.renderer?.backend?.device?.adapter?.limits;
    this.capabilities = resolveAdvancedRendererCapabilities(backend, limits as Record<string, unknown> | undefined);
    this.status = {
      requestedMode: 'realtime',
      effectiveMode: 'realtime',
      state: 'idle',
      message: null,
      samples: 0,
      triangles: 0,
      bvhNodes: 0,
      lights: 0,
      emissiveLights: 0,
      dynamicMeshes: false,
      cpuFrameTimeMs: 0,
      advancedGpuBytes: 0,
      historyBytes: 0,
      radianceCacheBytes: 0,
    };
    if (backend === 'webgpu') {
      void queryBrowserAdvancedRendererCapabilities().then((capabilities) => {
        if (this.disposed || (this.viewer as any).backend !== 'webgpu') return;
        this.capabilities = capabilities;
        this.emitStatus();
      });
    }
  }

  getSettings(): SceneAdvancedRenderSettings {
    return cloneSettings(this.settings);
  }

  getStatus(): AdvancedRenderStatus {
    return { ...this.status };
  }

  getCapabilities(): AdvancedRenderingCapabilityDescription {
    const { limits: _limits, ...description } = this.capabilities;
    return { ...description };
  }

  setSettings(update: Partial<SceneAdvancedRenderSettings> | SceneAdvancedRenderSettings): void {
    const previous = this.settings;
    this.settings = mergeSettings(this.settings, update);
    if (previous.renderingMode !== this.settings.renderingMode) {
      this.status.requestedMode = this.settings.renderingMode;
    }
    this.renderer?.setSettings(this.settings);
    this.history.invalidate('restir');
    this.history.invalidate('pathTracing');
    this.history.invalidate('radianceCache');
    this.resetAccumulation('advanced-settings');
    void this.activate();
  }

  setMode(mode: AdvancedRenderingMode): void {
    this.setSettings({ renderingMode: mode });
  }

  markDirty(...keys: TemporalRevisionKey[]): void {
    if (keys.length) this.history.bump(...keys);
    this.sceneDirty ||= keys.some((key) => key === 'geometry' || key === 'transform' || key === 'material' || key === 'lighting' || key === 'environment');
    this.resetAccumulation(keys.join('+') || 'scene-change');
  }

  resetAccumulation(reason = 'manual'): void {
    this.renderer?.resetAccumulation();
    this.status.samples = 0;
    this.status.message = reason === 'manual' ? this.status.message : `History reset: ${reason}`;
    this.emitStatus();
  }

  private currentBackend(): 'webgpu' | 'webgl2' {
    return (this.viewer as any).backend === 'webgpu' ? 'webgpu' : 'webgl2';
  }

  private async ensureRenderer(): Promise<void> {
    if (this.renderer && this.capabilities.softwareRayQuery) return;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      this.setState('initializing', null);
      const renderer = new WebGpuHybridRenderer(this.viewer.canvas, {
        onDeviceLost: (message) => {
          this.capabilities = resolveAdvancedRendererCapabilities('webgl2');
          this.setState('fallback', message, 'realtime');
          this.warn(message);
        },
        onError: (error) => this.warn(`Advanced renderer error: ${error instanceof Error ? error.message : String(error)}`),
      });
      try {
        const capabilities = await renderer.initialize();
        if (this.disposed) {
          renderer.dispose();
          return;
        }
        this.capabilities = capabilities;
        renderer.setSettings(this.settings);
        this.renderer = renderer;
        this.sceneDirty = true;
      } catch (error) {
        renderer.dispose();
        this.renderer = null;
        const message = error instanceof Error ? error.message : String(error);
        this.setState('fallback', message, 'realtime');
        this.warn(`Advanced rendering unavailable: ${message}`);
        throw error;
      }
    })().finally(() => { this.initialization = null; });
    return this.initialization;
  }

  private rebuildScene(): void {
    if (!this.renderer) return;
    this.setState('building', 'Building software BVH and unified light tables.');
    const started = performance.now();
    this.scene = extractAdvancedScene(this.viewer);
    this.renderer.setScene(this.scene);
    this.sceneDirty = false;
    this.status.triangles = this.scene.triangleCount;
    this.status.bvhNodes = this.scene.bvh.nodes.length;
    this.status.lights = this.scene.lightCount;
    this.status.emissiveLights = this.scene.emissiveLightCount;
    this.status.dynamicMeshes = this.scene.dynamicMeshes;
    this.status.message = `BVH ready in ${(performance.now() - started).toFixed(1)} ms.`;
    this.history.commit('restir');
    this.history.commit('radianceCache');
    this.history.commit('pathTracing');
  }

  async activate(): Promise<void> {
    if (this.disposed) return;
    this.status.requestedMode = this.settings.renderingMode;
    if (this.settings.renderingMode === 'realtime') {
      this.renderer?.hide();
      this.stopLoop();
      this.setState('idle', null, 'realtime');
      return;
    }
    if (this.currentBackend() !== 'webgpu') {
      const message = 'Cinematic and Path Traced Preview require WebGPU; realtime WebGL2 fallback is active.';
      this.renderer?.hide();
      this.stopLoop();
      this.setState('fallback', message, 'realtime');
      this.warn(message);
      return;
    }
    try {
      await this.ensureRenderer();
    } catch {
      return;
    }
    if (!this.renderer) return;
    if (this.sceneDirty || !this.scene) this.rebuildScene();
    this.renderer.setSettings(this.settings);
    this.setState('rendering', this.status.message, this.settings.renderingMode);
    this.startLoop();
  }

  private startLoop(): void {
    if (this.frameHandle || this.disposed) return;
    const tick = () => {
      this.frameHandle = 0;
      if (this.disposed || this.settings.renderingMode === 'realtime') return;
      const runtime = this.viewer as any;
      if (this.sceneDirty && this.renderer) this.rebuildScene();
      if (this.scene?.dynamicMeshes && runtime.animationEnabled) {
        this.renderer?.hide();
        this.setState(
          'fallback',
          'Animated skin/morph deformation stays on the realtime raster path while playback is active; stop playback to rebuild the current pose for accumulation.',
          'realtime',
        );
      } else if (this.renderer) {
        try {
          const metrics = this.renderer.render(runtime.camera, this.settings.renderingMode as 'cinematic' | 'pathTracing');
          if (metrics) this.consumeMetrics(metrics);
          if (this.status.effectiveMode !== this.settings.renderingMode || this.status.state !== 'rendering') {
            this.setState('rendering', null, this.settings.renderingMode);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.renderer.hide();
          this.setState('error', message, 'realtime');
          this.warn(`Advanced frame failed; realtime fallback is active: ${message}`);
        }
      }
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (!this.frameHandle) return;
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private consumeMetrics(metrics: AdvancedGpuMetrics): void {
    this.status.samples = metrics.samples;
    this.status.cpuFrameTimeMs = metrics.cpuFrameTimeMs;
    this.status.advancedGpuBytes = metrics.totalBytes;
    this.status.historyBytes = metrics.historyBytes;
    this.status.radianceCacheBytes = metrics.cacheBytes;
    if (metrics.samples === 1 || metrics.samples % 16 === 0) this.emitStatus();
  }

  private setState(
    state: AdvancedRenderRuntimeState,
    message: string | null,
    effectiveMode: AdvancedRenderingMode = this.status.effectiveMode,
  ): void {
    this.status.state = state;
    this.status.message = message;
    this.status.effectiveMode = effectiveMode;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.viewer.canvas.dataset.advancedRenderMode = this.status.effectiveMode;
    this.viewer.canvas.dataset.advancedRenderState = this.status.state;
    this.viewer.canvas.dispatchEvent(new CustomEvent('kyxos-advanced-render-status', { detail: this.getStatus() }));
  }

  private warn(message: string): void {
    this.viewer.canvas.dispatchEvent(new CustomEvent('kyxos-advanced-render-warning', { detail: { message } }));
    this.viewer.dispatchEvent(new CustomEvent('warning', { detail: { effect: 'advanced-rendering', message } }));
  }

  async capture(options: { mimeType?: string; quality?: number } = {}): Promise<Blob | null> {
    if (!this.renderer || this.status.effectiveMode === 'realtime' || this.status.state !== 'rendering') return null;
    return this.renderer.capture(options.mimeType ?? 'image/png', options.quality ?? 0.92);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
  }
}

function controller(viewer: KyxosViewer): AdvancedRenderingController {
  let value = controllers.get(viewer);
  if (!value) {
    value = new AdvancedRenderingController(viewer);
    controllers.set(viewer, value);
  }
  return value;
}

export function installAdvancedRenderingApi(ViewerClass: { prototype: KyxosViewer }): void {
  const prototype = ViewerClass.prototype as KyxosViewer & Record<symbol, boolean | undefined> & Record<string, any>;
  if (prototype[installKey]) return;

  prototype.setRenderingMode = function setRenderingMode(mode: AdvancedRenderingMode): void {
    controller(this).setMode(mode);
  };
  prototype.setAdvancedRenderSettings = function setAdvancedRenderSettings(settings: Partial<SceneAdvancedRenderSettings>): void {
    controller(this).setSettings(settings);
  };
  prototype.setRestirDI = function setRestirDI(settings: Partial<SceneRestirDISettings>): void {
    const runtime = controller(this);
    runtime.setSettings({ restirDI: { ...runtime.getSettings().restirDI, ...settings } } as Partial<SceneAdvancedRenderSettings>);
  };
  prototype.setRadianceCache = function setRadianceCache(settings: Partial<SceneRadianceCacheSettings>): void {
    const runtime = controller(this);
    runtime.setSettings({ radianceCache: { ...runtime.getSettings().radianceCache, ...settings } } as Partial<SceneAdvancedRenderSettings>);
  };
  prototype.setPathTracing = function setPathTracing(settings: Partial<ScenePathTracingSettings>): void {
    const runtime = controller(this);
    runtime.setSettings({ pathTracing: { ...runtime.getSettings().pathTracing, ...settings } } as Partial<SceneAdvancedRenderSettings>);
  };
  prototype.getAdvancedRenderSettings = function getAdvancedRenderSettings(): SceneAdvancedRenderSettings {
    return controller(this).getSettings();
  };
  prototype.getAdvancedRenderStatus = function getAdvancedRenderStatus(): AdvancedRenderStatus {
    return controller(this).getStatus();
  };
  prototype.getAdvancedCapabilities = function getAdvancedCapabilities(): AdvancedRenderingCapabilityDescription {
    return controller(this).getCapabilities();
  };
  prototype.resetAccumulation = function resetAccumulation(reason = 'manual'): void {
    controller(this).resetAccumulation(reason);
  };

  const originalGetCapabilities = prototype.getCapabilities;
  if (typeof originalGetCapabilities === 'function') {
    prototype.getCapabilities = function getCapabilitiesWithAdvancedRendering(...args: unknown[]): unknown {
      const capabilities = originalGetCapabilities.apply(this, args);
      return { ...(capabilities as Record<string, unknown>), advancedRendering: controller(this).getCapabilities() };
    };
  }

  const originalCapture = prototype.capture;
  if (typeof originalCapture === 'function') {
    prototype.capture = async function captureAdvancedAware(options: Record<string, unknown> = {}): Promise<Blob> {
      const advanced = await controller(this).capture({
        mimeType: typeof options.mimeType === 'string' ? options.mimeType : undefined,
        quality: typeof options.quality === 'number' ? options.quality : undefined,
      });
      return advanced ?? originalCapture.call(this, options);
    };
  }

  const wrapDirty = (name: string, revisions: TemporalRevisionKey[]) => {
    const original = prototype[name];
    if (typeof original !== 'function') return;
    prototype[name] = function advancedDirtyWrapper(...args: unknown[]) {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.then((value: unknown) => {
          controller(this).markDirty(...revisions);
          return value;
        });
      }
      controller(this).markDirty(...revisions);
      return result;
    };
  };

  wrapDirty('loadModel', ['geometry', 'material', 'transform']);
  wrapDirty('loadEnvironment', ['environment', 'lighting']);
  wrapDirty('setMaterialTextures', ['material']);
  wrapDirty('setNodeTransform', ['transform']);
  wrapDirty('setMaterial', ['material']);
  wrapDirty('setSceneLights', ['lighting']);
  wrapDirty('setEnvironment', ['environment', 'lighting']);

  const originalAnimation = prototype.setAnimationEnabled;
  if (typeof originalAnimation === 'function') {
    prototype.setAnimationEnabled = function setAnimationEnabledAdvancedAware(enabled: boolean): unknown {
      const result = originalAnimation.call(this, enabled);
      if (!enabled) controller(this).markDirty('geometry', 'animation');
      else controller(this).markDirty('animation');
      return result;
    };
  }

  const originalDispose = prototype.dispose;
  prototype.dispose = function disposeAdvancedRendering(...args: unknown[]): unknown {
    controller(this).dispose();
    controllers.delete(this);
    return originalDispose?.apply(this, args);
  };

  prototype[installKey] = true;
}
