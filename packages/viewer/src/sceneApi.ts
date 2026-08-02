import * as THREE from 'three/webgpu';
import {
  KYXOS_SCENE_CONTRACT_VERSION,
  KYXOS_VIEWER_API_VERSION,
  assertSceneContract,
  cloneSceneContract,
  type AssetResolver,
  type JsonPatchOperation,
  type KyxosSceneContract,
  type SceneCamera,
  type SceneEnvironment,
  type SceneMaterial,
  type SceneNode,
  type ScenePatch,
  type SceneRenderSettings,
  type TextureRef,
  type Transform,
  type ViewerCapabilityDescription,
} from '@kyxos/scene-contract';
import { migrateSceneContract } from '@kyxos/scene-migrations';
import { KyxosViewer } from './KyxosViewer';
import type { AnimationState, CameraState, PickResult } from './sceneTypes';

interface RuntimeSceneState {
  contract: KyxosSceneContract | null;
  nodes: Map<string, THREE.Object3D>;
  detached: Map<string, THREE.Object3D>;
  resolver: AssetResolver | null;
}

interface MaterialBinding {
  owner: THREE.Mesh;
  index: number;
  material: THREE.MeshStandardMaterial;
}

const runtimeState = new WeakMap<KyxosViewer, RuntimeSceneState>();
const textureLoader = new THREE.TextureLoader();

function state(viewer: KyxosViewer): RuntimeSceneState {
  let current = runtimeState.get(viewer);
  if (!current) {
    current = {
      contract: null,
      nodes: new Map(),
      detached: new Map(),
      resolver: null,
    };
    runtimeState.set(viewer, current);
  }
  return current;
}

function internals(viewer: KyxosViewer): Record<string, any> {
  return viewer as unknown as Record<string, any>;
}

function decodePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerParts(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error(`Invalid Scene Patch path: ${path}`);
  return path.slice(1).split('/').map(decodePointer);
}

function getAt(root: unknown, path: string): unknown {
  let value: any = root;
  for (const part of pointerParts(path)) {
    if (value == null || typeof value !== 'object') {
      throw new Error(`Scene Patch path is missing: ${path}`);
    }
    value = value[Array.isArray(value) ? Number(part) : part];
  }
  return value;
}

function getParent(root: unknown, path: string): { parent: any; key: string } {
  const parts = pointerParts(path);
  if (!parts.length) {
    throw new Error('Replacing the Scene Contract root is not supported by applyScenePatch().');
  }
  let parent: any = root;
  for (const part of parts.slice(0, -1)) {
    if (parent == null || typeof parent !== 'object') {
      throw new Error(`Scene Patch path is missing: ${path}`);
    }
    parent = parent[Array.isArray(parent) ? Number(part) : part];
  }
  return { parent, key: parts.at(-1)! };
}

function removeAt(parent: any, key: string): unknown {
  if (Array.isArray(parent)) {
    if (key === '-') throw new Error('The append token cannot be used for removal.');
    return parent.splice(Number(key), 1)[0];
  }
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
  if (operation.op === 'test') {
    if (JSON.stringify(getAt(root, operation.path)) !== JSON.stringify(operation.value)) {
      throw new Error(`Scene Patch test failed at ${operation.path}.`);
    }
    return;
  }
  if (operation.op === 'move' || operation.op === 'copy') {
    const value = structuredClone(getAt(root, operation.from));
    if (operation.op === 'move') {
      const source = getParent(root, operation.from);
      removeAt(source.parent, source.key);
    }
    const target = getParent(root, operation.path);
    setAt(target.parent, target.key, value, true);
    return;
  }
  const target = getParent(root, operation.path);
  if (operation.op === 'remove') {
    removeAt(target.parent, target.key);
  } else if (operation.op === 'add' || operation.op === 'replace') {
    setAt(
      target.parent,
      target.key,
      structuredClone(operation.value),
      operation.op === 'add',
    );
  }
}

