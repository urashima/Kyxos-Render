import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dracoLoader = new DRACOLoader().setWorkerLimit(2);
const ktx2Loaders = new WeakMap<object, KTX2Loader>();
const nativeBlobArrayBuffer = Blob.prototype.arrayBuffer;
const objectUrlBlobRegistryKey = Symbol.for('kyxos.objectUrlBlobRegistry');
const localBlobBytesRegistryKey = Symbol.for('kyxos.localBlobBytesRegistry');
const LOCAL_BLOB_TIMEOUT_MS = 30_000;

type ProgressCallback = (event: ProgressEvent<EventTarget>) => void;
type ObjectUrlRegistryGlobal = typeof globalThis & {
  [objectUrlBlobRegistryKey]?: Map<string, Blob>;
  [localBlobBytesRegistryKey]?: WeakMap<Blob, Uint8Array>;
};

function constrainedMobileDecode(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ipadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || ipadDesktopMode;
}

function decoderWorkerLimit(): number {
  return constrainedMobileDecode() ? 1 : 2;
}

function markLoadStage(stage: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.gltfLoadStage = stage;
    document.documentElement.dataset.gltfDecoderWorkers = String(decoderWorkerLimit());
    const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
    if (canvas) {
      canvas.dataset.gltfLoadStage = stage;
      canvas.dataset.gltfDecoderWorkers = String(decoderWorkerLimit());
    }
  }
  console.warn(`[gltf-loader] ${stage}`);
}

function urlProtocol(url: string): string {
  const separator = url.indexOf(':');
  return separator > 0 ? url.slice(0, separator).toLowerCase() : 'relative';
}

function registeredObjectUrlBlob(url: string): Blob | null {
  const registry = (globalThis as ObjectUrlRegistryGlobal)[objectUrlBlobRegistryKey];
  return registry?.get(url) ?? null;
}

function registeredObjectUrlBytes(url: string): Uint8Array | null {
  const runtime = globalThis as ObjectUrlRegistryGlobal;
  const blob = runtime[objectUrlBlobRegistryKey]?.get(url);
  if (!blob) return null;
  return runtime[localBlobBytesRegistryKey]?.get(blob) ?? null;
}

function progress(
  callback: ProgressCallback | undefined,
  loaded: number,
  total: number,
): void {
  callback?.(
    new ProgressEvent('progress', {
      lengthComputable: true,
      loaded,
      total,
    }),
  );
}

function arrayBufferForRegisteredBytes(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function loadRegisteredBlob(
  url: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer | null> {
  const blob = registeredObjectUrlBlob(url);
  if (!blob) {
    markLoadStage('registered-blob-miss');
    return null;
  }

  const exact = registeredObjectUrlBytes(url);
  if (exact) {
    markLoadStage('registered-bytes-read-start');
    progress(onProgress, 0, exact.byteLength);
    const buffer = arrayBufferForRegisteredBytes(exact);
    progress(onProgress, exact.byteLength, exact.byteLength);
    markLoadStage('registered-bytes-read-complete');
    return buffer;
  }

  const sourceKind = blob instanceof File ? 'picker-file' : 'registered-blob';
  markLoadStage(`${sourceKind}-recovery-read-start`);
  progress(onProgress, 0, blob.size);
  const buffer = await nativeBlobArrayBuffer.call(blob);
  markLoadStage(`${sourceKind}-recovery-read-complete`);
  progress(onProgress, blob.size, blob.size);
  return buffer;
}

function loadLocalBlob(
  url: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer> {
  markLoadStage('blob-xhr-recovery-start');
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.timeout = LOCAL_BLOB_TIMEOUT_MS;
    request.onprogress = (event) => onProgress?.(event);
    request.onload = () => {
      if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
        reject(new Error(`GLB Blob request failed with status ${request.status}.`));
        return;
      }
      if (!(request.response instanceof ArrayBuffer)) {
        reject(new Error('GLB Blob request returned an unexpected response.'));
        return;
      }
      markLoadStage('blob-xhr-recovery-complete');
      resolve(request.response);
    };
    request.onerror = () => reject(new Error('GLB Blob request failed.'));
    request.onabort = () => reject(new Error('GLB Blob request was aborted.'));
    request.ontimeout = () => reject(new Error('GLB Blob request timed out.'));
    request.send();
  });
}

