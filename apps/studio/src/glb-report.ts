interface GlbNode {
  name?: string;
  children?: number[];
  mesh?: number;
  camera?: number;
  skin?: number;
  weights?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extensions?: Record<string, unknown>;
  extras?: Record<string, unknown>;
}

interface GlbAccessor {
  min?: number[];
  max?: number[];
}

interface TextureInfo {
  index?: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
  extensions?: Record<string, unknown>;
}

interface GlbAnimation {
  name?: string;
  samplers?: Array<{ input?: number; output?: number; interpolation?: string }>;
  channels?: Array<Record<string, unknown>>;
}

interface GlbPrimitive {
  material?: number;
  mode?: number;
  indices?: number;
  attributes?: Record<string, number>;
  targets?: Array<Record<string, number>>;
  extensions?: Record<string, unknown>;
}

interface GlbMaterial extends Record<string, unknown> {
  name?: string;
  pbrMetallicRoughness?: Record<string, unknown>;
  normalTexture?: TextureInfo;
  emissiveTexture?: TextureInfo;
  emissiveFactor?: number[];
  occlusionTexture?: TextureInfo;
  alphaMode?: string;
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, unknown>;
}

interface GlbJson {
  nodes?: GlbNode[];
  meshes?: Array<{
    name?: string;
    weights?: number[];
    primitives?: GlbPrimitive[];
    extras?: { targetNames?: string[]; [key: string]: unknown };
  }>;
  materials?: GlbMaterial[];
  animations?: GlbAnimation[];
  images?: Array<{
    name?: string;
    mimeType?: string;
    bufferView?: number;
    uri?: string;
  }>;
  textures?: Array<{ source?: number; sampler?: number; extensions?: Record<string, unknown> }>;
  samplers?: Array<Record<string, unknown>>;
  accessors?: GlbAccessor[];
  cameras?: Array<Record<string, unknown>>;
  skins?: Array<{
    name?: string;
    inverseBindMatrices?: number;
    skeleton?: number;
    joints?: number[];
  }>;
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface GlbImportReport {
  sourceName: string;
  nodes: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  animations: Array<Record<string, unknown>>;
  images: NonNullable<GlbJson['images']>;
  textures: Record<string, unknown>;
  meshes: NonNullable<GlbJson['meshes']>;
  cameras: NonNullable<GlbJson['cameras']>;
  skins: NonNullable<GlbJson['skins']>;
  lights: unknown[];
  materialVariants: unknown[];
  extensionsUsed: string[];
  extensionsRequired: string[];
  warnings: string[];
}

function parseGlbJson(buffer: ArrayBuffer): GlbJson {
  if (buffer.byteLength < 20) throw new Error('File is too small to be a GLB container.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('File is not a valid GLB container.');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error('Only GLB 2.0 is supported.');
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > buffer.byteLength) {
    throw new Error('GLB container is truncated.');
  }

  let offset = 12;
  while (offset + 8 <= declaredLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > declaredLength) throw new Error('GLB chunk exceeds container length.');
    if (type === 0x4e4f534a) {
      const source = new TextDecoder()
        .decode(new Uint8Array(buffer, offset, length))
        .replace(/[\0\s]+$/g, '');
      return JSON.parse(source) as GlbJson;
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
    if (typeof maximum === 'number' && Number.isFinite(maximum)) duration = Math.max(duration, maximum);
  }
  return duration;
}

function primitiveReport(primitive: GlbPrimitive, index: number) {
  return {
    index,
    material: primitive.material ?? null,
    mode: primitive.mode ?? 4,
    indices: primitive.indices ?? null,
    attributes: primitive.attributes ?? {},
    targets: primitive.targets ?? [],
    extensions: primitive.extensions ?? {},
  };
}

export function createGlbImportReport(
  buffer: ArrayBuffer,
  sourceName: string,
): GlbImportReport {
  const gltf = parseGlbJson(buffer);
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
    skin: node.skin,
    weights: node.weights ?? [],
    translation: node.translation ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0, 1],
    scale: node.scale ?? [1, 1, 1],
    extensions: node.extensions ?? {},
    extras: node.extras ?? {},
  }));

  const materials = (gltf.materials ?? []).map((material, index) => ({
    index,
    name: material.name || `Material ${index + 1}`,
    pbr: material.pbrMetallicRoughness ?? {},
    normalTexture: material.normalTexture,
    emissiveTexture: material.emissiveTexture,
    emissiveFactor: material.emissiveFactor,
    occlusionTexture: material.occlusionTexture,
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
    interpolation: [...new Set((animation.samplers ?? []).map((sampler) => sampler.interpolation ?? 'LINEAR'))],
    channels: animation.channels ?? [],
    samplers: animation.samplers ?? [],
  }));

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
    'KHR_materials_variants',
    'KHR_lights_punctual',
    'KHR_mesh_quantization',
    'KHR_texture_basisu',
    'EXT_meshopt_compression',
    'KHR_draco_mesh_compression',
  ]);
  const warnings = (gltf.extensionsRequired ?? [])
    .filter((extension) => !supportedExtensions.has(extension))
    .map((extension) => `Required extension may be unsupported: ${extension}`);

  const meshPrimitives = (gltf.meshes ?? []).map((mesh, meshIndex) => ({
    meshIndex,
    name: mesh.name || `Mesh ${meshIndex + 1}`,
    weights: mesh.weights ?? [],
    targetNames: mesh.extras?.targetNames ?? [],
    primitives: (mesh.primitives ?? []).map(primitiveReport),
  }));

  return {
    sourceName,
    nodes,
    materials,
    animations,
    images: gltf.images ?? [],
    textures: {
      textures: gltf.textures ?? [],
      samplers: gltf.samplers ?? [],
      meshPrimitives,
      skins: gltf.skins ?? [],
      rootExtensions: gltf.extensions ?? {},
    },
    meshes: gltf.meshes ?? [],
    cameras: gltf.cameras ?? [],
    skins: gltf.skins ?? [],
    lights: (gltf.extensions as { KHR_lights_punctual?: { lights?: unknown[] } } | undefined)
      ?.KHR_lights_punctual?.lights ?? [],
    materialVariants: (gltf.extensions as { KHR_materials_variants?: { variants?: unknown[] } } | undefined)
      ?.KHR_materials_variants?.variants ?? [],
    extensionsUsed: gltf.extensionsUsed ?? [],
    extensionsRequired: gltf.extensionsRequired ?? [],
    warnings,
  };
}
