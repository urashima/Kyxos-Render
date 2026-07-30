interface GlbNode {
  name?: string;
  children?: number[];
  mesh?: number;
  camera?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GlbAccessor {
  min?: number[];
  max?: number[];
}

interface TextureInfo {
  index?: number;
  texCoord?: number;
  scale?: number;
  extensions?: Record<string, unknown>;
}

interface GlbAnimation {
  name?: string;
  samplers?: Array<{ input?: number; output?: number; interpolation?: string }>;
  channels?: Array<Record<string, unknown>>;
}

interface GlbJson {
  nodes?: GlbNode[];
  meshes?: Array<{
    name?: string;
    primitives?: Array<{ material?: number; attributes?: Record<string, number> }>;
  }>;
  materials?: Array<Record<string, any>>;
  animations?: GlbAnimation[];
  images?: Array<{
    name?: string;
    mimeType?: string;
    bufferView?: number;
    uri?: string;
  }>;
  textures?: Array<{ source?: number; sampler?: number }>;
  samplers?: Array<Record<string, unknown>>;
  accessors?: GlbAccessor[];
  cameras?: Array<Record<string, unknown>>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

function parseGlb(buffer: ArrayBuffer): GlbJson {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('File is not a valid GLB container.');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error('Only GLB 2.0 is supported.');
  }

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (type === 0x4e4f534a) {
      return JSON.parse(
        new TextDecoder()
          .decode(new Uint8Array(buffer, offset, length))
          .replace(/\0+$/g, ''),
      ) as GlbJson;
    }
    offset += length;
  }
  throw new Error('GLB JSON chunk is missing.');
}

function animationDuration(animation: GlbAnimation, accessors: GlbAccessor[]): number {
  let duration = 0;
  for (const sampler of animation.samplers ?? []) {
    const accessor = sampler.input == null ? undefined : accessors[sampler.input];
    const maximum = accessor?.max?.[0];
    if (typeof maximum === 'number' && Number.isFinite(maximum)) {
      duration = Math.max(duration, maximum);
    }
  }
  return duration;
}

self.onmessage = (
  event: MessageEvent<{ buffer: ArrayBuffer; name: string }>,
) => {
  try {
    const gltf = parseGlb(event.data.buffer);
    const parents = new Map<number, number>();
    gltf.nodes?.forEach((node, parent) =>
      node.children?.forEach((child) => parents.set(child, parent)),
    );

    const nodes = (gltf.nodes ?? []).map((node, index) => ({
      index,
      name: node.name || `Node ${index + 1}`,
      parent: parents.get(index) ?? null,
      children: node.children ?? [],
      mesh: node.mesh,
      camera: node.camera,
      translation: node.translation ?? [0, 0, 0],
      rotation: node.rotation ?? [0, 0, 0, 1],
      scale: node.scale ?? [1, 1, 1],
    }));

    const materials = (gltf.materials ?? []).map((material, index) => ({
      index,
      name: material.name || `Material ${index + 1}`,
      pbr: material.pbrMetallicRoughness ?? {},
      normalTexture: material.normalTexture as TextureInfo | undefined,
      emissiveTexture: material.emissiveTexture as TextureInfo | undefined,
      emissiveFactor: material.emissiveFactor,
      occlusionTexture: material.occlusionTexture as TextureInfo | undefined,
      alphaMode: material.alphaMode,
      alphaCutoff: material.alphaCutoff,
      doubleSided: material.doubleSided,
      extensions: material.extensions,
    }));

    const animations = (gltf.animations ?? []).map((animation, index) => ({
      index,
      name: animation.name || `Animation ${index + 1}`,
      channelCount: animation.channels?.length ?? 0,
      duration: animationDuration(animation, gltf.accessors ?? []),
      interpolation: [
        ...new Set(
          (animation.samplers ?? []).map(
            (sampler) => sampler.interpolation ?? 'LINEAR',
          ),
        ),
      ],
    }));

    const warnings: string[] = [];
    const supportedExtensions = new Set([
      'KHR_materials_unlit',
      'KHR_texture_transform',
      'KHR_materials_clearcoat',
      'KHR_materials_transmission',
      'KHR_materials_ior',
      'KHR_materials_sheen',
      'KHR_materials_specular',
      'KHR_materials_emissive_strength',
      'KHR_materials_volume',
      'KHR_mesh_quantization',
      'KHR_texture_basisu',
    ]);
    for (const extension of gltf.extensionsRequired ?? []) {
      if (!supportedExtensions.has(extension)) {
        warnings.push(`Required extension may be unsupported: ${extension}`);
      }
    }

    postMessage({
      ok: true,
      result: {
        sourceName: event.data.name,
        nodes,
        materials,
        animations,
        images: gltf.images ?? [],
        textures: gltf.textures ?? [],
        samplers: gltf.samplers ?? [],
        meshes: gltf.meshes ?? [],
        cameras: gltf.cameras ?? [],
        extensionsUsed: gltf.extensionsUsed ?? [],
        warnings,
      },
    });
  } catch (error) {
    postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
