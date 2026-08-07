import * as THREE from 'three/webgpu';
import type { KyxosSceneContract, SceneCamera, SceneNode } from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';
import type { PickResult } from './sceneTypes';

export interface EditorViewportHelperSettings {
  grid: boolean;
  axes: boolean;
  bounds: boolean;
  skeletons: boolean;
  lights: boolean;
  cameras: boolean;
  hover: boolean;
}

export interface EditorViewportComponentTarget {
  nodeId: string;
  kind: 'camera' | 'light';
  x: number;
  y: number;
  distance: number;
  visible: boolean;
}

export const DEFAULT_EDITOR_VIEWPORT_HELPERS: EditorViewportHelperSettings = {
  grid: true,
  axes: true,
  bounds: true,
  skeletons: false,
  lights: true,
  cameras: true,
  hover: true,
};

interface ViewerInternals {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls?: {
    target: THREE.Vector3;
    update(): void;
  };
  modelRoot: THREE.Object3D;
}

interface EditorViewportHelperState {
  root: THREE.Group;
  dynamic: THREE.Group;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  settings: EditorViewportHelperSettings;
  selectedNodeIds: string[];
  hoverNodeId: string | null;
  componentProxies: Map<string, THREE.Object3D>;
  pointerFrame: number | null;
  pointerX: number;
  pointerY: number;
  onPointerMove: (event: PointerEvent) => void;
  onPointerLeave: () => void;
}

interface ViewerPrototypeInternals {
  pick(screenX: number, screenY: number): PickResult | null;
  frameNode(nodeId: string): void;
  __kyxosEditorComponentPickingInstalled?: boolean;
}

const helperStates = new WeakMap<KyxosViewer, EditorViewportHelperState>();

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function markEditorOverlay(object: THREE.Object3D): void {
  object.traverse((entry) => {
    entry.userData.kyxosToolOverlay = true;
    entry.frustumCulled = false;
    entry.renderOrder = 10_000;
  });
}

function disposeMaterial(material: unknown): void {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  (material as { dispose?: () => void } | null)?.dispose?.();
}

function disposeOverlay(object: THREE.Object3D): void {
  object.traverse((entry) => {
    (entry as THREE.Object3D & { geometry?: { dispose?: () => void } }).geometry?.dispose?.();
    disposeMaterial((entry as THREE.Object3D & { material?: unknown }).material);
  });
  object.removeFromParent();
}

function clearDynamic(state: EditorViewportHelperState): void {
  for (const child of [...state.dynamic.children]) disposeOverlay(child);
}

function clearComponentProxies(state: EditorViewportHelperState): void {
  for (const proxy of state.componentProxies.values()) proxy.removeFromParent();
  state.componentProxies.clear();
}

