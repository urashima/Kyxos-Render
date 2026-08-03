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
  gltfNativeTextures?: Map<number, THREE.Texture>;
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

function setMaterialIndex(material: THREE.Material | undefined, index: unknown): void {
  if (material && typeof index === 'number' && Number.isInteger(index)) {
    material.userData.gltfMaterialIndex = index;
  }
}

function setTextureIndex(
  texture: THREE.Texture | null | undefined,
  index: unknown,
  registry: Map<number, THREE.Texture>,
): void {
  if (!texture?.isTexture || typeof index !== 'number' || !Number.isInteger(index)) return;
  texture.userData.gltfTextureIndex = index;
  registry.set(index, texture);
}

function annotateMeshMaterials(
  object: THREE.Object3D,
  meshIndex: number | null,
  primitiveIndex: number | null,
  json: any,
): void {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || !mesh.material || meshIndex == null) return;
  const primitives = json?.meshes?.[meshIndex]?.primitives as Array<{ material?: number }> | undefined;
  if (!primitives?.length) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  if (materials.length === primitives.length) {
    materials.forEach((material, index) => setMaterialIndex(material, primitives[index]?.material));
    return;
  }
  const sourcePrimitive = primitives[primitiveIndex ?? 0] ?? primitives[0];
  materials.forEach((material) => setMaterialIndex(material, sourcePrimitive?.material));
}

function annotateMaterialTextures(
  material: THREE.Material,
  materialIndex: number | null,
  json: any,
  registry: Map<number, THREE.Texture>,
): void {
  if (materialIndex == null) return;
  const source = json?.materials?.[materialIndex] ?? {};
  const pbr = source.pbrMetallicRoughness ?? {};
  const extensions = source.extensions ?? {};
  const clearcoat = extensions.KHR_materials_clearcoat ?? {};
  const transmission = extensions.KHR_materials_transmission ?? {};
  const volume = extensions.KHR_materials_volume ?? {};
  const sheen = extensions.KHR_materials_sheen ?? {};
  const specular = extensions.KHR_materials_specular ?? {};
  const candidate = material as THREE.Material & Record<string, any>;

  setTextureIndex(candidate.map, pbr.baseColorTexture?.index, registry);
  setTextureIndex(candidate.metalnessMap, pbr.metallicRoughnessTexture?.index, registry);
  setTextureIndex(candidate.roughnessMap, pbr.metallicRoughnessTexture?.index, registry);
  setTextureIndex(candidate.normalMap, source.normalTexture?.index, registry);
  setTextureIndex(candidate.emissiveMap, source.emissiveTexture?.index, registry);
  setTextureIndex(candidate.aoMap, source.occlusionTexture?.index, registry);
  setTextureIndex(candidate.clearcoatMap, clearcoat.clearcoatTexture?.index, registry);
  setTextureIndex(candidate.clearcoatRoughnessMap, clearcoat.clearcoatRoughnessTexture?.index, registry);
  setTextureIndex(candidate.clearcoatNormalMap, clearcoat.clearcoatNormalTexture?.index, registry);
  setTextureIndex(candidate.transmissionMap, transmission.transmissionTexture?.index, registry);
  setTextureIndex(candidate.thicknessMap, volume.thicknessTexture?.index, registry);
  setTextureIndex(candidate.sheenColorMap, sheen.sheenColorTexture?.index, registry);
  setTextureIndex(candidate.sheenRoughnessMap, sheen.sheenRoughnessTexture?.index, registry);
  setTextureIndex(candidate.specularIntensityMap, specular.specularTexture?.index, registry);
  setTextureIndex(candidate.specularColorMap, specular.specularColorTexture?.index, registry);
}

function annotateAssociations(gltf: any): Map<number, THREE.Texture> {
  const registry = new Map<number, THREE.Texture>();
  const associations = gltf?.parser?.associations as Map<object, unknown> | undefined;
  const json = gltf?.parser?.json;
  if (associations) {
    for (const [resource, association] of associations) {
      const object = resource as THREE.Object3D;
      const material = resource as THREE.Material;
      const texture = resource as THREE.Texture;
      if (object.isObject3D) {
        const nodeIndex = associationIndex(association, 'nodes');
        const meshIndex = associationIndex(association, 'meshes');
        const primitiveIndex = associationIndex(association, 'primitives');
        if (nodeIndex != null) object.userData.gltfNodeIndex = nodeIndex;
        if (meshIndex != null) object.userData.gltfMeshIndex = meshIndex;
        if (primitiveIndex != null) object.userData.gltfPrimitiveIndex = primitiveIndex;
        annotateMeshMaterials(object, meshIndex, primitiveIndex, json);
      } else if (material.isMaterial) {
        setMaterialIndex(material, associationIndex(association, 'materials'));
      } else if (texture.isTexture) {
        setTextureIndex(texture, associationIndex(association, 'textures'), registry);
      }
    }
  }

  // Some Three.js revisions associate only generated Object3D instances. Use
  // the source primitive/material JSON as a deterministic fallback for both the
  // material index and every texture slot.
  gltf.scene?.traverse((object: THREE.Object3D) => {
    const meshIndex = typeof object.userData.gltfMeshIndex === 'number'
      ? object.userData.gltfMeshIndex
      : null;
    const primitiveIndex = typeof object.userData.gltfPrimitiveIndex === 'number'
      ? object.userData.gltfPrimitiveIndex
      : null;
    annotateMeshMaterials(object, meshIndex, primitiveIndex, json);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const entry of materials) {
      const index = typeof entry.userData.gltfMaterialIndex === 'number'
        ? entry.userData.gltfMaterialIndex
        : null;
      annotateMaterialTextures(entry, index, json, registry);
    }
  });
  return registry;
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
    const nativeTextures = annotateAssociations(gltf);
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
    internal.gltfNativeTextures = nativeTextures;
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
