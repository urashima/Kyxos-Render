import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import type { Group, Object3D } from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';
import { disposeObject3D } from './utils/dispose';

type ViewerPrototype = KyxosViewer & {
  modelRoot?: Group;
  animateScene?: (elapsed: number, delta: number) => void;
  animationEnabled?: boolean;
  loadScene(scene: KyxosSceneContract, resolver: AssetResolver): Promise<void>;
  __kyxosEditorSceneModeInstalled?: boolean;
};

function clearModelRoot(viewer: ViewerPrototype): void {
  const root = viewer.modelRoot;
  if (!root) return;

  for (const child of [...root.children]) {
    child.removeFromParent();
    disposeObject3D(child as Object3D);
  }
  root.updateMatrixWorld(true);

  // The default playground scene owns a procedural animation callback. Studio
  // scenes must be completely data-driven by the Scene Contract instead.
  viewer.animateScene = () => undefined;
  viewer.animationEnabled = false;
}

/**
 * Keeps the reusable KyxosViewer playground defaults out of authoring scenes.
 *
 * KyxosViewer intentionally boots with a procedural showcase so the standalone
 * playground is never blank. A new Studio project, however, has no model asset.
 * Before this extension the showcase remained inside modelRoot and looked like
 * project content. Clearing modelRoot before every Scene Contract load makes an
 * empty project genuinely empty and guarantees that an imported GLB is the only
 * editable model in the viewport.
 */
export function installEditorSceneModeExtension(ViewerClass: typeof KyxosViewer): void {
  const prototype = ViewerClass.prototype as ViewerPrototype;
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