function helperSettingsEqual(
  left: EditorViewportHelperSettings,
  right: EditorViewportHelperSettings,
): boolean {
  return (Object.keys(DEFAULT_EDITOR_VIEWPORT_HELPERS) as Array<keyof EditorViewportHelperSettings>)
    .every((key) => left[key] === right[key]);
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findRuntimeNodeObject(viewer: KyxosViewer, nodeId: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  internals(viewer).modelRoot.traverse((object) => {
    if (
      !result &&
      object.userData.kyxosToolOverlay !== true &&
      object.userData.kyxosNodeId === nodeId
    ) {
      result = object;
    }
  });
  return result;
}

function componentKind(node: SceneNode): 'camera' | 'light' | null {
  if (node.cameraId) return 'camera';
  if (node.lightId) return 'light';
  return null;
}

function syncComponentProxies(viewer: KyxosViewer, state: EditorViewportHelperState): void {
  const contract = viewer.getLoadedSceneContract();
  if (!contract) {
    clearComponentProxies(state);
    return;
  }

  const componentNodes = contract.nodes.filter((node) => componentKind(node));
  const wanted = new Set(componentNodes.map((node) => node.id));
  for (const [nodeId, proxy] of state.componentProxies) {
    if (wanted.has(nodeId)) continue;
    proxy.removeFromParent();
    state.componentProxies.delete(nodeId);
  }

  for (const node of componentNodes) {
    const kind = componentKind(node)!;
    let proxy = state.componentProxies.get(node.id);
    if (!proxy) {
      proxy = new THREE.Object3D();
      proxy.userData.kyxosToolOverlay = true;
      proxy.userData.kyxosEditorComponentProxy = true;
      proxy.userData.kyxosNodeId = node.id;
      state.componentProxies.set(node.id, proxy);
    }
    proxy.name = `Kyxos.EditorComponent.${kind}.${node.name}`;
    proxy.userData.kyxosEditorComponentKind = kind;
    proxy.userData.kyxosEditorComponentId = node.cameraId ?? node.lightId;
    proxy.position.set(
      node.transform.position.x,
      node.transform.position.y,
      node.transform.position.z,
    );
    proxy.rotation.set(
      node.transform.rotation.x,
      node.transform.rotation.y,
      node.transform.rotation.z,
    );
    proxy.scale.set(
      node.transform.scale.x,
      node.transform.scale.y,
      node.transform.scale.z,
    );
    proxy.visible = node.visible;
    proxy.updateMatrix();
  }

  // Mirror the authored hierarchy so TransformControls can convert its world
  // delta back to the same local transform stored by the Scene Contract.
  for (const node of componentNodes) {
    const proxy = state.componentProxies.get(node.id)!;
    const parent = node.parentId
      ? findRuntimeNodeObject(viewer, node.parentId) ?? state.componentProxies.get(node.parentId)
      : state.root;
    const nextParent = parent ?? state.root;
    if (proxy.parent !== nextParent) nextParent.add(proxy);
  }
  internals(viewer).modelRoot.updateMatrixWorld(true);
  state.root.updateMatrixWorld(true);
}

export function resolveEditorViewportNodeObject(
  viewer: KyxosViewer,
  nodeId: string,
): THREE.Object3D | null {
  const runtime = findRuntimeNodeObject(viewer, nodeId);
  if (runtime) return runtime;
  const state = helperStates.get(viewer);
  if (!state) return null;
  syncComponentProxies(viewer, state);
  return state.componentProxies.get(nodeId) ?? null;
}

function addBounds(
  state: EditorViewportHelperState,
  object: THREE.Object3D,
  color: number,
  name: string,
): void {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const helper = new THREE.Box3Helper(bounds, color);
  helper.name = name;
  markEditorOverlay(helper);
  state.dynamic.add(helper);
}

function helperColor(state: EditorViewportHelperState, nodeId: string): number {
  if (state.selectedNodeIds.includes(nodeId)) return 0x73a7ff;
  if (state.hoverNodeId === nodeId) return 0xffd166;
  return 0xaab6c9;
}

function createComponentMarker(
  state: EditorViewportHelperState,
  proxy: THREE.Object3D,
  nodeId: string,
  kind: 'camera' | 'light',
  camera: THREE.Camera,
): THREE.Object3D {
  const position = proxy.getWorldPosition(new THREE.Vector3());
  const distance = Math.max(0.1, camera.position.distanceTo(position));
  const radius = Math.max(0.07, Math.min(0.28, distance * 0.012));
  const geometry = kind === 'camera'
    ? new THREE.OctahedronGeometry(radius, 0)
    : new THREE.SphereGeometry(radius, 10, 8);
  const material = new THREE.MeshBasicMaterial({
    color: helperColor(state, nodeId),
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const marker = new THREE.Mesh(geometry, material);
  marker.name = `Kyxos.EditorComponentMarker.${kind}.${nodeId}`;
  marker.position.copy(position);
  marker.userData.kyxosEditorComponentMarker = true;
  marker.userData.kyxosNodeId = nodeId;
  marker.userData.kyxosEditorComponentKind = kind;
  markEditorOverlay(marker);
  return marker;
}

function createContractCameraHelper(
  contractCamera: SceneCamera,
  proxy: THREE.Object3D,
  aspect: number,
): THREE.CameraHelper {
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  if (contractCamera.projection === 'orthographic') {
    const size = Math.max(0.001, contractCamera.orthographicSize ?? 1);
    camera = new THREE.OrthographicCamera(
      -size * aspect,
      size * aspect,
      size,
      -size,
      contractCamera.near,
      contractCamera.far,
    );
  } else {
    camera = new THREE.PerspectiveCamera(
      contractCamera.fov,
      Math.max(0.01, aspect),
      contractCamera.near,
      contractCamera.far,
    );
  }
  camera.position.copy(proxy.getWorldPosition(new THREE.Vector3()));
  camera.quaternion.copy(proxy.getWorldQuaternion(new THREE.Quaternion()));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return new THREE.CameraHelper(camera);
}

function addContractCameraHelpers(
  viewer: KyxosViewer,
  state: EditorViewportHelperState,
  contract: KyxosSceneContract,
): void {
  if (!state.settings.cameras) return;
  const rect = viewer.canvas.getBoundingClientRect();
  const aspect = Math.max(0.01, rect.width / Math.max(1, rect.height));
  for (const node of contract.nodes) {
    if (!node.cameraId || !node.visible) continue;
    const proxy = state.componentProxies.get(node.id);
    const source = contract.cameras.find((camera) => camera.id === node.cameraId);
    if (!proxy || !source) continue;
    const helper = createContractCameraHelper(source, proxy, aspect);
    helper.name = `Kyxos.EditorCameraHelper.${node.id}`;
    helper.userData.kyxosNodeId = node.id;
    helper.userData.kyxosEditorComponentKind = 'camera';
    markEditorOverlay(helper);
    state.dynamic.add(helper);
  }
}

function addRuntimeLightHelpers(viewer: KyxosViewer, state: EditorViewportHelperState): void {
  if (!state.settings.lights) return;
  const internal = internals(viewer);
  const entries: THREE.Object3D[] = [];
  internal.scene.traverse((entry) => {
    if (!entry.userData.kyxosToolOverlay) entries.push(entry);
  });

  for (const entry of entries) {
    if (!entry.userData.kyxosManagedLight) continue;
    let helper: THREE.Object3D | null = null;
    if ((entry as THREE.DirectionalLight).isDirectionalLight) {
      helper = new THREE.DirectionalLightHelper(entry as THREE.DirectionalLight, 0.75);
    } else if ((entry as THREE.PointLight).isPointLight) {
      helper = new THREE.PointLightHelper(entry as THREE.PointLight, 0.35);
    } else if ((entry as THREE.SpotLight).isSpotLight) {
      helper = new THREE.SpotLightHelper(entry as THREE.SpotLight);
    } else if ((entry as THREE.HemisphereLight).isHemisphereLight) {
      helper = new THREE.HemisphereLightHelper(entry as THREE.HemisphereLight, 0.5);
    }
    if (!helper) continue;
    helper.name = `Kyxos.EditorLightHelper.${entry.name || entry.uuid}`;
    markEditorOverlay(helper);
    state.dynamic.add(helper);
  }
}

function addSceneHelpers(viewer: KyxosViewer, state: EditorViewportHelperState): void {
  const internal = internals(viewer);
  internal.modelRoot.updateWorldMatrix(true, true);

  if (state.settings.skeletons) {
    const seen = new Set<THREE.Skeleton>();
    internal.modelRoot.traverse((entry) => {
      const mesh = entry as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton || seen.has(mesh.skeleton)) return;
      seen.add(mesh.skeleton);
      const helper = new THREE.SkeletonHelper(mesh);
      helper.name = `Kyxos.EditorSkeleton.${mesh.name || mesh.uuid}`;
      markEditorOverlay(helper);
      state.dynamic.add(helper);
    });
  }

  const contract = viewer.getLoadedSceneContract();
  if (contract) addContractCameraHelpers(viewer, state, contract);
  addRuntimeLightHelpers(viewer, state);

  if (!contract) return;
  for (const node of contract.nodes) {
    const kind = componentKind(node);
    if (!kind || !node.visible) continue;
    if (kind === 'camera' && !state.settings.cameras) continue;
    if (kind === 'light' && !state.settings.lights) continue;
    const proxy = state.componentProxies.get(node.id);
    if (proxy) state.dynamic.add(createComponentMarker(state, proxy, node.id, kind, internal.camera));
  }
}

function componentTargets(
  viewer: KyxosViewer,
  state: EditorViewportHelperState,
): EditorViewportComponentTarget[] {
  syncComponentProxies(viewer, state);
  const contract = viewer.getLoadedSceneContract();
  if (!contract) return [];
  const internal = internals(viewer);
  const rect = viewer.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return [];
  internal.camera.updateMatrixWorld(true);

  const targets: EditorViewportComponentTarget[] = [];
  for (const node of contract.nodes) {
    const kind = componentKind(node);
    if (!kind || !node.visible) continue;
    if (kind === 'camera' && !state.settings.cameras) continue;
    if (kind === 'light' && !state.settings.lights) continue;
    const proxy = state.componentProxies.get(node.id);
    if (!proxy) continue;
    proxy.updateWorldMatrix(true, false);
    const world = proxy.getWorldPosition(new THREE.Vector3());
    const projected = world.clone().project(internal.camera);
    const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    targets.push({
      nodeId: node.id,
      kind,
      x,
      y,
      distance: internal.camera.position.distanceTo(world),
      visible:
        projected.z >= -1.05 &&
        projected.z <= 1.05 &&
        projected.x >= -1.05 &&
        projected.x <= 1.05 &&
        projected.y >= -1.05 &&
        projected.y <= 1.05,
    });
  }
  return targets;
}

function syncComponentDiagnostics(
  viewer: KyxosViewer,
  state: EditorViewportHelperState,
  targets = componentTargets(viewer, state),
): void {
  viewer.canvas.dataset.editorComponentHelpers = targets
    .map((target) => `${target.kind}:${target.nodeId}`)
    .join(',');
  viewer.canvas.dataset.editorComponentHelperTargets = JSON.stringify(targets);
}

export function getEditorViewportComponentTargets(
  this: KyxosViewer,
): EditorViewportComponentTarget[] {
  const state = helperStates.get(this);
  if (!state) return [];
  return componentTargets(this, state);
}

export function pickEditorViewportHelper(
  this: KyxosViewer,
  screenX: number,
  screenY: number,
): PickResult | null {
  const state = helperStates.get(this);
  if (!state) return null;
  const targets = componentTargets(this, state);
  syncComponentDiagnostics(this, state, targets);

  let best: { target: EditorViewportComponentTarget; pixelDistance: number } | null = null;
  for (const target of targets) {
    if (!target.visible) continue;
    const radius = target.kind === 'camera' ? 18 : 16;
    const pixelDistance = Math.hypot(screenX - target.x, screenY - target.y);
    if (pixelDistance > radius) continue;
    if (
      !best ||
      pixelDistance < best.pixelDistance ||
      (pixelDistance === best.pixelDistance && target.distance < best.target.distance)
    ) {
      best = { target, pixelDistance };
    }
  }
  if (!best) return null;
  const object = resolveEditorViewportNodeObject(this, best.target.nodeId);
  const point = object?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  this.canvas.dataset.editorHelperLastHit = best.target.nodeId;
  return {
    nodeId: best.target.nodeId,
    distance: best.target.distance,
    point: { x: point.x, y: point.y, z: point.z },
  };
}

function rebuildEditorViewportHelpers(viewer: KyxosViewer): void {
  const state = helperStates.get(viewer);
  if (!state) return;

  syncComponentProxies(viewer, state);
  state.grid.visible = state.settings.grid;
  state.axes.visible = state.settings.axes;
  clearDynamic(state);

  if (state.settings.bounds) {
    for (const nodeId of state.selectedNodeIds) {
      const object = resolveEditorViewportNodeObject(viewer, nodeId);
      if (object) addBounds(state, object, 0x73a7ff, `Kyxos.EditorSelectionBounds.${nodeId}`);
    }
  }

  if (
    state.settings.hover &&
    state.hoverNodeId &&
    !state.selectedNodeIds.includes(state.hoverNodeId)
  ) {
    const hovered = resolveEditorViewportNodeObject(viewer, state.hoverNodeId);
    if (hovered) addBounds(state, hovered, 0xffd166, `Kyxos.EditorHoverBounds.${state.hoverNodeId}`);
  }

  addSceneHelpers(viewer, state);
  viewer.canvas.dataset.editorHelpers = Object.entries(state.settings)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(',');
  viewer.canvas.dataset.editorHoverNode = state.hoverNodeId ?? '';
  syncComponentDiagnostics(viewer, state);
  viewer.dispatchEvent(new CustomEvent('editor-viewport-helpers-change', {
    detail: {
      settings: structuredClone(state.settings),
      selectedNodeIds: [...state.selectedNodeIds],
      hoverNodeId: state.hoverNodeId,
      componentTargets: componentTargets(viewer, state),
    },
  }));
}

export function createEditorViewportHelpers(this: KyxosViewer): void {
  this.disposeEditorViewportHelpers();
  const root = new THREE.Group();
  root.name = 'Kyxos.EditorViewportHelpers';
  root.userData.kyxosToolOverlay = true;

  const grid = new THREE.GridHelper(40, 40, 0x5f6b82, 0x303746);
  grid.name = 'Kyxos.EditorGrid';
  grid.position.y = 0;
  markEditorOverlay(grid);

  const axes = new THREE.AxesHelper(2);
  axes.name = 'Kyxos.EditorAxes';
  axes.position.set(0, 0.002, 0);
  markEditorOverlay(axes);

  const dynamic = new THREE.Group();
  dynamic.name = 'Kyxos.EditorDynamicHelpers';
  dynamic.userData.kyxosToolOverlay = true;

  root.add(grid, axes, dynamic);
  internals(this).scene.add(root);

  const state = {} as EditorViewportHelperState;
  state.root = root;
  state.dynamic = dynamic;
  state.grid = grid;
  state.axes = axes;
  state.settings = structuredClone(DEFAULT_EDITOR_VIEWPORT_HELPERS);
  state.selectedNodeIds = [];
  state.hoverNodeId = null;
  state.componentProxies = new Map();
  state.pointerFrame = null;
  state.pointerX = 0;
  state.pointerY = 0;
  state.onPointerMove = (event) => {
    if (!state.settings.hover) return;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    if (state.pointerFrame != null) return;
    state.pointerFrame = requestAnimationFrame(() => {
      state.pointerFrame = null;
      const next = this.pick(state.pointerX, state.pointerY)?.nodeId ?? null;
      if (next === state.hoverNodeId) return;
      state.hoverNodeId = next;
      rebuildEditorViewportHelpers(this);
    });
  };
  state.onPointerLeave = () => {
    if (state.hoverNodeId == null) return;
    state.hoverNodeId = null;
    rebuildEditorViewportHelpers(this);
  };

  this.canvas.addEventListener('pointermove', state.onPointerMove, { passive: true });
  this.canvas.addEventListener('pointerleave', state.onPointerLeave);
  helperStates.set(this, state);
  rebuildEditorViewportHelpers(this);
}

export function setEditorViewportHelperSettings(
  this: KyxosViewer,
  settings: Partial<EditorViewportHelperSettings>,
): void {
  const state = helperStates.get(this);
  if (!state) return;
  const next = { ...state.settings, ...settings };
  if (helperSettingsEqual(state.settings, next)) return;
  state.settings = next;
  if (!state.settings.hover) state.hoverNodeId = null;
  rebuildEditorViewportHelpers(this);
}

export function getEditorViewportHelperSettings(
  this: KyxosViewer,
): EditorViewportHelperSettings {
  return structuredClone(
    helperStates.get(this)?.settings ?? DEFAULT_EDITOR_VIEWPORT_HELPERS,
  );
}

export function setEditorViewportHelperSelection(
  this: KyxosViewer,
  nodeIds: string[],
): void {
  const state = helperStates.get(this);
  if (!state) return;
  const next = [...new Set(nodeIds)];
  if (stringArraysEqual(state.selectedNodeIds, next)) return;
  state.selectedNodeIds = next;
  rebuildEditorViewportHelpers(this);
}

export function refreshEditorViewportHelpers(this: KyxosViewer): void {
  rebuildEditorViewportHelpers(this);
}

export function disposeEditorViewportHelpers(this: KyxosViewer): void {
  const state = helperStates.get(this);
  if (!state) return;
  this.canvas.removeEventListener('pointermove', state.onPointerMove);
  this.canvas.removeEventListener('pointerleave', state.onPointerLeave);
  if (state.pointerFrame != null) cancelAnimationFrame(state.pointerFrame);
  clearDynamic(state);
  clearComponentProxies(state);
  disposeOverlay(state.grid);
  disposeOverlay(state.axes);
  state.dynamic.removeFromParent();
  state.root.removeFromParent();
  helperStates.delete(this);
  delete this.canvas.dataset.editorHelpers;
  delete this.canvas.dataset.editorHoverNode;
  delete this.canvas.dataset.editorComponentHelpers;
  delete this.canvas.dataset.editorComponentHelperTargets;
  delete this.canvas.dataset.editorHelperLastHit;
}

Object.assign(KyxosViewer.prototype, {
  createEditorViewportHelpers,
  setEditorViewportHelperSettings,
  getEditorViewportHelperSettings,
  setEditorViewportHelperSelection,
  refreshEditorViewportHelpers,
  getEditorViewportComponentTargets,
  pickEditorViewportHelper,
  disposeEditorViewportHelpers,
});

// Scene picking deliberately ignores editor overlays. Layer component helper
// picking in front of authored mesh picking only while helper state exists, so
// Public Viewer / Embed remain unaffected and Studio gets PlayCanvas-style
// screen-space camera/light selection.
const viewerPrototype = KyxosViewer.prototype as unknown as ViewerPrototypeInternals;
if (!viewerPrototype.__kyxosEditorComponentPickingInstalled) {
  const originalPick = viewerPrototype.pick;
  const originalFrameNode = viewerPrototype.frameNode;
  viewerPrototype.pick = function pickWithEditorComponentHelpers(
    this: KyxosViewer,
    screenX: number,
    screenY: number,
  ): PickResult | null {
    return pickEditorViewportHelper.call(this, screenX, screenY)
      ?? originalPick.call(this, screenX, screenY);
  };
  viewerPrototype.frameNode = function frameEditorComponent(
    this: KyxosViewer,
    nodeId: string,
  ): void {
    const object = resolveEditorViewportNodeObject(this, nodeId);
    if (!object?.userData.kyxosEditorComponentProxy) {
      originalFrameNode.call(this, nodeId);
      return;
    }
    const internal = internals(this);
    const target = object.getWorldPosition(new THREE.Vector3());
    const direction = internal.camera.position.clone().sub(target);
    if (direction.lengthSq() < 0.000001) direction.set(1, 0.65, 1);
    direction.normalize();
    internal.controls?.target.copy(target);
    internal.camera.position.copy(target).add(direction.multiplyScalar(2.8));
    internal.controls?.update();
    this.resetTemporal('frame-editor-component');
  };
  viewerPrototype.__kyxosEditorComponentPickingInstalled = true;
}

declare module './KyxosViewer' {
  interface KyxosViewer {
    createEditorViewportHelpers(): void;
    setEditorViewportHelperSettings(settings: Partial<EditorViewportHelperSettings>): void;
    getEditorViewportHelperSettings(): EditorViewportHelperSettings;
    setEditorViewportHelperSelection(nodeIds: string[]): void;
    refreshEditorViewportHelpers(): void;
    getEditorViewportComponentTargets(): EditorViewportComponentTarget[];
    pickEditorViewportHelper(screenX: number, screenY: number): PickResult | null;
    disposeEditorViewportHelpers(): void;
  }
}