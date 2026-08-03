import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dracoLoader = new DRACOLoader().setWorkerLimit(2);
const ktx2Loaders = new WeakMap<object, KTX2Loader>();
const objectUrlBlobRegistryKey = Symbol.for('kyxos.objectUrlBlobRegistry');
const localBlobBytesRegistryKey = Symbol.for('kyxos.localBlobBytesRegistry');
const LOCAL_BLOB_TIMEOUT_MS = 30_000;

type ProgressCallback = (event: ProgressEvent<EventTarget>) => void;
type ObjectUrlRegistryGlobal = typeof globalThis & {
  [objectUrlBlobRegistryKey]?: Map<string, Blob>;
  [localBlobBytesRegistryKey]?: WeakMap<Blob, Uint8Array>;
};

function markLoadStage(stage: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.gltfLoadStage = stage;
    const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
    if (canvas) canvas.dataset.gltfLoadStage = stage;
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
    const buffer = exact.slice().buffer;
    progress(onProgress, exact.byteLength, exact.byteLength);
    markLoadStage('registered-bytes-read-complete');
    return buffer;
  }

  markLoadStage(blob instanceof File ? 'picker-file-read-start' : 'registered-blob-read-start');
  progress(onProgress, 0, blob.size);
  const buffer = await blob.arrayBuffer();
  markLoadStage(blob instanceof File ? 'picker-file-read-complete' : 'registered-blob-read-complete');
  progress(onProgress, blob.size, blob.size);
  return buffer;
}

function loadLocalBlob(
  url: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer> {
  markLoadStage('blob-xhr-start');
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
      markLoadStage('blob-xhr-complete');
      resolve(request.response);
    };
    request.onerror = () => reject(new Error('GLB Blob request failed.'));
    request.onabort = () => reject(new Error('GLB Blob request was aborted.'));
    request.ontimeout = () => reject(new Error('GLB Blob request timed out.'));
    request.send();
  });
}

export interface ConfiguredGltfLoaderOptions {
  /** Kept for API compatibility; KTX2 is now always configured when a renderer exists. */
  ktx2?: boolean;
}

/** Create a loader with Draco, Meshopt and KTX2/Basis support. */
export function createConfiguredGltfLoader(
  renderer?: object | null,
  _options: ConfiguredGltfLoaderOptions = {},
): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);

  // KTX2Loader uses its official import.meta-relative Basis transcoder assets.
  // Keeping it attached is cheap; the worker/WASM is loaded only when a KTX2
  // texture is encountered. This also handles assets that omit extensionsUsed.
  if (renderer) {
    let ktx2Loader = ktx2Loaders.get(renderer);
    if (!ktx2Loader) {
      ktx2Loader = new KTX2Loader().setWorkerLimit(2);
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

    const progressCallback = onProgress as ProgressCallback | undefined;
    const buffer =
      (await loadRegisteredBlob(url, progressCallback))
      ?? (await loadLocalBlob(url, progressCallback));
    markLoadStage('gltf-parse-start');
    try {
      const result = await loader.parseAsync(buffer, '');
      markLoadStage('gltf-parse-complete');
      return result;
    } catch (error) {
      markLoadStage('gltf-parse-error');
      throw error;
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
