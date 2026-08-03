import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import {
  type Group,
  type Material,
  type Object3D,
} from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';
import { disposeObject3D } from './utils/dispose';

type LoadScene = (
  this: KyxosViewer,
  scene: KyxosSceneContract,
  resolver: AssetResolver,
) => Promise<void>;

type RenderFrame = (this: KyxosViewer, time: number) => void;
type DisposeViewer = (this: KyxosViewer) => void;
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
}

interface ViewerPrototypeInternals {
  loadScene?: LoadScene;
  renderFrame?: RenderFrame;
  dispose?: DisposeViewer;
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

function bindStudioMode(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  const shell = viewer.canvas.closest<HTMLElement>('.kyxos-studio-shell');
  internal.editorStudioPipeline = Boolean(shell);
  if (!shell) {
    internal.editorRenderSuspended = false;
    return;
  }

  bindImportLifecycle(viewer);
  viewer.canvas.dataset.authoringRender = 'pipeline';
  viewer.canvas.dataset.authoringPipeline = 'playground';
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
  const originalRenderFrame = prototype.renderFrame;
  const originalDispose = prototype.dispose;
  if (typeof originalLoadScene !== 'function' || typeof originalRenderFrame !== 'function') {
    throw new Error('Scene API and Viewer render loop must be installed before editor scene mode.');
  }

  prototype.renderFrame = function renderEditorFrame(time: number): void {
    const internal = internals(this);
    if (internal.editorStudioPipeline && internal.editorRenderSuspended) return;
    originalRenderFrame.call(this, time);
  };

  prototype.loadScene = async function loadEditorScene(
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
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
    originalDispose?.call(this);
  };

  prototype.__kyxosEditorSceneModeInstalled = true;
}