export interface ConfiguredGltfLoaderOptions {
  /** Kept for API compatibility; KTX2 is always configured when a renderer exists. */
  ktx2?: boolean;
}

/** Create a loader with Draco, Meshopt and KTX2/Basis support. */
export function createConfiguredGltfLoader(
  renderer?: object | null,
  _options: ConfiguredGltfLoaderOptions = {},
): GLTFLoader {
  const loader = new GLTFLoader();
  dracoLoader.setWorkerLimit(decoderWorkerLimit());
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);

  if (renderer) {
    let ktx2Loader = ktx2Loaders.get(renderer);
    if (!ktx2Loader) {
      ktx2Loader = new KTX2Loader().setWorkerLimit(decoderWorkerLimit());
      ktx2Loader.detectSupport(renderer as any);
      ktx2Loaders.set(renderer, ktx2Loader);
    }
    loader.setKTX2Loader(ktx2Loader);
  }

  const nativeLoadAsync = loader.loadAsync.bind(loader);
  loader.loadAsync = async (url, onProgress) => {
    const protocol = urlProtocol(url);
    markLoadStage(`load-url-${protocol}`);

    if (!url.startsWith('blob:')) {
      try {
        const result = await nativeLoadAsync(url, onProgress);
        markLoadStage(`native-${protocol}-complete`);
        return result;
      } catch (error) {
        markLoadStage(`native-${protocol}-error`);
        throw error;
      }
    }

    // Blob URLs are already a native browser capability and Three's FileLoader
    // knows how to consume them. Always use that path first. The old Kyxos path
    // eagerly resolved blob: -> registry -> picker File -> ArrayBuffer before
    // GLTFLoader could run. CI traces showed that path hanging on desktop
    // fidelity/KTX2 fixtures and terminating iPhone/WebKit browser targets even
    // for tiny GLBs. It also manufactured another large JS-visible allocation.
    markLoadStage(constrainedMobileDecode() ? 'mobile-native-blob-start' : 'native-blob-start');
    try {
      const result = await nativeLoadAsync(url, onProgress);
      markLoadStage(constrainedMobileDecode() ? 'mobile-native-blob-complete' : 'native-blob-complete');
      return result;
    } catch (nativeError) {
      markLoadStage(constrainedMobileDecode() ? 'mobile-native-blob-error' : 'native-blob-error');

      // Never re-enter manual whole-Blob reads on constrained Apple mobile
      // hardware. If the browser cannot load its own blob URL, propagating the
      // error is safer than a second allocation/recovery path that can kill the
      // WebProcess.
      if (constrainedMobileDecode()) throw nativeError;

      // Desktop recovery remains available for stale/quirky object URL cases.
      // It is fallback-only, so healthy imports retain Three/browser semantics.
      const progressCallback = onProgress as ProgressCallback | undefined;
      try {
        const buffer =
          (await loadRegisteredBlob(url, progressCallback))
          ?? (await loadLocalBlob(url, progressCallback));
        markLoadStage('desktop-blob-recovery-parse-start');
        const result = await loader.parseAsync(buffer, '');
        markLoadStage('desktop-blob-recovery-parse-complete');
        return result;
      } catch (recoveryError) {
        markLoadStage('desktop-blob-recovery-error');
        throw recoveryError instanceof Error ? recoveryError : nativeError;
      }
    }
  };

  return loader;
}

export function disposeConfiguredGltfLoader(renderer?: object | null): void {
  if (!renderer) return;
  const loader = ktx2Loaders.get(renderer);
  loader?.dispose();
  ktx2Loaders.delete(renderer);
}
