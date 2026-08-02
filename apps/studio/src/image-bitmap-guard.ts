const installed = Symbol.for('kyxos.imageBitmapGuard.installed');
const IMAGE_BITMAP_TIMEOUT_MS = 5_000;

type GuardGlobal = typeof globalThis & {
  [installed]?: boolean;
};

const guardGlobal = globalThis as GuardGlobal;
const originalCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);

if (!guardGlobal[installed] && originalCreateImageBitmap) {
  const guardedCreateImageBitmap = ((...args: unknown[]): Promise<ImageBitmap> => {
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
}
