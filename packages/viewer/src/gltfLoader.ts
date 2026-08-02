import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dracoLoader = new DRACOLoader().setWorkerLimit(2);
const ktx2Loaders = new WeakMap<object, KTX2Loader>();
const objectUrlBlobRegistryKey = Symbol.for('kyxos.objectUrlBlobRegistry');
const LOCAL_BLOB_TIMEOUT_MS = 30_000;

type ProgressCallback = (event: ProgressEvent<EventTarget>) => void;
type ObjectUrlRegistryGlobal = typeof globalThis & {
  [objectUrlBlobRegistryKey]?: Map<string, Blob>;
};

function registeredObjectUrlBlob(url: string): Blob | null {
  const registry = (globalThis as ObjectUrlRegistryGlobal)[objectUrlBlobRegistryKey];
  return registry?.get(url) ?? null;
}

async function loadRegisteredBlob(
  url: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer | null> {
  const blob = registeredObjectUrlBlob(url);
  if (!blob) return null;
  onProgress?.(
    new ProgressEvent('progress', {
      lengthComputable: true,
      loaded: 0,
      total: blob.size,
    }),
  );
  const buffer = await blob.arrayBuffer();
  onProgress?.(
    new ProgressEvent('progress', {
      lengthComputable: true,
      loaded: blob.size,
      total: blob.size,
    }),
  );
  return buffer;
}

function loadLocalBlob(
  url: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer> {
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
      resolve(request.response);
    };
    request.onerror = () => reject(new Error('GLB Blob request failed.'));
    request.onabort = () => reject(new Error('GLB Blob request was aborted.'));
    request.ontimeout = () => reject(new Error('GLB Blob request timed out.'));
    request.send();
  });
}

export interface ConfiguredGltfLoaderOptions {
  /** Only initialize the KTX2 transcoder when the asset actually declares Basis/KTX2. */
  ktx2?: boolean;
}

/** Create a loader with Draco and Meshopt support, plus KTX2/Basis when requested. */
export function createConfiguredGltfLoader(
  renderer?: object | null,
  options: ConfiguredGltfLoaderOptions = {},
): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);

  if (renderer && options.ktx2) {
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
    if (!url.startsWith('blob:')) return nativeLoadAsync(url, onProgress);

    // Studio registers the original Blob when it creates an object URL. Reading
    // that Blob directly avoids Chromium's network-style Blob URL path, which can
    // remain pending for IndexedDB-cloned Blobs. Object URLs created elsewhere
    // retain the XHR fallback before the official GLTFLoader parser is invoked.
    const progress = onProgress as ProgressCallback | undefined;
    const buffer =
      (await loadRegisteredBlob(url, progress)) ?? (await loadLocalBlob(url, progress));
    return loader.parseAsync(buffer, '');
  };

  return loader;
}

export function disposeConfiguredGltfLoader(renderer?: object | null): void {
  if (!renderer) return;
  const loader = ktx2Loaders.get(renderer);
  loader?.dispose();
  ktx2Loaders.delete(renderer);
}
