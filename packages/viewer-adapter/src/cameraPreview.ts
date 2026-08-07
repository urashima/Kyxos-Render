import type { SceneDocument } from '@kyxos/editor-core';
import type { AssetResolver, ScenePatch } from '@kyxos/scene-contract';
import { KyxosViewer } from '@kyxos/viewer';

import { BrowserKyxosViewportAdapter } from './index';

interface AdapterInternals {
  assetResolver: AssetResolver;
  document: SceneDocument | null;
  createOptions: {
    backend?: 'auto' | 'webgpu' | 'webgl2';
  };
}

interface PreviewState {
  canvas: HTMLCanvasElement;
  viewer: KyxosViewer;
  cameraId: string;
  generation: number;
  operationQueue: Promise<void>;
}

interface AdapterPrototype {
  loadDocument(document: SceneDocument): Promise<void>;
  applyPatch(patch: ScenePatch): Promise<void>;
  dispose(): void;
  __kyxosCameraPreviewInstalled?: boolean;
}

const previewStates = new WeakMap<BrowserKyxosViewportAdapter, PreviewState>();
const previewMountTokens = new WeakMap<BrowserKyxosViewportAdapter, number>();
let previewGeneration = 0;

function internals(adapter: BrowserKyxosViewportAdapter): AdapterInternals {
  return adapter as unknown as AdapterInternals;
}

function dispatchPreviewState(
  adapter: BrowserKyxosViewportAdapter,
  state: PreviewState | null,
  status: 'ready' | 'camera' | 'closed' | 'error',
  error?: unknown,
): void {
  adapter.dispatchEvent(new CustomEvent('camera-preview', {
    detail: {
      status,
      cameraId: state?.cameraId ?? null,
      error,
    },
  }));
}

function applyPreviewCamera(adapter: BrowserKyxosViewportAdapter, state: PreviewState): boolean {
  const scene = state.viewer.getLoadedSceneContract() ?? internals(adapter).document?.value;
  const camera = scene?.cameras.find((entry) => entry.id === state.cameraId);
  if (!camera) return false;
  state.viewer.setCameraState(camera);
  state.canvas.dataset.cameraPreviewId = camera.id;
  state.canvas.dataset.cameraPreviewProjection = camera.projection ?? 'perspective';
  return true;
}

function enqueuePreview(
  adapter: BrowserKyxosViewportAdapter,
  state: PreviewState,
  operation: () => Promise<void>,
): Promise<void> {
  const generation = state.generation;
  const run = async () => {
    if (previewStates.get(adapter) !== state || state.generation !== generation) return;
    await operation();
    if (previewStates.get(adapter) !== state || state.generation !== generation) return;
    if (!applyPreviewCamera(adapter, state)) {
      dispatchPreviewState(adapter, state, 'error', new Error('Preview camera is unavailable.'));
    }
  };
  const result = state.operationQueue.then(run, run);
  state.operationQueue = result.catch((error) => {
    if (previewStates.get(adapter) === state) dispatchPreviewState(adapter, state, 'error', error);
  });
  return result;
}

function invalidatePendingMount(adapter: BrowserKyxosViewportAdapter): number {
  const token = ++previewGeneration;
  previewMountTokens.set(adapter, token);
  return token;
}

function disposePreview(adapter: BrowserKyxosViewportAdapter): void {
  invalidatePendingMount(adapter);
  const state = previewStates.get(adapter);
  if (!state) return;
  previewStates.delete(adapter);
  state.generation += 1;
  state.viewer.dispose();
  delete state.canvas.dataset.cameraPreviewId;
  delete state.canvas.dataset.cameraPreviewProjection;
  dispatchPreviewState(adapter, null, 'closed');
}

