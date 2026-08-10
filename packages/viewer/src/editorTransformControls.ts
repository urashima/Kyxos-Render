import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { KyxosViewer } from './KyxosViewer';
import { resolveEditorViewportNodeObject } from './editorViewportHelpers';

export type EditorTransformMode = 'select' | 'translate' | 'rotate' | 'scale';
export type EditorTransformSpace = 'local' | 'world';
export type EditorTransformPivot = 'active' | 'center';

export interface EditorTransformSnap {
  enabled: boolean;
  translation: number;
  rotation: number;
  scale: number;
}

interface SelectedObject {
  nodeId: string;
  object: THREE.Object3D;
}

interface DragObjectSnapshot extends SelectedObject {
  startWorld: THREE.Matrix4;
  parentWorldInverse: THREE.Matrix4;
}

interface DragSnapshot {
  pivotWorld: THREE.Matrix4;
  objects: DragObjectSnapshot[];
}

interface EditorControlState {
  controls: TransformControls;
  helper: THREE.Object3D;
  pivotObject: THREE.Object3D;
  mode: EditorTransformMode;
  selectedNodeIds: string[];
  snap: EditorTransformSnap;
  space: EditorTransformSpace;
  pivot: EditorTransformPivot;
  dragging: boolean;
  drag: DragSnapshot | null;
  onChange: () => void;
  onObjectChange: () => void;
  onDraggingChanged: (event: { value?: boolean }) => void;
  onMouseDown: () => void;
  onMouseUp: () => void;
}

interface ViewerInternals {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls?: { enabled: boolean };
  modelRoot: THREE.Object3D;
}

interface TransformChange {
  nodeId: string;
  property: 'position' | 'rotation' | 'scale';
  axis: 'x' | 'y' | 'z';
  value: number;
}

const editorStates = new WeakMap<KyxosViewer, EditorControlState>();

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function findNodeObject(viewer: KyxosViewer, nodeId: string): THREE.Object3D | null {
  return resolveEditorViewportNodeObject(viewer, nodeId);
}

function selectedObjects(viewer: KyxosViewer, state: EditorControlState): SelectedObject[] {
  const result: SelectedObject[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const nodeId of state.selectedNodeIds) {
    const object = findNodeObject(viewer, nodeId);
    if (!object || seen.has(object)) continue;
    seen.add(object);
    result.push({ nodeId, object });
  }
  return result;
}

function selectedRoots(selection: SelectedObject[]): SelectedObject[] {
  const selected = new Set(selection.map((entry) => entry.object));
  return selection.filter(({ object }) => {
    let parent = object.parent;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parent.parent;
    }
    return true;
  });
}

function selectionCenter(selection: SelectedObject[]): THREE.Vector3 {
  const bounds = new THREE.Box3();
  const worldPosition = new THREE.Vector3();
  const average = new THREE.Vector3();
  let positionCount = 0;
  let hasBounds = false;

  for (const { object } of selection) {
    object.updateWorldMatrix(true, true);
    object.getWorldPosition(worldPosition);
    average.add(worldPosition);
    positionCount += 1;

    const objectBounds = new THREE.Box3().setFromObject(object);
    if (!objectBounds.isEmpty()) {
      bounds.union(objectBounds);
      hasBounds = true;
    }
  }

  if (hasBounds) return bounds.getCenter(new THREE.Vector3());
  return positionCount ? average.multiplyScalar(1 / positionCount) : average;
}

function updatePivotTransform(viewer: KyxosViewer, state: EditorControlState): boolean {
  const selection = selectedObjects(viewer, state);
  const active = selection[0];
  if (!active) return false;

  const position = state.pivot === 'center'
    ? selectionCenter(selection)
    : active.object.getWorldPosition(new THREE.Vector3());
  const rotation = state.space === 'local'
    ? active.object.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();

  state.pivotObject.position.copy(position);
  state.pivotObject.quaternion.copy(rotation);
  state.pivotObject.scale.set(1, 1, 1);
  state.pivotObject.updateMatrix();
  state.pivotObject.updateMatrixWorld(true);
  return true;
}

function captureDrag(viewer: KyxosViewer, state: EditorControlState): DragSnapshot | null {
  if (!updatePivotTransform(viewer, state)) return null;
  const roots = selectedRoots(selectedObjects(viewer, state));
  if (!roots.length) return null;
  state.pivotObject.updateMatrixWorld(true);
  return {
    pivotWorld: state.pivotObject.matrixWorld.clone(),
    objects: roots.map(({ nodeId, object }) => {
      object.updateWorldMatrix(true, false);
      const parentWorldInverse = object.parent
        ? object.parent.matrixWorld.clone().invert()
        : new THREE.Matrix4();
      return {
        nodeId,
        object,
        startWorld: object.matrixWorld.clone(),
        parentWorldInverse,
      };
    }),
  };
}

