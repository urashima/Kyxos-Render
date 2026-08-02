import './glb-import-diagnostics';

const originalFileArrayBuffer = File.prototype.arrayBuffer;
const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
const objectUrlBlobRegistryKey = Symbol.for('kyxos.objectUrlBlobRegistry');
const pickerFiles = new WeakSet<File>();
const recentPickerFiles: Array<{ file: File; capturedAt: number }> = [];
const cachedReads = new WeakMap<File, Promise<ArrayBuffer>>();
const READ_TIMEOUT_MS = 30_000;
const PICKER_SOURCE_TTL_MS = 60_000;

type ObjectUrlRegistryGlobal = typeof globalThis & {
  [objectUrlBlobRegistryKey]?: Map<string, Blob>;
};

const registryGlobal = globalThis as ObjectUrlRegistryGlobal;
const objectUrlBlobRegistry =
  registryGlobal[objectUrlBlobRegistryKey] ?? new Map<string, Blob>();
registryGlobal[objectUrlBlobRegistryKey] = objectUrlBlobRegistry;

function pruneRecentPickerFiles(now = Date.now()): void {
  while (
    recentPickerFiles.length &&
    (recentPickerFiles.length > 32 ||
      now - recentPickerFiles[0].capturedAt > PICKER_SOURCE_TTL_MS)
  ) {
    recentPickerFiles.shift();
  }
}

function sourceBlobForObjectUrl(blob: Blob): Blob {
  const now = Date.now();
  pruneRecentPickerFiles(now);
  for (let index = recentPickerFiles.length - 1; index >= 0; index -= 1) {
    const candidate = recentPickerFiles[index].file;
    if (candidate.size !== blob.size) continue;
    if (candidate.type && blob.type && candidate.type !== blob.type) continue;
    return candidate;
  }
  return blob;
}

// Keep a direct reference to every local Blob behind an object URL. During the
// active import, prefer the original picker File over the IndexedDB clone with
// the same size/type. Chromium can leave reads of cloned Blob data pending even
// when the generated object URL itself is valid.
URL.createObjectURL = function createTrackedObjectUrl(blob: Blob | MediaSource): string {
  const url = originalCreateObjectUrl(blob);
  if (blob instanceof Blob) {
    const source = sourceBlobForObjectUrl(blob);
    objectUrlBlobRegistry.set(url, source);
    document.documentElement.dataset.localBlobSource =
      source instanceof File ? 'picker-file' : 'persisted-blob';
  }
  return url;
};

URL.revokeObjectURL = function revokeTrackedObjectUrl(url: string): void {
  objectUrlBlobRegistry.delete(url);
  originalRevokeObjectUrl(url);
};

// Capture before the input's own change handler starts the async import. The
// same File is hashed and parsed, and remains available as the preferred source
// when the local asset manifest creates an object URL from its IndexedDB clone.
document.addEventListener(
  'change',
  (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const capturedAt = Date.now();
    for (const file of input.files ?? []) {
      pickerFiles.add(file);
      recentPickerFiles.push({ file, capturedAt });
    }
    pruneRecentPickerFiles(capturedAt);
  },
  true,
);

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
    reader.onload = () =>
      finish(() => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error('File reader returned an unexpected result.'));
          return;
        }
        resolve(reader.result);
      });
    reader.onerror = () =>
      finish(() => reject(reader.error ?? new Error('File reading failed.')));
    reader.onabort = () =>
      finish(() => reject(new Error('File reading was aborted.')));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Studio hashes and parses the same picker-owned File. Cache that one source
 * read and return a fresh copy to each consumer so transferring the parser copy
 * cannot detach the cached bytes.
 */
File.prototype.arrayBuffer = function guardedFileArrayBuffer(): Promise<ArrayBuffer> {
  if (!pickerFiles.has(this)) return originalFileArrayBuffer.call(this);
  let cached = cachedReads.get(this);
  if (!cached) {
    cached = readFile(this);
    cachedReads.set(this, cached);
    cached.catch(() => cachedReads.delete(this));
  }
  return cached.then((buffer) => buffer.slice(0));
};