function applyPatchToContract(
  contract: KyxosSceneContract,
  patch: ScenePatch,
): KyxosSceneContract {
  const next = cloneSceneContract(contract);
  for (const operation of patch) applyOperation(next, operation);
  next.metadata.updatedAt = new Date().toISOString();
  assertSceneContract(next);
  return next;
}

function modelCandidates(viewer: KyxosViewer): THREE.Object3D[] {
  const root = internals(viewer).modelRoot as THREE.Object3D;
  const candidates: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object !== root && !object.userData.kyxosToolOverlay) candidates.push(object);
  });
  return candidates;
}

function matchingSourceNode(
  contract: KyxosSceneContract,
  node: SceneNode,
  mapped: Map<string, THREE.Object3D>,
): THREE.Object3D | null {
  const sourceIndex = node.metadata?.gltfNodeIndex;
  for (const candidate of contract.nodes) {
    if (candidate.id === node.id) continue;
    if (
      sourceIndex != null &&
      candidate.metadata?.gltfNodeIndex === sourceIndex &&
      mapped.has(candidate.id)
    ) {
      return mapped.get(candidate.id)!;
    }
    if (
      node.meshAssetId &&
      candidate.meshAssetId === node.meshAssetId &&
      candidate.meshIndex === node.meshIndex &&
      mapped.has(candidate.id)
    ) {
      return mapped.get(candidate.id)!;
    }
  }
  return null;
}

function clearNodeMarkers(object: THREE.Object3D): void {
  object.traverse((entry) => {
    delete entry.userData.kyxosNodeId;
  });
}

function assignContractNodes(viewer: KyxosViewer, contract: KyxosSceneContract): void {
  const current = state(viewer);
  const modelRoot = internals(viewer).modelRoot as THREE.Object3D;
  const previous = current.nodes;
  const requestedIds = new Set(contract.nodes.map((node) => node.id));

  for (const [nodeId, object] of previous) {
    if (requestedIds.has(nodeId)) continue;
    object.removeFromParent();
    current.detached.set(nodeId, object);
  }

  const candidates = modelCandidates(viewer);
  const claimed = new Set<THREE.Object3D>();
  for (const object of previous.values()) claimed.add(object);
  for (const object of current.detached.values()) claimed.add(object);

  const mapped = new Map<string, THREE.Object3D>();
  for (const node of contract.nodes) {
    let object = previous.get(node.id) ?? current.detached.get(node.id) ?? null;
    if (object) current.detached.delete(node.id);

    if (!object) {
      object =
        candidates.find(
          (candidate) => !claimed.has(candidate) && candidate.name === node.name,
        ) ?? null;
    }
    if (!object) {
      const source = matchingSourceNode(contract, node, new Map([...previous, ...mapped]));
      if (source) {
        object = source.clone(false);
        clearNodeMarkers(object);
        object.name = node.name;
      }
    }
    if (!object) {
      object = candidates.find((candidate) => !claimed.has(candidate)) ?? null;
    }
    if (!object) {
      viewer.dispatchEvent(
        new CustomEvent('warning', {
          detail: {
            message: `Scene node ${node.name} could not be mapped to a runtime object.`,
          },
        }),
      );
      continue;
    }

    claimed.add(object);
    object.userData.kyxosNodeId = node.id;
    mapped.set(node.id, object);
  }

  for (const node of contract.nodes) {
    const object = mapped.get(node.id);
    if (!object) continue;
    const parent = node.parentId ? mapped.get(node.parentId) : modelRoot;
    if (parent && object.parent !== parent) parent.add(object);
  }

  for (const node of contract.nodes) {
    const object = mapped.get(node.id);
    if (!object) continue;
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
    if (node.morphWeights?.length) {
      object.traverse((entry) => {
        const mesh = entry as THREE.Mesh & { morphTargetInfluences?: number[] };
        if (!mesh.morphTargetInfluences) return;
        for (let index = 0; index < mesh.morphTargetInfluences.length; index += 1) {
          mesh.morphTargetInfluences[index] = node.morphWeights?.[index] ?? 0;
        }
      });
    }
    object.updateMatrix();
  }
  modelRoot.updateMatrixWorld(true);
  current.nodes = mapped;
}

