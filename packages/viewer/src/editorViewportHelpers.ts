import * as THREE from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';

export interface EditorViewportHelperSettings {
  grid: boolean;
  axes: boolean;
  bounds: boolean;
  skeletons: boolean;
  lights: boolean;
  cameras: boolean;
  hover: boolean;
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
  pointerFrame: number | null;
  pointerX: number;
  pointerY: number;
  onPointerMove: (event: PointerEvent) => void;
  onPointerLeave: () => void;
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

function findNodeObject(viewer: KyxosViewer, nodeId: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  internals(viewer).modelRoot.traverse((object) => {
    if (!result && object.userData.kyxosNodeId === nodeId) result = object;
  });
  return result;
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

  internal.scene.traverse((entry) => {
    if (entry.userData.kyxosToolOverlay) return;
    if (state.settings.lights) {
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
      if (helper) {
        helper.name = `Kyxos.EditorLightHelper.${entry.name || entry.uuid}`;
        markEditorOverlay(helper);
        state.dynamic.add(helper);
      }
    }

    if (
      state.settings.cameras &&
      (entry as THREE.Camera).isCamera &&
      entry !== internal.camera
    ) {
      const helper = new THREE.CameraHelper(entry as THREE.Camera);
      helper.name = `Kyxos.EditorCameraHelper.${entry.name || entry.uuid}`;
      markEditorOverlay(helper);
      state.dynamic.add(helper);
    }
  });
}

function rebuildEditorViewportHelpers(viewer: KyxosViewer): void {
  const state = helperStates.get(viewer);
  if (!state) return;

  state.grid.visible = state.settings.grid;
  state.axes.visible = state.settings.axes;
  clearDynamic(state);

  if (state.settings.bounds) {
    for (const nodeId of state.selectedNodeIds) {
      const object = findNodeObject(viewer, nodeId);
      if (object) addBounds(state, object, 0x73a7ff, `Kyxos.EditorSelectionBounds.${nodeId}`);
    }
  }

  if (
    state.settings.hover &&
    state.hoverNodeId &&
    !state.selectedNodeIds.includes(state.hoverNodeId)
  ) {
    const hovered = findNodeObject(viewer, state.hoverNodeId);
    if (hovered) addBounds(state, hovered, 0xffd166, `Kyxos.EditorHoverBounds.${state.hoverNodeId}`);
  }

  addSceneHelpers(viewer, state);
  viewer.canvas.dataset.editorHelpers = Object.entries(state.settings)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(',');
  viewer.canvas.dataset.editorHoverNode = state.hoverNodeId ?? '';
  viewer.dispatchEvent(new CustomEvent('editor-viewport-helpers-change', {
    detail: {
      settings: structuredClone(state.settings),
      selectedNodeIds: [...state.selectedNodeIds],
      hoverNodeId: state.hoverNodeId,
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
  state.settings = { ...state.settings, ...settings };
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
  state.selectedNodeIds = [...new Set(nodeIds)];
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
  disposeOverlay(state.grid);
  disposeOverlay(state.axes);
  state.dynamic.removeFromParent();
  state.root.removeFromParent();
  helperStates.delete(this);
  delete this.canvas.dataset.editorHelpers;
  delete this.canvas.dataset.editorHoverNode;
}

Object.assign(KyxosViewer.prototype, {
  createEditorViewportHelpers,
  setEditorViewportHelperSettings,
  getEditorViewportHelperSettings,
  setEditorViewportHelperSelection,
  refreshEditorViewportHelpers,
  disposeEditorViewportHelpers,
});

declare module './KyxosViewer' {
  interface KyxosViewer {
    createEditorViewportHelpers(): void;
    setEditorViewportHelperSettings(settings: Partial<EditorViewportHelperSettings>): void;
    getEditorViewportHelperSettings(): EditorViewportHelperSettings;
    setEditorViewportHelperSelection(nodeIds: string[]): void;
    refreshEditorViewportHelpers(): void;
    disposeEditorViewportHelpers(): void;
  }
}
