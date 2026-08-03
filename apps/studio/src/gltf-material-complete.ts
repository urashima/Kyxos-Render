import { SceneDocument } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneMaterial,
  TextureRef,
  Vec3,
  Vec4,
} from '@kyxos/scene-contract';

interface ReportTextureInfo {
  index?: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
  extensions?: Record<string, unknown>;
}

interface ReportMaterial {
  index?: number;
  pbr?: Record<string, unknown>;
  normalTexture?: ReportTextureInfo;
  emissiveTexture?: ReportTextureInfo;
  emissiveFactor?: number[];
  occlusionTexture?: ReportTextureInfo;
  alphaMode?: string;
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, unknown>;
}

interface ReportImage {
  name?: string;
  mimeType?: string;
  uri?: string;
}

interface ReportTexture {
  source?: number;
  sampler?: number;
  extensions?: Record<string, unknown>;
}

interface ReportSampler {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
}

interface ImportReport {
  materials?: ReportMaterial[];
  images?: ReportImage[];
  textures?: {
    textures?: ReportTexture[];
    samplers?: ReportSampler[];
  };
}

interface MaterialImportGlobal {
  __kyxosLastGlbImportReport?: ImportReport;
}

interface SceneDocumentPrototype {
  replace(scene: KyxosSceneContract, source?: string): void;
  __kyxosCompleteGltfMaterialsInstalled?: boolean;
}

type CompleteSceneMaterial = SceneMaterial & {
  unlit?: boolean;
  aoIntensity?: number;
  clearcoatNormalTexture?: TextureRef;
  clearcoatNormalScale?: number;
  sheenColorTexture?: TextureRef;
  sheenRoughnessTexture?: TextureRef;
  specularTexture?: TextureRef;
  specularColorTexture?: TextureRef;
  iridescence?: number;
  iridescenceTexture?: TextureRef;
  iridescenceIor?: number;
  iridescenceThicknessMinimum?: number;
  iridescenceThicknessMaximum?: number;
  iridescenceThicknessTexture?: TextureRef;
  anisotropy?: number;
  anisotropyRotation?: number;
  anisotropyTexture?: TextureRef;
  dispersion?: number;
};

type CompleteTextureField =
  | 'baseColorTexture'
  | 'metalnessTexture'
  | 'roughnessTexture'
  | 'normalTexture'
  | 'emissiveTexture'
  | 'aoTexture'
  | 'clearcoatTexture'
  | 'clearcoatRoughnessTexture'
  | 'clearcoatNormalTexture'
  | 'transmissionTexture'
  | 'thicknessTexture'
  | 'sheenColorTexture'
  | 'sheenRoughnessTexture'
  | 'specularTexture'
  | 'specularColorTexture'
  | 'iridescenceTexture'
  | 'iridescenceThicknessTexture'
  | 'anisotropyTexture';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function factor(value: unknown, size: number, defaults: number[]): number[] {
  return Array.isArray(value)
    ? Array.from({ length: size }, (_, index) => finite(value[index], defaults[index]))
    : defaults.slice(0, size);
}

function vec3(value: unknown, defaults: number[]): Vec3 {
  const result = factor(value, 3, defaults);
  return { x: result[0], y: result[1], z: result[2] };
}

function vec4(value: unknown, defaults: number[]): Vec4 {
  const result = factor(value, 4, defaults);
  return { x: result[0], y: result[1], z: result[2], w: result[3] };
}

function importReport(scene: KyxosSceneContract): ImportReport | null {
  const model = Object.values(scene.assets).find((asset) => asset.kind === 'model');
  const embedded = model?.metadata?.gltfImportReport;
  if (embedded && typeof embedded === 'object' && !Array.isArray(embedded)) {
    return embedded as ImportReport;
  }
  const globalReport = (globalThis as typeof globalThis & MaterialImportGlobal)
    .__kyxosLastGlbImportReport;
  return globalReport && typeof globalReport === 'object' ? globalReport : null;
}

function textureImageIndex(texture: ReportTexture | undefined): number | null {
  const basis = record(texture?.extensions?.KHR_texture_basisu);
  const source = typeof basis.source === 'number' ? basis.source : texture?.source;
  return typeof source === 'number' && Number.isInteger(source) ? source : null;
}

