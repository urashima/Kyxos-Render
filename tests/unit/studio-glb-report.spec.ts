import { describe, expect, it } from 'vitest';

import { createGlbImportReport } from '../../apps/studio/src/glb-report';
import { parseGlbInWorker } from '../../apps/studio/src/glb-worker-client';
import {
  createGltfAuthoringGlb,
  createTriangleGlb,
} from '../../packages/test-fixtures/src/index';

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function matrixNodeGlb(): Uint8Array {
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{
      name: 'Matrix Node',
      matrix: [
        0, 2, 0, 0,
        -3, 0, 0, 0,
        0, 0, 4, 0,
        5, 6, 7, 1,
      ],
    }],
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(json.byteLength);
  const output = new Uint8Array(12 + 8 + jsonLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20);
  output.set(json, 20);
  return output;
}

describe('Studio shared GLB metadata report parser', () => {
  it('creates the deterministic triangle import report used by Worker and fallback paths', () => {
    const report = createGlbImportReport(
      arrayBuffer(createTriangleGlb()),
      'triangle.glb',
    );

    expect(report.sourceName).toBe('triangle.glb');
    expect(report.nodes).toHaveLength(1);
    expect(report.nodes[0]).toMatchObject({
      name: 'Triangle',
      mesh: 0,
      parent: null,
    });
    expect(report.materials).toHaveLength(1);
    expect(report.materials[0]).toMatchObject({
      name: 'Fixture Metal',
    });
    expect(report.extensionsRequired).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('keeps the core import path independent from Worker availability', async () => {
    const bytes = createTriangleGlb();
    const report = await parseGlbInWorker<ReturnType<typeof createGlbImportReport>>(
      new File([bytes], 'triangle.glb', { type: 'model/gltf-binary' }),
    );

    expect(report.sourceName).toBe('triangle.glb');
    expect(report.nodes[0]).toMatchObject({ name: 'Triangle', mesh: 0 });
  });

  it('preserves complete authoring metadata for skins, morphs, cameras, lights and variants', () => {
    const report = createGlbImportReport(
      arrayBuffer(createGltfAuthoringGlb()),
      'authoring.glb',
    );

    expect(report.skins).toHaveLength(1);
    expect(report.cameras).toHaveLength(1);
    expect(report.lights).toHaveLength(1);
    expect(report.materialVariants).toHaveLength(1);
    expect(report.nodes.some((node) => node.skin === 0)).toBe(true);
    expect(
      (report.textures.meshPrimitives as Array<{ primitives: Array<{ targets: unknown[] }> }>)[0]
        .primitives[0].targets,
    ).toHaveLength(1);
  });

  it('decomposes glTF matrix nodes without discarding translation rotation or scale', () => {
    const report = createGlbImportReport(
      arrayBuffer(matrixNodeGlb()),
      'matrix.glb',
    );
    expect(report.nodes[0]).toMatchObject({
      matrix: [
        0, 2, 0, 0,
        -3, 0, 0, 0,
        0, 0, 4, 0,
        5, 6, 7, 1,
      ],
      translation: [5, 6, 7],
      scale: [2, 3, 4],
    });
    const rotation = report.nodes[0].rotation as number[];
    expect(rotation[0]).toBeCloseTo(0, 6);
    expect(rotation[1]).toBeCloseTo(0, 6);
    expect(Math.abs(rotation[2])).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(rotation[3])).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('rejects truncated GLB containers before reading a chunk out of bounds', () => {
    const bytes = createTriangleGlb().slice(0, 24);
    expect(() => createGlbImportReport(arrayBuffer(bytes), 'broken.glb')).toThrow(
      'GLB container is truncated.',
    );
  });
});
