import { describe, expect, it } from 'vitest';
import { bundleExternalGltf } from '../../apps/studio/src/gltf-bundler';

describe('external glTF bundling', () => {
  it('embeds local buffers and images into a deterministic GLB', async () => {
    const gltf = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin', byteLength: 4 }],
      images: [{ uri: 'albedo.png', mimeType: 'image/png' }],
      scenes: [{ nodes: [] }],
      scene: 0,
    };
    const files = [
      new File([JSON.stringify(gltf)], 'scene.gltf', { type: 'model/gltf+json' }),
      new File([new Uint8Array([1, 2, 3, 4])], 'mesh.bin'),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'albedo.png', { type: 'image/png' }),
    ];
    const result = await bundleExternalGltf(files, 'scene.gltf');
    const bytes = new Uint8Array(await result.file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(result.resourceNames).toEqual(['albedo.png', 'mesh.bin']);
  });

  it('rejects missing and remote external resources', async () => {
    const missing = new File([JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'missing.bin', byteLength: 1 }] })], 'missing.gltf');
    await expect(bundleExternalGltf([missing], missing.name)).rejects.toThrow(/missing/i);
    const remote = new File([JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/model.bin', byteLength: 1 }] })], 'remote.gltf');
    await expect(bundleExternalGltf([remote], remote.name)).rejects.toThrow(/remote|external/i);
    const extensionUri = new File([JSON.stringify({ asset: { version: '2.0' }, extensions: { EXT_custom: { uri: 'mutable.bin' } } })], 'extension.gltf');
    await expect(bundleExternalGltf([extensionUri], extensionUri.name)).rejects.toThrow(/URI fields remain/i);
  });
});
