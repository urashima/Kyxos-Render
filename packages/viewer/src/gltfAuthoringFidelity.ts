import type {
  AssetResolver,
  KyxosSceneContract,
  SceneMaterial,
  Transform,
} from '@kyxos/scene-contract';
import * as THREE from 'three/webgpu';

import type {
  NativeGltfMaterialSnapshot,
  NativeGltfObjectSnapshot,
} from './gltfNativeLoad';
import { KyxosViewer } from './KyxosViewer';

interface FidelityInternals {
  modelRoot?: THREE.Group;
  loadedGltfAnimations?: THREE.AnimationClip[];
  gltfNativeSnapshots?: NativeGltfObjectSnapshot[];
  gltfNativeMaterialSnapshots?: NativeGltfMaterialSnapshot[];
  editorOriginalMaterials?: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  editorProxyMaterials?: Set<THREE.Material>;
  gltfMaterialObserver?: MutationObserver;
  gltfDiagnosticFrame?: number;
  editorNeedsRender?: boolean;
  resetTemporal?(reason?: string): void;
}

interface ViewerPrototype {
  loadScene(scene: KyxosSceneContract, resolver: AssetResolver): Promise<void>;
  dispose(): void;
  __kyxosGltfAuthoringFidelityInstalled?: boolean;
}

function internals(viewer: KyxosViewer): FidelityInternals {
  return viewer as unknown as FidelityInternals;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}

function transformMatches(left: Transform, right: Transform): boolean {
  return (
    closeEnough(left.position.x, right.position.x)
    && closeEnough(left.position.y, right.position.y)
    && closeEnough(left.position.z, right.position.z)
    && closeEnough(left.rotation.x, right.rotation.x)
    && closeEnough(left.rotation.y, right.rotation.y)
    && closeEnough(left.rotation.z, right.rotation.z)
    && closeEnough(left.scale.x, right.scale.x)
    && closeEnough(left.scale.y, right.scale.y)
    && closeEnough(left.scale.z, right.scale.z)
  );
}

function originalTransform(node: KyxosSceneContract['nodes'][number]): Transform | null {
  const value = node.metadata?.gltfOriginalTransform as Transform | undefined;
  return value?.position && value.rotation && value.scale ? value : null;
}

function sourceIndex(node: KyxosSceneContract['nodes'][number] | undefined): number | null {
  const value = node?.metadata?.gltfNodeIndex;
  return typeof value === 'number' ? value : null;
}

function restoreProxyMaterials(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  for (const [mesh, material] of internal.editorOriginalMaterials ?? []) {
    mesh.material = material;
  }
  internal.editorOriginalMaterials?.clear();
  for (const material of internal.editorProxyMaterials ?? []) material.dispose();
  internal.editorProxyMaterials?.clear();
}

function restoreNativeHierarchy(viewer: KyxosViewer, contract: KyxosSceneContract): number {
  const internal = internals(viewer);
  const snapshots = internal.gltfNativeSnapshots ?? [];
  const nodesBySourceIndex = new Map<number, KyxosSceneContract['nodes'][number]>();
  for (const node of contract.nodes) {
    const index = sourceIndex(node);
    if (index != null) nodesBySourceIndex.set(index, node);
  }

  let restored = 0;
  for (const snapshot of snapshots) {
    if (snapshot.nodeIndex == null) {
      if (snapshot.parent && snapshot.object.parent !== snapshot.parent) {
        snapshot.parent.add(snapshot.object);
      }
      snapshot.object.position.copy(snapshot.position);
      snapshot.object.quaternion.copy(snapshot.quaternion);
      snapshot.object.scale.copy(snapshot.scale);
      snapshot.object.matrixAutoUpdate = snapshot.matrixAutoUpdate;
      snapshot.object.matrix.copy(snapshot.matrix);
      if (snapshot.matrixAutoUpdate) snapshot.object.updateMatrix();
      restored += 1;
      continue;
    }

    const node = nodesBySourceIndex.get(snapshot.nodeIndex);
    const initial = node ? originalTransform(node) : null;
    if (!node || !initial || !transformMatches(node.transform, initial)) continue;
    const contractParent = node.parentId
      ? contract.nodes.find((candidate) => candidate.id === node.parentId)
      : undefined;
    if (sourceIndex(contractParent) !== snapshot.parentNodeIndex) continue;

    if (snapshot.parent && snapshot.object.parent !== snapshot.parent) {
      snapshot.parent.add(snapshot.object);
    }
    snapshot.object.position.copy(snapshot.position);
    snapshot.object.quaternion.copy(snapshot.quaternion);
    snapshot.object.scale.copy(snapshot.scale);
    snapshot.object.matrixAutoUpdate = snapshot.matrixAutoUpdate;
    snapshot.object.matrix.copy(snapshot.matrix);
    if (snapshot.matrixAutoUpdate) snapshot.object.updateMatrix();
    restored += 1;
  }

  internal.modelRoot?.updateMatrixWorld(true);
  internal.modelRoot?.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.update();
  });
  return restored;
}