function collectMaterialBindings(object: THREE.Object3D): MaterialBinding[] {
  const bindings: MaterialBinding[] = [];
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material, index) => {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial || (standard as any).isMeshPhysicalMaterial) {
        bindings.push({ owner: mesh, index, material: standard });
      }
    });
  });
  return bindings;
}

function ensureOwnedMaterial(binding: MaterialBinding): THREE.MeshStandardMaterial {
  if (binding.material.userData.kyxosSceneMaterial) return binding.material;
  const clone = binding.material.clone();
  clone.userData.kyxosSceneMaterial = true;
  if (Array.isArray(binding.owner.material)) {
    const materials = [...binding.owner.material];
    materials[binding.index] = clone;
    binding.owner.material = materials;
  } else {
    binding.owner.material = clone;
  }
  binding.material = clone;
  return clone;
}

async function loadTexture(
  viewer: KyxosViewer,
  reference: TextureRef,
): Promise<THREE.Texture | null> {
  const current = state(viewer);
  if (!current.resolver || !current.contract) return null;
  const asset = current.contract.assets[reference.assetId];
  if (!asset) return null;
  const texture = await textureLoader.loadAsync(await current.resolver.resolve(asset));
  texture.userData.kyxosManagedTexture = true;
  texture.colorSpace =
    reference.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrapping = {
    repeat: THREE.RepeatWrapping,
    clamp: THREE.ClampToEdgeWrapping,
    mirror: THREE.MirroredRepeatWrapping,
  } as const;
  texture.wrapS = wrapping[reference.wrapS ?? 'repeat'];
  texture.wrapT = wrapping[reference.wrapT ?? 'repeat'];
  texture.channel = Math.max(0, Math.trunc(reference.texCoord ?? 0));
  const minFilters: Record<string, THREE.MinificationTextureFilter> = {
    nearest: THREE.NearestFilter,
    linear: THREE.LinearFilter,
    nearestMipNearest: THREE.NearestMipmapNearestFilter,
    linearMipNearest: THREE.LinearMipmapNearestFilter,
    nearestMipLinear: THREE.NearestMipmapLinearFilter,
    linearMipLinear: THREE.LinearMipmapLinearFilter,
  };
  const magFilters: Record<string, THREE.MagnificationTextureFilter> = {
    nearest: THREE.NearestFilter,
    linear: THREE.LinearFilter,
  };
  texture.minFilter = minFilters[reference.minFilter ?? 'linearMipLinear'] ?? THREE.LinearMipmapLinearFilter;
  texture.magFilter = magFilters[reference.magFilter ?? 'linear'] ?? THREE.LinearFilter;
  texture.offset.set(reference.offset?.x ?? 0, reference.offset?.y ?? 0);
  texture.repeat.set(reference.scale?.x ?? 1, reference.scale?.y ?? 1);
  texture.rotation = reference.rotation ?? 0;
  texture.needsUpdate = true;
  return texture;
}

function replaceManagedTexture(
  material: THREE.MeshStandardMaterial,
  property: string,
  texture: THREE.Texture | null,
): void {
  const previous = (material as any)[property] as THREE.Texture | null | undefined;
  if (previous?.userData.kyxosManagedTexture && previous !== texture) previous.dispose();
  (material as any)[property] = texture;
}

async function applyMaterialToReferences(
  viewer: KyxosViewer,
  contract: KyxosSceneContract,
  materialId: string,
): Promise<void> {
  const material = contract.materials[materialId];
  if (!material) return;
  for (const node of contract.nodes) {
    const slots = node.materialSlots ?? [];
    for (let slot = 0; slot < slots.length; slot += 1) {
      if (slots[slot] === materialId) await viewer.setMaterial(node.id, slot, material);
    }
  }
}

function semverParts(value: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = value.split(/[+-]/)[0].split('.').map(Number);
  return [major, minor, patch];
}

