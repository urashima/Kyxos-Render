import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three/webgpu';

import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import { createEmptySceneContract } from '@kyxos/scene-contract';
import { installEditorSceneModeExtension } from '../../packages/viewer/src/editorSceneMode';

class FakeViewer extends EventTarget {
  modelRoot = new Group();
  canvas = document.createElement('canvas');
  animateScene = vi.fn();
  animationEnabled = true;
  originalLoadCalls = 0;

  async loadScene(_scene: KyxosSceneContract, _resolver: AssetResolver): Promise<void> {
    this.originalLoadCalls += 1;
  }
}

const resolver: AssetResolver = {
  resolve: async () => 'blob:test',
};

describe('Studio editor scene mode', () => {
  it('removes the procedural playground model for an empty project', async () => {
    installEditorSceneModeExtension(FakeViewer as never);
    const viewer = new FakeViewer();
    viewer.modelRoot.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));

    await viewer.loadScene(createEmptySceneContract('Empty'), resolver);

    expect(viewer.modelRoot.children).toHaveLength(0);
    expect(viewer.animationEnabled).toBe(false);
    expect(viewer.canvas.hasAttribute('data-empty-scene')).toBe(true);
    expect(viewer.originalLoadCalls).toBe(1);
  });

  it('marks a model-backed contract as non-empty after the real loader runs', async () => {
    const viewer = new FakeViewer();
    const contract = createEmptySceneContract('Imported');
    contract.assets.model = {
      id: 'model',
      uri: 'asset://hash',
      contentHash: 'hash',
      kind: 'model',
      mimeType: 'model/gltf-binary',
      byteSize: 12,
      name: 'model.glb',
    };

    await viewer.loadScene(contract, resolver);

    expect(viewer.canvas.hasAttribute('data-empty-scene')).toBe(false);
    expect(viewer.originalLoadCalls).toBe(1);
  });
});
