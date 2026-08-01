function align4(value: number): number {
  return (value + 3) & ~3;
}

function copyBytes(target: Uint8Array, offset: number, source: ArrayBufferView): void {
  target.set(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    offset,
  );
}

export function createMultiMaterialGlb(): Uint8Array {
  const positions = new Float32Array([
    -1, 0, 0,
    0, 0, 0,
    -0.5, 1, 0,
    1, 0, 0,
    0.5, 1, 0,
  ]);
  const leftIndices = new Uint16Array([0, 1, 2]);
  const rightIndices = new Uint16Array([1, 3, 4]);

  const positionOffset = 0;
  const leftIndexOffset = align4(positionOffset + positions.byteLength);
  const rightIndexOffset = align4(leftIndexOffset + leftIndices.byteLength);
  const binaryLength = align4(rightIndexOffset + rightIndices.byteLength);
  const binary = new Uint8Array(binaryLength);
  copyBytes(binary, positionOffset, positions);
  copyBytes(binary, leftIndexOffset, leftIndices);
  copyBytes(binary, rightIndexOffset, rightIndices);

  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos multi-material test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Two Material Mesh', mesh: 0 }],
    meshes: [
      {
        name: 'Two Material Mesh',
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
          },
          {
            attributes: { POSITION: 0 },
            indices: 2,
            material: 1,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'Left Red',
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.08, 0.06, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.7,
        },
      },
      {
        name: 'Right Blue',
        pbrMetallicRoughness: {
          baseColorFactor: [0.05, 0.2, 0.9, 1],
          metallicFactor: 0.75,
          roughnessFactor: 0.25,
        },
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: positionOffset,
        byteLength: positions.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: leftIndexOffset,
        byteLength: leftIndices.byteLength,
        target: 34963,
      },
      {
        buffer: 0,
        byteOffset: rightIndexOffset,
        byteLength: rightIndices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 5,
        type: 'VEC3',
        min: [-1, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
      {
        bufferView: 2,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
  };

  const encodedJson = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(encodedJson.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encodedJson, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}
