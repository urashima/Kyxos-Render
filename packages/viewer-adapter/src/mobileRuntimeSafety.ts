import { SceneDocument } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  ScenePatch,
  SceneRenderSettings,
} from '@kyxos/scene-contract';
import { createCanonicalQualityPreset } from '@kyxos/scene-contract/render-settings';
import type { QualityPresetName } from '@kyxos/viewer';
import { BrowserKyxosViewportAdapter } from './index';

const installKey = Symbol.for('kyxos.viewer-adapter.mobile-runtime-safety');

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

interface AdapterInternals {
  createOptions?: {
    backend?: 'auto' | 'webgpu' | 'webgl2';
    quality?: QualityPresetName;
  };
  viewer?: {
    setRenderSettings(settings: SceneRenderSettings): void;
    renderer?: { setPixelRatio(value: number): void };
    metrics?: { pixelRatio: number };
    resizeToCanvas?: () => void;
    queuePipelineRebuild?: (reason: string) => void;
  } | null;
  document?: SceneDocument | null;
  canvas?: HTMLCanvasElement | null;
}

interface AdapterPrototype {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  loadDocument(document: SceneDocument): Promise<void>;
  applyPatch(patch: ScenePatch): Promise<void>;
  loadEnvironmentAsset(assetId?: string): Promise<void>;
  setQualityPreset(name: QualityPresetName | 'ultra'): void;
  mountCameraPreview?: (canvas: HTMLCanvasElement, cameraId: string) => Promise<void>;
}