function compareSemver(left: string, right: string): number {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export async function loadScene(
  this: KyxosViewer,
  input: KyxosSceneContract,
  resolver: AssetResolver,
): Promise<void> {
  const contract = migrateSceneContract(input);
  const compatibility = this.validateCompatibility(contract);
  if (!compatibility.compatible) {
    throw new Error(compatibility.reason ?? 'Scene Contract is incompatible.');
  }
  assertSceneContract(contract);

  const current = state(this);
  current.resolver = resolver;

  const model = Object.values(contract.assets).find((asset) => asset.kind === 'model');
  if (model) {
    const extensions = Array.isArray(model.metadata?.extensionsUsed)
      ? model.metadata.extensionsUsed.map(String)
      : [];
    await this.loadModel(await resolver.resolve(model), {
      ktx2: extensions.includes('KHR_texture_basisu'),
    });
  }

  const environmentAsset = contract.environment.assetId
    ? contract.assets[contract.environment.assetId]
    : undefined;
  if (environmentAsset) await this.loadEnvironment(await resolver.resolve(environmentAsset));
  else await this.restoreStudioEnvironment();

  current.contract = cloneSceneContract(contract);
  current.detached.clear();
  current.nodes.clear();
  assignContractNodes(this, contract);

  for (const materialId of Object.keys(contract.materials)) {
    await applyMaterialToReferences(this, contract, materialId);
  }
  if (contract.activeMaterialVariantId) {
    await this.setMaterialVariant(contract.activeMaterialVariantId);
  }

  this.setCameraState(
    contract.cameras.find((camera) => camera.id === contract.activeCameraId) ??
      contract.cameras[0],
  );
  this.setEnvironment(contract.environment);
  this.setRenderSettings(contract.renderSettings);
  this.dispatchEvent(new CustomEvent('scene-loaded', { detail: { id: contract.id } }));
}

export async function applyScenePatch(
  this: KyxosViewer,
  patch: ScenePatch,
): Promise<void> {
  const current = state(this);
  if (!current.contract) throw new Error('No Scene Contract is loaded.');
  const next = applyPatchToContract(current.contract, patch);
  current.contract = next;

  const materialIds = new Set<string>();
  let hierarchyChanged = false;
  let environmentChanged = false;
  let environmentAssetChanged = false;
  let cameraChanged = false;
  let renderChanged = false;
  let variantChanged = false;

  for (const operation of patch) {
    const nodeMatch = operation.path.match(
      /^\/nodes\/(\d+)\/(transform|visible|parentId|children|morphWeights|materialSlots)/,
    );
    if (nodeMatch) {
      const node = next.nodes[Number(nodeMatch[1])];
      if (node && nodeMatch[2] === 'visible') this.setNodeVisibility(node.id, node.visible);
      else if (node && nodeMatch[2] === 'transform') this.setNodeTransform(node.id, node.transform);
      else if (node && nodeMatch[2] === 'morphWeights') this.applyNodeMorphWeights(node.id, node.morphWeights ?? []);
      else if (node && nodeMatch[2] === 'materialSlots') {
        for (const materialId of node.materialSlots ?? []) materialIds.add(materialId);
      } else hierarchyChanged = true;
    } else if (operation.path === '/nodes' || /^\/nodes\/(\d+|-)$/.test(operation.path)) {
      hierarchyChanged = true;
    }

    const materialMatch = operation.path.match(/^\/materials\/([^/]+)/);
    if (materialMatch) materialIds.add(decodePointer(materialMatch[1]));
    if (operation.path.startsWith('/environment')) {
      environmentChanged = true;
      if (operation.path === '/environment/assetId') environmentAssetChanged = true;
    }
    if (operation.path.startsWith('/cameras') || operation.path === '/activeCameraId') {
      cameraChanged = true;
    }
    if (operation.path.startsWith('/renderSettings')) renderChanged = true;
    if (operation.path === '/activeMaterialVariantId') variantChanged = true;
  }

  if (hierarchyChanged) assignContractNodes(this, next);
  for (const materialId of materialIds) {
    await applyMaterialToReferences(this, next, materialId);
  }
  if (environmentAssetChanged) {
    const assetId = next.environment.assetId;
    if (assetId) {
      const asset = next.assets[assetId];
      if (asset && current.resolver) {
        await this.loadEnvironment(await current.resolver.resolve(asset));
      }
    } else {
      await this.restoreStudioEnvironment();
    }
  }
  if (environmentChanged) this.setEnvironment(next.environment);
  if (cameraChanged) {
    this.setCameraState(
      next.cameras.find((camera) => camera.id === next.activeCameraId) ?? next.cameras[0],
    );
  }
  if (renderChanged) this.setRenderSettings(next.renderSettings);
  if (variantChanged) await this.setMaterialVariant(next.activeMaterialVariantId);

  this.dispatchEvent(new CustomEvent('scene-patch', { detail: { patch } }));
}

export function getCapabilities(this: KyxosViewer): ViewerCapabilityDescription {
  const backend = this.getMetrics().backend;
  const effects = Object.fromEntries(
    Object.keys(this.getEffects()).map((name) => [name, { available: true }]),
  );
  return {
    viewerApiVersion: KYXOS_VIEWER_API_VERSION,
    sceneContract: { min: '1.0.0', max: KYXOS_SCENE_CONTRACT_VERSION },
    backend,
    effects,
    textureFormats: ['png', 'jpeg', 'webp', 'ktx2', 'hdr', 'exr'],
    maxTextureSize: Number(internals(this).renderer?.capabilities?.maxTextureSize ?? 8192),
    animation: { clips: true, seek: true, speed: true, stateGraph: true, blendTrees: true },
    picking: { available: true, multiSelect: true },
  };
}

export function validateCompatibility(
  this: KyxosViewer,
  contract: KyxosSceneContract,
): { compatible: boolean; reason?: string } {
  const capabilities = this.getCapabilities();
  if (compareSemver(contract.contractVersion, capabilities.sceneContract.max) > 0) {
    return {
      compatible: false,
      reason: `Contract ${contract.contractVersion} is newer than supported ${capabilities.sceneContract.max}.`,
    };
  }
  if (compareSemver(contract.contractVersion, capabilities.sceneContract.min) < 0) {
    return {
      compatible: false,
      reason: `Contract ${contract.contractVersion} must be migrated from below ${capabilities.sceneContract.min}.`,
    };
  }
  if (compareSemver(KYXOS_VIEWER_API_VERSION, contract.compatibility.viewerApiMin) < 0) {
    return {
      compatible: false,
      reason: `Viewer API ${KYXOS_VIEWER_API_VERSION} is below required ${contract.compatibility.viewerApiMin}.`,
    };
  }
  if (
    contract.compatibility.viewerApiMax &&
    compareSemver(KYXOS_VIEWER_API_VERSION, contract.compatibility.viewerApiMax) > 0
  ) {
    return {
      compatible: false,
      reason: `Viewer API ${KYXOS_VIEWER_API_VERSION} exceeds supported ${contract.compatibility.viewerApiMax}.`,
    };
  }
  for (const requirement of contract.capabilities) {
    if (!requirement.required) continue;
    if (
      requirement.name.startsWith('effect:') &&
      !capabilities.effects[requirement.name.slice('effect:'.length)]?.available
    ) {
      return {
        compatible: false,
        reason: `Required capability ${requirement.name} is unavailable.`,
      };
    }
  }
  return { compatible: true };
}

export function getLoadedSceneContract(
  this: KyxosViewer,
): KyxosSceneContract | null {
  const contract = state(this).contract;
  return contract ? cloneSceneContract(contract) : null;
}

export function getNodeState(this: KyxosViewer, nodeId: string) {
  const object = state(this).nodes.get(nodeId);
  if (!object) return null;
  return {
    id: nodeId,
    visible: object.visible,
    transform: {
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
      scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
    },
  };
}

export function setNodeTransform(
  this: KyxosViewer,
  nodeId: string,
  transform: Transform,
): void {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  object.updateMatrix();
  object.updateMatrixWorld(true);
  this.dispatchEvent(new CustomEvent('node-transform', { detail: { nodeId, transform } }));
}

export function setNodeVisibility(
  this: KyxosViewer,
  nodeId: string,
  visible: boolean,
): void {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  object.visible = visible;
  this.dispatchEvent(new CustomEvent('node-visibility', { detail: { nodeId, visible } }));
}

export async function setMaterial(
  this: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
): Promise<void> {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  const bindings = collectMaterialBindings(object);
  const binding = bindings[slot] ?? (slot === 0 ? bindings[0] : undefined);
  if (!binding) return;
  const target = ensureOwnedMaterial(binding);

  target.color.setRGB(material.baseColor.x, material.baseColor.y, material.baseColor.z);
  target.opacity = material.opacity;
  target.transparent = material.alphaMode === 'blend';
  target.alphaTest = material.alphaMode === 'mask' ? material.alphaCutoff ?? 0.5 : 0;
  target.metalness = material.metalness;
  target.roughness = material.roughness;
  target.normalScale.setScalar(material.normalScale ?? 1);
  target.emissive.setRGB(material.emissive.x, material.emissive.y, material.emissive.z);
  target.emissiveIntensity = material.emissiveIntensity ?? 1;
  target.side = material.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

  const textureMappings = [
    ['baseColorTexture', 'map'],
    ['normalTexture', 'normalMap'],
    ['roughnessTexture', 'roughnessMap'],
    ['metalnessTexture', 'metalnessMap'],
    ['emissiveTexture', 'emissiveMap'],
    ['aoTexture', 'aoMap'],
  ] as const;
  for (const [sourceKey, targetKey] of textureMappings) {
    const reference = material[sourceKey];
    if (reference) {
      replaceManagedTexture(target, targetKey, await loadTexture(this, reference));
    } else if ((target as any)[targetKey]?.userData?.kyxosManagedTexture) {
      replaceManagedTexture(target, targetKey, null);
    }
  }
  if ((target as any).isMeshPhysicalMaterial) {
    const physical = target as THREE.MeshPhysicalMaterial;
    physical.clearcoat = material.clearcoat ?? physical.clearcoat;
    physical.clearcoatRoughness = material.clearcoatRoughness ?? physical.clearcoatRoughness;
    physical.transmission = material.transmission ?? physical.transmission;
    physical.thickness = material.thickness ?? physical.thickness;
    physical.attenuationDistance = material.attenuationDistance ?? physical.attenuationDistance;
    if (material.attenuationColor) {
      physical.attenuationColor.setRGB(
        material.attenuationColor.x,
        material.attenuationColor.y,
        material.attenuationColor.z,
      );
    }
    physical.ior = material.ior ?? physical.ior;
    physical.sheen = material.sheenColor ? 1 : physical.sheen;
    if (material.sheenColor) {
      physical.sheenColor.setRGB(
        material.sheenColor.x,
        material.sheenColor.y,
        material.sheenColor.z,
      );
    }
    physical.sheenRoughness = material.sheenRoughness ?? physical.sheenRoughness;
    physical.specularIntensity = material.specularIntensity ?? physical.specularIntensity;
    if (material.specularColor) {
      physical.specularColor.setRGB(
        material.specularColor.x,
        material.specularColor.y,
        material.specularColor.z,
      );
    }
  }
  target.needsUpdate = true;
  this.dispatchEvent(
    new CustomEvent('material-change', { detail: { nodeId, slot, materialId: material.id } }),
  );
}

export function applyNodeMorphWeights(
  this: KyxosViewer,
  nodeId: string,
  weights: number[],
): void {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh & { morphTargetInfluences?: number[] };
    if (!mesh.morphTargetInfluences) return;
    for (let index = 0; index < mesh.morphTargetInfluences.length; index += 1) {
      mesh.morphTargetInfluences[index] = weights[index] ?? 0;
    }
  });
  this.resetTemporal('morph-weights');
}

