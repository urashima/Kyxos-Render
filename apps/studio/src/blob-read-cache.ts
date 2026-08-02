import './glb-import-diagnostics';

const originalFileArrayBuffer = File.prototype.arrayBuffer;
const cachedReads = new WeakMap<File, Promise<ArrayBuffer>>();
const READ_TIMEOUT_MS = 30_000;

function readFile(file: File): Promise<ArrayBuffer> {
  if (typeof FileReader === 'undefined') {
    return originalFileArrayBuffer.call(file);
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const timeout = window.setTimeout(() => {
      reader.abort();
      reject(new Error(`Reading ${file.name} timed out.`));
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
        reject(new Error('File reader returned an unexpected result.'));
        return;
      }
      resolve(reader.result);
    });
    reader.onerror = () => finish(() => reject(reader.error ?? new Error('File reading failed.')));
    reader.onabort = () => finish(() => reject(new Error('File reading was aborted.')));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Studio hashes and parses the same user-selected File. Cache that one source
 * read and return a fresh copy to each consumer so transferring the parser copy
 * cannot detach the cached bytes.
 *
 * Do not patch Blob.prototype: Three.js loads persisted models from Blob URLs,
 * and replacing the platform Blob reader also intercepts that runtime path.
 */
File.prototype.arrayBuffer = function guardedFileArrayBuffer(): Promise<ArrayBuffer> {
  let cached = cachedReads.get(this);
  if (!cached) {
    cached = readFile(this);
    cachedReads.set(this, cached);
    cached.catch(() => cachedReads.delete(this));
  }
  return cached.then((buffer) => buffer.slice(0));
};