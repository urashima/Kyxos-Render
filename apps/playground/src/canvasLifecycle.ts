import { KyxosViewer, type KyxosViewerCreateOptions } from '@kyxos/viewer';

const patchKey = Symbol.for('kyxos.playground.fresh-canvas-viewer-create');
type ViewerCreate = (options: KyxosViewerCreateOptions) => Promise<KyxosViewer>;

const viewerConstructor = KyxosViewer as typeof KyxosViewer & { create: ViewerCreate };
const patchState = viewerConstructor as unknown as Record<PropertyKey, unknown>;

if (!patchState[patchKey]) {
  const originalCreate = viewerConstructor.create.bind(viewerConstructor);

  viewerConstructor.create = async (options: KyxosViewerCreateOptions) => {
    // A browser canvas is permanently bound to the first context family created
    // on it. Disposing a WebGPU renderer does not make that same element eligible
    // for a later WebGL 2 context (and vice versa). The playground recreates the
    // viewer when switching backends, so give each recreation a fresh canvas.
    // Offscreen stress-test canvases are intentionally left untouched.
    if (options.canvas.id !== 'viewport') return originalCreate(options);

    const liveCanvas = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!liveCanvas) return originalCreate(options);

    const replacement = liveCanvas.cloneNode(false) as HTMLCanvasElement;
    liveCanvas.replaceWith(replacement);

    return originalCreate({ ...options, canvas: replacement });
  };

  patchState[patchKey] = true;
}
