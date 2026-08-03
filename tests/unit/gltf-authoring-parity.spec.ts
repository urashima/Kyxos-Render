import { describe, expect, it } from 'vitest';

import {
  morphTargetRows,
  morphWeightPatch,
  resetMorphWeightsPatch,
  skinJointSummary,
} from '../../apps/studio/src/gltf-node-inspector';
import { applyPatch } from '../../packages/editor-core/src/index';
import { mergeReimportedSceneWithOverrides } from '../../packages/editor-core/src/reimport';
import { createFixtureContract } from '../../packages/test-fixtures/src/index';

function reimportPair() {
  const current = createFixtureContract('Current');
  const imported = createFixtureContract('Imported');

  current.nodes[0].metadata = {
    gltfNodeIndex: 0,
    gltfMorphDefaultWeights: [0.1, 0.2],
  };
  current.nodes[0].name = 'Editor Renamed Mesh';
  current.nodes[0].transform.position.x = 4;
  current.nodes[0].visible = false;
  current.nodes[0].locked = true;
  current.nodes[0].morphWeights = [0.75, -0.25];
  current.nodes[0].morphTargetNames = ['Smile', 'Blink'];
  current.nodes[0].skin = {
    skinIndex: 0,
    joints: ['joint-node'],
    skeletonNodeId: 'joint-node',
    inverseBindMatricesAccessor: 7,
  };
  current.nodes.push({
    id: 'joint-node',
    name: 'Root Joint',
    parentId: null,
    children: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    visible: true,
    metadata: { gltfNodeIndex: 1 },
  });

  current.materials['fixture-material'].roughness = 0.9;
  current.materials['fixture-material'].metadata = {
    gltfMaterialIndex: 0,
    original: {
      ...structuredClone(current.materials['fixture-material']),
      roughness: 0.25,
      metadata: undefined,
    },
  };

  const currentCamera = current.cameras[0];
  currentCamera.fov = 72;
  currentCamera.near = 0.2;
  current.nodes[0].cameraId = currentCamera.id;
  current.activeCameraId = currentCamera.id;
  current.lights = [{
    id: 'current-light',
    name: 'Edited Spot',
    type: 'spot',
    color: '#ffddbb',
    intensity: 8,
    transform: structuredClone(current.nodes[0].transform),
    castShadow: true,
    range: 14,
    innerConeAngle: 0.1,
    outerConeAngle: 0.5,
  }];
  current.nodes[0].lightId = 'current-light';
  current.materialVariants = [{ id: 'current-red', name: 'Red' }];
  current.activeMaterialVariantId = 'current-red';

  imported.nodes[0].id = 'imported-node';
  imported.nodes[0].metadata = {
    gltfNodeIndex: 0,
    gltfMorphDefaultWeights: [0.3, 0.4],
  };
  imported.nodes[0].name = 'Source Mesh';
  imported.nodes[0].transform.position.x = 1;
  imported.nodes[0].visible = true;
  imported.nodes[0].locked = false;
  imported.nodes[0].morphWeights = [0.3, 0.4];
  imported.nodes[0].morphTargetNames = ['Smile', 'Blink'];
  imported.nodes[0].skin = {
    skinIndex: 0,
    joints: ['imported-joint'],
    skeletonNodeId: 'imported-joint',
    inverseBindMatricesAccessor: 7,
  };
  imported.nodes.push({
    id: 'imported-joint',
    name: 'Root Joint',
    parentId: null,
    children: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    visible: true,
    metadata: { gltfNodeIndex: 1 },
  });

  const importedMaterial = imported.materials['fixture-material'];
  delete imported.materials['fixture-material'];
  importedMaterial.id = 'imported-material';
  importedMaterial.roughness = 0.1;
  importedMaterial.metadata = {
    gltfMaterialIndex: 0,
    original: {
      ...structuredClone(importedMaterial),
      metadata: undefined,
    },
  };
  imported.materials['imported-material'] = importedMaterial;
  imported.nodes[0].materialSlots = ['imported-material'];

  const importedCamera = imported.cameras[0];
  importedCamera.id = 'imported-camera';
  importedCamera.fov = 35;
  imported.nodes[0].cameraId = importedCamera.id;
  imported.activeCameraId = importedCamera.id;
  imported.lights = [{
    id: 'imported-light',
    name: 'Source Light',
    type: 'point',
    color: '#ffffff',
    intensity: 2,
    transform: structuredClone(imported.nodes[0].transform),
    castShadow: false,
    range: 5,
  }];
  imported.nodes[0].lightId = 'imported-light';
  imported.materialVariants = [{ id: 'imported-red', name: 'Red' }];
  imported.activeMaterialVariantId = undefined;

  return { current, imported };
}