export async function setMaterialVariant(
  this: KyxosViewer,
  variantId?: string,
): Promise<void> {
  const current = state(this);
  if (!current.contract) return;
  current.contract.activeMaterialVariantId = variantId;
  for (const node of current.contract.nodes) {
    const slots = (variantId && node.materialVariantBindings?.[variantId]) ?? node.materialSlots ?? [];
    for (let index = 0; index < slots.length; index += 1) {
      const material = current.contract.materials[slots[index]];
      if (material) await this.setMaterial(node.id, index, material);
    }
  }
  this.resetTemporal('material-variant');
  this.dispatchEvent(new CustomEvent('material-variant', { detail: { variantId } }));
}

export function setAnimationState(
  this: KyxosViewer,
  animation: AnimationState,
): void {
  this.setAnimationEnabled(animation.playing);
  internals(this).animationState = structuredClone(animation);
}

export function setCameraState(
  this: KyxosViewer,
  camera?: SceneCamera | CameraState,
): void {
  if (!camera) return;
  const internal = internals(this);
  const controls = internal.controls;
  const wantsOrthographic = 'projection' in camera && camera.projection === 'orthographic';
  const current = internal.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  let target = current;
  if (wantsOrthographic !== current.isOrthographicCamera) {
    target = wantsOrthographic
      ? new THREE.OrthographicCamera(-1, 1, 1, -1, camera.near, camera.far)
      : new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far);
    target.name = 'Kyxos.SceneCamera';
    internal.camera = target;
    controls.object = target;
  }
  target.position.set(
    camera.transform.position.x,
    camera.transform.position.y,
    camera.transform.position.z,
  );
  if (target instanceof THREE.PerspectiveCamera) target.fov = camera.fov;
  if (target instanceof THREE.OrthographicCamera) {
    target.userData.kyxosOrthographicSize =
      'orthographicSize' in camera ? camera.orthographicSize ?? 1 : 1;
  }
  target.near = camera.near;
  target.far = camera.far;
  internal.resizeToCanvas();
  controls.target.set(camera.target.x, camera.target.y, camera.target.z);
  controls.autoRotate = Boolean(camera.autoRotate);
  if ('orbit' in camera && camera.orbit) {
    controls.minDistance = camera.orbit.minDistance ?? controls.minDistance;
    controls.maxDistance = camera.orbit.maxDistance ?? controls.maxDistance;
    controls.minPolarAngle = camera.orbit.minPolarAngle ?? controls.minPolarAngle;
    controls.maxPolarAngle = camera.orbit.maxPolarAngle ?? controls.maxPolarAngle;
  }
  controls.update();
  this.resetTemporal('scene-camera');
}

