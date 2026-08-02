import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import {
  Color,
  MeshBasicMaterial,
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
  editorRenderSuspended?: boolean;
  editorResumeTimer?: number;
  editorShellObserver?: MutationObserver;
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

function sourceColor(material: Material): Color {
  const candidate = (material as Material & { color?: Color }).color;
  return candidate?.isColor ? candidate.clone() : new Color(0x9aa4b2);
}

function proxyMaterial(source: Material, internal: ViewerInternals): Material {
  const candidate = source as Material & {
    opacity?: number;
    transparent?: boolean;
    side?: number;
    depthTest?: boolean;
    depthWrite?: boolean;
    vertexColors?: boolean;
  };
  const proxy = new MeshBasicMaterial({
    color: sourceColor(source),
    opacity: candidate.opacity ?? 1,
    transparent: Boolean(candidate.transparent || (candidate.opacity ?? 1) < 1),
    side: candidate.side,
    depthTest: candidate.depthTest ?? true,
    depthWrite: candidate.depthWrite ?? true,
    vertexColors: Boolean(candidate.vertexColors),
    toneMapped: false,
  });
  proxy.name = `${source.name || source.type} · Authoring Proxy`;
  proxy.userData.kyxosAuthoringProxy = true;
  internal.editorProxyMaterials ??= new Set();
  internal.editorProxyMaterials.add(proxy);
  return proxy;
}

function applyAuthoringProxyMaterials(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  const root = internal.modelRoot;
  if (!root || !internal.editorDirectRender) return;

  restoreOriginalMaterials(viewer);
  const originals = new Map<MeshLike, Material | Material[]>();
  internal.editorOriginalMaterials = originals;
  root.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh || !mesh.material) return;
    const original = mesh.material;
    originals.set(mesh, original);
    mesh.material = Array.isArray(original)
      ? original.map((material) => proxyMaterial(material, internal))
      : proxyMaterial(original, internal);
  });
  viewer.canvas.dataset.authoringMaterials = originals.size ? 'proxy' : 'none';
}

function suspendAuthoringRender(viewer: KyxosViewer): void {
  const internal = internals(viewer);
  internal.editorRenderSuspended = true;
  if (internal.editorResumeTimer != null) window.clearTimeout(internal.editorResumeTimer);
  // Give SceneDocument listeners, Hierarchy, Asset Workspace and the completion
  // marker a full browser turn before the first GPU compilation for the model.
  internal.editorResumeTimer = window.setTimeout(() => {
    internal.editorResumeTimer = undefined;
    internal.editorRenderSuspended = false;
    viewer.canvas.dataset.authoringReady = 'true';
  }, 750);
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
    applyAuthoringProxyMaterials(viewer);
    suspendAuthoringRender(viewer);
  } else {
    restoreOriginalMaterials(viewer);
    internal.editorRenderSuspended = false;
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
    || internal.editorRenderSuspended
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
 * Studio Authoring renders imported meshes with lightweight, color-preserving
 * Basic proxy materials. Skinning and morph deformation remain attached to the
 * original mesh objects, while Preview restores the exact imported PBR material
 * graph and the complete saved RenderPipeline. Public Viewer never uses proxies.
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
    if (internals(this).editorDirectRender) suspendAuthoringRender(this);
    clearModelRoot(this);
    clearUnmanagedPlaygroundLights(this);
    await originalLoadScene.call(this, scene, resolver);

    if (internals(this).editorDirectRender) {
      applyAuthoringProxyMaterials(this);
      suspendAuthoringRender(this);
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
    if (internal.editorResumeTimer != null) window.clearTimeout(internal.editorResumeTimer);
    restoreOriginalMaterials(this);
    internal.editorShellObserver = undefined;
    originalDispose?.call(this);
  };

  prototype.__kyxosEditorSceneModeInstalled = true;
}
