import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dracoLoader = new DRACOLoader().setWorkerLimit(2);
const ktx2Loaders = new WeakMap<object, KTX2Loader>();

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
  return loader;
}

export function disposeConfiguredGltfLoader(renderer?: object | null): void {
  if (!renderer) return;
  const loader = ktx2Loaders.get(renderer);
  loader?.dispose();
  ktx2Loaders.delete(renderer);
}