export function setEnvironment(
  this: KyxosViewer,
  environment: SceneEnvironment,
): void {
  const internal = internals(this);
  const scene = internal.scene as THREE.Scene;
  scene.environmentIntensity = environment.intensity;
  scene.backgroundIntensity = environment.backgroundIntensity;
  scene.backgroundBlurriness = environment.backgroundBlur;
  if ('environmentRotation' in scene) {
    (scene as any).environmentRotation = new THREE.Euler(0, environment.rotation, 0);
  }
  if ('backgroundRotation' in scene) {
    (scene as any).backgroundRotation = new THREE.Euler(0, environment.rotation, 0);
  }
  internal.renderer?.setClearColor?.(
    new THREE.Color(environment.backgroundColor),
    environment.transparentBackground ? 0 : 1,
  );
  this.canvas.style.background = environment.transparentBackground
    ? 'transparent'
    : environment.backgroundColor;
  this.resetTemporal('scene-environment');
}

export function setRenderSettings(
  this: KyxosViewer,
  settings: SceneRenderSettings,
): void {
  this.setQualityPreset(settings.qualityPreset);
  const renderer = internals(this).renderer;
  renderer.toneMappingExposure = settings.exposure;
  const toneMappings: Record<string, unknown> = {
    AgX: THREE.AgXToneMapping,
    ACES: THREE.ACESFilmicToneMapping,
    Neutral: (THREE as any).NeutralToneMapping,
    Linear: THREE.LinearToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
  };
  if (toneMappings[settings.toneMapping] != null) {
    renderer.toneMapping = toneMappings[settings.toneMapping];
  }
  for (const [name, value] of Object.entries(settings.effects)) {
    if (value) this.setEffect(name as any, value as any);
  }
}

