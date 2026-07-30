import { describe, expect, it } from 'vitest';
import { inspectAsset } from '../../packages/asset-importer/src';

function createGlb(json: unknown) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJsonLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const totalLength = 12 + 8 + paddedJsonLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonBytes.byteLength).set(jsonBytes);
  return buffer;
}

describe('asset importer', () => {
  it('extracts GLB asset metrics and unsupported required extensions', async () => {
    const glb = createGlb({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 9 }, { count: 6 }],
      materials: [{}],
      textures: [{}],
      images: [{}],
      nodes: [{ mesh: 0 }],
      animations: [{ samplers: [{ output: 2 }] }],
      extensionsRequired: ['VENDOR_future_extension'],
    });
    const result = await inspectAsset(glb, { url: 'robot.glb' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('KX_ASSET_EXTENSION_UNSUPPORTED');
  });

  it('accepts ZIP glTF upload structure with processing fallback', async () => {
    const result = await inspectAsset(new ArrayBuffer(32), {
      url: 'scene.zip',
      zipEntries: ['scene.gltf', 'scene.bin', 'textures/base.webp'],
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('KX_OK_WITH_FALLBACK');
    expect(result.data?.report.zipEntries).toContain('scene.gltf');
  });
});
