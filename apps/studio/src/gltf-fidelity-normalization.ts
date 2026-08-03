import { SceneDocument } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneMaterial,
  TextureRef,
  Transform,
} from '@kyxos/scene-contract';

interface ReportNode {
  index?: number;
  parent?: number | null;
  matrix?: number[];
  rotation?: number[];
}

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
  occlusionTexture?: ReportTextureInfo;
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

interface ReportTextureBundle {
  textures?: ReportTexture[];
  samplers?: ReportSampler[];
}

interface ImportReport {
  nodes?: ReportNode[];
  materials?: ReportMaterial[];
  images?: ReportImage[];
  textures?: ReportTextureBundle;
}

interface FidelityGlobal {
  __kyxosLastGlbImportReport?: ImportReport;
}

interface SceneDocumentPrototype {
  replace(scene: KyxosSceneContract, source?: string): void;
  __kyxosGltfFidelityInstalled?: boolean;
}

type TextureField =
  | 'baseColorTexture'
  | 'metalnessTexture'
  | 'roughnessTexture'
  | 'normalTexture'
  | 'emissiveTexture'
  | 'aoTexture'
  | 'clearcoatTexture'
  | 'clearcoatRoughnessTexture'
  | 'transmissionTexture'
  | 'thicknessTexture';

type MaterialPayload = Omit<SceneMaterial, 'metadata'> & Partial<Record<TextureField, TextureRef>>;

function cloneTransform(transform: Transform): Transform {
  return structuredClone(transform);
}

function asImportReport(value: unknown): ImportReport | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ImportReport
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function importReport(scene: KyxosSceneContract): ImportReport | null {
  const modelAsset = Object.values(scene.assets).find((asset) => asset.kind === 'model');
  const embedded = asImportReport(modelAsset?.metadata?.gltfImportReport);
  if (embedded?.nodes?.length) return embedded;
  return asImportReport(
    (globalThis as typeof globalThis & FidelityGlobal).__kyxosLastGlbImportReport,
  );
}

function mimeFromImage(image: ReportImage | undefined): string {
  if (image?.mimeType) return image.mimeType;
  const extension = image?.uri?.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ktx2: 'image/ktx2',
  } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function embeddedTextureAssetId(modelAssetId: string, textureIndex: number): string {
  return `embedded-gltf-texture:${modelAssetId}:${textureIndex}`;
}

function textureImageIndex(texture: ReportTexture | undefined): number | null {
  const basis = asRecord(texture?.extensions?.KHR_texture_basisu);
  const source = typeof basis.source === 'number' ? basis.source : texture?.source;
  return typeof source === 'number' && Number.isInteger(source) ? source : null;
}

function ensureEmbeddedTextureAsset(
  scene: KyxosSceneContract,
  report: ImportReport,
  textureIndex: number,
): string | null {
  const model = Object.values(scene.assets).find((asset) => asset.kind === 'model');
  const texture = report.textures?.textures?.[textureIndex];
  const imageIndex = textureImageIndex(texture);
  if (!model || !texture || imageIndex == null) return null;

  const assetId = embeddedTextureAssetId(model.id, textureIndex);
  const image = report.images?.[imageIndex];
  scene.assets[assetId] = {
    id: assetId,
    uri: `asset://${model.contentHash}-embedded-texture-${textureIndex}`,
    contentHash: `${model.contentHash}:embedded-texture:${textureIndex}`,
    kind: 'texture',
    mimeType: mimeFromImage(image),
    name: image?.name || `Embedded Texture ${textureIndex + 1}`,
    metadata: {
      embedded: true,
      embeddedInAssetId: model.id,
      gltfTextureIndex: textureIndex,
      gltfImageIndex: imageIndex,
      gltfSamplerIndex: texture.sampler,
      sourceUri: image?.uri,
    },
  };
  return assetId;
}