function isiPadDesktopMode(): boolean {
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function isConstrainedMobileRuntime(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || isiPadDesktopMode();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
  const narrow = Math.min(
    window.screen.width || window.innerWidth,
    window.screen.height || window.innerHeight,
  ) <= 1024;
  const memory = (navigator as NavigatorWithMemory).deviceMemory;
  const lowMemory = typeof memory === 'number' && memory <= 4;
  return ios || lowMemory || (coarse && narrow && /Android|Mobile/i.test(ua));
}

function mobileSafeEffects(): SceneRenderSettings['effects'] {
  const effects = createCanonicalQualityPreset('low');
  // Even Low enables GTAO. Keep the editor's first mobile frame to one beauty
  // pass plus FXAA; authored scene quality is preserved in SceneDocument and
  // remains available to Public Viewer / Publish.
  effects.gtao = { ...effects.gtao, enabled: false };
  effects.ssao = { ...effects.ssao, enabled: false };
  effects.ssr = { ...effects.ssr, enabled: false };
  effects.ssgi = { ...effects.ssgi, enabled: false };
  effects.temporalReprojection = { ...effects.temporalReprojection, enabled: false };
  effects.poissonDenoise = { ...effects.poissonDenoise, enabled: false };
  effects.temporalDenoise = { ...effects.temporalDenoise, enabled: false };
  effects.motionBlur = { ...effects.motionBlur, enabled: false };
  effects.bloom = { ...effects.bloom, enabled: false };
  effects.dof = { ...effects.dof, enabled: false };
  effects.lut = { ...effects.lut, enabled: false };
  effects.lensDistortion = { ...effects.lensDistortion, enabled: false };
  effects.sharpness = { ...effects.sharpness, enabled: false };
  effects.sparkle = { ...effects.sparkle, enabled: false };
  return effects;
}

export function createMobileSafeRenderSettings(
  authored: SceneRenderSettings,
): SceneRenderSettings {
  return {
    ...structuredClone(authored),
    backend: 'webgl2',
    qualityPreset: 'low',
    effects: mobileSafeEffects(),
  };
}

function createMobileSafeScene(authored: KyxosSceneContract): KyxosSceneContract {
  const scene = structuredClone(authored);
  scene.renderSettings = createMobileSafeRenderSettings(authored.renderSettings);
  scene.lights = (scene.lights ?? []).map((light) => ({
    ...light,
    // Mobile Studio is an authoring viewport, not the published runtime. Shadow
    // maps are among the largest avoidable GPU allocations during GLB texture
    // upload, so keep authored shadow state in the authoritative document while
    // the transient mobile runtime renders lights without shadow targets.
    castShadow: false,
  }));
  // HDR/EXR authoring environments can be 4K/8K floating-point images. Loading
  // them immediately after a texture-heavy GLB creates another large transient
  // decode + PMREM allocation on iOS. Keep the authored assetId in the real
  // SceneDocument, while Mobile Studio previews against its lightweight built-in
  // environment. Desktop and Public Viewer still resolve the authored asset.
  if (scene.environment.assetId) delete scene.environment.assetId;
  return scene;
}

function markMobileProfile(canvas?: HTMLCanvasElement | null): void {
  document.documentElement.dataset.studioRuntimeProfile = 'mobile-safe';
  document.documentElement.dataset.studioRuntimeBackend = 'webgl2';
  document.documentElement.dataset.studioRuntimeQuality = 'low';
  document.documentElement.dataset.studioRuntimePixelRatio = '1';
  document.documentElement.dataset.studioRuntimeShadows = 'disabled';
  document.documentElement.dataset.studioRuntimeEnvironment = 'studio-default';
  if (canvas) {
    canvas.dataset.studioRuntimeProfile = 'mobile-safe';
    canvas.dataset.studioRuntimeBackend = 'webgl2';
    canvas.dataset.studioRuntimeQuality = 'low';
    canvas.dataset.studioRuntimeShadows = 'disabled';
    canvas.dataset.studioRuntimeEnvironment = 'studio-default';
  }
}

function applyPixelRatioCap(adapter: BrowserKyxosViewportAdapter): void {
  const internals = adapter as unknown as AdapterInternals;
  const viewer = internals.viewer as any;
  const renderer = viewer?.renderer;
  if (!viewer || !renderer?.setPixelRatio) return;
  renderer.setPixelRatio(1);
  if (viewer.metrics) viewer.metrics.pixelRatio = 1;
  viewer.resizeToCanvas?.();
  viewer.queuePipelineRebuild?.('mobile-safe-pixel-ratio');
}

function sanitizeMobilePatch(patch: ScenePatch): ScenePatch {
  return patch.flatMap((operation) => {
    if (operation.path.startsWith('/renderSettings')) return [];
    if (operation.path === '/environment/assetId') return [];
    if (/^\/lights\/\d+\/castShadow$/.test(operation.path)) {
      if (operation.op === 'remove' || operation.op === 'test') return [];
      return [{ ...operation, value: false }];
    }
    return [operation];
  }) as ScenePatch;
}

function installMobileAdapterSafety(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype
    & Record<symbol, boolean | undefined>;
  if (prototype[installKey]) return;

  const originalMount = prototype.mount;
  prototype.mount = async function mountWithMobileSafety(
    this: BrowserKyxosViewportAdapter,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    if (!isConstrainedMobileRuntime()) return originalMount.call(this, canvas);

    // Asset thumbnails create a second hidden Viewer. On iOS this can double
    // render-target + decoded-texture residency while the main GLB is loading.
    // Desktop still generates and caches the real 3D preview; mobile consumes
    // that cache but never creates the second GPU context itself.
    if (canvas.closest('.kx-thumbnail-render-host')) {
      canvas.dataset.mobileSecondaryViewerBlocked = 'true';
      throw new Error('Secondary asset thumbnail Viewer is deferred on constrained mobile devices.');
    }

    const internals = this as unknown as AdapterInternals;
    internals.createOptions = {
      ...(internals.createOptions ?? {}),
      backend: 'webgl2',
      quality: 'low',
    };
    markMobileProfile(canvas);
    await originalMount.call(this, canvas);
    applyPixelRatioCap(this);
  };

  const originalLoadDocument = prototype.loadDocument;
  prototype.loadDocument = async function loadDocumentWithMobileSafety(
    this: BrowserKyxosViewportAdapter,
    sceneDocument: SceneDocument,
  ): Promise<void> {
    if (!isConstrainedMobileRuntime()) {
      return originalLoadDocument.call(this, sceneDocument);
    }
    const authoredQuality = sceneDocument.value.renderSettings.qualityPreset;
    const runtimeDocument = new SceneDocument(createMobileSafeScene(sceneDocument.value));
    await originalLoadDocument.call(this, runtimeDocument);
    // Gizmo editing must continue to read the authoritative document, not the
    // transient runtime clone used only to reduce mobile GPU residency.
    const internals = this as unknown as AdapterInternals;
    internals.document = sceneDocument;
    if (internals.canvas) internals.canvas.dataset.authoredRenderQuality = authoredQuality;
    markMobileProfile(internals.canvas);
  };

  const originalApplyPatch = prototype.applyPatch;
  prototype.applyPatch = async function applyPatchWithMobileSafety(
    this: BrowserKyxosViewportAdapter,
    patch: ScenePatch,
  ): Promise<void> {
    if (!isConstrainedMobileRuntime()) return originalApplyPatch.call(this, patch);
    const runtimePatch = sanitizeMobilePatch(patch);
    if (runtimePatch.length) await originalApplyPatch.call(this, runtimePatch);
    if (
      runtimePatch.length !== patch.length ||
      patch.some((entry) => entry.path.startsWith('/renderSettings'))
    ) {
      const internals = this as unknown as AdapterInternals;
      const authored = internals.document?.value.renderSettings;
      if (authored && internals.viewer) {
        internals.viewer.setRenderSettings(createMobileSafeRenderSettings(authored));
      }
      if (internals.canvas && authored) {
        internals.canvas.dataset.authoredRenderQuality = authored.qualityPreset;
      }
      markMobileProfile(internals.canvas);
    }
  };

  const originalLoadEnvironmentAsset = prototype.loadEnvironmentAsset;
  prototype.loadEnvironmentAsset = function loadEnvironmentAssetWithMobileSafety(
    this: BrowserKyxosViewportAdapter,
    assetId?: string,
  ): Promise<void> {
    if (!isConstrainedMobileRuntime()) {
      return originalLoadEnvironmentAsset.call(this, assetId);
    }
    const internals = this as unknown as AdapterInternals;
    if (internals.canvas) {
      internals.canvas.dataset.authoredEnvironmentAsset = assetId ?? '';
    }
    markMobileProfile(internals.canvas);
    // Keep the runtime on the built-in PMREM even when the user selects an HDR.
    // The authoritative document already records the selected asset for desktop
    // editing and publication.
    return originalLoadEnvironmentAsset.call(this, undefined);
  };

  const originalSetQualityPreset = prototype.setQualityPreset;
  prototype.setQualityPreset = function setQualityPresetWithMobileSafety(
    this: BrowserKyxosViewportAdapter,
    name: QualityPresetName | 'ultra',
  ): void {
    if (!isConstrainedMobileRuntime()) {
      originalSetQualityPreset.call(this, name);
      return;
    }
    const internals = this as unknown as AdapterInternals;
    if (internals.canvas) internals.canvas.dataset.authoredRenderQuality = name;
    originalSetQualityPreset.call(this, 'low');
    markMobileProfile(internals.canvas);
  };

  const originalMountCameraPreview = prototype.mountCameraPreview;
  if (typeof originalMountCameraPreview === 'function') {
    prototype.mountCameraPreview = async function mountCameraPreviewWithMobileSafety(
      this: BrowserKyxosViewportAdapter,
      canvas: HTMLCanvasElement,
      cameraId: string,
    ): Promise<void> {
      if (isConstrainedMobileRuntime()) {
        canvas.dataset.mobileSecondaryViewerBlocked = 'true';
        throw new Error(
          'Live Camera Preview is deferred on iPhone/iPad to protect editor memory. Use View Through instead.',
        );
      }
      return originalMountCameraPreview.call(this, canvas, cameraId);
    };
  }

  prototype[installKey] = true;
}

export function installMobileRuntimeSafety(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (isConstrainedMobileRuntime()) markMobileProfile();
  // Keep import scheduling inside Studio's own queue. A global ImportTaskQueue
  // monkey patch can serialize nested persistence/recovery tasks behind the
  // very import that is awaiting them. Mobile safety owns GPU/runtime policy,
  // not editor transaction ordering.
  installMobileAdapterSafety();
}