function materialSourceIndex(material: SceneMaterial | undefined): number | null {
  const value = material?.metadata?.gltfMaterialIndex;
  return typeof value === 'number' ? value : null;
}

function nativeMaterialIndex(material: THREE.Material | undefined): number | null {
  const value = material?.userData.gltfMaterialIndex;
  return typeof value === 'number' ? value : null;
}

function materialIsUnedited(material: SceneMaterial | undefined): boolean {
  if (!material) return false;
  const original = material.metadata?.original;
  if (!original || typeof original !== 'object') return false;
  const current = structuredClone(material) as SceneMaterial & { metadata?: unknown };
  delete current.metadata;
  return JSON.stringify(current) === JSON.stringify(original);
}

function restoreNativeMaterials(viewer: KyxosViewer, contract: KyxosSceneContract): number {
  const internal = internals(viewer);
  restoreProxyMaterials(viewer);
  let restored = 0;

  for (const snapshot of internal.gltfNativeMaterialSnapshots ?? []) {
    const node = contract.nodes.find(
      (candidate) => sourceIndex(candidate) === snapshot.ownerNodeIndex,
    );
    if (!node) continue;
    const slots = (
      contract.activeMaterialVariantId
      && node.materialVariantBindings?.[contract.activeMaterialVariantId]
    ) || node.materialSlots || [];
    const current = Array.isArray(snapshot.mesh.material)
      ? [...snapshot.mesh.material]
      : [snapshot.mesh.material];

    snapshot.materials.forEach((native, slot) => {
      const expected = contract.materials[slots[slot]];
      if (
        expected
        && materialIsUnedited(expected)
        && materialSourceIndex(expected) === nativeMaterialIndex(native)
      ) {
        current[slot] = native;
        restored += 1;
      }
    });
    snapshot.mesh.material = Array.isArray(snapshot.mesh.material) ? current : current[0];
  }

  viewer.canvas.dataset.authoringMaterials = 'exact-gltf';
  return restored;
}

function materialHasTexture(material: THREE.Material): boolean {
  const value = material as THREE.Material & Record<string, unknown>;
  return [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'emissiveMap',
    'aoMap',
    'alphaMap',
    'clearcoatMap',
    'transmissionMap',
    'thicknessMap',
    'sheenColorMap',
    'specularColorMap',
  ].some((key) => value[key] instanceof THREE.Texture);
}

function weightDiagnostics(attribute: any): { vertices: number; invalid: number } {
  if (!attribute || typeof attribute.count !== 'number') return { vertices: 0, invalid: 0 };
  let invalid = 0;
  for (let index = 0; index < attribute.count; index += 1) {
    const sum = Number(attribute.getX(index) ?? 0)
      + Number(attribute.getY(index) ?? 0)
      + Number(attribute.getZ(index) ?? 0)
      + Number(attribute.getW(index) ?? 0);
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.002) invalid += 1;
  }
  return { vertices: attribute.count, invalid };
}

