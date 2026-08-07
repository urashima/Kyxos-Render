import './glb-import-diagnostics';

const originalFileArrayBuffer = File.prototype.arrayBuffer;
const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
const objectUrlBlobRegistryKey = Symbol.for('kyxos.objectUrlBlobRegistry');
const localBlobBytesRegistryKey = Symbol.for('kyxos.localBlobBytesRegistry');
const pickerFiles = new WeakSet<File>();
const recentPickerFiles: Array<{ file: File; capturedAt: number }> = [];
const cachedReads = new WeakMap<File, Promise<ArrayBuffer>>();
const READ_TIMEOUT_MS = 30_000;
const PICKER_SOURCE_TTL_MS = 60_000;
const MAX_CACHED_PICKER_BYTES = 8 * 1024 * 1024;

type ObjectUrlRegistryGlobal = typeof globalThis & {
  [objectUrlBlobRegistryKey]?: Map<string, Blob>;
  [localBlobBytesRegistryKey]?: WeakMap<Blob, Uint8Array>;
};

const registryGlobal = globalThis as ObjectUrlRegistryGlobal;
const objectUrlBlobRegistry =
  registryGlobal[objectUrlBlobRegistryKey] ?? new Map<string, Blob>();
const localBlobBytesRegistry =
  registryGlobal[localBlobBytesRegistryKey] ?? new WeakMap<Blob, Uint8Array>();
registryGlobal[objectUrlBlobRegistryKey] = objectUrlBlobRegistry;
registryGlobal[localBlobBytesRegistryKey] = localBlobBytesRegistry;

function constrainedMobileMemory(): boolean {
  const ua = navigator.userAgent;
  const ipadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || ipadDesktopMode;
}

/** Register immutable source bytes for generated or repacked local assets. */
export function registerLocalBlobBytes(blob: Blob, bytes: Uint8Array): void {
  // Generated assets are normally much smaller than source GLBs. Keep one
  // immutable snapshot, but do not manufacture another copy every time a
  // consumer asks for the bytes.
  localBlobBytesRegistry.set(blob, bytes.slice());
}

function registeredBytes(blob: Blob): ArrayBuffer | null {
  const bytes = localBlobBytesRegistry.get(blob);
  if (!bytes) return null;
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

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
  // Generated GLBs own an exact byte snapshot. Never replace them with a picker
  // file selected only by size/type heuristics.
  if (localBlobBytesRegistry.has(blob)) return blob;

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

URL.createObjectURL = function createTrackedObjectUrl(blob: Blob | MediaSource): string {
  const url = originalCreateObjectUrl(blob);
  if (blob instanceof Blob) {
    const source = sourceBlobForObjectUrl(blob);
    objectUrlBlobRegistry.set(url, source);
    document.documentElement.dataset.localBlobSource =
      localBlobBytesRegistry.has(source)
        ? 'registered-bytes'
        : source instanceof File ? 'picker-file' : 'persisted-blob';
  }
  return url;
};

URL.revokeObjectURL = function revokeTrackedObjectUrl(url: string): void {
  objectUrlBlobRegistry.delete(url);
  originalRevokeObjectUrl(url);
};

document.addEventListener(
  'change',
  (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const capturedAt = Date.now();
    for (const file of input.files ?? []) {
      pickerFiles.add(file);
      recentPickerFiles.push({ file, capturedAt });
      if (constrainedMobileMemory() || file.size > MAX_CACHED_PICKER_BYTES) {
        document.documentElement.dataset.pickerBlobReadMode = 'uncached-large';
        document.documentElement.dataset.pickerBlobBytes = String(file.size);
      }
    }
    pruneRecentPickerFiles(capturedAt);
  },
  true,
);

function readFile(file: File): Promise<ArrayBuffer> {
  const exact = registeredBytes(file);
  if (exact) return Promise.resolve(exact);
  if (typeof FileReader === 'undefined') return originalFileArrayBuffer.call(file);

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

File.prototype.arrayBuffer = function guardedFileArrayBuffer(): Promise<ArrayBuffer> {
  const exact = registeredBytes(this);
  if (exact) return Promise.resolve(exact);
  if (!pickerFiles.has(this)) return originalFileArrayBuffer.call(this);

  // The previous guard cached the complete picker ArrayBuffer for 60 seconds
  // (because recentPickerFiles also retained the File) and returned buffer.slice
  // on every call. A 200 MB GLB could therefore keep one 200 MB cache plus a
  // fresh 200 MB clone for hashing, persistence and GLTFLoader parsing. iOS
  // Safari commonly kills the page under that transient pressure. Large picker
  // files and all iPhone/iPad imports now use the browser's one-shot read path
  // and are eligible for collection immediately after each consumer finishes.
  if (constrainedMobileMemory() || this.size > MAX_CACHED_PICKER_BYTES) {
    document.documentElement.dataset.pickerBlobReadMode = 'uncached-large';
    return originalFileArrayBuffer.call(this);
  }

  let cached = cachedReads.get(this);
  if (!cached) {
    cached = readFile(this);
    cachedReads.set(this, cached);
    cached.catch(() => cachedReads.delete(this));
  }
  document.documentElement.dataset.pickerBlobReadMode = 'cached-small';
  // Small files can afford the standards-compatible fresh ArrayBuffer result;
  // large files never enter this cache path.
  return cached.then((buffer) => buffer.slice(0));
};
