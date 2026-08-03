import { createEmptySceneContract, type KyxosSceneContract } from '@kyxos/scene-contract';

export const FIXTURE_HASH = '7f1a62b95d7c919cb7f15f8b9d56696fd74d37c0c0c783d6698331a7ad0e1241';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function encodeGlb(gltf: Record<string, unknown>, binary: Uint8Array): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(encoded.byteLength);
  const binaryLength = align4(binary.byteLength);
  const totalLength = 12 + 8 + jsonLength + (binaryLength ? 8 + binaryLength : 0);
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encoded, 20);
  if (binaryLength) {
    const binaryHeader = 20 + jsonLength;
    view.setUint32(binaryHeader, binaryLength, true);
    view.setUint32(binaryHeader + 4, 0x004e4942, true);
    output.set(binary, binaryHeader + 8);
  }
  return output;
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

  return encodeGlb(gltf, binary);
}

/**
 * Composite glTF 2.0 fixture used by browser acceptance. It contains a skinned
 * mesh, one morph target, an imported camera, KHR_lights_punctual and
 * KHR_materials_variants in one small deterministic GLB.
 */
export function createGltfAuthoringGlb(): Uint8Array {
  const parts: Uint8Array[] = [];
  const views: Array<{ buffer: number; byteOffset: number; byteLength: number; target?: number }> = [];
  let byteLength = 0;

  const append = (value: ArrayBufferView, target?: number): number => {
    const aligned = align4(byteLength);
    if (aligned > byteLength) parts.push(new Uint8Array(aligned - byteLength));
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const index = views.length;
    views.push({ buffer: 0, byteOffset: aligned, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    parts.push(new Uint8Array(bytes));
    byteLength = aligned + bytes.byteLength;
    return index;
  };

  const positionView = append(new Float32Array([
    -0.8, 0, 0,
    0.8, 0, 0,
    0, 1.4, 0,
  ]), 34962);
  const jointsView = append(new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]), 34962);
  const weightsView = append(new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]), 34962);
  const morphView = append(new Float32Array([
    0, 0, 0,
    0, 0, 0,
    0, 0.45, 0,
  ]), 34962);
  const indexView = append(new Uint16Array([0, 1, 2]), 34963);
  const inverseBindView = append(new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]));

  const paddedLength = align4(byteLength);
  if (paddedLength > byteLength) parts.push(new Uint8Array(paddedLength - byteLength));
  const binary = new Uint8Array(paddedLength);
  let offset = 0;
  for (const part of parts) {
    binary.set(part, offset);
    offset += part.byteLength;
  }

  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos complete glTF authoring fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Authoring Root', children: [1, 2, 3, 4] },
      { name: 'Skinned Morph Mesh', mesh: 0, skin: 0, weights: [0.2] },
      { name: 'Root Joint' },
      { name: 'Imported Camera', camera: 0, translation: [0, 1.5, 5] },
      {
        name: 'Imported Key Light',
        translation: [2, 3, 2],
        extensions: { KHR_lights_punctual: { light: 0 } },
      },
    ],
    meshes: [{
      name: 'Skinned Morph Mesh',
      weights: [0.2],
      extras: { targetNames: ['Raise'] },
      primitives: [{
        attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
        targets: [{ POSITION: 3 }],
        indices: 4,
        material: 0,
        extensions: {
          KHR_materials_variants: {
            mappings: [{ material: 1, variants: [0] }],
          },
        },
      }],
    }],
    skins: [{
      name: 'Fixture Skin',
      inverseBindMatrices: 5,
      skeleton: 2,
      joints: [2],
    }],
    cameras: [{
      name: 'Fixture Perspective',
      type: 'perspective',
      perspective: { yfov: Math.PI / 3, znear: 0.1, zfar: 100 },
    }],
    materials: [
      {
        name: 'Default Blue',
        pbrMetallicRoughness: {
          baseColorFactor: [0.15, 0.45, 1, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.45,
        },
      },
      {
        name: 'Variant Red',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0.12, 0.08, 1],
          metallicFactor: 0.15,
          roughnessFactor: 0.3,
        },
      },
    ],
    extensionsUsed: ['KHR_lights_punctual', 'KHR_materials_variants'],
    extensions: {
      KHR_lights_punctual: {
        lights: [{
          name: 'Imported Spot',
          type: 'spot',
          color: [1, 0.8, 0.65],
          intensity: 6,
          range: 12,
          spot: { innerConeAngle: 0.1, outerConeAngle: 0.55 },
        }],
      },
      KHR_materials_variants: {
        variants: [{ name: 'Red' }],
      },
    },
    buffers: [{ byteLength: paddedLength }],
    bufferViews: views,
    accessors: [
      {
        bufferView: positionView,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.8, 0, 0],
        max: [0.8, 1.4, 0],
      },
      { bufferView: jointsView, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: weightsView, componentType: 5126, count: 3, type: 'VEC4' },
      {
        bufferView: morphView,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [0, 0.45, 0],
      },
      { bufferView: indexView, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: inverseBindView, componentType: 5126, count: 1, type: 'MAT4' },
    ],
  };

  return encodeGlb(gltf, binary);
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