function wrapMode(value: number | undefined): TextureRef['wrapS'] | undefined {
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

function vec2(value: unknown): { x: number; y: number } | undefined {
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
  info: unknown,
  colorSpace: TextureRef['colorSpace'],
  channel?: TextureRef['channel'],
): TextureRef | undefined {
  const source = asRecord(info);
  const textureIndex = source.index;
  if (typeof textureIndex !== 'number' || !Number.isInteger(textureIndex)) return undefined;
  const assetId = ensureEmbeddedTextureAsset(scene, report, textureIndex);
  if (!assetId) return undefined;

  const texture = report.textures?.textures?.[textureIndex];
  const sampler = texture?.sampler == null
    ? undefined
    : report.textures?.samplers?.[texture.sampler];
  const transform = asRecord(asRecord(source.extensions).KHR_texture_transform);
  const transformedTexCoord = typeof transform.texCoord === 'number'
    ? transform.texCoord
    : source.texCoord;
  const reference: TextureRef = {
    assetId,
    colorSpace,
    ...(channel ? { channel } : {}),
  };
  if (typeof transformedTexCoord === 'number') reference.texCoord = transformedTexCoord;
  const offset = vec2(transform.offset);
  const scale = vec2(transform.scale);
  if (offset) reference.offset = offset;
  if (scale) reference.scale = scale;
  if (typeof transform.rotation === 'number') reference.rotation = transform.rotation;
  const wrapS = wrapMode(sampler?.wrapS);
  const wrapT = wrapMode(sampler?.wrapT);
  const minimum = minFilter(sampler?.minFilter);
  const magnification = magFilter(sampler?.magFilter);
  if (wrapS) reference.wrapS = wrapS;
  if (wrapT) reference.wrapT = wrapT;
  if (minimum) reference.minFilter = minimum;
  if (magnification) reference.magFilter = magnification;
  return reference;
}

function materialPayload(material: SceneMaterial): MaterialPayload {
  const copy = structuredClone(material) as SceneMaterial & { metadata?: unknown };
  delete copy.metadata;
  return copy as MaterialPayload;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyTextureField(
  material: SceneMaterial,
  baseline: MaterialPayload,
  field: TextureField,
  imported: TextureRef | undefined,
): void {
  const target = material as SceneMaterial & Partial<Record<TextureField, TextureRef>>;
  if (sameValue(target[field], baseline[field])) {
    if (imported) target[field] = imported;
    else delete target[field];
  }
  if (imported) baseline[field] = imported;
  else delete baseline[field];
}

function enrichMaterialTextures(
  scene: KyxosSceneContract,
  report: ImportReport,
): void {
  for (const material of Object.values(scene.materials)) {
    const sourceIndex = material.metadata?.gltfMaterialIndex;
    if (typeof sourceIndex !== 'number') continue;
    const source = report.materials?.find((entry) => entry.index === sourceIndex)
      ?? report.materials?.[sourceIndex];
    if (!source) continue;

    const pbr = asRecord(source.pbr);
    const extensions = asRecord(source.extensions);
    const clearcoat = asRecord(extensions.KHR_materials_clearcoat);
    const transmission = asRecord(extensions.KHR_materials_transmission);
    const volume = asRecord(extensions.KHR_materials_volume);
    const priorOriginal = material.metadata?.original;
    const baseline = priorOriginal && typeof priorOriginal === 'object'
      ? structuredClone(priorOriginal) as MaterialPayload
      : materialPayload(material);

    const baseColor = textureRef(scene, report, pbr.baseColorTexture, 'srgb', 'rgba');
    const metallicRoughness = pbr.metallicRoughnessTexture;
    const normal = textureRef(scene, report, source.normalTexture, 'linear', 'rgb');
    const emissive = textureRef(scene, report, source.emissiveTexture, 'srgb', 'rgb');
    const occlusion = textureRef(scene, report, source.occlusionTexture, 'linear', 'r');
    const clearcoatMap = textureRef(scene, report, clearcoat.clearcoatTexture, 'linear', 'r');
    const clearcoatRoughness = textureRef(
      scene,
      report,
      clearcoat.clearcoatRoughnessTexture,
      'linear',
      'g',
    );
    const transmissionMap = textureRef(
      scene,
      report,
      transmission.transmissionTexture,
      'linear',
      'r',
    );
    const thicknessMap = textureRef(scene, report, volume.thicknessTexture, 'linear', 'g');

    applyTextureField(material, baseline, 'baseColorTexture', baseColor);
    applyTextureField(
      material,
      baseline,
      'metalnessTexture',
      textureRef(scene, report, metallicRoughness, 'linear', 'b'),
    );
    applyTextureField(
      material,
      baseline,
      'roughnessTexture',
      textureRef(scene, report, metallicRoughness, 'linear', 'g'),
    );
    applyTextureField(material, baseline, 'normalTexture', normal);
    applyTextureField(material, baseline, 'emissiveTexture', emissive);
    applyTextureField(material, baseline, 'aoTexture', occlusion);
    applyTextureField(material, baseline, 'clearcoatTexture', clearcoatMap);
    applyTextureField(material, baseline, 'clearcoatRoughnessTexture', clearcoatRoughness);
    applyTextureField(material, baseline, 'transmissionTexture', transmissionMap);
    applyTextureField(material, baseline, 'thicknessTexture', thicknessMap);

    material.metadata = {
      ...(material.metadata ?? {}),
      gltfTextures: {
        baseColor: pbr.baseColorTexture,
        metallicRoughness,
        normal: source.normalTexture,
        emissive: source.emissiveTexture,
        occlusion: source.occlusionTexture,
        clearcoat: clearcoat.clearcoatTexture,
        clearcoatRoughness: clearcoat.clearcoatRoughnessTexture,
        transmission: transmission.transmissionTexture,
        thickness: volume.thicknessTexture,
      },
      embeddedTextureAssetIds: [
        baseColor,
        normal,
        emissive,
        occlusion,
        clearcoatMap,
        clearcoatRoughness,
        transmissionMap,
        thicknessMap,
      ].flatMap((entry) => entry ? [entry.assetId] : []),
      original: baseline,
    };
  }
}

function enrichImportedScene(scene: KyxosSceneContract, report: ImportReport): KyxosSceneContract {
  const next = structuredClone(scene);
  for (const node of next.nodes) {
    const sourceIndex = node.metadata?.gltfNodeIndex;
    if (typeof sourceIndex !== 'number') continue;
    const source = report.nodes?.[sourceIndex];
    if (!source) continue;
    node.metadata = {
      ...(node.metadata ?? {}),
      sourceQuaternion: Array.isArray(source.rotation)
        ? structuredClone(source.rotation)
        : node.metadata?.sourceQuaternion,
      gltfNodeMatrix: Array.isArray(source.matrix) && source.matrix.length === 16
        ? structuredClone(source.matrix)
        : node.metadata?.gltfNodeMatrix,
      gltfOriginalParentIndex: source.parent ?? null,
      gltfOriginalTransform: cloneTransform(node.transform),
    };
  }
  enrichMaterialTextures(next, report);
  return next;
}

const prototype = SceneDocument.prototype as unknown as SceneDocumentPrototype;
if (!prototype.__kyxosGltfFidelityInstalled) {
  const originalReplace = prototype.replace;
  prototype.replace = function replaceWithNativeGltfMetadata(
    scene: KyxosSceneContract,
    source = 'replace',
  ): void {
    const report = source === 'import-glb' ? importReport(scene) : null;
    originalReplace.call(
      this,
      report ? enrichImportedScene(scene, report) : scene,
      source,
    );
  };
  prototype.__kyxosGltfFidelityInstalled = true;
}
