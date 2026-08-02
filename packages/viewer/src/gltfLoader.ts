import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dracoLoader = new DRACOLoader().setWorkerLimit(2);
const ktx2Loaders = new WeakMap<object, KTX2Loader>();
const LOCAL_BLOB_TIMEOUT_MS = 30_000;

type ProgressCallback = (event: ProgressEvent<EventTarget>) => void;

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

/**
 * Three.js FileLoader uses fetch for URLs. Chromium can leave a fetch-backed
 * Blob URL pending when that Blob was cloned out of IndexedDB. Read local Blob
 * URLs through XHR and keep the official GLTFLoader parser and extension stack.
 */
class ConfiguredGltfLoader extends GLTFLoader {
  override async loadAsync(
    url: string,
    onProgress?: ProgressCallback,
  ): Promise<GLTF> {
    if (!url.startsWith('blob:')) return super.loadAsync(url, onProgress);
    const buffer = await loadLocalBlob(url, onProgress);
    return this.parseAsync(buffer, '');
  }
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
  const loader = new ConfiguredGltfLoader();
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
  return loader;
}

export function disposeConfiguredGltfLoader(renderer?: object | null): void {
  if (!renderer) return;
  const loader = ktx2Loaders.get(renderer);
  loader?.dispose();
  ktx2Loaders.delete(renderer);
}