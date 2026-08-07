import type {
  AssetResolver,
  KyxosSceneContract,
  SceneCamera,
  ScenePatch,
} from '@kyxos/scene-contract';
import {
  type Group,
  type Material,
  type Object3D,
} from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';
import type { EditorCameraBookmarkState } from './editorViewportNavigation';
import type { CameraState } from './sceneTypes';
import { disposeObject3D } from './utils/dispose';

type CameraInput = SceneCamera | (CameraState & { id?: string; name?: string });
type LoadScene = (
  this: KyxosViewer,
  scene: KyxosSceneContract,
  resolver: AssetResolver,
) => Promise<void>;
type ApplyScenePatch = (this: KyxosViewer, patch: ScenePatch) => Promise<void>;
type RenderFrame = (this: KyxosViewer, time: number) => void;
type DisposeViewer = (this: KyxosViewer) => void;
type SetCameraState = (this: KyxosViewer, camera?: CameraInput) => void;
type MeshLike = Object3D & {
  isMesh?: boolean;
  material?: Material | Material[];
};

interface StudioImportLifecycleDetail {
  stage?: string;
}

interface ViewerInternals {
  scene?: { children: Object3D[] };
  modelRoot?: Group;
  animateScene?: (elapsed: number, delta: number) => void;
  animationEnabled?: boolean;
  editorStudioPipeline?: boolean;
  editorRenderSuspended?: boolean;
  editorImportActive?: boolean;
  editorSceneLoading?: boolean;
  editorResumeTimer?: number;
  editorImportListener?: EventListener;
  editorOriginalMaterials?: Map<MeshLike, Material | Material[]>;
  editorProxyMaterials?: Set<Material>;
  editorAuthoringCameraDetached?: boolean;
  editorAuthoredSceneCamera?: CameraInput;
  editorSceneCameraViewId?: string;
  editorAuthoringCameraBookmark?: EditorCameraBookmarkState;
}

interface ViewerPrototypeInternals {
  loadScene?: LoadScene;
  applyScenePatch?: ApplyScenePatch;
  renderFrame?: RenderFrame;
  dispose?: DisposeViewer;
  setCameraState?: SetCameraState;
  getLoadedSceneContract?(): KyxosSceneContract | null;
  captureEditorCameraBookmark?(): EditorCameraBookmarkState;
  restoreEditorCameraBookmark?(state: EditorCameraBookmarkState): void;
  setEditorViewPreset?(preset: 'perspective'): void;
  setEditorSceneCameraView?(cameraId?: string): boolean;
  resetTemporal?(reason?: string): void;
  __kyxosEditorSceneModeInstalled?: boolean;
}

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function disposeProxyMaterials(internal: ViewerInternals): void {
  for (const material of internal.editorProxyMaterials ?? []) material.dispose();
  internal.editorProxyMaterials?.clear();
}

function restoreOriginalMaterials(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  for (const [mesh, material] of internal.editorOriginalMaterials ?? []) {
    mesh.material = material;
  }
  internal.editorOriginalMaterials?.clear();
  disposeProxyMaterials(internal);
}

/**
 * Studio used to render its editing viewport through renderer.render(), which
 * intentionally bypassed the complete Playground RenderPipeline. Keep the
 * native glTF material graph, but let the normal pipeline consume it so TRAA,
 * SSGI, GTAO / SSAO, SSR, Bloom, DoF and the remaining authored effects are
 * visible while editing instead of only after entering Preview mode.
 */
function preserveExactAuthoringMaterials(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  const root = internal.modelRoot;
  if (!root) return;

  restoreOriginalMaterials(viewer);
  let meshes = 0;
  root.traverse((object) => {
    const mesh = object as MeshLike;
    if (mesh.isMesh && mesh.material) meshes += 1;
  });
  viewer.canvas.dataset.authoringMaterials = meshes ? 'exact-gltf' : 'none';
}

function clearResumeTimer(internal: ViewerInternals): void {
  if (internal.editorResumeTimer != null) {
    window.clearTimeout(internal.editorResumeTimer);
    internal.editorResumeTimer = undefined;
  }
}

