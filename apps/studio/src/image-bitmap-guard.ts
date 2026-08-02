const installed = Symbol.for('kyxos.imageBitmapGuard.installed');
const IMAGE_BITMAP_TIMEOUT_MS = 5_000;
const skippedThumbnailType = 'application/x-kyxos-thumbnail-skip';

type GuardGlobal = typeof globalThis & {
  [installed]?: boolean;
};

function hasActiveImportTransaction(): boolean {
  return Boolean(
    document.querySelector(
      '.import-task:not(.complete):not(.failed):not(.cancelled)',
    ),
  );
}

function isSkippedThumbnailSource(source: unknown): boolean {
  return source instanceof Blob && source.type === skippedThumbnailType;
}

const guardGlobal = globalThis as GuardGlobal;
const originalCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);

if (!guardGlobal[installed] && originalCreateImageBitmap) {
  const guardedCreateImageBitmap = ((...args: unknown[]): Promise<ImageBitmap> => {
    // The viewport adapter uses a dedicated MIME type when thumbnail generation
    // is intentionally skipped. Reject that sentinel before calling the browser
    // decoder; unlike DOM status classes, the Blob travels with the exact request.
    if (isSkippedThumbnailSource(args[0])) {
      document.documentElement.dataset.imageBitmapGuard = 'skipped-thumbnail-blob';
      return Promise.reject(
        new DOMException('Thumbnail decoding was intentionally skipped.', 'AbortError'),
      );
    }

    // Asset thumbnails are optional decoration. Never invoke the browser image
    // decoder while an import transaction is active: software Chromium can block
    // synchronously inside createImageBitmap before a timeout can even be armed.
    if (hasActiveImportTransaction()) {
      document.documentElement.dataset.imageBitmapGuard = 'skipped-active-import';
      return Promise.reject(
        new DOMException('Thumbnail decoding skipped during asset import.', 'AbortError'),
      );
    }

    let operation: Promise<ImageBitmap>;
    try {
      operation = Reflect.apply(originalCreateImageBitmap, globalThis, args) as Promise<ImageBitmap>;
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<ImageBitmap>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new DOMException('Image bitmap decoding timed out.', 'TimeoutError'));
      }, IMAGE_BITMAP_TIMEOUT_MS);

      operation.then(
        (bitmap) => {
          if (settled) {
            bitmap.close();
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(bitmap);
        },
        (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  }) as typeof globalThis.createImageBitmap;

  globalThis.createImageBitmap = guardedCreateImageBitmap;
  guardGlobal[installed] = true;
  document.documentElement.dataset.imageBitmapGuard = 'installed';
}
