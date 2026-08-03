import * as THREE from 'three/webgpu';
import type { SceneCamera, Vec3 } from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';
import type {
  EditorTransformMode,
  EditorTransformPivot,
  EditorTransformSnap,
  EditorTransformSpace,
} from './editorTransformControls';

export type EditorViewPreset =
  | 'perspective'
  | 'front'
  | 'back'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

export interface EditorCameraBookmarkState {
  camera: SceneCamera;
  up: Vec3;
  preset?: EditorViewPreset;
}

interface ViewerInternals {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: {
    object: THREE.Camera;
    target: THREE.Vector3;
    update(): void;
  };
  modelRoot: THREE.Object3D;
  resizeToCanvas(): void;
  resetTemporal(reason: string): void;
  queuePipelineRebuild(reason: string): void;
}

const installed = Symbol('kyxos.editorViewportNavigation.installed');
const activePresets = new WeakMap<KyxosViewer, EditorViewPreset>();

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function sceneBounds(viewer: KyxosViewer): THREE.Sphere {
  const internal = internals(viewer);
  const bounds = new THREE.Box3().setFromObject(internal.modelRoot);
  if (bounds.isEmpty()) {
    return new THREE.Sphere(internal.controls.target.clone(), 1);
  }
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = 1;
  return sphere;
}