function pauseStudioPipeline(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  clearResumeTimer(internal);
  internal.editorRenderSuspended = true;
  viewer.canvas.dataset.authoringReady = 'false';
  viewer.canvas.dataset.authoringRender = 'pipeline';
  viewer.canvas.dataset.authoringPipeline = 'playground';
}

function resumeStudioPipelineAfter(viewer: KyxosViewer, delay = 80): void {
  const internal = internals(viewer);
  clearResumeTimer(internal);
  internal.editorResumeTimer = window.setTimeout(() => {
    internal.editorResumeTimer = undefined;
    if (internal.editorImportActive || internal.editorSceneLoading) return;
    internal.editorRenderSuspended = false;
    viewer.canvas.dataset.authoringReady = 'true';
    viewer.canvas.dataset.authoringRender = 'pipeline';
    viewer.canvas.dataset.authoringPipeline = 'playground';
    (viewer as unknown as ViewerPrototypeInternals).resetTemporal?.(
      'studio-authoring-pipeline-resume',
    );
  }, delay);
}

function clearModelRoot(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  restoreOriginalMaterials(viewer);
  const root = internal.modelRoot;
  if (root) {
    for (const child of [...root.children]) {
      child.removeFromParent();
      disposeObject3D(child as Object3D);
    }
    root.updateMatrixWorld(true);
  }

  internal.animateScene = () => undefined;
  internal.animationEnabled = false;
}

function clearStudioDefaultDecorations(viewer: KyxosViewer): void {
  const scene = internals(viewer).scene;
  if (!scene) return;
  let floorCount = 0;
  let lightCount = 0;
  for (const child of [...scene.children]) {
    const object = child as Object3D & { isLight?: boolean };
    const defaultAdornment = object.userData.kyxosDefaultSceneAdornment === true;
    const unmanagedLight = object.isLight && object.userData.kyxosManagedLight !== true;
    if (!defaultAdornment && !unmanagedLight) continue;
    if (object.isLight) lightCount += 1;
    else floorCount += 1;
    object.removeFromParent();
    disposeObject3D(object);
  }
  viewer.canvas.dataset.studioDefaultFloor = floorCount ? 'removed' : 'absent';
  viewer.canvas.dataset.studioDefaultLights = lightCount ? 'removed' : 'absent';
}

function bindImportLifecycle(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  if (internal.editorImportListener) return;

  const listener: EventListener = (event) => {
    const detail = (event as CustomEvent<StudioImportLifecycleDetail>).detail;
    const stage = detail?.stage ?? '';
    if (['queued', 'hashing', 'uploading', 'parsing', 'building'].includes(stage)) {
      internal.editorImportActive = true;
      pauseStudioPipeline(viewer);
      viewer.canvas.dataset.authoringImport = stage;
      return;
    }
    if (['core-complete', 'failed', 'cancelled'].includes(stage)) {
      internal.editorImportActive = false;
      viewer.canvas.dataset.authoringImport = stage;
      resumeStudioPipelineAfter(viewer);
    }
  };
  document.addEventListener('kyxos:studio-import-lifecycle', listener);
  internal.editorImportListener = listener;
}

function clearSceneCameraView(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  internal.editorSceneCameraViewId = undefined;
  delete viewer.canvas.dataset.editorSceneCameraView;
}

function bindStudioMode(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  const shell = viewer.canvas.closest<HTMLElement>('.kyxos-studio-shell');
  internal.editorStudioPipeline = Boolean(shell);
  internal.editorAuthoringCameraDetached = Boolean(shell);
  if (!shell) {
    internal.editorRenderSuspended = false;
    internal.editorAuthoredSceneCamera = undefined;
    internal.editorAuthoringCameraBookmark = undefined;
    clearSceneCameraView(viewer);
    delete viewer.canvas.dataset.authoringCamera;
    delete viewer.canvas.dataset.authoredSceneCamera;
    return;
  }

  bindImportLifecycle(viewer);
  viewer.canvas.dataset.authoringRender = 'pipeline';
  viewer.canvas.dataset.authoringPipeline = 'playground';
  viewer.canvas.dataset.authoringCamera = 'editor';
}