export function pick(
  this: KyxosViewer,
  screenX: number,
  screenY: number,
): PickResult | null {
  const internal = internals(this);
  const rect = this.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const pointer = new THREE.Vector2(
    ((screenX - rect.left) / rect.width) * 2 - 1,
    -((screenY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, internal.camera);
  for (const hit of raycaster.intersectObject(internal.modelRoot, true)) {
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.kyxosNodeId) object = object.parent;
    if (object?.userData.kyxosNodeId) {
      return {
        nodeId: object.userData.kyxosNodeId,
        distance: hit.distance,
        point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      };
    }
  }
  return null;
}

export function frameNode(this: KyxosViewer, nodeId: string): void {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  const internal = internals(this);
  const sphere = new THREE.Box3()
    .setFromObject(object)
    .getBoundingSphere(new THREE.Sphere());
  internal.controls.target.copy(sphere.center);
  const direction = internal.camera.position
    .clone()
    .sub(sphere.center)
    .normalize();
  internal.camera.position
    .copy(sphere.center)
    .add(direction.multiplyScalar(Math.max(sphere.radius * 2.7, 1)));
  internal.controls.update();
  this.resetTemporal('frame-node');
}

export function resize(this: KyxosViewer, width: number, height: number): void {
  this.canvas.style.width = `${Math.max(1, width)}px`;
  this.canvas.style.height = `${Math.max(1, height)}px`;
  internals(this).resizeToCanvas();
  this.resetTemporal('external-resize');
}

export function resetCamera(this: KyxosViewer): void {
  const internal = internals(this);
  internal.camera.position.set(3.4, 2.4, 4.8);
  internal.controls.target.set(0, 0.9, 0);
  internal.controls.update();
  this.resetTemporal('camera-reset');
}

Object.assign(KyxosViewer.prototype, {
  loadScene,
  applyScenePatch,
  getCapabilities,
  validateCompatibility,
  getLoadedSceneContract,
  getNodeState,
  setNodeTransform,
  setNodeVisibility,
  setMaterial,
  applyNodeMorphWeights,
  setMaterialVariant,
  setAnimationState,
  setCameraState,
  setEnvironment,
  setRenderSettings,
  pick,
  frameNode,
  resize,
  resetCamera,
});

declare module './KyxosViewer' {
  interface KyxosViewer {
    loadScene(scene: KyxosSceneContract, assetResolver: AssetResolver): Promise<void>;
    applyScenePatch(patch: ScenePatch): Promise<void>;
    getCapabilities(): ViewerCapabilityDescription;
    validateCompatibility(scene: KyxosSceneContract): {
      compatible: boolean;
      reason?: string;
    };
    getLoadedSceneContract(): KyxosSceneContract | null;
    getNodeState(nodeId: string): ReturnType<typeof getNodeState>;
    setNodeTransform(nodeId: string, transform: Transform): void;
    setNodeVisibility(nodeId: string, visible: boolean): void;
    setMaterial(nodeId: string, slot: number, material: SceneMaterial): Promise<void>;
    applyNodeMorphWeights(nodeId: string, weights: number[]): void;
    setMaterialVariant(variantId?: string): Promise<void>;
    setAnimationState(animation: AnimationState): void;
    setCameraState(camera: SceneCamera | CameraState): void;
    setEnvironment(environment: SceneEnvironment): void;
    setRenderSettings(settings: SceneRenderSettings): void;
    pick(screenX: number, screenY: number): PickResult | null;
    frameNode(nodeId: string): void;
    resize(width: number, height: number): void;
    resetCamera(): void;
  }
}
