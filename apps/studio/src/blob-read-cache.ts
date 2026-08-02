const originalArrayBuffer = Blob.prototype.arrayBuffer;
const cachedReads = new WeakMap<Blob, Promise<ArrayBuffer>>();
const READ_TIMEOUT_MS = 30_000;

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof FileReader === 'undefined') {
    return originalArrayBuffer.call(blob);
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const timeout = window.setTimeout(() => {
      reader.abort();
      reject(new Error(`Reading ${blob instanceof File ? blob.name : 'blob'} timed out.`));
    }, READ_TIMEOUT_MS);
    const finish = (callback: () => void) => {
      window.clearTimeout(timeout);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      callback();
    };
    reader.onload = () => finish(() => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Blob reader returned an unexpected result.'));
        return;
      }
      resolve(reader.result);
    });
    reader.onerror = () => finish(() => reject(reader.error ?? new Error('Blob reading failed.')));
    reader.onabort = () => finish(() => reject(new Error('Blob reading was aborted.')));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Studio imports hash and parse the same File. Chromium can stall when an
 * ephemeral File supplied by a picker/test is read repeatedly while a worker is
 * also receiving a transferable buffer. Cache one FileReader result and return
 * a fresh copy for every consumer so transferring a parser copy never detaches
 * the cached source.
 */
Blob.prototype.arrayBuffer = function guardedArrayBuffer(): Promise<ArrayBuffer> {
  let cached = cachedReads.get(this);
  if (!cached) {
    cached = readBlob(this);
    cachedReads.set(this, cached);
    cached.catch(() => cachedReads.delete(this));
  }
  return cached.then((buffer) => buffer.slice(0));
};
