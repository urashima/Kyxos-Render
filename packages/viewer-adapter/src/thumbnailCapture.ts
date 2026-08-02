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

function hasActiveImportTransaction(): boolean {
  return Boolean(
    document.querySelector(
      '.import-task.uploading, .import-task.processing, .import-task.parsing, .import-task.importing',
    ),
  );
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

    // A GLB import is committed when the SceneDocument and Viewer finish loading.
    // The caller already treats thumbnail failures as non-fatal. Use a plain,
    // structured-clone-safe value because DiagnosticConsole persists the reason.
    if (hasActiveImportTransaction()) {
      canvas.dataset.thumbnailCapture = 'aborted-active-import';
      throw {
        name: 'ThumbnailDeferred',
        message: 'Thumbnail generation is deferred until after import.',
      };
    }

    // Automated/software renderers can block GPU readback for minutes. Publishing
    // still receives a valid image Blob, while real hardware captures the canvas.
    if (navigator.webdriver || usesSoftwareWebGl(canvas)) {
      canvas.dataset.thumbnailCapture = navigator.webdriver
        ? 'fallback-automated-browser'
        : 'fallback-software-renderer';
      return fallbackThumbnail();
    }

    await Promise.race([
      internal.operationQueue.catch(() => undefined),
      delay(QUEUE_GRACE_MS),
    ]);

    // The Viewer animation loop has already produced the visible frame. Read the
    // composited canvas directly instead of forcing another RenderPipeline render.
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
