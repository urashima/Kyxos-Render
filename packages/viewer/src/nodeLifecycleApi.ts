import * as THREE from 'three/webgpu';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type {
  AssetResolver,
  JsonPatchOperation,
  KyxosSceneContract,
  SceneNode,
  ScenePatch,
} from '@kyxos/scene-contract';
import { KyxosViewer } from './KyxosViewer';

interface NodeLifecycleState {
  contract: KyxosSceneContract | null;
  objects: Map<string, THREE.Object3D>;
  archived: Map<string, THREE.Object3D>;
}

const lifecycleStates = new WeakMap<KyxosViewer, NodeLifecycleState>();

function state(viewer: KyxosViewer): NodeLifecycleState {
  let current = lifecycleStates.get(viewer);
  if (!current) {
    current = {
      contract: null,
      objects: new Map(),
      archived: new Map(),
    };
    lifecycleStates.set(viewer, current);
  }
  return current;
}

function internals(viewer: KyxosViewer): Record<string, any> {
  return viewer as unknown as Record<string, any>;
}

function decodePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerParts(path: string): string[] {
  if (!path) return [];
  if (!path.startsWith('/')) throw new Error(`Invalid JSON Patch path: ${path}`);
  return path.slice(1).split('/').map(decodePointer);
}

function getAt(root: unknown, path: string): unknown {
  let value: any = root;
  for (const part of pointerParts(path)) {
    value = value?.[Array.isArray(value) ? Number(part) : part];
  }
  return value;
}

function parentAt(root: unknown, path: string): { parent: any; key: string } {
  const parts = pointerParts(path);
  if (!parts.length) throw new Error('Root Scene Contract replacement is unsupported.');
  let parent: any = root;
  for (const part of parts.slice(0, -1)) {
    parent = parent?.[Array.isArray(parent) ? Number(part) : part];
    if (parent == null) throw new Error(`JSON Patch path is missing: ${path}`);
  }
  return { parent, key: parts.at(-1)! };
}

function removeAt(parent: any, key: string): unknown {
  if (Array.isArray(parent)) return parent.splice(Number(key), 1)[0];
  const previous = parent[key];
  delete parent[key];
  return previous;
}

function setAt(parent: any, key: string, value: unknown, insert: boolean): void {
  if (Array.isArray(parent)) {
    if (key === '-') parent.push(value);
    else if (insert) parent.splice(Number(key), 0, value);
    else parent[Number(key)] = value;
  } else {
    parent[key] = value;
  }
}

function applyOperation(root: KyxosSceneContract, operation: JsonPatchOperation): void {
  if (operation.op === 'test') return;
  if (operation.op === 'move' || operation.op === 'copy') {
    const value = structuredClone(getAt(root, operation.from));
    if (operation.op === 'move') {
      const source = parentAt(root, operation.from);
      removeAt(source.parent, source.key);
    }
    const target = parentAt(root, operation.path);
    setAt(target.parent, target.key, value, true);
    return;
  }
  const target = parentAt(root, operation.path);
  if (operation.op === 'remove') removeAt(target.parent, target.key);
  else setAt(
    target.parent,
    target.key,
    structuredClone(operation.value),
    operation.op === 'add',
  );
}

function applyContractPatch(
  contract: KyxosSceneContract,
  patch: ScenePatch,
): KyxosSceneContract {
  const next = structuredClone(contract);
  for (const operation of patch) applyOperation(next, operation);
  return next;
}

function collectObjects(viewer: KyxosViewer): Map<string, THREE.Object3D> {
  const objects = new Map<string, THREE.Object3D>();
  const root = internals(viewer).modelRoot as THREE.Object3D | undefined;
  root?.traverse((object) => {
    const nodeId = object.userData.kyxosNodeId;
    if (typeof nodeId === 'string') objects.set(nodeId, object);
  });
  return objects;
}

function applyTransform(object: THREE.Object3D, node: SceneNode): void {
  object.position.set(
    node.transform.position.x,
    node.transform.position.y,
    node.transform.position.z,
  );
  object.rotation.set(
    node.transform.rotation.x,
    node.transform.rotation.y,
    node.transform.rotation.z,
  );
  object.scale.set(
    node.transform.scale.x,
    node.transform.scale.y,
    node.transform.scale.z,
  );
  object.visible = node.visible;
  object.name = node.name;
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function findDuplicateSource(
  node: SceneNode,
  previous: KyxosSceneContract,
  objects: Map<string, THREE.Object3D>,
): THREE.Object3D | undefined {
  const explicit = node.metadata?.duplicatedFrom;
  if (typeof explicit === 'string') return objects.get(explicit);
  const baseName = node.name.replace(/\s+Copy(?:\s+\d+)?$/, '');
  const sourceNode = previous.nodes.find(
    (candidate) =>
      candidate.name === baseName &&
      candidate.meshAssetId === node.meshAssetId &&
      candidate.meshIndex === node.meshIndex,
  ) ?? previous.nodes.find(
    (candidate) =>
      candidate.meshAssetId === node.meshAssetId &&
      candidate.meshIndex === node.meshIndex &&
      JSON.stringify(candidate.materialSlots ?? []) ===
        JSON.stringify(node.materialSlots ?? []),
  );
  return sourceNode ? objects.get(sourceNode.id) : undefined;
}

function synchronizeNodes(
  viewer: KyxosViewer,
  previous: KyxosSceneContract,
  next: KyxosSceneContract,
): void {
  const current = state(viewer);
  const root = internals(viewer).modelRoot as THREE.Object3D;
  const nextIds = new Set(next.nodes.map((node) => node.id));

  for (const previousNode of previous.nodes) {
    if (nextIds.has(previousNode.id)) continue;
    const object = current.objects.get(previousNode.id);
    if (!object) continue;
    current.archived.set(previousNode.id, object);
    object.removeFromParent();
    current.objects.delete(previousNode.id);
  }

  for (const node of next.nodes) {
    let object = current.objects.get(node.id);
    if (!object) {
      object = current.archived.get(node.id);
      if (object) current.archived.delete(node.id);
    }
    if (!object) {
      const source = findDuplicateSource(node, previous, current.objects);
      if (source) object = cloneSkeleton(source);
    }
    if (!object) continue;

    object.userData.kyxosNodeId = node.id;
    current.objects.set(node.id, object);
    const parent = node.parentId
      ? current.objects.get(node.parentId) ?? root
      : root;
    if (object.parent !== parent) parent.add(object);
    applyTransform(object, node);
  }

  root.updateMatrixWorld(true);
}

const originalLoadScene = KyxosViewer.prototype.loadScene;
KyxosViewer.prototype.loadScene = async function loadSceneWithNodeLifecycle(
  contract: KyxosSceneContract,
  resolver: AssetResolver,
): Promise<void> {
  await originalLoadScene.call(this, contract, resolver);
  const current = state(this);
  current.contract = structuredClone(contract);
  current.objects = collectObjects(this);
  current.archived.clear();
};

const originalApplyScenePatch = KyxosViewer.prototype.applyScenePatch;
KyxosViewer.prototype.applyScenePatch = async function applyPatchWithNodeLifecycle(
  patch: ScenePatch,
): Promise<void> {
  const current = state(this);
  const previous = current.contract
    ? structuredClone(current.contract)
    : null;
  await originalApplyScenePatch.call(this, patch);
  if (!previous) return;
  const next = applyContractPatch(previous, patch);
  if (patch.some((operation) => operation.path.startsWith('/nodes'))) {
    synchronizeNodes(this, previous, next);
  }
  current.contract = next;
  this.resetTemporal('node-lifecycle');
};
