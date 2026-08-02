import { BrowserKyxosViewportAdapter, type KyxosViewportAdapter } from './index';

type AdapterInternals = {
  viewer: unknown | null;
  canvas: HTMLCanvasElement | null;
  operationQueue: Promise<void>;
};

type AdapterPrototype = {
  captureThumbnail: KyxosViewportAdapter['captureThumbnail'];
  [key: symbol]: unknown;
};

const installed = Symbol('kyxos.thumbnailCapture.installed');
const CAPTURE_TIMEOUT_MS = 10_000;
const QUEUE_GRACE_MS = 1_000;
const transparentPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function internals(adapter: BrowserKyxosViewportAdapter): AdapterInternals {
  return adapter as unknown as AdapterInternals;
}

function fallbackThumbnail(): Blob {
  const binary = atob(transparentPng);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/png' });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function usesSoftwareWebGl(canvas: HTMLCanvasElement): boolean {
  try {
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    const renderer = [
      debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '') : '',
      String(gl.getParameter(gl.RENDERER) ?? ''),
      String(gl.getParameter(gl.VENDOR) ?? ''),
    ].join(' ');
    return /swiftshader|llvmpipe|softpipe|lavapipe|software raster/i.test(renderer);
  } catch {
    return false;
  }
}

export function installNonBlockingThumbnailCapture(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype[installed]) return;

  prototype.captureThumbnail = async function captureCompositedThumbnail(
    this: BrowserKyxosViewportAdapter,
  ): Promise<Blob> {
    const internal = internals(this);
    const canvas = internal.canvas;
    if (!internal.viewer || !canvas) {
      throw new Error('Viewport adapter is not mounted.');
    }

    // Software WebGL readback can block the browser main thread for minutes.
    // A placeholder is preferable in that environment: model import, editing,
    // autosave and publishing remain usable instead of waiting on decoration.
    if (usesSoftwareWebGl(canvas)) {
      canvas.dataset.thumbnailCapture = 'fallback-software-renderer';
      return fallbackThumbnail();
    }

    // Scene operations are normally already complete when a thumbnail is
    // requested. Give a late edit a short grace period, but never let an
    // unrelated queue entry block import or publishing indefinitely.
    await Promise.race([
      internal.operationQueue.catch(() => undefined),
      delay(QUEUE_GRACE_MS),
    ]);

    // The Viewer animation loop has already produced the visible frame. Read the
    // composited canvas directly instead of calling viewer.capture(), which forces
    // a synchronous RenderPipeline render before its Promise exists.
    return new Promise<Blob>((resolve) => {
      let settled = false;
      const finish = (blob?: Blob | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(blob ?? fallbackThumbnail());
      };
      const timeoutId = window.setTimeout(
        () => finish(),
        CAPTURE_TIMEOUT_MS,
      );
      try {
        canvas.toBlob((blob) => finish(blob), 'image/png', 0.92);
      } catch {
        finish();
      }
    });
  };

  prototype[installed] = true;
}