export async function mountCameraPreview(
  this: BrowserKyxosViewportAdapter,
  canvas: HTMLCanvasElement,
  cameraId: string,
): Promise<void> {
  disposePreview(this);
  const internal = internals(this);
  const mountToken = invalidatePendingMount(this);
  canvas.dataset.sceneCameraPreview = 'true';
  canvas.dataset.cameraPreviewStatus = 'loading';
  let viewer: KyxosViewer | null = null;

  try {
    viewer = await KyxosViewer.create({
      canvas,
      backend: internal.createOptions.backend ?? 'auto',
      quality: 'low',
      pixelRatio: 1,
      autoStart: true,
    });
    if (previewMountTokens.get(this) !== mountToken) {
      viewer.dispose();
      return;
    }

    const state: PreviewState = {
      canvas,
      viewer,
      cameraId,
      generation: mountToken,
      operationQueue: Promise.resolve(),
    };
    previewStates.set(this, state);
    const document = internal.document;
    if (document) {
      await enqueuePreview(this, state, () => viewer!.loadScene(document.value, internal.assetResolver));
    }
    if (previewMountTokens.get(this) !== mountToken || previewStates.get(this) !== state) return;
    if (!applyPreviewCamera(this, state)) {
      throw new Error('Preview camera is unavailable.');
    }
    canvas.dataset.cameraPreviewStatus = 'ready';
    dispatchPreviewState(this, state, 'ready');
  } catch (error) {
    if (previewMountTokens.get(this) !== mountToken) {
      viewer?.dispose();
      return;
    }
    canvas.dataset.cameraPreviewStatus = 'error';
    dispatchPreviewState(this, previewStates.get(this) ?? null, 'error', error);
    disposePreview(this);
    throw error;
  }
}

export function setCameraPreviewCamera(
  this: BrowserKyxosViewportAdapter,
  cameraId: string,
): void {
  const state = previewStates.get(this);
  if (!state || state.cameraId === cameraId) return;
  state.cameraId = cameraId;
  if (applyPreviewCamera(this, state)) dispatchPreviewState(this, state, 'camera');
}

export function closeCameraPreview(this: BrowserKyxosViewportAdapter): void {
  disposePreview(this);
}

export function getCameraPreviewCamera(
  this: BrowserKyxosViewportAdapter,
): string | null {
  return previewStates.get(this)?.cameraId ?? null;
}

const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype & {
  mountCameraPreview?: typeof mountCameraPreview;
  setCameraPreviewCamera?: typeof setCameraPreviewCamera;
  closeCameraPreview?: typeof closeCameraPreview;
  getCameraPreviewCamera?: typeof getCameraPreviewCamera;
};

if (!prototype.__kyxosCameraPreviewInstalled) {
  const originalLoadDocument = prototype.loadDocument;
  const originalApplyPatch = prototype.applyPatch;
  const originalDispose = prototype.dispose;

  prototype.loadDocument = async function loadDocumentWithCameraPreview(
    this: BrowserKyxosViewportAdapter,
    document: SceneDocument,
  ): Promise<void> {
    await originalLoadDocument.call(this, document);
    const state = previewStates.get(this);
    if (!state) return;
    await enqueuePreview(this, state, () => state.viewer.loadScene(document.value, internals(this).assetResolver));
  };

  prototype.applyPatch = async function applyPatchWithCameraPreview(
    this: BrowserKyxosViewportAdapter,
    patch: ScenePatch,
  ): Promise<void> {
    await originalApplyPatch.call(this, patch);
    const state = previewStates.get(this);
    if (!state) return;
    await enqueuePreview(this, state, () => state.viewer.applyScenePatch(patch));
  };

  prototype.dispose = function disposeWithCameraPreview(
    this: BrowserKyxosViewportAdapter,
  ): void {
    disposePreview(this);
    originalDispose.call(this);
  };

  prototype.mountCameraPreview = mountCameraPreview;
  prototype.setCameraPreviewCamera = setCameraPreviewCamera;
  prototype.closeCameraPreview = closeCameraPreview;
  prototype.getCameraPreviewCamera = getCameraPreviewCamera;
  prototype.__kyxosCameraPreviewInstalled = true;
}

declare module './index' {
  interface KyxosViewportAdapter {
    mountCameraPreview(canvas: HTMLCanvasElement, cameraId: string): Promise<void>;
    setCameraPreviewCamera(cameraId: string): void;
    closeCameraPreview(): void;
    getCameraPreviewCamera(): string | null;
  }

  interface BrowserKyxosViewportAdapter {
    mountCameraPreview(canvas: HTMLCanvasElement, cameraId: string): Promise<void>;
    setCameraPreviewCamera(cameraId: string): void;
    closeCameraPreview(): void;
    getCameraPreviewCamera(): string | null;
  }
}