function mimeType(image: ReportImage | undefined): string {
  if (image?.mimeType) return image.mimeType;
  const extension = image?.uri?.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ktx2: 'image/ktx2',
    avif: 'image/avif',
  } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function textureAssetId(modelAssetId: string, textureIndex: number): string {
  return `embedded-gltf-texture:${modelAssetId}:${textureIndex}`;
}

function textureHash(modelHash: string, textureIndex: number): string {
  return `${modelHash.slice(0, 56)}${textureIndex.toString(16).padStart(8, '0')}`;
}

function ensureTextureAsset(
  scene: KyxosSceneContract,
  report: ImportReport,
  textureIndex: number,
): string | null {
  const model = Object.values(scene.assets).find((asset) => asset.kind === 'model');
  const texture = report.textures?.textures?.[textureIndex];
  const imageIndex = textureImageIndex(texture);
  if (!model || !texture || imageIndex == null) return null;

  const id = textureAssetId(model.id, textureIndex);
  const image = report.images?.[imageIndex];
  const contentHash = textureHash(model.contentHash, textureIndex);
  scene.assets[id] = {
    id,
    uri: `asset://${contentHash}`,
    contentHash,
    kind: 'texture',
    mimeType: mimeType(image),
    name: image?.name || `glTF Texture ${textureIndex + 1}`,
    metadata: {
      embedded: true,
      embeddedInAssetId: model.id,
      gltfTextureIndex: textureIndex,
      gltfImageIndex: imageIndex,
      gltfSamplerIndex: texture.sampler,
      sourceUri: image?.uri,
    },
  };
  return id;
}

function wrap(value: number | undefined): TextureRef['wrapS'] | undefined {
  return ({
    10497: 'repeat',
    33071: 'clamp',
    33648: 'mirror',
  } as Record<number, TextureRef['wrapS']>)[value ?? -1];
}

function minFilter(value: number | undefined): string | undefined {
  return ({
    9728: 'nearest',
    9729: 'linear',
    9984: 'nearestMipNearest',
    9985: 'linearMipNearest',
    9986: 'nearestMipLinear',
    9987: 'linearMipLinear',
  } as Record<number, string>)[value ?? -1];
}

function magFilter(value: number | undefined): string | undefined {
  return ({
    9728: 'nearest',
    9729: 'linear',
  } as Record<number, string>)[value ?? -1];
}

function vector2(value: unknown): { x: number; y: number } | undefined {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    ? { x: Number(value[0]), y: Number(value[1]) }
    : undefined;
}

function textureRef(
  scene: KyxosSceneContract,
  report: ImportReport,
  value: unknown,
  colorSpace: TextureRef['colorSpace'],
  channel: TextureRef['channel'],
): TextureRef | undefined {
  const info = record(value);
  const index = info.index;
  if (typeof index !== 'number' || !Number.isInteger(index)) return undefined;
  const assetId = ensureTextureAsset(scene, report, index);
  if (!assetId) return undefined;

  const texture = report.textures?.textures?.[index];
  const sampler = texture?.sampler == null
    ? undefined
    : report.textures?.samplers?.[texture.sampler];
  const transform = record(record(info.extensions).KHR_texture_transform);
  const result: TextureRef = {
    assetId,
    colorSpace,
    channel,
    texCoord: Math.max(0, Math.trunc(finite(transform.texCoord, finite(info.texCoord, 0)))),
    offset: vector2(transform.offset) ?? { x: 0, y: 0 },
    scale: vector2(transform.scale) ?? { x: 1, y: 1 },
    rotation: finite(transform.rotation, 0),
    wrapS: wrap(sampler?.wrapS) ?? 'repeat',
    wrapT: wrap(sampler?.wrapT) ?? 'repeat',
    minFilter: minFilter(sampler?.minFilter) ?? 'linearMipLinear',
    magFilter: magFilter(sampler?.magFilter) ?? 'linear',
  };
  return result;
}

function assignTexture(
  material: CompleteSceneMaterial,
  field: CompleteTextureField,
  value: TextureRef | undefined,
): void {
  if (value) (material as Record<string, unknown>)[field] = value;
  else delete (material as Record<string, unknown>)[field];
}

