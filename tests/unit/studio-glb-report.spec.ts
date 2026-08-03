import { describe, expect, it } from 'vitest';

import { createGlbImportReport } from '../../apps/studio/src/glb-report';
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

  it('rejects truncated GLB containers before reading a chunk out of bounds', () => {
    const bytes = createTriangleGlb().slice(0, 24);
    expect(() => createGlbImportReport(arrayBuffer(bytes), 'broken.glb')).toThrow(
      'GLB container is truncated.',
    );
  });
});
