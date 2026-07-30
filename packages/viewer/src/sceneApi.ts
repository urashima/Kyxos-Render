import * as THREE from 'three/webgpu';
import {
  KYXOS_SCENE_CONTRACT_VERSION,
  KYXOS_VIEWER_API_VERSION,
  assertSceneContract,
  type AssetResolver,
  type JsonPatchOperation,
  type KyxosSceneContract,
  type SceneCamera,
  type SceneEnvironment,
  type SceneMaterial,
  type ScenePatch,
  type SceneRenderSettings,
  type Transform,
  type ViewerCapabilityDescription,
} from '@kyxos/scene-contract';
import { migrateSceneContract } from '@kyxos/scene-migrations';
import { KyxosViewer } from './KyxosViewer';
import type { AnimationState, CameraState, PickResult } from './sceneTypes';

interface RuntimeSceneState {
  contract: KyxosSceneContract | null;
  nodes: Map<string, THREE.Object3D>;
  resolver: AssetResolver | null;
}

const runtimeState = new WeakMap<KyxosViewer, RuntimeSceneState>();

function state(viewer: KyxosViewer): RuntimeSceneState {
  let current = runtimeState.get(viewer);
  if (!current) {
    current = { contract: null, nodes: new Map(), resolver: null };
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
    if (value == null || typeof value !== 'object') throw new Error(`Scene Patch path is missing: ${path}`);
    value = value[Array.isArray(value) ? Number(part) : part];
  }
  return value;
}

function getParent(root: unknown, path: string): { parent: any; key: string } {
  const parts = pointerParts(path);
  if (!parts.length) throw new Error('Replacing the Scene Contract root is not supported by applyScenePatch().');
  let parent: any = root;
  for (const part of parts.slice(0, -1)) {
    if (parent == null || typeof parent !== 'object') throw new Error(`Scene Patch path is missing: ${path}`);
    parent = parent[Array.isArray(parent) ? Number(part) : part];
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
  if (operation.op === 'remove') removeAt(target.parent, target.key);
  else setAt(target.parent, target.key, structuredClone(operation.value), operation.op === 'add');
}

function applyPatchToContract(contract: KyxosSceneContract, patch: ScenePatch): KyxosSceneContract {
  const next = structuredClone(contract);
  for (const operation of patch) applyOperation(next, operation);
  next.metadata.updatedAt = new Date().toISOString();
  assertSceneContract(next);
  return next;
}

function objectMaterials(object: any): THREE.MeshStandardMaterial[] {
  if (!object?.material) return [];
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.filter((material: any) => material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial);
}

function assignContractNodes(viewer: KyxosViewer, contract: KyxosSceneContract): void {
  const current = state(viewer);
  current.nodes.clear();
  const root = internals(viewer).modelRoot as THREE.Object3D;
  const candidates: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object !== root) candidates.push(object);
  });
  const available = new Set(candidates);
  for (const node of contract.nodes) {
    let object = candidates.find((candidate) => available.has(candidate) && candidate.name === node.name);
    if (!object) object = [...available][0];
    if (!object) continue;
    available.delete(object);
    object.userData.kyxosNodeId = node.id;
    current.nodes.set(node.id, object);
    object.position.set(node.transform.position.x, node.transform.position.y, node.transform.position.z);
    object.rotation.set(node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z);
    object.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
    object.visible = node.visible;
  }
}

