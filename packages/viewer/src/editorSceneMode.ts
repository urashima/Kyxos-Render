import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import {
  type Camera,
  type Group,
  type Material,
  type Object3D,
  type Scene,
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

type ControlsLike = {
  update(): void;
  addEventListener?(type: 'change', listener: EventListener): void;
  removeEventListener?(type: 'change', listener: EventListener): void;
};

interface DirectRenderer {
  render?(scene: Scene, camera: Camera): unknown;
}

interface StudioImportLifecycleDetail {
  stage?: string;
}

interface ViewerInternals {
  scene?: Scene;
  camera?: Camera;
  controls?: ControlsLike;
  renderer?: DirectRenderer;
  modelRoot?: Group;
  animateScene?: (elapsed: number, delta: number) => void;
  animationEnabled?: boolean;
  lastFrameTime?: number;
  elapsed?: number;
  disposed?: boolean;
  editorDirectRender?: boolean;
  editorRenderSuspended?: boolean;
  editorNeedsRender?: boolean;
  editorImportActive?: boolean;
  editorResumeTimer?: number;
  editorShellObserver?: MutationObserver;
  editorImportListener?: EventListener;
  editorControlListener?: EventListener;
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

function requestAuthoringRender(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  internal.editorNeedsRender = true;
  viewer.canvas.dataset.authoringDirty = 'true';
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
 * Studio previously replaced every imported material with MeshBasicMaterial.
 * That made import transactions cheap, but silently discarded base-color,
 * normal, AO, metallic/roughness and glTF physical-extension textures. Direct
 * authoring rendering is already demand-driven, so keep GLTFLoader's exact PBR
 * graph and only bypass the post-processing pipeline.
 */
function applyExactAuthoringMaterials(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  const root = internal.modelRoot;
  if (!root || !internal.editorDirectRender) return;

  restoreOriginalMaterials(viewer);
  let meshes = 0;
  root.traverse((object) => {
    const mesh = object as MeshLike;
    if (mesh.isMesh && mesh.material) meshes += 1;
  });
  viewer.canvas.dataset.authoringMaterials = meshes ? 'exact-gltf' : 'none';
  requestAuthoringRender(viewer);
}

function clearResumeTimer(internal: ViewerInternals): void {
  if (internal.editorResumeTimer != null) {
    window.clearTimeout(internal.editorResumeTimer);
    internal.editorResumeTimer = undefined;
  }
}

function pauseAuthoringRender(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  clearResumeTimer(internal);
  internal.editorRenderSuspended = true;
  viewer.canvas.dataset.authoringReady = 'false';
}

function resumeAuthoringRenderAfter(viewer: KyxosViewer, delay = 1_500): void {
  const internal = internals(viewer);
  clearResumeTimer(internal);
  internal.editorResumeTimer = window.setTimeout(() => {
    internal.editorResumeTimer = undefined;
    if (internal.editorImportActive) return;
    internal.editorRenderSuspended = false;
    viewer.canvas.dataset.authoringReady = 'true';
    requestAuthoringRender(viewer);
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
  requestAuthoringRender(viewer);
}

function clearUnmanagedPlaygroundLights(viewer: KyxosViewer): void {
  const scene = internals(viewer).scene;
  if (!scene) return;
  for (const child of [...scene.children]) {
    const light = child as Object3D & { isLight?: boolean };
    if (light.isLight && !light.userData.kyxosManagedLight) light.removeFromParent();
  }
}

function setDirectAuthoringRender(viewer: KyxosViewer, enabled: boolean): void {
  const internal = internals(viewer);
  if (internal.editorDirectRender === enabled) return;
  internal.editorDirectRender = enabled;
  viewer.canvas.dataset.authoringRender = enabled ? 'direct' : 'pipeline';
  if (enabled) {
    applyExactAuthoringMaterials(viewer);
    pauseAuthoringRender(viewer);
    resumeAuthoringRenderAfter(viewer);
  } else {
    restoreOriginalMaterials(viewer);
    internal.editorRenderSuspended = false;
    internal.editorNeedsRender = false;
    delete viewer.canvas.dataset.authoringDirty;
    (viewer as unknown as ViewerPrototypeInternals).resetTemporal?.('studio-preview-full-pipeline');
  }
}

function bindImportLifecycle(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  if (internal.editorImportListener) return;

  const listener: EventListener = (event) => {
    const detail = (event as CustomEvent<StudioImportLifecycleDetail>).detail;
    const stage = detail?.stage ?? '';
    if (['queued', 'hashing', 'uploading', 'parsing', 'building'].includes(stage)) {
      internal.editorImportActive = true;
      pauseAuthoringRender(viewer);
      viewer.canvas.dataset.authoringImport = stage;
      return;
    }
    if (['core-complete', 'failed', 'cancelled'].includes(stage)) {
      internal.editorImportActive = false;
      viewer.canvas.dataset.authoringImport = stage;
      resumeAuthoringRenderAfter(viewer);
    }
  };
  document.addEventListener('kyxos:studio-import-lifecycle', listener);
  internal.editorImportListener = listener;
}

function bindControlRendering(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  if (internal.editorControlListener || !internal.controls?.addEventListener) return;
  const listener: EventListener = () => requestAuthoringRender(viewer);
  internal.controls.addEventListener('change', listener);
  internal.editorControlListener = listener;
}

function bindStudioMode(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  internal.editorShellObserver?.disconnect();
  internal.editorShellObserver = undefined;

  const shell = viewer.canvas.closest<HTMLElement>('.kyxos-studio-shell');
  if (!shell) {
    setDirectAuthoringRender(viewer, false);
    return;
  }

  bindImportLifecycle(viewer);
  bindControlRendering(viewer);
  const update = () => setDirectAuthoringRender(
    viewer,
    !shell.classList.contains('preview-mode'),
  );
  update();
  const observer = new MutationObserver(update);
  observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
  internal.editorShellObserver = observer;
}

function renderDirectFrame(viewer: KyxosViewer, time: number): void {
  const internal = internals(viewer);
  if (
    internal.disposed
    || internal.editorRenderSuspended
    || (!internal.editorNeedsRender && !internal.animationEnabled)
    || !internal.renderer?.render
    || !internal.scene
    || !internal.camera
  ) {
    return;
  }

  const previous = internal.lastFrameTime ?? time;
  const delta = Math.min(0.1, Math.max(0, (time - previous) / 1000));
  internal.lastFrameTime = time;
  internal.elapsed = (internal.elapsed ?? 0) + delta;
  internal.editorNeedsRender = Boolean(internal.animationEnabled);
  viewer.canvas.dataset.authoringDirty = String(Boolean(internal.editorNeedsRender));
  internal.controls?.update();
  if (internal.animationEnabled) internal.animateScene?.(internal.elapsed, delta);

  try {
    internal.renderer.render(internal.scene, internal.camera);
  } catch (error) {
    viewer.dispatchEvent(new CustomEvent('error', { detail: { error } }));
  }
}

/**
 * Keeps reusable Playground defaults out of authored Scene Contract content.
 * Studio pauses rendering for the complete import transaction and renders only
 * dirty Authoring frames with the exact imported PBR/texture graph. Preview
 * switches back to the full RenderPipeline. Public Viewer never uses import
 * pausing or demand-driven editor rendering.
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
    if (internals(this).editorDirectRender) {
      renderDirectFrame(this, time);
      return;
    }
    originalRenderFrame.call(this, time);
  };

  prototype.loadScene = async function loadEditorScene(
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    bindStudioMode(this);
    const internal = internals(this);
    if (internal.editorDirectRender) pauseAuthoringRender(this);
    clearModelRoot(this);
    clearUnmanagedPlaygroundLights(this);
    await originalLoadScene.call(this, scene, resolver);

    if (internal.editorDirectRender) {
      applyExactAuthoringMaterials(this);
      if (!internal.editorImportActive) resumeAuthoringRenderAfter(this);
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
    internal.editorShellObserver?.disconnect();
    if (internal.editorImportListener) {
      document.removeEventListener('kyxos:studio-import-lifecycle', internal.editorImportListener);
    }
    if (internal.editorControlListener) {
      internal.controls?.removeEventListener?.('change', internal.editorControlListener);
    }
    clearResumeTimer(internal);
    restoreOriginalMaterials(this);
    internal.editorShellObserver = undefined;
    internal.editorImportListener = undefined;
    internal.editorControlListener = undefined;
    originalDispose?.call(this);
  };

  prototype.__kyxosEditorSceneModeInstalled = true;
}
