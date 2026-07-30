import { createEmptySceneContract, type KyxosSceneContract } from '@kyxos/scene-contract';

export const FIXTURE_HASH = '7f1a62b95d7c919cb7f15f8b9d56696fd74d37c0c0c783d6698331a7ad0e1241';

function align4(value: number): number {
  return (value + 3) & ~3;
}

export function createTriangleGlb(): Uint8Array {
  const positions = new Float32Array([
    -0.8, 0, 0,
    0.8, 0, 0,
    0, 1.4, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const binaryLength = align4(positions.byteLength + indices.byteLength);
  const binary = new Uint8Array(binaryLength);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(indices.buffer), positions.byteLength);

  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Triangle', mesh: 0 }],
    meshes: [
      {
        name: 'Triangle Mesh',
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'Fixture Metal',
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.55, 1, 1],
          metallicFactor: 0.65,
          roughnessFactor: 0.25,
        },
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.8, 0, 0],
        max: [0.8, 1.4, 0],
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };

  const encoded = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(encoded.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encoded, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

export function createFixtureContract(name = 'Fixture Scene'): KyxosSceneContract {
  const contract = createEmptySceneContract(name);
  const assetId = 'fixture-model';
  const materialId = 'fixture-material';
  const nodeId = 'fixture-node';
  contract.assets[assetId] = {
    id: assetId,
    uri: `asset://${FIXTURE_HASH}`,
    contentHash: FIXTURE_HASH,
    kind: 'model',
    mimeType: 'model/gltf-binary',
    byteSize: createTriangleGlb().byteLength,
    name: 'fixture-triangle.glb',
  };
  contract.materials[materialId] = {
    id: materialId,
    name: 'Fixture Metal',
    baseColor: { x: 0.2, y: 0.55, z: 1, w: 1 },
    metalness: 0.65,
    roughness: 0.25,
    emissive: { x: 0, y: 0, z: 0 },
    opacity: 1,
    alphaMode: 'opaque',
    doubleSided: false,
  };
  contract.nodes.push({
    id: nodeId,
    name: 'Triangle',
    parentId: null,
    children: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    visible: true,
    meshAssetId: assetId,
    meshIndex: 0,
    materialSlots: [materialId],
  });
  contract.renderSettings.effects = {
    traa: { enabled: true },
    ssr: { enabled: true },
    ssgi: { enabled: false },
    dof: { enabled: false },
    sparkle: { enabled: false },
  };
  return contract;
}