export async function loadScene(
  this: KyxosViewer,
  input: KyxosSceneContract,
  resolver: AssetResolver,
): Promise<void> {
  const contract = migrateSceneContract(input);
  const compatibility = this.validateCompatibility(contract);
  if (!compatibility.compatible) throw new Error(compatibility.reason ?? 'Scene Contract is incompatible.');
  assertSceneContract(contract);

  const model = Object.values(contract.assets).find((asset) => asset.kind === 'model');
  if (model) await this.loadModel(await resolver.resolve(model));

  const environmentAsset = contract.environment.assetId
    ? contract.assets[contract.environment.assetId]
    : undefined;
  if (environmentAsset) await this.loadEnvironment(await resolver.resolve(environmentAsset));

  const current = state(this);
  current.contract = structuredClone(contract);
  current.resolver = resolver;
  assignContractNodes(this, contract);

  for (const [materialId, material] of Object.entries(contract.materials)) {
    const node = contract.nodes.find((entry) => entry.materialSlots?.includes(materialId));
    if (node) await this.setMaterial(node.id, node.materialSlots!.indexOf(materialId), material);
  }

  this.setCameraState(
    contract.cameras.find((camera) => camera.id === contract.activeCameraId) ?? contract.cameras[0],
  );
  this.setEnvironment(contract.environment);
  this.setRenderSettings(contract.renderSettings);
  this.dispatchEvent(new CustomEvent('scene-loaded', { detail: { id: contract.id } }));
}

export async function applyScenePatch(this: KyxosViewer, patch: ScenePatch): Promise<void> {
  const current = state(this);
  if (!current.contract) throw new Error('No Scene Contract is loaded.');
  const next = applyPatchToContract(current.contract, patch);
  current.contract = next;

  const materialIds = new Set<string>();
  let reloadHierarchy = false;
  let environmentChanged = false;
  let cameraChanged = false;
  let renderChanged = false;

  for (const operation of patch) {
    const nodeMatch = operation.path.match(/^\/nodes\/(\d+)\/(transform|visible|parentId|children)/);
    if (nodeMatch) {
      const node = next.nodes[Number(nodeMatch[1])];
      if (node && nodeMatch[2] === 'visible') this.setNodeVisibility(node.id, node.visible);
      else if (node && nodeMatch[2] === 'transform') this.setNodeTransform(node.id, node.transform);
      else reloadHierarchy = true;
    }
    const materialMatch = operation.path.match(/^\/materials\/([^/]+)/);
    if (materialMatch) materialIds.add(decodePointer(materialMatch[1]));
    if (operation.path.startsWith('/environment')) environmentChanged = true;
    if (operation.path.startsWith('/cameras') || operation.path === '/activeCameraId') cameraChanged = true;
    if (operation.path.startsWith('/renderSettings')) renderChanged = true;
  }

  if (reloadHierarchy) assignContractNodes(this, next);
  for (const materialId of materialIds) {
    const material = next.materials[materialId];
    const node = next.nodes.find((entry) => entry.materialSlots?.includes(materialId));
    if (material && node) await this.setMaterial(node.id, node.materialSlots!.indexOf(materialId), material);
  }
  if (environmentChanged) this.setEnvironment(next.environment);
  if (cameraChanged) {
    this.setCameraState(next.cameras.find((camera) => camera.id === next.activeCameraId) ?? next.cameras[0]);
  }
  if (renderChanged) this.setRenderSettings(next.renderSettings);
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
    animation: { clips: true, seek: true, speed: true },
    picking: { available: true, multiSelect: true },
  };
}

