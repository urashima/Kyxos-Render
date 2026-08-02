import { KyxosViewer } from '@kyxos/viewer';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const diagnosticsInstalled = Symbol.for('kyxos.glbImportDiagnostics.installed');

type AdapterInternals = {
  canvas: HTMLCanvasElement | null;
};

type ViewerPrototype = KyxosViewer & Record<string, (...args: any[]) => any>;

function mark(
  stage: string,
  source?: BrowserKyxosViewportAdapter | KyxosViewer,
): void {
  document.documentElement.dataset.glbImportStage = stage;
  const canvas = source instanceof KyxosViewer
    ? source.canvas
    : source
      ? (source as unknown as AdapterInternals).canvas
      : document.querySelector<HTMLCanvasElement>('#studio-canvas');
  if (canvas) canvas.dataset.glbImportStage = stage;
  console.info(`[glb-import] ${stage}`);
}

function wrapViewerAsync(
  prototype: ViewerPrototype,
  method: string,
  stage: string,
): void {
  const original = prototype[method];
  if (typeof original !== 'function') return;
  prototype[method] = async function viewerAsyncDiagnostic(
    this: KyxosViewer,
    ...args: any[]
  ) {
    mark(`${stage}-start`, this);
    try {
      const result = await original.apply(this, args);
      mark(`${stage}-complete`, this);
      return result;
    } catch (error) {
      mark(`${stage}-error`, this);
      throw error;
    }
  };
}

function wrapViewerSync(
  prototype: ViewerPrototype,
  method: string,
  stage: string,
): void {
  const original = prototype[method];
  if (typeof original !== 'function') return;
  prototype[method] = function viewerSyncDiagnostic(
    this: KyxosViewer,
    ...args: any[]
  ) {
    mark(`${stage}-start`, this);
    try {
      const result = original.apply(this, args);
      mark(`${stage}-complete`, this);
      return result;
    } catch (error) {
      mark(`${stage}-error`, this);
      throw error;
    }
  };
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

  const viewerPrototype = KyxosViewer.prototype as ViewerPrototype;
  wrapViewerAsync(viewerPrototype, 'loadScene', 'scene-load');
  wrapViewerAsync(viewerPrototype, 'loadModel', 'model-load');
  wrapViewerAsync(viewerPrototype, 'restoreStudioEnvironment', 'environment-restore');
  wrapViewerAsync(viewerPrototype, 'setMaterial', 'material-bind');
  wrapViewerSync(viewerPrototype, 'setCameraState', 'camera-apply');
  wrapViewerSync(viewerPrototype, 'setEnvironment', 'environment-apply');
  wrapViewerSync(viewerPrototype, 'setRenderSettings', 'render-settings-apply');

  const prototype = BrowserKyxosViewportAdapter.prototype as BrowserKyxosViewportAdapter & {
    loadDocument: BrowserKyxosViewportAdapter['loadDocument'];
    captureThumbnail: BrowserKyxosViewportAdapter['captureThumbnail'];
  };
  const originalLoadDocument = prototype.loadDocument;
  const originalCaptureThumbnail = prototype.captureThumbnail;

  prototype.loadDocument = function loadDocumentWithDiagnostics(document) {
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
      mark('thumbnail-error', this);
      throw error;
    }
  };
}