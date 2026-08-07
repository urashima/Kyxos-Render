import { ImportTaskQueue, SceneDocument } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  ScenePatch,
  SceneRenderSettings,
} from '@kyxos/scene-contract';
import { createCanonicalQualityPreset } from '@kyxos/scene-contract/render-settings';
import type { QualityPresetName } from '@kyxos/viewer';
import { BrowserKyxosViewportAdapter } from './index';

const installKey = Symbol.for('kyxos.viewer-adapter.mobile-runtime-safety');
const importInstallKey = Symbol.for('kyxos.viewer-adapter.mobile-import-serialization');

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
    getMetrics(): { pixelRatio: number };
    renderer?: { setPixelRatio(value: number): void };
    metrics?: { pixelRatio: number };
    resizeToCanvas?: () => void;
    queuePipelineRebuild?: (reason: string) => void;
  } | null;
  document?: SceneDocument | null;
}

type AdapterPrototype = BrowserKyxosViewportAdapter & Record<symbol, boolean | undefined> & {
  mountCameraPreview?: (canvas: HTMLCanvasElement, cameraId: string) => Promise<void>;
};

type ImportQueuePrototype = ImportTaskQueue<unknown> & Record<symbol, boolean | undefined>;

function isiPadDesktopMode(): boolean {
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function isConstrainedMobileRuntime(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || isiPadDesktopMode();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
  const narrow = Math.min(window.screen.width || window.innerWidth, window.screen.height || window.innerHeight) <= 1024;
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
  return scene;
}

function markMobileProfile(canvas?: HTMLCanvasElement | null): void {
  document.documentElement.dataset.studioRuntimeProfile = 'mobile-safe';
  document.documentElement.dataset.studioRuntimeBackend = 'webgl2';
  document.documentElement.dataset.studioRuntimeQuality = 'low';
  document.documentElement.dataset.studioRuntimePixelRatio = '1';
  if (canvas) {
    canvas.dataset.studioRuntimeProfile = 'mobile-safe';
    canvas.dataset.studioRuntimeBackend = 'webgl2';
    canvas.dataset.studioRuntimeQuality = 'low';
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

function installMobileAdapterSafety(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as AdapterPrototype;
  if (prototype[installKey]) return;

  const originalMount = prototype.mount;
  prototype.mount = async function mountWithMobileSafety(canvas: HTMLCanvasElement): Promise<void> {
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
    document: SceneDocument,
  ): Promise<void> {
    if (!isConstrainedMobileRuntime()) return originalLoadDocument.call(this, document);
    const authoredQuality = document.value.renderSettings.qualityPreset;
    document.documentElement?.dataset;
    const runtimeDocument = new SceneDocument(createMobileSafeScene(document.value));
    await originalLoadDocument.call(this, runtimeDocument);
    // Gizmo editing must continue to read the authoritative document, not the
    // transient runtime clone used only to reduce mobile GPU residency.
    (this as unknown as AdapterInternals).document = document;
    const canvas = (this as unknown as { canvas?: HTMLCanvasElement | null }).canvas;
    if (canvas) canvas.dataset.authoredRenderQuality = authoredQuality;
    markMobileProfile(canvas);
  };

  const originalApplyPatch = prototype.applyPatch;
  prototype.applyPatch = async function applyPatchWithMobileSafety(
    patch: ScenePatch,
  ): Promise<void> {
    if (!isConstrainedMobileRuntime()) return originalApplyPatch.call(this, patch);
    const runtimePatch = patch.filter((operation) => !operation.path.startsWith('/renderSettings'));
    if (runtimePatch.length) await originalApplyPatch.call(this, runtimePatch);
    if (runtimePatch.length !== patch.length) {
      const internals = this as unknown as AdapterInternals;
      const authored = internals.document?.value.renderSettings;
      if (authored && internals.viewer) {
        internals.viewer.setRenderSettings(createMobileSafeRenderSettings(authored));
      }
      const canvas = (this as unknown as { canvas?: HTMLCanvasElement | null }).canvas;
      if (canvas && authored) canvas.dataset.authoredRenderQuality = authored.qualityPreset;
      markMobileProfile(canvas);
    }
  };

  const originalSetQualityPreset = prototype.setQualityPreset;
  prototype.setQualityPreset = function setQualityPresetWithMobileSafety(
    name: QualityPresetName | 'ultra',
  ): void {
    if (!isConstrainedMobileRuntime()) {
      originalSetQualityPreset.call(this, name);
      return;
    }
    const canvas = (this as unknown as { canvas?: HTMLCanvasElement | null }).canvas;
    if (canvas) canvas.dataset.authoredRenderQuality = name;
    originalSetQualityPreset.call(this, 'low');
    markMobileProfile(canvas);
  };

  const originalMountCameraPreview = prototype.mountCameraPreview;
  if (typeof originalMountCameraPreview === 'function') {
    prototype.mountCameraPreview = async function mountCameraPreviewWithMobileSafety(
      canvas: HTMLCanvasElement,
      cameraId: string,
    ): Promise<void> {
      if (isConstrainedMobileRuntime()) {
        canvas.dataset.mobileSecondaryViewerBlocked = 'true';
        throw new Error('Live Camera Preview is deferred on iPhone/iPad to protect editor memory. Use View Through instead.');
      }
      return originalMountCameraPreview.call(this, canvas, cameraId);
    };
  }

  prototype[installKey] = true;
}

function installMobileImportSerialization(): void {
  const prototype = ImportTaskQueue.prototype as unknown as ImportQueuePrototype;
  if (prototype[importInstallKey]) return;
  const originalEnqueue = prototype.enqueue;
  let tail: Promise<void> = Promise.resolve();

  prototype.enqueue = function enqueueWithMobileSerialization(name: string, worker: any): string {
    if (!isConstrainedMobileRuntime()) return originalEnqueue.call(this, name, worker);
    return originalEnqueue.call(this, name, async (context: any) => {
      const previous = tail.catch(() => undefined);
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      document.documentElement.dataset.mobileImportConcurrency = '1';
      try {
        return await worker(context);
      } finally {
        release();
      }
    });
  } as ImportQueuePrototype['enqueue'];

  prototype[importInstallKey] = true;
}

export function installMobileRuntimeSafety(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (isConstrainedMobileRuntime()) markMobileProfile();
  installMobileAdapterSafety();
  installMobileImportSerialization();
}
