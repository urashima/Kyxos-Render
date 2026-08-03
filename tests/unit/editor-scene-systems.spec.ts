import { describe, expect, it, vi } from 'vitest';
import {
  createEmptySceneContract,
  type KyxosSceneContract,
  type ScenePatch,
} from '../../packages/scene-contract/src/index';
import { applyPatch } from '../../packages/editor-core/src/index';
import {
  SceneSystemsService,
  batchGroupMembers,
  collisionPairsEnabled,
  createDefaultCollider,
  createDefaultRigidbody,
  effectiveNodeLayers,
  ensureSceneSystems,
  summarizeSceneSystems,
  validateSceneSystems,
} from '../../packages/editor-core/src/scene-systems';

function sceneFixture(): KyxosSceneContract {
  const scene = createEmptySceneContract('Systems');
  scene.assets.mesh = {
    id: 'mesh',
    uri: 'asset://mesh',
    contentHash: 'mesh',
    kind: 'model',
    mimeType: 'model/gltf-binary',
  };
  scene.nodes = [
    {
      id: 'root',
      name: 'Root',
      parentId: null,
      children: ['child'],
      visible: true,
      meshAssetId: 'mesh',
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
    {
      id: 'child',
      name: 'Child',
      parentId: 'root',
      children: [],
      visible: true,
      meshAssetId: 'mesh',
      transform: {
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  ];
  return scene;
}

function createHost(initial: KyxosSceneContract) {
  let scene = structuredClone(initial);
  const executed = vi.fn();
  return {
    host: {
      getScene: () => structuredClone(scene),
      execute(label: string, build: (scene: KyxosSceneContract) => ScenePatch) {
        const patch = build(structuredClone(scene));
        scene = applyPatch(scene, patch);
        executed(label, patch);
      },
    },
    getScene: () => structuredClone(scene),
    executed,
  };
}

describe('Scene systems defaults and validation', () => {
  it('adds stable default layers and initializes every node', () => {
    const scene = ensureSceneSystems(sceneFixture());
    expect(scene.editorState?.layers?.map((layer) => layer.id)).toEqual(['world', 'skybox', 'ui']);
    expect(scene.editorState?.batchGroups).toEqual([]);
    expect(scene.editorState?.lightmapSettings?.maxResolution).toBe(2048);
    expect(scene.editorState?.physicsSettings?.gravity.y).toBe(-9.81);
    expect(scene.nodes.every((node) => node.layerIds?.includes('world'))).toBe(true);
    expect(scene.nodes.every((node) => node.batchGroupId === null)).toBe(true);
    expect(validateSceneSystems(scene)).toEqual([]);
  });

  it('reports broken references and invalid physics authoring values', () => {
    const scene = ensureSceneSystems(sceneFixture());
    scene.nodes[0].layerIds = ['missing-layer'];
    scene.nodes[0].batchGroupId = 'missing-batch';
    scene.nodes[0].collider = {
      ...createDefaultCollider('mesh'),
      meshAssetId: 'missing-mesh',
      friction: 2,
    };
    scene.nodes[0].rigidbody = {
      ...createDefaultRigidbody('dynamic'),
      mass: 0,
      linearDamping: 2,
    };
    scene.editorState!.lightmapSettings!.maxResolution = 10;
    scene.editorState!.physicsSettings!.maxSubSteps = 0;

    expect(validateSceneSystems(scene).map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'layer.reference-missing',
      'batch.reference-missing',
      'collider.asset-missing',
      'collider.invalid-settings',
      'rigidbody.invalid-settings',
      'lightmap.invalid-settings',
      'physics.invalid-settings',
    ]));
  });
});

describe('Scene systems command service', () => {
  it('creates, edits, reorders and safely removes layers', () => {
    const state = createHost(ensureSceneSystems(sceneFixture()));
    const ids = ['custom-layer', 'batch-group'];
    const service = new SceneSystemsService(state.host, () => ids.shift()!);
    const change = vi.fn();
    service.addEventListener('change', change);

    const layerId = service.addLayer('Gameplay');
    expect(layerId).toBe('custom-layer');
    service.assignLayers(['root', 'child'], [layerId]);
    expect(state.getScene().nodes.every((node) => node.layerIds).every(Boolean)).toBe(true);
    expect(state.getScene().nodes.map((node) => node.layerIds)).toEqual([[layerId], [layerId]]);

    service.updateLayer(layerId, { name: 'Actors', visible: false, order: 5 });
    expect(state.getScene().editorState?.layers?.find((layer) => layer.id === layerId)).toMatchObject({
      name: 'Actors',
      visible: false,
      order: 5,
    });

    const layerOrder = state.getScene().editorState!.layers!.map((layer) => layer.id).reverse();
    service.reorderLayers(layerOrder);
    expect(state.getScene().editorState?.layers?.map((layer) => layer.order)).toEqual([0, 10, 20, 30]);

    service.removeLayer(layerId, 'world');
    expect(state.getScene().editorState?.layers?.some((layer) => layer.id === layerId)).toBe(false);
    expect(state.getScene().nodes.map((node) => node.layerIds)).toEqual([['world'], ['world']]);
    expect(change).toHaveBeenCalled();
  });

  it('manages Batch Groups and node components through canonical patches', () => {
    const state = createHost(ensureSceneSystems(sceneFixture()));
    const service = new SceneSystemsService(state.host, () => 'batch-group');
    const groupId = service.addBatchGroup('Static Geometry');
    service.updateBatchGroup(groupId, { dynamic: true, maxAabbSize: 32 });
    service.assignBatchGroup(['root', 'child'], groupId);
    expect(batchGroupMembers(state.getScene(), groupId).map((node) => node.id)).toEqual(['root', 'child']);

    service.setCollider(['root'], {
      ...createDefaultCollider('mesh'),
      meshAssetId: 'mesh',
      convex: true,
    });
    service.setRigidbody(['root'], createDefaultRigidbody('dynamic'));
    service.setNodeLightmap(['root'], {
      enabled: true,
      static: true,
      castShadows: true,
      receiveLightmap: true,
      scaleMultiplier: 2,
    });
    service.setLightmapSettings({ enabled: true, maxResolution: 4096 });
    service.setPhysicsSettings({ enabled: true, gravity: { x: 0, y: -4, z: 0 } });

    const scene = state.getScene();
    expect(scene.nodes[0].collider?.type).toBe('mesh');
    expect(scene.nodes[0].rigidbody).toMatchObject({ type: 'dynamic', mass: 1 });
    expect(scene.nodes[0].lightmap).toMatchObject({ enabled: true, scaleMultiplier: 2 });
    expect(scene.editorState?.lightmapSettings).toMatchObject({ enabled: true, maxResolution: 4096 });
    expect(scene.editorState?.physicsSettings).toMatchObject({ enabled: true, gravity: { x: 0, y: -4, z: 0 } });
    expect(validateSceneSystems(scene)).toEqual([]);

    service.removeBatchGroup(groupId);
    expect(state.getScene().nodes.every((node) => node.batchGroupId === null)).toBe(true);
  });
});

describe('Scene systems queries', () => {
  it('calculates visible effective layers and collision masks', () => {
    const scene = ensureSceneSystems(sceneFixture());
    scene.editorState!.layers![0].enabled = true;
    scene.editorState!.layers![1].enabled = false;
    scene.nodes[0].layerIds = ['world', 'skybox'];
    expect(effectiveNodeLayers(scene, scene.nodes[0]).map((layer) => layer.id)).toEqual(['world']);

    const player = { ...createDefaultCollider('box'), collisionGroup: 1, collisionMask: 2 };
    const enemy = { ...createDefaultCollider('box'), collisionGroup: 2, collisionMask: 1 };
    const scenery = { ...createDefaultCollider('box'), collisionGroup: 4, collisionMask: 1 };
    expect(collisionPairsEnabled(player, enemy)).toBe(true);
    expect(collisionPairsEnabled(player, scenery)).toBe(false);
  });

  it('summarizes authored systems', () => {
    const scene = ensureSceneSystems(sceneFixture());
    scene.editorState!.batchGroups = [{
      id: 'batch', name: 'Batch', dynamic: false, enabled: true, maxAabbSize: 100,
      layerIds: ['world'], castShadow: true, receiveShadow: true,
    }];
    scene.nodes[0].batchGroupId = 'batch';
    scene.nodes[0].collider = createDefaultCollider('box');
    scene.nodes[0].rigidbody = createDefaultRigidbody('static');
    scene.nodes[0].lightmap = {
      enabled: true, static: true, castShadows: true, receiveLightmap: true, scaleMultiplier: 1,
    };
    expect(summarizeSceneSystems(scene)).toEqual({
      layers: 3,
      batchGroups: 1,
      layeredNodes: 2,
      batchedNodes: 1,
      colliders: 1,
      rigidbodies: 1,
      lightmappedNodes: 1,
      issues: 0,
    });
  });
});
