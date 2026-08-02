import { describe, expect, it } from 'vitest';
import { AssetWorkspace } from '../../packages/asset-workspace/src/index';

describe('asset workspace', () => {
  it('supports folders, search, delete and restore', () => {
    const workspace = new AssetWorkspace();
    workspace.addFolder('Models', null, 'models');
    workspace.add({ id: 'robot', name: 'Robot.glb', kind: 'model', parentId: 'models', dependencies: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    expect(workspace.list({ query: 'robot' }).map((asset) => asset.id)).toEqual(['robot']);
    workspace.delete('models');
    expect(workspace.list()).toEqual([]);
    workspace.restore('models');
    expect(workspace.list({ parentId: 'models' }).map((asset) => asset.id)).toEqual(['robot']);
  });

  it('reports dependencies, reverse references and preserves overrides on reimport', () => {
    const workspace = new AssetWorkspace();
    workspace.add({ id: 'texture', name: 'Base.ktx2', kind: 'texture', parentId: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    workspace.add({ id: 'material', name: 'Material', kind: 'material', parentId: null, dependencies: ['texture'], metadata: { overrides: { roughness: 0.2 } }, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    expect(workspace.references('texture').map((asset) => asset.id)).toEqual(['material']);
    expect(workspace.dependencies('material').map((asset) => asset.id)).toEqual(['texture']);
    const updated = workspace.preserveOverridesOnReimport('material', { name: 'Material v2', kind: 'material', parentId: null, dependencies: ['texture'], metadata: {} });
    expect(updated.metadata?.overrides).toEqual({ roughness: 0.2 });
  });

  it('enforces deterministic import transitions', () => {
    const workspace = new AssetWorkspace();
    workspace.enqueue('Robot.glb', 'task');
    workspace.updateTask('task', 'reading', 0.1);
    workspace.updateTask('task', 'decoding', 0.3);
    workspace.updateTask('task', 'processing', 0.6);
    workspace.updateTask('task', 'uploading', 0.9);
    workspace.updateTask('task', 'complete', 1, undefined, 'robot');
    expect(workspace.listTasks()[0]).toMatchObject({ state: 'complete', progress: 1, assetId: 'robot' });
  });
});