function appendVectorChanges(
  changes: TransformChange[],
  nodeId: string,
  property: TransformChange['property'],
  vector: THREE.Vector3 | THREE.Euler,
): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    changes.push({ nodeId, property, axis, value: vector[axis] });
  }
}

function groupTransformDetail(
  state: EditorControlState,
  drag: DragSnapshot,
): { changes: TransformChange[]; mergeKey: string } {
  state.pivotObject.updateMatrixWorld(true);
  const inverseStartPivot = drag.pivotWorld.clone().invert();
  const deltaWorld = state.pivotObject.matrixWorld.clone().multiply(inverseStartPivot);
  const changes: TransformChange[] = [];

  for (const snapshot of drag.objects) {
    const localMatrix = snapshot.parentWorldInverse
      .clone()
      .multiply(deltaWorld)
      .multiply(snapshot.startWorld);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    localMatrix.decompose(position, quaternion, scale);

    snapshot.object.position.copy(position);
    snapshot.object.quaternion.copy(quaternion);
    snapshot.object.scale.copy(scale);
    snapshot.object.updateMatrix();
    snapshot.object.updateMatrixWorld(true);

    const rotation = new THREE.Euler().setFromQuaternion(
      quaternion,
      snapshot.object.rotation.order,
    );
    appendVectorChanges(changes, snapshot.nodeId, 'position', position);
    appendVectorChanges(changes, snapshot.nodeId, 'rotation', rotation);
    appendVectorChanges(changes, snapshot.nodeId, 'scale', scale);
  }

  return {
    changes,
    mergeKey: [
      'transform-controls',
      state.mode,
      state.pivot,
      ...state.selectedNodeIds,
    ].join(':'),
  };
}

function syncCanvasState(viewer: KyxosViewer, state: EditorControlState): void {
  viewer.canvas.dataset.editorGizmo = 'three-transform-controls';
  viewer.canvas.dataset.editorTool = state.mode;
  viewer.canvas.dataset.editorSpace = state.space;
  viewer.canvas.dataset.editorPivot = state.pivot;
  viewer.canvas.dataset.editorSelection = state.selectedNodeIds.join(',');
  viewer.canvas.dataset.editorSnap = String(state.snap.enabled);
  viewer.canvas.dataset.editorAxis = state.controls.axis ?? '';
}

function applySnap(state: EditorControlState): void {
  const controls = state.controls;
  controls.setSpace(state.space);
  controls.translationSnap = state.snap.enabled
    ? Math.max(0.000001, state.snap.translation)
    : null;
  controls.rotationSnap = state.snap.enabled
    ? THREE.MathUtils.degToRad(Math.max(0.000001, state.snap.rotation))
    : null;
  controls.scaleSnap = state.snap.enabled
    ? Math.max(0.000001, state.snap.scale)
    : null;
}

function attachCurrent(viewer: KyxosViewer, state: EditorControlState): void {
  // Scene Camera projection changes can replace the Viewer's camera object.
  // Keep Three.js TransformControls bound to the current authoring camera.
  state.controls.camera = internals(viewer).camera;
  syncCanvasState(viewer, state);
  if (state.mode === 'select' || !updatePivotTransform(viewer, state)) {
    state.controls.detach();
    state.helper.visible = false;
    return;
  }
  state.controls.setMode(state.mode);
  applySnap(state);
  state.controls.attach(state.pivotObject);
  state.helper.visible = true;
}