export function validateCompatibility(
  this: KyxosViewer,
  contract: KyxosSceneContract,
): { compatible: boolean; reason?: string } {
  const major = Number(String(contract.contractVersion).split('.')[0]);
  const supportedMajor = Number(KYXOS_SCENE_CONTRACT_VERSION.split('.')[0]);
  if (major > supportedMajor) {
    return {
      compatible: false,
      reason: `Contract ${contract.contractVersion} is newer than supported ${KYXOS_SCENE_CONTRACT_VERSION}.`,
    };
  }
  const capabilities = this.getCapabilities();
  for (const requirement of contract.capabilities) {
    if (!requirement.required) continue;
    if (
      requirement.name.startsWith('effect:') &&
      !capabilities.effects[requirement.name.slice('effect:'.length)]?.available
    ) {
      return { compatible: false, reason: `Required capability ${requirement.name} is unavailable.` };
    }
  }
  return { compatible: true };
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

export function setNodeTransform(this: KyxosViewer, nodeId: string, transform: Transform): void {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  object.updateMatrix();
  object.updateMatrixWorld(true);
  this.resetTemporal('scene-transform');
}

export function setNodeVisibility(this: KyxosViewer, nodeId: string, visible: boolean): void {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  object.visible = visible;
  this.resetTemporal('scene-visibility');
}

export async function setMaterial(
  this: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
): Promise<void> {
  const object = state(this).nodes.get(nodeId);
  if (!object) return;
  const current = state(this);
  for (const target of objectMaterials(object)) {
    target.color.setRGB(material.baseColor.x, material.baseColor.y, material.baseColor.z);
    target.opacity = material.opacity;
    target.transparent = material.alphaMode === 'blend';
    target.alphaTest = material.alphaMode === 'mask' ? material.alphaCutoff ?? 0.5 : 0;
    target.metalness = material.metalness;
    target.roughness = material.roughness;
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
      const textureRef = material[sourceKey];
      if (!textureRef || !current.resolver || !current.contract) continue;
      const asset = current.contract.assets[textureRef.assetId];
      if (!asset) continue;
      const texture = await new THREE.TextureLoader().loadAsync(await current.resolver.resolve(asset));
      texture.colorSpace = textureRef.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.offset.set(textureRef.offset?.x ?? 0, textureRef.offset?.y ?? 0);
      texture.repeat.set(textureRef.scale?.x ?? 1, textureRef.scale?.y ?? 1);
      texture.rotation = textureRef.rotation ?? 0;
      (target as any)[targetKey] = texture;
    }
    target.needsUpdate = true;
  }
  void slot;
  this.resetTemporal('scene-material');
}

export function setAnimationState(this: KyxosViewer, animation: AnimationState): void {
  this.setAnimationEnabled(animation.playing);
  internals(this).animationState = structuredClone(animation);
}

export function setCameraState(this: KyxosViewer, camera?: SceneCamera | CameraState): void {
  if (!camera) return;
  const internal = internals(this);
  const target = internal.camera as THREE.PerspectiveCamera;
  const controls = internal.controls;
  target.position.set(camera.transform.position.x, camera.transform.position.y, camera.transform.position.z);
  target.fov = camera.fov;
  target.near = camera.near;
  target.far = camera.far;
  target.updateProjectionMatrix();
  controls.target.set(camera.target.x, camera.target.y, camera.target.z);
  controls.autoRotate = Boolean(camera.autoRotate);
  controls.update();
  this.resetTemporal('scene-camera');
}

export function setEnvironment(this: KyxosViewer, environment: SceneEnvironment): void {
  const internal = internals(this);
  internal.scene.environmentIntensity = environment.intensity;
  internal.scene.backgroundIntensity = environment.backgroundIntensity;
  internal.scene.backgroundBlurriness = environment.backgroundBlur;
  this.canvas.style.background = environment.transparentBackground
    ? 'transparent'
    : environment.backgroundColor;
  this.resetTemporal('scene-environment');
}

export function setRenderSettings(this: KyxosViewer, settings: SceneRenderSettings): void {
  this.setQualityPreset(settings.qualityPreset);
  internals(this).renderer.toneMappingExposure = settings.exposure;
  for (const [name, value] of Object.entries(settings.effects)) {
    if (value) this.setEffect(name as any, value as any);
  }
}

export function pick(this: KyxosViewer, screenX: number, screenY: number): PickResult | null {
  const internal = internals(this);
  const rect = this.canvas.getBoundingClientRect();
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
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
  internal.controls.target.copy(sphere.center);
  const direction = internal.camera.position.clone().sub(sphere.center).normalize();
  internal.camera.position.copy(sphere.center).add(direction.multiplyScalar(Math.max(sphere.radius * 2.7, 1)));
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
  getNodeState,
  setNodeTransform,
  setNodeVisibility,
  setMaterial,
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
    validateCompatibility(scene: KyxosSceneContract): { compatible: boolean; reason?: string };
    getNodeState(nodeId: string): ReturnType<typeof getNodeState>;
    setNodeTransform(nodeId: string, transform: Transform): void;
    setNodeVisibility(nodeId: string, visible: boolean): void;
    setMaterial(nodeId: string, slot: number, material: SceneMaterial): Promise<void>;
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
