import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import * as THREE from 'three/webgpu';

import { createConfiguredGltfLoader } from './gltfLoader';
import { KyxosViewer } from './KyxosViewer';
import { disposeObject3D } from './utils/dispose';

export interface NativeGltfObjectSnapshot {
  object: THREE.Object3D;
  parent: THREE.Object3D | null;
  parentNodeIndex: number | null;
  nodeIndex: number | null;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  matrix: THREE.Matrix4;
  matrixAutoUpdate: boolean;
}

export interface NativeGltfMaterialSnapshot {
  mesh: THREE.Mesh;
  ownerNodeIndex: number | null;
  materials: THREE.Material[];
}

interface NativeGltfInternals {
  renderer?: object;
  modelRoot?: THREE.Group;
  loadedGltfAnimations?: THREE.AnimationClip[];
  gltfSceneLoadActive?: boolean;
  gltfNativeSnapshots?: NativeGltfObjectSnapshot[];
  gltfNativeMaterialSnapshots?: NativeGltfMaterialSnapshot[];
  resetTemporal?(reason?: string): void;
}

interface ViewerPrototype {
  loadModel(url: string, options?: { ktx2?: boolean }): Promise<void>;
  loadScene(scene: KyxosSceneContract, resolver: AssetResolver): Promise<void>;
  __kyxosNativeGltfLoadInstalled?: boolean;
}

function internals(viewer: KyxosViewer): NativeGltfInternals {
  return viewer as unknown as NativeGltfInternals;
}

function associationIndex(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null;
  const index = (value as Record<string, unknown>)[key];
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

function annotateAssociations(gltf: any): void {
  const associations = gltf?.parser?.associations as Map<object, unknown> | undefined;
  if (!associations) return;
  for (const [resource, association] of associations) {
    if (resource instanceof THREE.Object3D) {
      const nodeIndex = associationIndex(association, 'nodes');
      const meshIndex = associationIndex(association, 'meshes');
      const primitiveIndex = associationIndex(association, 'primitives');
      if (nodeIndex != null) resource.userData.gltfNodeIndex = nodeIndex;
      if (meshIndex != null) resource.userData.gltfMeshIndex = meshIndex;
      if (primitiveIndex != null) resource.userData.gltfPrimitiveIndex = primitiveIndex;
    } else if (resource instanceof THREE.Material) {
      const materialIndex = associationIndex(association, 'materials');
      if (materialIndex != null) resource.userData.gltfMaterialIndex = materialIndex;
    }
  }
}

function nearestParentNodeIndex(object: THREE.Object3D | null): number | null {
  let current = object;
  while (current) {
    const index = current.userData.gltfNodeIndex;
    if (typeof index === 'number') return index;
    current = current.parent;
  }
  return null;
}

function captureNativeSnapshots(root: THREE.Object3D): NativeGltfObjectSnapshot[] {
  const snapshots: NativeGltfObjectSnapshot[] = [];
  root.traverse((object) => {
    snapshots.push({
      object,
      parent: object.parent,
      parentNodeIndex: nearestParentNodeIndex(object.parent),
      nodeIndex: typeof object.userData.gltfNodeIndex === 'number'
        ? object.userData.gltfNodeIndex
        : null,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      matrix: object.matrix.clone(),
      matrixAutoUpdate: object.matrixAutoUpdate,
    });
  });
  return snapshots;
}

function captureNativeMaterials(root: THREE.Object3D): NativeGltfMaterialSnapshot[] {
  const snapshots: NativeGltfMaterialSnapshot[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    snapshots.push({
      mesh,
      ownerNodeIndex: nearestParentNodeIndex(mesh),
      materials: Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material],
    });
  });
  return snapshots;
}

function normalizeForPlayground(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(2.6 / maxDimension);
  model.position.sub(center.multiplyScalar(model.scale.x));
  model.position.y -= new THREE.Box3().setFromObject(model).min.y;
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype.__kyxosNativeGltfLoadInstalled) {
  const originalLoadModel = prototype.loadModel;
  const originalLoadScene = prototype.loadScene;

  prototype.loadModel = async function loadNativeGltf(
    this: KyxosViewer,
    url: string,
    options: { ktx2?: boolean } = {},
  ): Promise<void> {
    if (url.startsWith('procedural:')) {
      await originalLoadModel.call(this, url, options);
      return;
    }

    const internal = internals(this);
    const loader = createConfiguredGltfLoader(internal.renderer, options);
    const gltf = await loader.loadAsync(url);
    annotateAssociations(gltf);
    internal.loadedGltfAnimations = gltf.animations.map((clip: THREE.AnimationClip) => clip.clone());

    const modelRoot = internal.modelRoot;
    if (!modelRoot) throw new Error('Viewer model root is unavailable.');
    disposeObject3D(modelRoot);
    modelRoot.clear();

    const model = gltf.scene as THREE.Object3D;
    model.traverse((object: any) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    if (!internal.gltfSceneLoadActive) normalizeForPlayground(model);
    modelRoot.add(model);
    modelRoot.updateMatrixWorld(true);
    internal.gltfNativeSnapshots = captureNativeSnapshots(model);
    internal.gltfNativeMaterialSnapshots = captureNativeMaterials(model);
    this.canvas.dataset.gltfTransformMode = internal.gltfSceneLoadActive
      ? 'native-scene'
      : 'normalized-playground';
    internal.resetTemporal?.('model-switch');
  };

  prototype.loadScene = async function loadSceneWithNativeGltf(
    this: KyxosViewer,
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    const internal = internals(this);
    internal.gltfSceneLoadActive = true;
    try {
      await originalLoadScene.call(this, scene, resolver);
    } finally {
      internal.gltfSceneLoadActive = false;
    }
  };

  prototype.__kyxosNativeGltfLoadInstalled = true;
}