function normalizeMaterial(
  scene: KyxosSceneContract,
  report: ImportReport,
  material: CompleteSceneMaterial,
  source: ReportMaterial,
): void {
  const pbr = record(source.pbr);
  const extensions = record(source.extensions);
  const baseColor = vec4(pbr.baseColorFactor, [1, 1, 1, 1]);
  material.baseColor = baseColor;
  material.opacity = baseColor.w;
  material.metalness = finite(pbr.metallicFactor, 1);
  material.roughness = finite(pbr.roughnessFactor, 1);
  material.normalScale = finite(source.normalTexture?.scale, 1);
  material.aoIntensity = finite(source.occlusionTexture?.strength, 1);
  material.emissive = vec3(source.emissiveFactor, [0, 0, 0]);
  material.alphaMode = source.alphaMode === 'MASK'
    ? 'mask'
    : source.alphaMode === 'BLEND'
      ? 'blend'
      : 'opaque';
  material.alphaCutoff = finite(source.alphaCutoff, 0.5);
  material.doubleSided = Boolean(source.doubleSided);

  const clearcoat = record(extensions.KHR_materials_clearcoat);
  const transmission = record(extensions.KHR_materials_transmission);
  const volume = record(extensions.KHR_materials_volume);
  const ior = record(extensions.KHR_materials_ior);
  const sheen = record(extensions.KHR_materials_sheen);
  const specular = record(extensions.KHR_materials_specular);
  const emissiveStrength = record(extensions.KHR_materials_emissive_strength);
  const iridescence = record(extensions.KHR_materials_iridescence);
  const anisotropy = record(extensions.KHR_materials_anisotropy);
  const dispersion = record(extensions.KHR_materials_dispersion);

  material.unlit = 'KHR_materials_unlit' in extensions;
  material.clearcoat = finite(clearcoat.clearcoatFactor, 0);
  material.clearcoatRoughness = finite(clearcoat.clearcoatRoughnessFactor, 0);
  material.clearcoatNormalScale = finite(record(clearcoat.clearcoatNormalTexture).scale, 1);
  material.transmission = finite(transmission.transmissionFactor, 0);
  material.thickness = finite(volume.thicknessFactor, 0);
  material.attenuationDistance = finite(volume.attenuationDistance, Number.POSITIVE_INFINITY);
  material.attenuationColor = vec3(volume.attenuationColor, [1, 1, 1]);
  material.ior = finite(ior.ior, 1.5);
  material.sheenColor = vec3(sheen.sheenColorFactor, [0, 0, 0]);
  material.sheenRoughness = finite(sheen.sheenRoughnessFactor, 0);
  material.specularIntensity = finite(specular.specularFactor, 1);
  material.specularColor = vec3(specular.specularColorFactor, [1, 1, 1]);
  material.emissiveIntensity = finite(emissiveStrength.emissiveStrength, 1);
  material.iridescence = finite(iridescence.iridescenceFactor, 0);
  material.iridescenceIor = finite(iridescence.iridescenceIor, 1.3);
  material.iridescenceThicknessMinimum = finite(
    iridescence.iridescenceThicknessMinimum,
    100,
  );
  material.iridescenceThicknessMaximum = finite(
    iridescence.iridescenceThicknessMaximum,
    400,
  );
  material.anisotropy = finite(anisotropy.anisotropyStrength, 0);
  material.anisotropyRotation = finite(anisotropy.anisotropyRotation, 0);
  material.dispersion = finite(dispersion.dispersion, 0);

  const metallicRoughnessTexture = pbr.metallicRoughnessTexture;
  assignTexture(material, 'baseColorTexture', textureRef(
    scene,
    report,
    pbr.baseColorTexture,
    'srgb',
    'rgba',
  ));
  assignTexture(material, 'metalnessTexture', textureRef(
    scene,
    report,
    metallicRoughnessTexture,
    'linear',
    'b',
  ));
  assignTexture(material, 'roughnessTexture', textureRef(
    scene,
    report,
    metallicRoughnessTexture,
    'linear',
    'g',
  ));
  assignTexture(material, 'normalTexture', textureRef(
    scene,
    report,
    source.normalTexture,
    'linear',
    'rgb',
  ));
  assignTexture(material, 'emissiveTexture', textureRef(
    scene,
    report,
    source.emissiveTexture,
    'srgb',
    'rgb',
  ));
  assignTexture(material, 'aoTexture', textureRef(
    scene,
    report,
    source.occlusionTexture,
    'linear',
    'r',
  ));
  assignTexture(material, 'clearcoatTexture', textureRef(
    scene,
    report,
    clearcoat.clearcoatTexture,
    'linear',
    'r',
  ));
  assignTexture(material, 'clearcoatRoughnessTexture', textureRef(
    scene,
    report,
    clearcoat.clearcoatRoughnessTexture,
    'linear',
    'g',
  ));
  assignTexture(material, 'clearcoatNormalTexture', textureRef(
    scene,
    report,
    clearcoat.clearcoatNormalTexture,
    'linear',
    'rgb',
  ));
  assignTexture(material, 'transmissionTexture', textureRef(
    scene,
    report,
    transmission.transmissionTexture,
    'linear',
    'r',
  ));
  assignTexture(material, 'thicknessTexture', textureRef(
    scene,
    report,
    volume.thicknessTexture,
    'linear',
    'g',
  ));
  assignTexture(material, 'sheenColorTexture', textureRef(
    scene,
    report,
    sheen.sheenColorTexture,
    'srgb',
    'rgb',
  ));
  assignTexture(material, 'sheenRoughnessTexture', textureRef(
    scene,
    report,
    sheen.sheenRoughnessTexture,
    'linear',
    'a',
  ));
  assignTexture(material, 'specularTexture', textureRef(
    scene,
    report,
    specular.specularTexture,
    'linear',
    'a',
  ));
  assignTexture(material, 'specularColorTexture', textureRef(
    scene,
    report,
    specular.specularColorTexture,
    'srgb',
    'rgb',
  ));
  assignTexture(material, 'iridescenceTexture', textureRef(
    scene,
    report,
    iridescence.iridescenceTexture,
    'linear',
    'r',
  ));
  assignTexture(material, 'iridescenceThicknessTexture', textureRef(
    scene,
    report,
    iridescence.iridescenceThicknessTexture,
    'linear',
    'g',
  ));
  assignTexture(material, 'anisotropyTexture', textureRef(
    scene,
    report,
    anisotropy.anisotropyTexture,
    'linear',
    'rgb',
  ));

  material.metadata = {
    ...(material.metadata ?? {}),
    gltfMaterialModel: material.unlit ? 'unlit' : 'metallic-roughness',
    gltfMaterialExtensions: structuredClone(extensions),
    gltfCompleteTextureFields: [
      'baseColorTexture',
      'metalnessTexture',
      'roughnessTexture',
      'normalTexture',
      'emissiveTexture',
      'aoTexture',
      'clearcoatTexture',
      'clearcoatRoughnessTexture',
      'clearcoatNormalTexture',
      'transmissionTexture',
      'thicknessTexture',
      'sheenColorTexture',
      'sheenRoughnessTexture',
      'specularTexture',
      'specularColorTexture',
      'iridescenceTexture',
      'iridescenceThicknessTexture',
      'anisotropyTexture',
    ].filter((field) => Boolean((material as Record<string, unknown>)[field])),
  };
}

export function normalizeCompleteGltfMaterials(
  input: KyxosSceneContract,
  report: ImportReport,
): KyxosSceneContract {
  const scene = structuredClone(input);
  for (const materialValue of Object.values(scene.materials)) {
    const material = materialValue as CompleteSceneMaterial;
    const sourceIndex = material.metadata?.gltfMaterialIndex;
    if (typeof sourceIndex !== 'number') continue;
    const source = report.materials?.find((entry) => entry.index === sourceIndex)
      ?? report.materials?.[sourceIndex];
    if (source) normalizeMaterial(scene, report, material, source);
  }
  return scene;
}

const prototype = SceneDocument.prototype as unknown as SceneDocumentPrototype;
if (!prototype.__kyxosCompleteGltfMaterialsInstalled) {
  const originalReplace = prototype.replace;
  prototype.replace = function replaceWithCompleteGltfMaterials(
    scene: KyxosSceneContract,
    source = 'replace',
  ): void {
    const report = source === 'import-glb' ? importReport(scene) : null;
    originalReplace.call(
      this,
      report ? normalizeCompleteGltfMaterials(scene, report) : scene,
      source,
    );
  };
  prototype.__kyxosCompleteGltfMaterialsInstalled = true;
}