function cameraId(camera?: CameraInput): string {
  return typeof camera?.id === 'string' ? camera.id : '';
}

function isEditorCameraState(camera?: CameraInput): boolean {
  return cameraId(camera).startsWith('editor-');
}

/**
 * PlayCanvas keeps the authoring camera independent from user scene cameras.
 * Scene Contract activeCameraId is runtime state; it must not move the Studio
 * viewport every time a camera is added, edited or made active. Editor presets
 * and bookmarks deliberately use `editor-*` IDs and are allowed through.
 */
function shouldDetachSceneCamera(viewer: KyxosViewer, camera?: CameraInput): boolean {
  const internal = internals(viewer);
  return Boolean(
    internal.editorStudioPipeline &&
    internal.editorAuthoringCameraDetached &&
    camera &&
    !isEditorCameraState(camera),
  );
}

function resetPreviousSceneCameraView(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  if (!internal.editorSceneCameraViewId) return;
  const bookmark = internal.editorAuthoringCameraBookmark;
  clearSceneCameraView(viewer);
  internal.editorAuthoringCameraBookmark = undefined;
  if (bookmark) {
    (viewer as unknown as ViewerPrototypeInternals).restoreEditorCameraBookmark?.(bookmark);
  } else {
    (viewer as unknown as ViewerPrototypeInternals).setEditorViewPreset?.('perspective');
  }
}

/**
 * Keeps reusable Playground defaults out of authored Scene Contract content,
 * but uses the same complete runtime pipeline in Studio, Public Viewer and
 * Embed. Studio only pauses that pipeline during an import transaction; it no
 * longer swaps to a simplified direct-render path in normal editing mode.
 */