function vector(value: THREE.Vector3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function transform(
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
): SceneCamera['transform'] {
  return {
    position: vector(position),
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function refreshEditorTransformCamera(viewer: KyxosViewer): void {
  const canvas = viewer.canvas;
  if (!canvas.dataset.editorGizmo) return;
  const mode = (canvas.dataset.editorTool ?? 'select') as EditorTransformMode;
  const space = (canvas.dataset.editorSpace ?? 'local') as EditorTransformSpace;
  const pivot = (canvas.dataset.editorPivot ?? 'active') as EditorTransformPivot;
  const selected = (canvas.dataset.editorSelection ?? '').split(',').filter(Boolean);
  const snap: EditorTransformSnap = {
    enabled: canvas.dataset.editorSnap === 'true',
    translation: 0.1,
    rotation: 15,
    scale: 0.1,
  };
  viewer.disposeEditorTransformControls();
  viewer.createEditorTransformControls();
  viewer.setEditorTransformSelection(selected);
  viewer.setEditorTransformMode(mode);
  viewer.setEditorTransformSpace(space);
  viewer.setEditorTransformPivot(pivot);
  viewer.setEditorTransformSnap(snap);
}

function presetDirection(preset: Exclude<EditorViewPreset, 'perspective'>): THREE.Vector3 {
  return {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    top: new THREE.Vector3(0, 1, 0),
    bottom: new THREE.Vector3(0, -1, 0),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
  }[preset];
}

export function setEditorViewPreset(
  this: KyxosViewer,
  preset: EditorViewPreset,
): void {
  const sphere = sceneBounds(this);
  const radius = Math.max(0.5, sphere.radius);
  const distance = Math.max(2, radius * 3);
  const direction = preset === 'perspective'
    ? new THREE.Vector3(1, 0.72, 1).normalize()
    : presetDirection(preset);
  const position = sphere.center.clone().addScaledVector(direction, distance);
  const camera: SceneCamera = {
    id: `editor-${preset}`,
    name: `Editor ${preset}`,
    transform: transform(position),
    target: vector(sphere.center),
    fov: 45,
    near: Math.max(0.001, distance / 10_000),
    far: Math.max(1_000, distance + radius * 20),
    projection: preset === 'perspective' ? 'perspective' : 'orthographic',
    orthographicSize: preset === 'perspective' ? undefined : radius * 1.25,
    autoRotate: false,
  };
  this.setCameraState(camera);

  const next = internals(this);
  next.camera.up.set(0, 1, 0);
  if (preset === 'top') next.camera.up.set(0, 0, -1);
  if (preset === 'bottom') next.camera.up.set(0, 0, 1);
  next.controls.target.copy(sphere.center);
  next.camera.lookAt(sphere.center);
  next.controls.update();
  activePresets.set(this, preset);
  this.canvas.dataset.editorView = preset;
  delete this.canvas.dataset.editorBookmarkSlot;
  this.canvas.dataset.editorCameraProjection = camera.projection ?? 'perspective';
  next.resetTemporal(`editor-view:${preset}`);
  this.dispatchEvent(new CustomEvent('editor-view-change', {
    detail: { preset, projection: camera.projection },
  }));
}

export function frameAllEditorContent(this: KyxosViewer): void {
  const internal = internals(this);
  const sphere = sceneBounds(this);
  const radius = Math.max(0.5, sphere.radius);
  const direction = internal.camera.position.clone().sub(internal.controls.target);
  if (direction.lengthSq() < 1e-8) direction.set(1, 0.72, 1);
  direction.normalize();
  internal.controls.target.copy(sphere.center);

  if (internal.camera instanceof THREE.OrthographicCamera) {
    internal.camera.userData.kyxosOrthographicSize = radius * 1.25;
    internal.camera.position.copy(sphere.center).addScaledVector(direction, radius * 3);
    internal.resizeToCanvas();
  } else {
    const halfFov = THREE.MathUtils.degToRad(internal.camera.fov * 0.5);
    const distance = Math.max(2, radius / Math.max(0.05, Math.sin(halfFov)) * 1.2);
    internal.camera.position.copy(sphere.center).addScaledVector(direction, distance);
  }
  internal.camera.lookAt(sphere.center);
  internal.controls.update();
  internal.resetTemporal('editor-frame-all');
  this.canvas.dataset.editorFrameAllAt = String(performance.now());
  delete this.canvas.dataset.editorBookmarkSlot;
  this.dispatchEvent(new CustomEvent('editor-frame-all', {
    detail: { center: vector(sphere.center), radius },
  }));
}

export function captureEditorCameraBookmark(
  this: KyxosViewer,
): EditorCameraBookmarkState {
  const internal = internals(this);
  const camera = internal.camera;
  return {
    camera: {
      id: 'editor-bookmark',
      name: 'Editor Bookmark',
      transform: transform(camera.position, camera.rotation),
      target: vector(internal.controls.target),
      fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 45,
      near: camera.near,
      far: camera.far,
      projection: camera instanceof THREE.OrthographicCamera
        ? 'orthographic'
        : 'perspective',
      orthographicSize: camera instanceof THREE.OrthographicCamera
        ? Number(camera.userData.kyxosOrthographicSize ?? camera.top)
        : undefined,
      autoRotate: false,
    },
    up: vector(camera.up),
    preset: activePresets.get(this),
  };
}

export function restoreEditorCameraBookmark(
  this: KyxosViewer,
  state: EditorCameraBookmarkState,
  slot?: number,
): void {
  this.setCameraState(state.camera);
  const internal = internals(this);
  internal.camera.up.set(state.up.x, state.up.y, state.up.z);
  internal.controls.target.set(
    state.camera.target.x,
    state.camera.target.y,
    state.camera.target.z,
  );
  internal.camera.lookAt(internal.controls.target);
  internal.controls.update();
  if (state.preset) activePresets.set(this, state.preset);
  else activePresets.delete(this);
  this.canvas.dataset.editorView = state.preset ?? 'bookmark';
  if (slot != null) this.canvas.dataset.editorBookmarkSlot = String(slot);
  this.canvas.dataset.editorCameraProjection = state.camera.projection ?? 'perspective';
  internal.resetTemporal(`editor-bookmark:${slot ?? 'custom'}`);
  this.dispatchEvent(new CustomEvent('editor-camera-bookmark-restored', {
    detail: { slot, state },
  }));
}

export function getEditorViewPreset(this: KyxosViewer): EditorViewPreset {
  return activePresets.get(this) ?? 'perspective';
}

const prototype = KyxosViewer.prototype as unknown as KyxosViewer & {
  [installed]?: boolean;
};
if (!prototype[installed]) {
  const originalSetCameraState = prototype.setCameraState;
  prototype.setCameraState = function setCameraStateWithEditorControls(
    this: KyxosViewer,
    camera,
  ): void {
    const before = internals(this).camera;
    originalSetCameraState.call(this, camera);
    const after = internals(this).camera;
    if (after !== before) internals(this).queuePipelineRebuild('editor-camera-projection');
    refreshEditorTransformCamera(this);
    this.canvas.dataset.editorCameraProjection =
      after instanceof THREE.OrthographicCamera
        ? 'orthographic'
        : 'perspective';
  };
  Object.assign(prototype, {
    setEditorViewPreset,
    frameAllEditorContent,
    captureEditorCameraBookmark,
    restoreEditorCameraBookmark,
    getEditorViewPreset,
  });
  prototype[installed] = true;
}

declare module './KyxosViewer' {
  interface KyxosViewer {
    setEditorViewPreset(preset: EditorViewPreset): void;
    frameAllEditorContent(): void;
    captureEditorCameraBookmark(): EditorCameraBookmarkState;
    restoreEditorCameraBookmark(state: EditorCameraBookmarkState, slot?: number): void;
    getEditorViewPreset(): EditorViewPreset;
  }
}
