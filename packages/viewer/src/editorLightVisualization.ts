import * as THREE from 'three/webgpu';
import type { SceneLight } from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';
import { resolveEditorViewportNodeObject } from './editorViewportHelpers';

interface LightVisualizationDescriptor {
  nodeId: string;
  lightId: string;
  type: SceneLight['type'];
  selected: boolean;
  hovered: boolean;
  range: number | null;
  innerConeAngle: number | null;
  outerConeAngle: number | null;
  direction: [number, number, number];
}

interface VisualizationState {
  root: THREE.Group;
  selected: Set<string>;
  hovered: string | null;
  lightsVisible: boolean;
  onHelpersChange: EventListener;
}

interface ViewerInternals {
  scene: THREE.Scene;
}

interface HelperChangeDetail {
  settings?: { lights?: boolean };
  selectedNodeIds?: string[];
  hoverNodeId?: string | null;
}

interface ViewerPrototypeInternals {
  createEditorViewportHelpers(): void;
  refreshEditorViewportHelpers(): void;
  disposeEditorViewportHelpers(): void;
  __kyxosEditorLightVisualizationInstalled?: boolean;
}

const states = new WeakMap<KyxosViewer, VisualizationState>();

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function disposeMaterial(material: unknown): void {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  (material as { dispose?: () => void } | null)?.dispose?.();
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((entry) => {
    (entry as THREE.Object3D & { geometry?: { dispose?: () => void } }).geometry?.dispose?.();
    disposeMaterial((entry as THREE.Object3D & { material?: unknown }).material);
  });
  object.removeFromParent();
}

function clearRoot(state: VisualizationState): void {
  for (const child of [...state.root.children]) disposeObject(child);
}

function helperColor(state: VisualizationState, nodeId: string): number {
  if (state.selected.has(nodeId)) return 0x73a7ff;
  if (state.hovered === nodeId) return 0xffd166;
  return 0x7e8ca4;
}

function overlayMaterial(color: number, opacity = 0.78): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function lineSegments(
  points: THREE.Vector3[],
  color: number,
  name: string,
  opacity = 0.78,
): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineSegments(geometry, overlayMaterial(color, opacity));
  line.name = name;
  line.userData.kyxosToolOverlay = true;
  line.frustumCulled = false;
  line.renderOrder = 10_001;
  return line;
}

function circleSegments(
  radius: number,
  plane: 'xy' | 'xz' | 'yz',
  segments = 48,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = (index / segments) * Math.PI * 2;
    const b = ((index + 1) / segments) * Math.PI * 2;
    const first = new THREE.Vector3();
    const second = new THREE.Vector3();
    if (plane === 'xy') {
      first.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      second.set(Math.cos(b) * radius, Math.sin(b) * radius, 0);
    } else if (plane === 'xz') {
      first.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      second.set(Math.cos(b) * radius, 0, Math.sin(b) * radius);
    } else {
      first.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
      second.set(0, Math.cos(b) * radius, Math.sin(b) * radius);
    }
    points.push(first, second);
  }
  return points;
}

function pointRangeGeometry(range: number): THREE.Vector3[] {
  return [
    ...circleSegments(range, 'xy'),
    ...circleSegments(range, 'xz'),
    ...circleSegments(range, 'yz'),
  ];
}

function spotConeGeometry(
  length: number,
  angle: number,
  includeRays = true,
): THREE.Vector3[] {
  const clampedAngle = Math.max(0.001, Math.min(Math.PI * 0.495, angle));
  const radius = Math.tan(clampedAngle) * length;
  const points = circleSegments(radius, 'xy', 40).map((point) => {
    point.z = -length;
    return point;
  });
  if (includeRays) {
    for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      points.push(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.cos(phase) * radius, Math.sin(phase) * radius, -length),
      );
    }
  }
  return points;
}

function directionalGeometry(length: number): THREE.Vector3[] {
  const head = Math.max(0.18, length * 0.16);
  return [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -length),
    new THREE.Vector3(0, 0, -length), new THREE.Vector3(head, 0, -length + head),
    new THREE.Vector3(0, 0, -length), new THREE.Vector3(-head, 0, -length + head),
    new THREE.Vector3(0, 0, -length), new THREE.Vector3(0, head, -length + head),
    new THREE.Vector3(0, 0, -length), new THREE.Vector3(0, -head, -length + head),
  ];
}

function ambientGeometry(radius: number): THREE.Vector3[] {
  return [
    ...circleSegments(radius, 'xy', 24),
    ...circleSegments(radius, 'xz', 24),
  ];
}

function worldDirection(proxy: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1)
    .applyQuaternion(proxy.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
}

function placeAtProxy(group: THREE.Group, proxy: THREE.Object3D): void {
  proxy.updateWorldMatrix(true, false);
  group.position.copy(proxy.getWorldPosition(new THREE.Vector3()));
  group.quaternion.copy(proxy.getWorldQuaternion(new THREE.Quaternion()));
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);
}