export function installEditorSceneModeExtension(ViewerClass: typeof KyxosViewer): void {
  const prototype = ViewerClass.prototype as unknown as ViewerPrototypeInternals;
  if (prototype.__kyxosEditorSceneModeInstalled) return;

  const originalLoadScene = prototype.loadScene;
  const originalApplyScenePatch = prototype.applyScenePatch;
  const originalRenderFrame = prototype.renderFrame;
  const originalDispose = prototype.dispose;
  const originalSetCameraState = prototype.setCameraState;
  if (
    typeof originalLoadScene !== 'function' ||
    typeof originalApplyScenePatch !== 'function' ||
    typeof originalRenderFrame !== 'function' ||
    typeof originalSetCameraState !== 'function'
  ) {
    throw new Error('Scene API and Viewer render loop must be installed before editor scene mode.');
  }

  prototype.setCameraState = function setAuthoringOrSceneCamera(camera?: CameraInput): void {
    const internal = internals(this);
    if (shouldDetachSceneCamera(this, camera)) {
      internal.editorAuthoredSceneCamera = camera ? structuredClone(camera) : undefined;
      if (!internal.editorSceneCameraViewId) this.canvas.dataset.authoringCamera = 'editor';
      this.canvas.dataset.authoredSceneCamera = cameraId(camera);
      this.dispatchEvent(new CustomEvent('editor-scene-camera-state', {
        detail: {
          camera: camera ? structuredClone(camera) : null,
          detached: true,
        },
      }));
      return;
    }

    if (internal.editorStudioPipeline && isEditorCameraState(camera)) {
      clearSceneCameraView(this);
      internal.editorAuthoringCameraBookmark = undefined;
    }
    originalSetCameraState.call(this, camera);
    if (internal.editorStudioPipeline) {
      this.canvas.dataset.authoringCamera = isEditorCameraState(camera) ? 'editor' : 'scene';
    }
  };

  prototype.setEditorSceneCameraView = function setEditorSceneCameraView(cameraIdValue?: string): boolean {
    const internal = internals(this);
    if (!internal.editorStudioPipeline) return false;

    if (!cameraIdValue) {
      const bookmark = internal.editorAuthoringCameraBookmark;
      clearSceneCameraView(this);
      internal.editorAuthoringCameraBookmark = undefined;
      if (bookmark && typeof prototype.restoreEditorCameraBookmark === 'function') {
        prototype.restoreEditorCameraBookmark.call(this, bookmark);
      } else if (typeof prototype.setEditorViewPreset === 'function') {
        prototype.setEditorViewPreset.call(this, 'perspective');
      }
      this.canvas.dataset.authoringCamera = 'editor';
      this.dispatchEvent(new CustomEvent('editor-scene-camera-view-change', {
        detail: { cameraId: null, active: false },
      }));
      return true;
    }

    const contract = prototype.getLoadedSceneContract?.call(this);
    const camera = contract?.cameras.find((entry) => entry.id === cameraIdValue);
    if (!camera) return false;
    if (!internal.editorSceneCameraViewId && typeof prototype.captureEditorCameraBookmark === 'function') {
      internal.editorAuthoringCameraBookmark = prototype.captureEditorCameraBookmark.call(this);
    }
    internal.editorSceneCameraViewId = camera.id;
    originalSetCameraState.call(this, camera);
    this.canvas.dataset.authoringCamera = 'scene';
    this.canvas.dataset.editorSceneCameraView = camera.id;
    this.dispatchEvent(new CustomEvent('editor-scene-camera-view-change', {
      detail: { cameraId: camera.id, active: true },
    }));
    return true;
  };

  prototype.renderFrame = function renderEditorFrame(time: number): void {
    const internal = internals(this);
    if (internal.editorStudioPipeline && internal.editorRenderSuspended) return;
    originalRenderFrame.call(this, time);
  };

  prototype.loadScene = async function loadEditorScene(
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    resetPreviousSceneCameraView(this);
    bindStudioMode(this);
    const internal = internals(this);
    const studio = Boolean(internal.editorStudioPipeline);
    internal.editorSceneLoading = true;
    if (studio) pauseStudioPipeline(this);
    clearModelRoot(this);
    if (studio) clearStudioDefaultDecorations(this);

    try {
      await originalLoadScene.call(this, scene, resolver);
      if (studio) preserveExactAuthoringMaterials(this);
    } finally {
      internal.editorSceneLoading = false;
      if (studio && !internal.editorImportActive) resumeStudioPipelineAfter(this);
    }

    const hasModel = Object.values(scene.assets).some((asset) => asset.kind === 'model');
    this.canvas.toggleAttribute('data-empty-scene', !hasModel);
    if (!hasModel) {
      this.dispatchEvent(
        new CustomEvent('scene-empty', {
          detail: { message: 'Upload or drop a GLB to start editing.' },
        }),
      );
    }
  };

  prototype.applyScenePatch = async function applyEditorScenePatch(patch: ScenePatch): Promise<void> {
    await originalApplyScenePatch.call(this, patch);
    const internal = internals(this);
    const viewId = internal.editorSceneCameraViewId;
    if (!viewId) return;
    const contract = prototype.getLoadedSceneContract?.call(this);
    const camera = contract?.cameras.find((entry) => entry.id === viewId);
    if (!camera) {
      prototype.setEditorSceneCameraView?.call(this);
      return;
    }
    originalSetCameraState.call(this, camera);
    this.canvas.dataset.authoringCamera = 'scene';
    this.canvas.dataset.editorSceneCameraView = camera.id;
  };

  prototype.dispose = function disposeEditorSceneMode(): void {
    const internal = internals(this);
    if (internal.editorImportListener) {
      document.removeEventListener('kyxos:studio-import-lifecycle', internal.editorImportListener);
    }
    clearResumeTimer(internal);
    restoreOriginalMaterials(this);
    internal.editorImportListener = undefined;
    internal.editorStudioPipeline = undefined;
    internal.editorRenderSuspended = undefined;
    internal.editorImportActive = undefined;
    internal.editorSceneLoading = undefined;
    internal.editorAuthoringCameraDetached = undefined;
    internal.editorAuthoredSceneCamera = undefined;
    internal.editorAuthoringCameraBookmark = undefined;
    clearSceneCameraView(this);
    delete this.canvas.dataset.authoringCamera;
    delete this.canvas.dataset.authoredSceneCamera;
    originalDispose?.call(this);
  };

  prototype.__kyxosEditorSceneModeInstalled = true;
}

declare module './KyxosViewer' {
  interface KyxosViewer {
    setEditorSceneCameraView(cameraId?: string): boolean;
  }
}