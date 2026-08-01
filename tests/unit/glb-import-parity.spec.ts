import { describe, expect, it } from 'vitest';

import { createEmptySceneContract } from '@kyxos/scene-contract';
import { normalizeGlbImportContract } from '../../apps/studio/src/glb-import-parity';

describe('GLB import parity', () => {
  it('maps every primitive material into the editable node slots', () => {
    const scene = createEmptySceneContract('Multi Material');
    scene.assets.model = {
      id: 'model',
      uri: 'asset://model-hash',
      contentHash: 'model-hash',
      kind: 'model',
      mimeType: 'model/gltf-binary',
      byteSize: 100,
      name: 'multi.glb',
      metadata: {
        textures: {
          textures: [],
          samplers: [],
          meshPrimitives: [
            {
              meshIndex: 0,
              name: 'Body',
              weights: [0.25],
              primitives: [
                {
                  index: 0,
                  material: 0,
                  mode: 4,
                  indices: 0,
                  attributes: { POSITION: 1 },
                  targets: [],
                  extensions: {},
                },
                {
                  index: 1,
                  material: 1,
                  mode: 4,
                  indices: 2,
                  attributes: { POSITION: 3 },
                  targets: [{ POSITION: 4 }],
                  extensions: {},
                },
              ],
            },
          ],
        },
      },
    };
    scene.materials.red = {
      id: 'red',
      name: 'Red',
      baseColor: { x: 1, y: 0, z: 0, w: 1 },
      metalness: 0,
      roughness: 1,
      emissive: { x: 0, y: 0, z: 0 },
      opacity: 1,
      alphaMode: 'opaque',
      doubleSided: false,
      metadata: { gltfMaterialIndex: 0 },
    };
    scene.materials.blue = {
      id: 'blue',
      name: 'Blue',
      baseColor: { x: 0, y: 0, z: 1, w: 1 },
      metalness: 0,
      roughness: 1,
      emissive: { x: 0, y: 0, z: 0 },
      opacity: 1,
      alphaMode: 'opaque',
      doubleSided: false,
      metadata: { gltfMaterialIndex: 1 },
    };
    scene.nodes.push({
      id: 'body',
      name: 'Body',
      parentId: null,
      children: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      visible: true,
      meshAssetId: 'model',
      meshIndex: 0,
      materialSlots: ['red'],
      metadata: { gltfNodeIndex: 0 },
    });

    const normalized = normalizeGlbImportContract(scene);

    expect(normalized.nodes[0].materialSlots).toEqual(['red', 'blue']);
    expect(normalized.nodes[0].metadata?.gltfPrimitiveCount).toBe(2);
    expect(normalized.nodes[0].metadata?.gltfMorphTargetCounts).toEqual([0, 1]);
    expect(normalized.nodes[0].metadata?.gltfMeshWeights).toEqual([0.25]);
  });

  it('creates an editable fallback slot for a primitive without a material', () => {
    const scene = createEmptySceneContract('Default Material');
    scene.assets.model = {
      id: 'model',
      uri: 'asset://model-hash',
      contentHash: 'model-hash',
      kind: 'model',
      mimeType: 'model/gltf-binary',
      metadata: {
        textures: {
          meshPrimitives: [
            {
              meshIndex: 0,
              name: 'Mesh',
              weights: [],
              primitives: [
                {
                  index: 0,
                  material: null,
                  mode: 4,
                  indices: null,
                  attributes: {},
                  targets: [],
                  extensions: {},
                },
              ],
            },
          ],
        },
      },
    };
    scene.nodes.push({
      id: 'mesh',
      name: 'Mesh',
      parentId: null,
      children: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      visible: true,
      meshAssetId: 'model',
      meshIndex: 0,
    });

    const normalized = normalizeGlbImportContract(scene);
    const slot = normalized.nodes[0].materialSlots?.[0];

    expect(slot).toBeTruthy();
    expect(normalized.materials[slot!].metadata?.generatedForUnassignedGltfPrimitive).toBe(true);
  });
});