function createLightVisualization(
  state: VisualizationState,
  nodeId: string,
  source: SceneLight,
  proxy: THREE.Object3D,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Kyxos.EditorLightVisualization.${nodeId}`;
  group.userData.kyxosToolOverlay = true;
  group.userData.kyxosNodeId = nodeId;
  group.userData.kyxosLightId = source.id;
  group.userData.kyxosLightType = source.type;
  const color = helperColor(state, nodeId);
  const emphasized = state.selected.has(nodeId) || state.hovered === nodeId;

  if (source.type === 'point') {
    const range = Math.max(0, source.range ?? 0);
    const radius = emphasized && range > 0 ? range : 0.48;
    group.add(lineSegments(
      pointRangeGeometry(radius),
      color,
      `Kyxos.EditorPointRange.${nodeId}`,
      emphasized ? 0.82 : 0.58,
    ));
  } else if (source.type === 'spot') {
    const range = Math.max(0.5, source.range ?? 10);
    const length = emphasized ? range : Math.min(range, 2.2);
    const outer = source.outerConeAngle ?? Math.PI / 4;
    group.add(lineSegments(
      spotConeGeometry(length, outer),
      color,
      `Kyxos.EditorSpotOuterCone.${nodeId}`,
      emphasized ? 0.86 : 0.62,
    ));
    const inner = Math.max(0, Math.min(source.innerConeAngle ?? 0, outer));
    if (emphasized && inner > 0.001) {
      group.add(lineSegments(
        spotConeGeometry(length, inner, false),
        color,
        `Kyxos.EditorSpotInnerCone.${nodeId}`,
        0.42,
      ));
    }
  } else if (source.type === 'directional') {
    group.add(lineSegments(
      directionalGeometry(emphasized ? 3 : 1.6),
      color,
      `Kyxos.EditorDirectionalVector.${nodeId}`,
      emphasized ? 0.9 : 0.64,
    ));
  } else {
    group.add(lineSegments(
      ambientGeometry(emphasized ? 0.65 : 0.42),
      color,
      `Kyxos.EditorAmbientIcon.${nodeId}`,
      emphasized ? 0.84 : 0.58,
    ));
  }

  group.traverse((entry) => {
    entry.userData.kyxosToolOverlay = true;
    entry.userData.kyxosNodeId = nodeId;
    entry.frustumCulled = false;
    entry.renderOrder = 10_001;
  });
  placeAtProxy(group, proxy);
  return group;
}

function rebuild(viewer: KyxosViewer): void {
  const state = states.get(viewer);
  if (!state) return;
  clearRoot(state);
  if (!state.lightsVisible) {
    delete viewer.canvas.dataset.editorLightVisualizations;
    return;
  }

  const contract = viewer.getLoadedSceneContract();
  if (!contract) {
    delete viewer.canvas.dataset.editorLightVisualizations;
    return;
  }

  const descriptors: LightVisualizationDescriptor[] = [];
  for (const node of contract.nodes) {
    if (!node.lightId || !node.visible) continue;
    const source = contract.lights.find((light) => light.id === node.lightId);
    const proxy = resolveEditorViewportNodeObject(viewer, node.id);
    if (!source || !proxy) continue;
    state.root.add(createLightVisualization(state, node.id, source, proxy));
    const direction = worldDirection(proxy);
    descriptors.push({
      nodeId: node.id,
      lightId: source.id,
      type: source.type,
      selected: state.selected.has(node.id),
      hovered: state.hovered === node.id,
      range: typeof source.range === 'number' ? source.range : null,
      innerConeAngle: typeof source.innerConeAngle === 'number' ? source.innerConeAngle : null,
      outerConeAngle: typeof source.outerConeAngle === 'number' ? source.outerConeAngle : null,
      direction: [direction.x, direction.y, direction.z],
    });
  }
  viewer.canvas.dataset.editorLightVisualizations = JSON.stringify(descriptors);
}

function installState(viewer: KyxosViewer): void {
  if (states.has(viewer)) return;
  const root = new THREE.Group();
  root.name = 'Kyxos.EditorLightVisualizations';
  root.userData.kyxosToolOverlay = true;
  internals(viewer).scene.add(root);
  const state: VisualizationState = {
    root,
    selected: new Set(),
    hovered: null,
    lightsVisible: viewer.getEditorViewportHelperSettings().lights,
    onHelpersChange: () => undefined,
  };
  state.onHelpersChange = (event) => {
    const detail = (event as CustomEvent<HelperChangeDetail>).detail;
    state.selected = new Set(detail?.selectedNodeIds ?? []);
    state.hovered = detail?.hoverNodeId ?? null;
    if (typeof detail?.settings?.lights === 'boolean') state.lightsVisible = detail.settings.lights;
    rebuild(viewer);
  };
  viewer.addEventListener('editor-viewport-helpers-change', state.onHelpersChange);
  states.set(viewer, state);
  rebuild(viewer);
}

function disposeState(viewer: KyxosViewer): void {
  const state = states.get(viewer);
  if (!state) return;
  viewer.removeEventListener('editor-viewport-helpers-change', state.onHelpersChange);
  clearRoot(state);
  state.root.removeFromParent();
  states.delete(viewer);
  delete viewer.canvas.dataset.editorLightVisualizations;
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototypeInternals;
if (!prototype.__kyxosEditorLightVisualizationInstalled) {
  const originalCreate = prototype.createEditorViewportHelpers;
  const originalRefresh = prototype.refreshEditorViewportHelpers;
  const originalDispose = prototype.disposeEditorViewportHelpers;

  prototype.createEditorViewportHelpers = function createHelpersWithLightVolumes(this: KyxosViewer): void {
    originalCreate.call(this);
    installState(this);
  };
  prototype.refreshEditorViewportHelpers = function refreshHelpersWithLightVolumes(this: KyxosViewer): void {
    originalRefresh.call(this);
    installState(this);
    rebuild(this);
  };
  prototype.disposeEditorViewportHelpers = function disposeHelpersWithLightVolumes(this: KyxosViewer): void {
    disposeState(this);
    originalDispose.call(this);
  };
  prototype.__kyxosEditorLightVisualizationInstalled = true;
}