function publishFidelityDiagnostics(
  viewer: KyxosViewer,
  contract: KyxosSceneContract,
): void {
  const internal = internals(viewer);
  const bones = new Set<THREE.Bone>();
  let skinnedMeshes = 0;
  let texturedMaterials = 0;
  let weightedVertices = 0;
  let invalidWeights = 0;

  for (const snapshot of internal.gltfNativeMaterialSnapshots ?? []) {
    texturedMaterials += snapshot.materials.filter(materialHasTexture).length;
  }
  internal.modelRoot?.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    skinnedMeshes += 1;
    mesh.skeleton.bones.forEach((bone) => bones.add(bone));
    const weights = weightDiagnostics(mesh.geometry.getAttribute('skinWeight'));
    weightedVertices += weights.vertices;
    invalidWeights += weights.invalid;
  });

  viewer.canvas.dataset.gltfTexturedMaterials = String(texturedMaterials);
  viewer.canvas.dataset.gltfSkinnedMeshes = String(skinnedMeshes);
  viewer.canvas.dataset.gltfBones = String(bones.size);
  viewer.canvas.dataset.gltfWeightedVertices = String(weightedVertices);
  viewer.canvas.dataset.gltfInvalidWeights = String(invalidWeights);
  viewer.canvas.dataset.gltfMatrixNodes = String(
    contract.nodes.filter((node) =>
      Array.isArray(node.metadata?.gltfNodeMatrix)
      && node.metadata.gltfNodeMatrix.length === 16,
    ).length,
  );
  viewer.canvas.dataset.gltfAnimations = String(internal.loadedGltfAnimations?.length ?? 0);

  if (new URLSearchParams(location.search).get('gltfDiagnostics') !== '1') return;
  if (internal.gltfDiagnosticFrame != null) cancelAnimationFrame(internal.gltfDiagnosticFrame);
  const updatePose = () => {
    const signature: number[] = [];
    internal.modelRoot?.traverse((object) => {
      if (!(object as THREE.Bone).isBone || signature.length >= 16) return;
      signature.push(
        Number(object.quaternion.x.toFixed(5)),
        Number(object.quaternion.y.toFixed(5)),
        Number(object.quaternion.z.toFixed(5)),
        Number(object.quaternion.w.toFixed(5)),
      );
    });
    viewer.canvas.dataset.gltfBonePose = signature.join(',');
    if (viewer.canvas.isConnected) {
      internal.gltfDiagnosticFrame = requestAnimationFrame(updatePose);
    }
  };
  updatePose();
}

function ensureMaterialObserver(viewer: KyxosViewer, contract: KyxosSceneContract): void {
  const internal = internals(viewer);
  internal.gltfMaterialObserver?.disconnect();
  const observer = new MutationObserver(() => {
    if (viewer.canvas.dataset.authoringMaterials !== 'proxy') return;
    queueMicrotask(() => {
      restoreNativeMaterials(viewer, contract);
      publishFidelityDiagnostics(viewer, contract);
      internal.editorNeedsRender = true;
    });
  });
  observer.observe(viewer.canvas, {
    attributes: true,
    attributeFilter: ['data-authoring-materials'],
  });
  internal.gltfMaterialObserver = observer;
}

export function installGltfAuthoringFidelityExtension(
  ViewerClass: typeof KyxosViewer,
): void {
  const prototype = ViewerClass.prototype as unknown as ViewerPrototype;
  if (prototype.__kyxosGltfAuthoringFidelityInstalled) return;
  const originalLoadScene = prototype.loadScene;
  const originalDispose = prototype.dispose;

  prototype.loadScene = async function loadSceneWithExactGltf(
    this: KyxosViewer,
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    await originalLoadScene.call(this, scene, resolver);
    const restoredNodes = restoreNativeHierarchy(this, scene);
    const restoredMaterials = restoreNativeMaterials(this, scene);
    ensureMaterialObserver(this, scene);
    publishFidelityDiagnostics(this, scene);
    const internal = internals(this);
    internal.editorNeedsRender = true;
    this.canvas.dataset.gltfNativeNodes = String(restoredNodes);
    this.canvas.dataset.gltfNativeMaterials = String(restoredMaterials);
    internal.resetTemporal?.('gltf-native-fidelity');
  };

  prototype.dispose = function disposeGltfFidelity(this: KyxosViewer): void {
    const internal = internals(this);
    internal.gltfMaterialObserver?.disconnect();
    internal.gltfMaterialObserver = undefined;
    if (internal.gltfDiagnosticFrame != null) {
      cancelAnimationFrame(internal.gltfDiagnosticFrame);
      internal.gltfDiagnosticFrame = undefined;
    }
    originalDispose.call(this);
  };

  prototype.__kyxosGltfAuthoringFidelityInstalled = true;
}
