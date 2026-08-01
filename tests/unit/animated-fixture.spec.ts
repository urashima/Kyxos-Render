import { describe, expect, it } from 'vitest';
import { createAnimatedTriangleGlb } from '../../packages/test-fixtures/src/animated';

function readGlbJson(glb: Uint8Array): any {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const json = new TextDecoder()
    .decode(glb.slice(20, 20 + jsonLength))
    .trim();
  return JSON.parse(json);
}

describe('animated GLB fixture', () => {
  it('contains a valid translation clip with a one-second input range', () => {
    const gltf = readGlbJson(createAnimatedTriangleGlb());
    expect(gltf.animations).toHaveLength(1);
    expect(gltf.animations[0].name).toBe('Slide');
    expect(gltf.animations[0].channels[0].target).toEqual({
      node: 0,
      path: 'translation',
    });
    const timeAccessor = gltf.accessors[gltf.animations[0].samplers[0].input];
    expect(timeAccessor.min).toEqual([0]);
    expect(timeAccessor.max).toEqual([1]);
  });
});
