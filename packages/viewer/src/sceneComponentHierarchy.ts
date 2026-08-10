import * as THREE from 'three/webgpu';
import type {
  KyxosSceneContract,
  SceneCamera,
  SceneNode,
  ScenePatch,
  Transform,
  Vec3,
} from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';
import type { CameraState } from './sceneTypes';

export interface ResolvedSceneTransform {
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface ViewerPrototypeInternals {
  setCameraState(camera?: SceneCamera | CameraState): void;
  applyScenePatch(patch: ScenePatch): Promise<void>;
  __kyxosSceneComponentHierarchyInstalled?: boolean;
}

function localMatrix(transform: Transform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(
      transform.position.x,
      transform.position.y,
      transform.position.z,
    ),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      'XYZ',
    )),
    new THREE.Vector3(
      transform.scale.x,
      transform.scale.y,
      transform.scale.z,
    ),
  );
}

function nodeChain(contract: KyxosSceneContract, nodeId: string): SceneNode[] | null {
  const byId = new Map(contract.nodes.map((node) => [node.id, node]));
  const chain: SceneNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);
  if (!current) return null;
  while (current) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse();
}

function decompose(matrix: THREE.Matrix4): ResolvedSceneTransform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { matrix, position, quaternion, scale };
}

export function resolveSceneNodeWorldTransform(
  contract: KyxosSceneContract,
  nodeId: string,
  fallback: Transform,
): ResolvedSceneTransform {
  const chain = nodeChain(contract, nodeId);
  if (!chain?.length) return decompose(localMatrix(fallback));
  const matrix = new THREE.Matrix4().identity();
  for (const node of chain) matrix.multiply(localMatrix(node.transform));
  return decompose(matrix);
}

export function resolveSceneNodeParentWorldMatrix(
  contract: KyxosSceneContract,
  nodeId: string,
): THREE.Matrix4 {
  const chain = nodeChain(contract, nodeId);
  if (!chain || chain.length <= 1) return new THREE.Matrix4().identity();
  const matrix = new THREE.Matrix4().identity();
  for (const node of chain.slice(0, -1)) matrix.multiply(localMatrix(node.transform));
  return matrix;
}

export function findSceneCameraNode(
  contract: KyxosSceneContract,
  cameraId: string,
): SceneNode | null {
  return contract.nodes.find((node) => node.cameraId === cameraId) ?? null;
}

export function findSceneLightNode(
  contract: KyxosSceneContract,
  lightId: string,
): SceneNode | null {
  return contract.nodes.find((node) => node.lightId === lightId) ?? null;
}

export function resolveSceneCameraWorldState(
  contract: KyxosSceneContract,
  camera: SceneCamera,
): SceneCamera {
  const node = findSceneCameraNode(contract, camera.id);
  if (!node) return structuredClone(camera);
  const resolved = resolveSceneNodeWorldTransform(contract, node.id, camera.transform);
  const rotation = new THREE.Euler().setFromQuaternion(resolved.quaternion, 'XYZ');
  const parentWorld = resolveSceneNodeParentWorldMatrix(contract, node.id);
  // Camera.target is authored in the same parent space as the camera position.
  // Transform it by ancestors only (not the camera's own local matrix) so an
  // authored rig can be translated/rotated as one hierarchy branch.
  const target = new THREE.Vector3(camera.target.x, camera.target.y, camera.target.z)
    .applyMatrix4(parentWorld);
  return {
    ...structuredClone(camera),
    transform: {
      position: { x: resolved.position.x, y: resolved.position.y, z: resolved.position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      scale: { x: resolved.scale.x, y: resolved.scale.y, z: resolved.scale.z },
    },
    target: { x: target.x, y: target.y, z: target.z },
  };
}

function isSceneCamera(camera?: SceneCamera | CameraState): camera is SceneCamera {
  return Boolean(camera && 'id' in camera && typeof camera.id === 'string');
}

function cameraDiagnostic(camera: SceneCamera): {
  id: string;
  position: Vec3;
  target: Vec3;
} {
  return {
    id: camera.id,
    position: structuredClone(camera.transform.position),
    target: structuredClone(camera.target),
  };
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototypeInternals;
if (!prototype.__kyxosSceneComponentHierarchyInstalled) {
  const originalSetCameraState = prototype.setCameraState;
  const originalApplyScenePatch = prototype.applyScenePatch;

  prototype.setCameraState = function setHierarchyAwareCameraState(
    this: KyxosViewer,
    camera?: SceneCamera | CameraState,
  ): void {
    if (!camera || !isSceneCamera(camera)) {
      originalSetCameraState.call(this, camera);
      return;
    }
    const contract = this.getLoadedSceneContract();
    const resolved = contract ? resolveSceneCameraWorldState(contract, camera) : camera;
    originalSetCameraState.call(this, resolved);
    this.canvas.dataset.managedCameraWorld = JSON.stringify(cameraDiagnostic(resolved));
  };

  prototype.applyScenePatch = async function applyHierarchyAwareScenePatch(
    this: KyxosViewer,
    patch: ScenePatch,
  ): Promise<void> {
    await originalApplyScenePatch.call(this, patch);
    if (!patch.some((operation) => operation.path.startsWith('/nodes'))) return;
    const contract = this.getLoadedSceneContract();
    const camera = contract?.cameras.find((entry) => entry.id === contract.activeCameraId)
      ?? contract?.cameras[0];
    if (camera) this.setCameraState(camera);
  };

  prototype.__kyxosSceneComponentHierarchyInstalled = true;
}
