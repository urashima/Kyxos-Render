import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import type { Camera, Group, Object3D, Scene } from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';
import { disposeObject3D } from './utils/dispose';

type LoadScene = (
  this: KyxosViewer,
  scene: KyxosSceneContract,
  resolver: AssetResolver,
) => Promise<void>;

type RenderFrame = (this: KyxosViewer, time: number) => void;
type DisposeViewer = (this: KyxosViewer) => void;

interface AsyncRenderer {
  renderAsync?(scene: Scene, camera: Camera): Promise<unknown>;
  render?(scene: Scene, camera: Camera): unknown;
}

interface ViewerInternals {
  scene?: Scene;
  camera?: Camera;
  controls?: { update(): void };
  renderer?: AsyncRenderer;
  modelRoot?: Group;
  animateScene?: (elapsed: number, delta: number) => void;
  animationEnabled?: boolean;
  lastFrameTime?: number;
  elapsed?: number;
  disposed?: boolean;
  editorDirectRender?: boolean;
  editorRenderPending?: boolean;
  editorShellObserver?: MutationObserver;
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

function clearModelRoot(viewer: KyxosViewer): void {
  const internal = internals(viewer);
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
  if (!enabled) {
    (viewer as unknown as ViewerPrototypeInternals).resetTemporal?.('studio-preview-full-pipeline');
  }
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
    || internal.editorRenderPending
    || !internal.renderer
    || !internal.scene
    || !internal.camera
  ) {
    return;
  }

  const previous = internal.lastFrameTime ?? time;
  const delta = Math.min(0.1, Math.max(0, (time - previous) / 1000));
  internal.lastFrameTime = time;
  internal.elapsed = (internal.elapsed ?? 0) + delta;
  internal.controls?.update();
  if (internal.animationEnabled) internal.animateScene?.(internal.elapsed, delta);

  try {
    const result = internal.renderer.renderAsync
      ? internal.renderer.renderAsync(internal.scene, internal.camera)
      : internal.renderer.render?.(internal.scene, internal.camera);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      internal.editorRenderPending = true;
      void Promise.resolve(result)
        .catch((error) => viewer.dispatchEvent(new CustomEvent('error', { detail: { error } })))
        .finally(() => { internal.editorRenderPending = false });
    }
  } catch (error) {
    viewer.dispatchEvent(new CustomEvent('error', { detail: { error } }));
  }
}

/**
 * Keeps reusable Playground defaults out of authored Scene Contract content.
 * Studio Authoring uses a lightweight direct render loop so importing a real
 * mesh cannot block the UI while the complete MRT/post-processing graph compiles.
 * Entering Preview mode restores the full saved RenderPipeline. Public Viewer
 * has no Studio shell and therefore always keeps the full pipeline.
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
    clearModelRoot(this);
    clearUnmanagedPlaygroundLights(this);
    await originalLoadScene.call(this, scene, resolver);

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
    internals(this).editorShellObserver?.disconnect();
    internals(this).editorShellObserver = undefined;
    originalDispose?.call(this);
  };

  prototype.__kyxosEditorSceneModeInstalled = true;
}
