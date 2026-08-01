import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { KyxosViewer } from './KyxosViewer';

export type EditorTransformMode = 'select' | 'translate' | 'rotate' | 'scale';
export type EditorTransformSpace = 'local' | 'world';

export interface EditorTransformSnap {
  enabled: boolean;
  translation: number;
  rotation: number;
  scale: number;
}

interface EditorControlState {
  controls: TransformControls;
  helper: THREE.Object3D;
  mode: EditorTransformMode;
  selectedNodeIds: string[];
  snap: EditorTransformSnap;
  space: EditorTransformSpace;
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

const editorStates = new WeakMap<KyxosViewer, EditorControlState>();

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function findNodeObject(viewer: KyxosViewer, nodeId: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null;
  internals(viewer).modelRoot.traverse((object) => {
    if (!result && object.userData.kyxosNodeId === nodeId) result = object;
  });
  return result;
}

function transformDetail(object: THREE.Object3D, mode: EditorTransformMode) {
  const nodeId = String(object.userData.kyxosNodeId ?? '');
  const property = mode === 'rotate' ? 'rotation' : mode === 'scale' ? 'scale' : 'position';
  const vector = object[property] as THREE.Vector3 | THREE.Euler;
  return {
    changes: (['x', 'y', 'z'] as const).map((axis) => ({
      nodeId,
      property,
      axis,
      value: vector[axis],
    })),
    mergeKey: `transform-controls:${mode}:${nodeId}`,
  };
}

function syncCanvasState(viewer: KyxosViewer, state: EditorControlState): void {
  viewer.canvas.dataset.editorGizmo = 'three-transform-controls';
  viewer.canvas.dataset.editorTool = state.mode;
  viewer.canvas.dataset.editorSpace = state.space;
  viewer.canvas.dataset.editorSelection = state.selectedNodeIds.join(',');
  viewer.canvas.dataset.editorSnap = String(state.snap.enabled);
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
  syncCanvasState(viewer, state);
  if (state.mode === 'select') {
    state.controls.detach();
    state.helper.visible = false;
    return;
  }
  const object = state.selectedNodeIds[0]
    ? findNodeObject(viewer, state.selectedNodeIds[0])
    : null;
  if (!object) {
    state.controls.detach();
    state.helper.visible = false;
    return;
  }
  state.controls.setMode(state.mode);
  applySnap(state);
  state.controls.attach(object);
  state.helper.visible = true;
}

export function createEditorTransformControls(this: KyxosViewer): void {
  this.disposeEditorTransformControls();
  const internal = internals(this);
  const controls = new TransformControls(internal.camera, this.canvas);
  const helper = controls.getHelper();
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
    mode: 'select',
    selectedNodeIds: [],
    snap: {
      enabled: false,
      translation: 0.1,
      rotation: 15,
      scale: 0.1,
    },
    space: 'local',
    onObjectChange: () => {
      const object = controls.object;
      if (!object || state.mode === 'select') return;
      object.updateMatrix();
      object.updateMatrixWorld(true);
      this.dispatchEvent(
        new CustomEvent('editor-transform-change', {
          detail: transformDetail(object, state.mode),
        }),
      );
    },
    onDraggingChanged: (event) => {
      if (internal.controls) internal.controls.enabled = !Boolean(event.value);
      this.canvas.dataset.editorDragging = String(Boolean(event.value));
      this.dispatchEvent(
        new CustomEvent('editor-transform-dragging', {
          detail: { dragging: Boolean(event.value) },
        }),
      );
    },
    onMouseDown: () => {
      this.dispatchEvent(
        new CustomEvent('editor-transform-start', {
          detail: { nodeIds: [...state.selectedNodeIds] },
        }),
      );
    },
    onMouseUp: () => {
      this.dispatchEvent(
        new CustomEvent('editor-transform-end', {
          detail: { nodeIds: [...state.selectedNodeIds] },
        }),
      );
    },
  };

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
  attachCurrent(this, state);
}

export function setEditorTransformMode(
  this: KyxosViewer,
  mode: EditorTransformMode,
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.mode = mode;
  attachCurrent(this, state);
}

export function setEditorTransformSpace(
  this: KyxosViewer,
  space: EditorTransformSpace,
): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.space = space;
  applySnap(state);
  syncCanvasState(this, state);
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
  if (!state) return;
  attachCurrent(this, state);
}

export function disposeEditorTransformControls(this: KyxosViewer): void {
  const state = editorStates.get(this);
  if (!state) return;
  state.controls.removeEventListener('objectChange', state.onObjectChange);
  state.controls.removeEventListener('dragging-changed', state.onDraggingChanged as never);
  state.controls.removeEventListener('mouseDown', state.onMouseDown);
  state.controls.removeEventListener('mouseUp', state.onMouseUp);
  state.controls.detach();
  state.controls.dispose();
  state.helper.removeFromParent();
  editorStates.delete(this);
  const orbit = internals(this).controls;
  if (orbit) orbit.enabled = true;
  delete this.canvas.dataset.editorGizmo;
  delete this.canvas.dataset.editorTool;
  delete this.canvas.dataset.editorSpace;
  delete this.canvas.dataset.editorSelection;
  delete this.canvas.dataset.editorSnap;
  delete this.canvas.dataset.editorDragging;
}

Object.assign(KyxosViewer.prototype, {
  createEditorTransformControls,
  setEditorTransformSelection,
  setEditorTransformMode,
  setEditorTransformSpace,
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
    setEditorTransformSnap(snap: EditorTransformSnap): void;
    refreshEditorTransformControls(): void;
    disposeEditorTransformControls(): void;
  }
}
