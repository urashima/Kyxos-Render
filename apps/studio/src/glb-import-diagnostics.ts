import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const diagnosticsInstalled = Symbol.for('kyxos.glbImportDiagnostics.installed');
const viewerDiagnosticsInstalled = Symbol.for('kyxos.glbImportDiagnostics.viewerInstalled');
const FALLBACK_THUMBNAIL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xc9WAAAAAElFTkSuQmCC';

type ViewerLike = {
  canvas: HTMLCanvasElement;
  [viewerDiagnosticsInstalled]?: boolean;
  [key: string]: unknown;
};

type AdapterInternals = {
  canvas: HTMLCanvasElement | null;
  viewer: ViewerLike | null;
};

function sourceCanvas(
  source?: BrowserKyxosViewportAdapter | ViewerLike,
): HTMLCanvasElement | null {
  if (!source) return document.querySelector<HTMLCanvasElement>('#studio-canvas');
  const direct = (source as Partial<ViewerLike>).canvas;
  if (direct instanceof HTMLCanvasElement) return direct;
  return (source as unknown as AdapterInternals).canvas;
}

function mark(
  stage: string,
  source?: BrowserKyxosViewportAdapter | ViewerLike,
): void {
  document.documentElement.dataset.glbImportStage = stage;
  const canvas = sourceCanvas(source);
  if (canvas) canvas.dataset.glbImportStage = stage;
  console.info(`[glb-import] ${stage}`);
}

function fallbackThumbnail(): Blob {
  const binary = atob(FALLBACK_THUMBNAIL_BASE64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

function wrapViewerAsync(viewer: ViewerLike, method: string, stage: string): void {
  const original = viewer[method];
  if (typeof original !== 'function') return;
  viewer[method] = async (...args: unknown[]) => {
    mark(`${stage}-start`, viewer);
    try {
      const result = await original.apply(viewer, args);
      mark(`${stage}-complete`, viewer);
      return result;
    } catch (error) {
      mark(`${stage}-error`, viewer);
      throw error;
    }
  };
}

function wrapViewerSync(viewer: ViewerLike, method: string, stage: string): void {
  const original = viewer[method];
  if (typeof original !== 'function') return;
  viewer[method] = (...args: unknown[]) => {
    mark(`${stage}-start`, viewer);
    try {
      const result = original.apply(viewer, args);
      mark(`${stage}-complete`, viewer);
      return result;
    } catch (error) {
      mark(`${stage}-error`, viewer);
      throw error;
    }
  };
}

function instrumentViewer(adapter: BrowserKyxosViewportAdapter): void {
  const viewer = (adapter as unknown as AdapterInternals).viewer;
  if (!viewer || viewer[viewerDiagnosticsInstalled]) return;
  viewer[viewerDiagnosticsInstalled] = true;
  wrapViewerAsync(viewer, 'loadScene', 'scene-load');
  wrapViewerAsync(viewer, 'loadModel', 'model-load');
  wrapViewerAsync(viewer, 'restoreStudioEnvironment', 'environment-restore');
  wrapViewerAsync(viewer, 'setMaterial', 'material-bind');
  wrapViewerSync(viewer, 'setCameraState', 'camera-apply');
  wrapViewerSync(viewer, 'setEnvironment', 'environment-apply');
  wrapViewerSync(viewer, 'setRenderSettings', 'render-settings-apply');
}

const globalState = window as typeof window & { [diagnosticsInstalled]?: boolean };
if (!globalState[diagnosticsInstalled]) {
  globalState[diagnosticsInstalled] = true;

  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args) as Worker;
      mark('worker-created');
      const nativePostMessage = worker.postMessage.bind(worker) as (...args: unknown[]) => void;
      worker.postMessage = ((...postArgs: unknown[]) => {
        mark('worker-posted');
        nativePostMessage(...postArgs);
      }) as typeof worker.postMessage;
      worker.addEventListener('message', (event) => {
        const data = (event as MessageEvent<{ ok?: boolean }>).data;
        mark(data?.ok === true ? 'worker-result-ok' : data?.ok === false ? 'worker-result-error' : 'worker-message');
      });
      worker.addEventListener('messageerror', () => mark('worker-message-error'));
      worker.addEventListener('error', () => mark('worker-runtime-error'));
      return worker;
    },
  }) as typeof Worker;

  const prototype = BrowserKyxosViewportAdapter.prototype as BrowserKyxosViewportAdapter & {
    loadDocument: BrowserKyxosViewportAdapter['loadDocument'];
    captureThumbnail: BrowserKyxosViewportAdapter['captureThumbnail'];
  };
  const originalLoadDocument = prototype.loadDocument;
  const originalCaptureThumbnail = prototype.captureThumbnail;

  prototype.loadDocument = function loadDocumentWithDiagnostics(document) {
    instrumentViewer(this);
    mark('viewer-load-start', this);
    return originalLoadDocument.call(this, document).then(
      () => mark('viewer-load-complete', this),
      (error) => {
        mark('viewer-load-error', this);
        throw error;
      },
    );
  };

  prototype.captureThumbnail = async function captureThumbnailWithDiagnostics() {
    mark('thumbnail-start', this);
    try {
      const result = await originalCaptureThumbnail.call(this);
      mark('thumbnail-complete', this);
      return result;
    } catch (error) {
      // Thumbnail readback is a best-effort post-import task. Headless WebGL,
      // lost contexts and protected canvases may reject readback even though the
      // imported scene is already valid. Match PlayCanvas job semantics by
      // completing the asset and reporting a warning instead of rejecting the
      // core import promise.
      console.warn('[glb-import] thumbnail readback unavailable; using fallback', error);
      mark('thumbnail-fallback', this);
      document.documentElement.dataset.importThumbnailFallback = 'true';
      return fallbackThumbnail();
    }
  };
}
