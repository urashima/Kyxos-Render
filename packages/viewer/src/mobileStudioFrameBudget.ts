import { KyxosViewer } from './KyxosViewer';

const installKey = Symbol.for('kyxos.viewer.mobile-studio-frame-budget');
const lastRenderTime = new WeakMap<KyxosViewer, number>();

interface ViewerPrototype {
  loadModel(url: string, options?: { ktx2?: boolean }): Promise<void>;
  renderFrame(time: number): void;
  [installKey]?: boolean;
}

function mobileSafeCanvas(viewer: KyxosViewer): HTMLCanvasElement | null {
  const canvas = (viewer as unknown as { canvas?: HTMLCanvasElement }).canvas;
  return canvas?.dataset.studioRuntimeProfile === 'mobile-safe' ? canvas : null;
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype[installKey]) {
  const originalLoadModel = prototype.loadModel;
  prototype.loadModel = async function loadModelWithMobileFrameBudget(
    this: KyxosViewer,
    url: string,
    options: { ktx2?: boolean } = {},
  ): Promise<void> {
    const canvas = mobileSafeCanvas(this);
    if (!canvas || url.startsWith('procedural:')) {
      await originalLoadModel.call(this, url, options);
      return;
    }

    canvas.dataset.studioRuntimeModelLoading = 'true';
    canvas.dataset.studioRuntimeFrameBudget = '10';
    document.documentElement.dataset.studioRuntimeModelLoading = 'true';
    document.documentElement.dataset.studioRuntimeFrameBudget = '10';
    try {
      await originalLoadModel.call(this, url, options);
    } finally {
      canvas.dataset.studioRuntimeModelLoading = 'false';
      canvas.dataset.studioRuntimeFrameBudget = '30';
      document.documentElement.dataset.studioRuntimeModelLoading = 'false';
      document.documentElement.dataset.studioRuntimeFrameBudget = '30';
    }
  };

  const originalRenderFrame = prototype.renderFrame;
  prototype.renderFrame = function renderFrameWithMobileBudget(
    this: KyxosViewer,
    time: number,
  ): void {
    const canvas = mobileSafeCanvas(this);
    if (!canvas) {
      originalRenderFrame.call(this, time);
      return;
    }

    const loading = canvas.dataset.studioRuntimeModelLoading === 'true';
    const targetFps = loading ? 10 : 30;
    const minimumFrameInterval = 1000 / targetFps;
    const previous = lastRenderTime.get(this) ?? -Infinity;
    if (time - previous < minimumFrameInterval) return;
    lastRenderTime.set(this, time);
    canvas.dataset.studioRuntimeFrameBudget = String(targetFps);
    document.documentElement.dataset.studioRuntimeFrameBudget = String(targetFps);
    originalRenderFrame.call(this, time);
  };

  prototype[installKey] = true;
}
