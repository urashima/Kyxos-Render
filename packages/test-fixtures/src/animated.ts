function align4(value: number): number {
  return (value + 3) & ~3;
}

function copyBytes(target: Uint8Array, offset: number, source: ArrayBufferView): void {
  target.set(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    offset,
  );
}

export function createAnimatedTriangleGlb(): Uint8Array {
  const positions = new Float32Array([
    -0.8, 0, 0,
    0.8, 0, 0,
    0, 1.4, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const times = new Float32Array([0, 1]);
  const translations = new Float32Array([
    0, 0, 0,
    0.75, 0, 0,
  ]);

  const positionOffset = 0;
  const indexOffset = align4(positionOffset + positions.byteLength);
  const timeOffset = align4(indexOffset + indices.byteLength);
  const translationOffset = align4(timeOffset + times.byteLength);
  const binaryLength = align4(translationOffset + translations.byteLength);
  const binary = new Uint8Array(binaryLength);
  copyBytes(binary, positionOffset, positions);
  copyBytes(binary, indexOffset, indices);
  copyBytes(binary, timeOffset, times);
  copyBytes(binary, translationOffset, translations);

  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos animated test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Animated Triangle', mesh: 0 }],
    meshes: [
      {
        name: 'Animated Triangle Mesh',
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
        name: 'Animated Fixture Metal',
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.35, 0.2, 1],
          metallicFactor: 0.35,
          roughnessFactor: 0.4,
        },
      },
    ],
    animations: [
      {
        name: 'Slide',
        samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
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
        byteOffset: indexOffset,
        byteLength: indices.byteLength,
        target: 34963,
      },
      {
        buffer: 0,
        byteOffset: timeOffset,
        byteLength: times.byteLength,
      },
      {
        buffer: 0,
        byteOffset: translationOffset,
        byteLength: translations.byteLength,
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
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
      {
        bufferView: 2,
        componentType: 5126,
        count: 2,
        type: 'SCALAR',
        min: [0],
        max: [1],
      },
      {
        bufferView: 3,
        componentType: 5126,
        count: 2,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [0.75, 0, 0],
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