export function createEditorTransformControls(this: KyxosViewer): void {
  this.disposeEditorTransformControls();
  const internal = internals(this);
  const controls = new TransformControls(internal.camera, this.canvas);
  const helper = controls.getHelper();
  const pivotObject = new THREE.Object3D();
  pivotObject.name = 'Kyxos.EditorTransformPivot';
  pivotObject.userData.kyxosToolOverlay = true;
  pivotObject.visible = false;
  internal.scene.add(pivotObject);

  helper.name = 'Kyxos.EditorTransformControls';
  helper.userData.kyxosToolOverlay = true;
  helper.traverse((object) => {
    object.userData.kyxosToolOverlay = true;
    object.frustumCulled = false;
  });
  helper.visible = false;
  internal.scene.add(helper);

  const state: EditorControlState = {
    controls,
    helper,
    pivotObject,
    mode: 'select',
    selectedNodeIds: [],
    snap: {
      enabled: false,
      translation: 0.1,
      rotation: 15,
      scale: 0.1,
    },
    space: 'local',
    pivot: 'active',
    dragging: false,
    drag: null,
    onChange: () => syncCanvasState(this, state),
    onObjectChange: () => {
      if (state.mode === 'select') return;
      const drag = state.drag ?? captureDrag(this, state);
      if (!drag) return;
      state.drag = drag;
      this.dispatchEvent(
        new CustomEvent('editor-transform-change', {
          detail: groupTransformDetail(state, drag),
        }),
      );
    },
    onDraggingChanged: (event) => {
      const dragging = event.value === true;
      state.dragging = dragging;
      if (internal.controls) internal.controls.enabled = !dragging;
      this.canvas.dataset.editorDragging = String(dragging);
      this.dispatchEvent(
        new CustomEvent('editor-transform-dragging', {
          detail: { dragging },
        }),
      );
    },
    onMouseDown: () => {
      state.dragging = true;
      state.drag = captureDrag(this, state);
      this.dispatchEvent(
        new CustomEvent('editor-transform-start', {
          detail: {
            nodeIds: [...state.selectedNodeIds],
            pivot: state.pivot,
          },
        }),
      );
    },
    onMouseUp: () => {
      this.dispatchEvent(
        new CustomEvent('editor-transform-end', {
          detail: {
            nodeIds: [...state.selectedNodeIds],
            pivot: state.pivot,
          },
        }),
      );
      state.dragging = false;
      state.drag = null;
      attachCurrent(this, state);
    },
  };

  controls.addEventListener('change', state.onChange);
  controls.addEventListener('objectChange', state.onObjectChange);
  controls.addEventListener('dragging-changed', state.onDraggingChanged as never);
  controls.addEventListener('mouseDown', state.onMouseDown);
  controls.addEventListener('mouseUp', state.onMouseUp);
  editorStates.set(this, state);
  syncCanvasState(this, state);
}

export function setEditorTransformSelection(
  this: KyxosViewer,
  nodeIds: string[],
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.selectedNodeIds = [...nodeIds];
  if (!state.dragging) attachCurrent(this, state);
}

export function setEditorTransformMode(
  this: KyxosViewer,
  mode: EditorTransformMode,
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.mode = mode;
  if (!state.dragging) attachCurrent(this, state);
}

export function setEditorTransformSpace(
  this: KyxosViewer,
  space: EditorTransformSpace,
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.space = space;
  if (!state.dragging) attachCurrent(this, state);
  else applySnap(state);
}

export function setEditorTransformPivot(
  this: KyxosViewer,
  pivot: EditorTransformPivot,
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.pivot = pivot;
  if (!state.dragging) attachCurrent(this, state);
  else syncCanvasState(this, state);
}

export function setEditorTransformSnap(
  this: KyxosViewer,
  snap: EditorTransformSnap,
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.snap = structuredClone(snap);
  applySnap(state);
  syncCanvasState(this, state);
}

export function refreshEditorTransformControls(this: KyxosViewer): void {
  const state = editorStates.get(this);
  if (!state || state.dragging || state.drag) return;
  attachCurrent(this, state);
}

export function disposeEditorTransformControls(this: KyxosViewer): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.controls.removeEventListener('change', state.onChange);
  state.controls.removeEventListener('objectChange', state.onObjectChange);
  state.controls.removeEventListener('dragging-changed', state.onDraggingChanged as never);
  state.controls.removeEventListener('mouseDown', state.onMouseDown);
  state.controls.removeEventListener('mouseUp', state.onMouseUp);
  state.controls.detach();
  state.controls.dispose();
  state.helper.removeFromParent();
  state.pivotObject.removeFromParent();
  editorStates.delete(this);
  const orbit = internals(this).controls;
  if (orbit) orbit.enabled = true;
  delete this.canvas.dataset.editorGizmo;
  delete this.canvas.dataset.editorTool;
  delete this.canvas.dataset.editorSpace;
  delete this.canvas.dataset.editorPivot;
  delete this.canvas.dataset.editorSelection;
  delete this.canvas.dataset.editorSnap;
  delete this.canvas.dataset.editorAxis;
  delete this.canvas.dataset.editorDragging;
}

Object.assign(KyxosViewer.prototype, {
  createEditorTransformControls,
  setEditorTransformSelection,
  setEditorTransformMode,
  setEditorTransformSpace,
  setEditorTransformPivot,
  setEditorTransformSnap,
  refreshEditorTransformControls,
  disposeEditorTransformControls,
});

declare module './KyxosViewer' {
  interface KyxosViewer {
    createEditorTransformControls(): void;
    setEditorTransformSelection(nodeIds: string[]): void;
    setEditorTransformMode(mode: EditorTransformMode): void;
    setEditorTransformSpace(space: EditorTransformSpace): void;
    setEditorTransformPivot(pivot: EditorTransformPivot): void;
    setEditorTransformSnap(snap: EditorTransformSnap): void;
    refreshEditorTransformControls(): void;
    disposeEditorTransformControls(): void;
  }
}