describe('glTF node authoring', () => {
  it('edits named morph targets across compatible selected nodes', () => {
    const { current } = reimportPair();
    const second = structuredClone(current.nodes[0]);
    second.id = 'second-morph';
    second.name = 'Second Morph';
    second.morphWeights = [0.25, -0.25];
    current.nodes.push(second);

    const rows = morphTargetRows([current.nodes[0], second]);
    expect(rows).toMatchObject([
      { index: 0, label: 'Smile', mixed: true, supportedNodeIds: ['fixture-node', 'second-morph'] },
      { index: 1, label: 'Blink', mixed: false },
    ]);

    const changed = applyPatch(
      current,
      morphWeightPatch(current, rows[0].supportedNodeIds, 0, 0.5),
    );
    expect(changed.nodes.filter((node) => node.morphWeights).map((node) => node.morphWeights?.[0]))
      .toEqual([0.5, 0.5]);

    const reset = applyPatch(
      changed,
      resetMorphWeightsPatch(changed, ['fixture-node']),
    );
    expect(reset.nodes[0].morphWeights).toEqual([0.1, 0.2]);
  });

  it('reports skin, joints, skeleton and inverse-bind accessor', () => {
    const { current } = reimportPair();
    expect(skinJointSummary(current, current.nodes[0])).toEqual({
      skinIndex: 0,
      jointCount: 1,
      jointNames: ['Root Joint'],
      skeletonName: 'Root Joint',
      inverseBindMatricesAccessor: 7,
    });
  });
});

describe('glTF reimport overrides', () => {
  it('keeps editor overrides while retaining regenerated imported IDs', () => {
    const { current, imported } = reimportPair();
    const merged = mergeReimportedSceneWithOverrides(current, imported, 'keep-overrides');
    const node = merged.nodes.find((entry) => entry.metadata?.gltfNodeIndex === 0)!;

    expect(node.id).toBe('imported-node');
    expect(node).toMatchObject({
      name: 'Editor Renamed Mesh',
      visible: false,
      locked: true,
      morphWeights: [0.75, -0.25],
      cameraId: 'imported-camera',
      lightId: 'imported-light',
    });
    expect(node.transform.position.x).toBe(4);
    expect(merged.materials['imported-material'].roughness).toBe(0.9);
    expect(merged.cameras.find((camera) => camera.id === 'imported-camera')).toMatchObject({
      fov: 72,
      near: 0.2,
    });
    expect(merged.lights?.find((light) => light.id === 'imported-light')).toMatchObject({
      name: 'Edited Spot',
      type: 'spot',
      intensity: 8,
      range: 14,
    });
    expect(merged.activeCameraId).toBe('imported-camera');
    expect(merged.activeMaterialVariantId).toBe('imported-red');
  });

  it('uses fresh source values when overrides are reset', () => {
    const { current, imported } = reimportPair();
    const merged = mergeReimportedSceneWithOverrides(current, imported, 'reset-overrides');
    const node = merged.nodes.find((entry) => entry.metadata?.gltfNodeIndex === 0)!;
    expect(node.name).toBe('Source Mesh');
    expect(node.transform.position.x).toBe(1);
    expect(node.morphWeights).toEqual([0.3, 0.4]);
    expect(merged.materials['imported-material'].roughness).toBe(0.1);
    expect(merged.cameras.find((camera) => camera.id === 'imported-camera')?.fov).toBe(35);
    expect(merged.lights?.find((light) => light.id === 'imported-light')?.intensity).toBe(2);
  });
});
