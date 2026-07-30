interface GlbJson { nodes?: Array<{ name?: string; children?: number[]; mesh?: number; camera?: number; translation?: number[]; rotation?: number[]; scale?: number[] }>; meshes?: Array<{ name?: string; primitives?: Array<{ material?: number }> }>; materials?: Array<Record<string, any>>; animations?: Array<{ name?: string; samplers?: Array<Record<string, unknown>>; channels?: Array<Record<string, unknown>> }>; images?: Array<{ name?: string; mimeType?: string; bufferView?: number; uri?: string }>; textures?: Array<{ source?: number }>; cameras?: Array<Record<string, unknown>>; extensionsUsed?: string[]; extensionsRequired?: string[] }
function parseGlb(buffer: ArrayBuffer): GlbJson {
  const view = new DataView(buffer); if (view.getUint32(0, true) !== 0x46546c67) throw new Error('File is not a valid GLB container.');
  if (view.getUint32(4, true) !== 2) throw new Error('Only GLB 2.0 is supported.');
  let offset = 12; while (offset + 8 <= buffer.byteLength) { const length = view.getUint32(offset, true); const type = view.getUint32(offset + 4, true); offset += 8; if (type === 0x4e4f534a) return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, length)).replace(/\0+$/g, '')); offset += length }
  throw new Error('GLB JSON chunk is missing.');
}
self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; name: string }>) => {
  try {
    const gltf = parseGlb(event.data.buffer); const parents = new Map<number, number>();
    gltf.nodes?.forEach((node, parent) => node.children?.forEach((child) => parents.set(child, parent)));
    const nodes = (gltf.nodes ?? []).map((node, index) => ({ index, name: node.name || `Node ${index + 1}`, parent: parents.get(index) ?? null, children: node.children ?? [], mesh: node.mesh, camera: node.camera, translation: node.translation ?? [0, 0, 0], rotation: node.rotation ?? [0, 0, 0, 1], scale: node.scale ?? [1, 1, 1] }));
    const materials = (gltf.materials ?? []).map((material, index) => ({ index, name: material.name || `Material ${index + 1}`, pbr: material.pbrMetallicRoughness ?? {}, normalTexture: material.normalTexture, emissiveTexture: material.emissiveTexture, emissiveFactor: material.emissiveFactor, occlusionTexture: material.occlusionTexture, alphaMode: material.alphaMode, alphaCutoff: material.alphaCutoff, doubleSided: material.doubleSided, extensions: material.extensions }));
    const animations = (gltf.animations ?? []).map((animation, index) => ({ index, name: animation.name || `Animation ${index + 1}`, channelCount: animation.channels?.length ?? 0 }));
    const warnings: string[] = [];
    for (const extension of gltf.extensionsRequired ?? []) if (!['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_emissive_strength', 'KHR_materials_volume', 'KHR_mesh_quantization'].includes(extension)) warnings.push(`Required extension may be unsupported: ${extension}`);
    postMessage({ ok: true, result: { nodes, materials, animations, images: gltf.images ?? [], meshes: gltf.meshes ?? [], cameras: gltf.cameras ?? [], extensionsUsed: gltf.extensionsUsed ?? [], warnings } });
  } catch (error) { postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
};
