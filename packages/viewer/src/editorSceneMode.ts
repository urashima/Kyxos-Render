import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import type { Group, Object3D, Scene } from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';
import { disposeObject3D } from './utils/dispose';

type LoadScene = (
  this: KyxosViewer,
  scene: KyxosSceneContract,
  resolver: AssetResolver,
) => Promise<void>;

interface ViewerInternals {
  scene?: Scene;
  modelRoot?: Group;
  animateScene?: (elapsed: number, delta: number) => void;
  animationEnabled?: boolean;
}

interface ViewerPrototypeInternals {
  loadScene?: LoadScene;
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

  // The default playground scene owns a procedural animation callback. Authored
  // scenes must be completely data-driven by the Scene Contract instead.
  internal.animateScene = () => undefined;
  internal.animationEnabled = false;
}

function clearUnmanagedPlaygroundLights(viewer: KyxosViewer): void {
  const scene = internals(viewer).scene;
  if (!scene) return;

  // KyxosViewer intentionally starts with showcase lighting for Playground.
  // Scene Contract lighting is added later by lightingApi and is marked with
  // kyxosManagedLight. Remove only the unmanaged bootstrap lights so Studio and
  // Public Viewer never render a hidden, non-editable second shadow/key light.
  for (const child of [...scene.children]) {
    const light = child as Object3D & { isLight?: boolean };
    if (light.isLight && !light.userData.kyxosManagedLight) {
      light.removeFromParent();
    }
  }
}

/**
 * Keeps reusable Playground defaults out of authored Scene Contract content.
 */
export function installEditorSceneModeExtension(ViewerClass: typeof KyxosViewer): void {
  const prototype = ViewerClass.prototype as unknown as ViewerPrototypeInternals;
  if (prototype.__kyxosEditorSceneModeInstalled) return;

  const originalLoadScene = prototype.loadScene;
  if (typeof originalLoadScene !== 'function') {
    throw new Error('Scene API must be installed before editor scene mode.');
  }

  prototype.loadScene = async function loadEditorScene(
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    clearModelRoot(this);
    clearUnmanagedPlaygroundLights(this);
    await originalLoadScene.call(this, scene, resolver);

    const hasModel = Object.values(scene.assets).some((asset) => asset.kind === 'model');
    this.canvas.toggleAttribute('data-empty-scene', !hasModel);
    if (!hasModel) {
      this.dispatchEvent(
        new CustomEvent('scene-empty', {
          detail: {
            message: 'Upload or drop a GLB to start editing.',
          },
        }),
      );
    }
  };

  prototype.__kyxosEditorSceneModeInstalled = true;
}
