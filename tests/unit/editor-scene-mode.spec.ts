import { describe, expect, it, vi } from 'vitest';

import type {
  AssetResolver,
  KyxosSceneContract,
} from '../../packages/scene-contract/src/index';
import { createEmptySceneContract } from '../../packages/scene-contract/src/index';
import { installEditorSceneModeExtension } from '../../packages/viewer/src/editorSceneMode';

class FakeCanvas {
  private readonly attributes = new Set<string>();

  toggleAttribute(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.attributes.has(name);
    if (enabled) this.attributes.add(name);
    else this.attributes.delete(name);
    return enabled;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
}

class FakeRoot {
  children: FakeObject[] = [];

  add(child: FakeObject): void {
    child.parent = this;
    this.children.push(child);
  }

  traverse(callback: (object: FakeObject) => void): void {
    for (const child of this.children) callback(child);
  }

  updateMatrixWorld(): void {}
}

class FakeObject {
  parent: FakeRoot | null = null;
  geometry = { dispose: vi.fn() };
  material = { dispose: vi.fn() };
  isLight = false;
  userData: Record<string, unknown> = {};

  removeFromParent(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  traverse(callback: (object: FakeObject) => void): void {
    callback(this);
  }
}

class FakeViewer extends EventTarget {
  scene = new FakeRoot();
  modelRoot = new FakeRoot();
  canvas = new FakeCanvas() as unknown as HTMLCanvasElement;
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

installEditorSceneModeExtension(
  FakeViewer as unknown as typeof import('../../packages/viewer/src/KyxosViewer').KyxosViewer,
);

describe('Studio editor scene mode', () => {
  it('removes procedural models and unmanaged Playground lights', async () => {
    const viewer = new FakeViewer();
    viewer.modelRoot.add(new FakeObject());

    const playgroundLight = new FakeObject();
    playgroundLight.isLight = true;
    viewer.scene.add(playgroundLight);

    const managedContractLight = new FakeObject();
    managedContractLight.isLight = true;
    managedContractLight.userData.kyxosManagedLight = 'contract-light';
    viewer.scene.add(managedContractLight);

    await viewer.loadScene(createEmptySceneContract('Empty'), resolver);

    expect(viewer.modelRoot.children).toHaveLength(0);
    expect(viewer.scene.children).toEqual([managedContractLight]);
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
