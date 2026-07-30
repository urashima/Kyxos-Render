import {
  KYXOS_ASSET_MANIFEST_VERSION,
  fail,
  ok,
  okWithFallback,
  type AssetManifest,
  type AssetReference,
  type KyxosResult,
} from '@kyxos/scene-contract';

export type AssetUploadState =
  'Selecting' | 'Validating' | 'Uploading' | 'Processing' | 'Generating Preview' | 'Ready' | 'Failed';

export interface AssetImportReport {
  fileName: string;
  fileSizeBytes: number;
  format: AssetReference['kind'];
  meshCount: number;
  triangleCount: number;
  drawCallEstimate: number;
  materialCount: number;
  textureCount: number;
  maxTextureSize: number;
  gpuMemoryEstimateBytes: number;
  skeletonCount: number;
  morphTargetCount: number;
  animationCount: number;
  animationDurationSeconds: number;
  cameras: number;
  nodes: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
  warnings: string[];
  errors: string[];
  missingFiles: string[];
  unsupportedExtensions: string[];
  zipEntries: string[];
}

export interface AssetImportResult {
  state: AssetUploadState;
  report: AssetImportReport;
  manifest: AssetManifest;
  validation: KyxosResult<AssetImportReport>;
}

export interface AssetImporterOptions {
  assetId?: string;
  revision?: number;
  url?: string;
  mimeType?: string;
  validator?: (gltfJson: unknown, bytes: ArrayBuffer) => Promise<{ warnings: string[]; errors: string[] }>;
  supportedExtensions?: string[];
  zipEntries?: string[];
}

export interface TusUploadController {
  readonly state: AssetUploadState;
  readonly uploadedBytes: number;
  readonly totalBytes: number;
  start: () => Promise<KyxosResult<{ uploadUrl: string; uploadedBytes: number }>>;
  cancel: () => void;
  resume: () => Promise<KyxosResult<{ uploadUrl: string; uploadedBytes: number }>>;
}

const supportedExtensions = new Set([
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_texture_basisu',
  'KHR_texture_transform',
  'KHR_draco_mesh_compression',
  'KHR_mesh_quantization',
  'EXT_meshopt_compression',
  'KHR_animation_pointer',
]);

const textureMimePattern = /image\/(png|jpeg|webp|ktx2)|video\/(mp4|webm)/i;

function getName(input: Blob | ArrayBuffer, fallback = 'asset.glb') {
  return input instanceof Blob && 'name' in input ? String((input as File).name) : fallback;
}

function getSize(input: Blob | ArrayBuffer) {
  return input instanceof Blob ? input.size : input.byteLength;
}

async function toArrayBuffer(input: Blob | ArrayBuffer) {
  return input instanceof Blob ? input.arrayBuffer() : input;
}

function readText(view: DataView, offset: number, length: number) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  return new TextDecoder().decode(bytes);
}

function emptyReport(
  fileName: string,
  fileSizeBytes: number,
  format: AssetReference['kind'],
): AssetImportReport {
  return {
    fileName,
    fileSizeBytes,
    format,
    meshCount: 0,
    triangleCount: 0,
    drawCallEstimate: 0,
    materialCount: 0,
    textureCount: 0,
    maxTextureSize: 0,
    gpuMemoryEstimateBytes: 0,
    skeletonCount: 0,
    morphTargetCount: 0,
    animationCount: 0,
    animationDurationSeconds: 0,
    cameras: 0,
    nodes: 0,
    extensionsUsed: [],
    extensionsRequired: [],
    warnings: [],
    errors: [],
    missingFiles: [],
    unsupportedExtensions: [],
    zipEntries: [],
  };
}

function formatFromName(fileName: string, mimeType?: string): AssetReference['kind'] | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.zip')) return 'gltf-zip';
  if (lower.endsWith('.hdr')) return 'hdr';
  if (lower.endsWith('.exr')) return 'exr';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ktx2')
  ) {
    return 'texture';
  }
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || (mimeType && textureMimePattern.test(mimeType))) {
    return 'video';
  }
  return null;
}

function trianglesForPrimitive(primitive: any, accessors: any[] = []) {
  const mode = Number(primitive.mode ?? 4);
  const indices = primitive.indices !== undefined ? accessors[primitive.indices] : null;
  const positions =
    primitive.attributes?.POSITION !== undefined ? accessors[primitive.attributes.POSITION] : null;
  const count = Number(indices?.count ?? positions?.count ?? 0);
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function analyzeGltfJson(json: any, fileName: string, fileSizeBytes: number, format: AssetReference['kind']) {
  const report = emptyReport(fileName, fileSizeBytes, format);
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const images = Array.isArray(json.images) ? json.images : [];
  const textures = Array.isArray(json.textures) ? json.textures : [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const animations = Array.isArray(json.animations) ? json.animations : [];

  report.meshCount = meshes.length;
  report.drawCallEstimate = meshes.reduce((sum, mesh: any) => sum + Number(mesh.primitives?.length ?? 0), 0);
  report.triangleCount = meshes.reduce(
    (sum, mesh: any) =>
      sum +
      (mesh.primitives ?? []).reduce(
        (inner: number, primitive: any) => inner + trianglesForPrimitive(primitive, accessors),
        0,
      ),
    0,
  );
  report.materialCount = Array.isArray(json.materials) ? json.materials.length : 0;
  report.textureCount = Math.max(textures.length, images.length);
  report.skeletonCount = Array.isArray(json.skins) ? json.skins.length : 0;
  report.morphTargetCount = meshes.reduce(
    (sum, mesh: any) =>
      sum +
      (mesh.primitives ?? []).reduce(
        (inner: number, primitive: any) => inner + Number(primitive.targets?.length ?? 0),
        0,
      ),
    0,
  );
  report.animationCount = animations.length;
  report.animationDurationSeconds = animations.reduce((maxDuration: number, animation: any) => {
    const samplerMax = (animation.samplers ?? []).reduce((innerMax: number, sampler: any) => {
      const accessor = accessors[sampler.output];
      return Math.max(innerMax, Number(accessor?.max?.[0] ?? 0));
    }, 0);
    return Math.max(maxDuration, samplerMax);
  }, 0);
  report.cameras = Array.isArray(json.cameras) ? json.cameras.length : 0;
  report.nodes = nodes.length;
  report.extensionsUsed = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
  report.extensionsRequired = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  report.unsupportedExtensions = report.extensionsRequired.filter(
    (extension) => !supportedExtensions.has(extension),
  );
  report.maxTextureSize = images.reduce(
    (maxSize: number, image: any) =>
      Math.max(maxSize, Number(image.extras?.width ?? 0), Number(image.extras?.height ?? 0)),
    0,
  );
  report.gpuMemoryEstimateBytes =
    fileSizeBytes +
    report.triangleCount * 96 +
    Math.max(report.textureCount, 1) *
      Math.max(report.maxTextureSize, 1024) *
      Math.max(report.maxTextureSize, 1024) *
      4;
  report.missingFiles = images
    .map((image: any) => String(image.uri ?? ''))
    .filter(
      (uri: string) => uri && !uri.startsWith('data:') && !uri.startsWith('blob:') && !uri.includes('/'),
    );
  if (report.unsupportedExtensions.length > 0) {
    report.errors.push(`Unsupported required extensions: ${report.unsupportedExtensions.join(', ')}`);
  }
  if (report.meshCount === 0 && format !== 'hdr' && format !== 'exr')
    report.warnings.push('No meshes were found.');
  return report;
}

function parseGlb(bytes: ArrayBuffer, fileName: string): KyxosResult<AssetImportReport> {
  const view = new DataView(bytes);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    return fail<AssetImportReport>('KX_ASSET_INVALID', 'GLB magic header is invalid.');
  }
  const version = view.getUint32(4, true);
  if (version !== 2)
    return fail<AssetImportReport>('KX_ASSET_FORMAT_UNSUPPORTED', `GLB version ${version} is not supported.`);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > view.byteLength)
    return fail<AssetImportReport>('KX_ASSET_INVALID', 'GLB declared length exceeds file size.');
  const jsonChunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a)
    return fail<AssetImportReport>('KX_ASSET_INVALID', 'First GLB chunk is not JSON.');
  const json = JSON.parse(readText(view, 20, jsonChunkLength).replace(/\0+$/g, '').trim());
  const report = analyzeGltfJson(json, fileName, view.byteLength, 'glb');
  if (report.unsupportedExtensions.length > 0) {
    return fail('KX_ASSET_EXTENSION_UNSUPPORTED', report.errors.join(' '), { report });
  }
  return ok(report, 'GLB parsed.');
}

function parseZipEntries(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  const names: string[] = [];
  for (let offset = 0; offset < view.byteLength - 30; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(readText(view, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength - 1;
  }
  return names;
}

export async function inspectAsset(
  input: Blob | ArrayBuffer,
  options: AssetImporterOptions = {},
): Promise<KyxosResult<AssetImportResult>> {
  const fileName = getName(input, options.url?.split('/').pop() ?? 'asset.glb');
  const mimeType = options.mimeType ?? (input instanceof Blob ? input.type : undefined);
  const format = formatFromName(fileName, mimeType);
  if (!format)
    return fail<AssetImportResult>(
      'KX_ASSET_FORMAT_UNSUPPORTED',
      `Unsupported asset format for ${fileName}.`,
    );
  const bytes = await toArrayBuffer(input);
  let validation: KyxosResult<AssetImportReport>;

  if (format === 'glb') {
    validation = parseGlb(bytes, fileName);
  } else if (format === 'gltf-zip') {
    const entries = options.zipEntries ?? parseZipEntries(bytes);
    const report = emptyReport(fileName, getSize(input), format);
    report.zipEntries = entries;
    if (!entries.some((entry) => entry.toLowerCase().endsWith('.gltf')))
      report.errors.push('ZIP does not contain a .gltf file.');
    if (!entries.some((entry) => entry.toLowerCase().endsWith('.bin')))
      report.warnings.push('ZIP does not contain a .bin file.');
    validation =
      report.errors.length > 0
        ? fail('KX_ASSET_INVALID', report.errors.join(' '), { report })
        : okWithFallback(
            report,
            'ZIP structure validated; glTF JSON parsing is delegated to the processing service.',
          );
  } else {
    const report = emptyReport(fileName, getSize(input), format);
    validation = ok(report, `${format.toUpperCase()} asset accepted.`);
  }

  if (!validation.ok || !validation.data) {
    return fail(validation.code, validation.message ?? 'Asset validation failed.', validation.details);
  }

  if (options.validator && format === 'glb') {
    try {
      const validatorResult = await options.validator(validation.data, bytes);
      validation.data.warnings.push(...validatorResult.warnings);
      validation.data.errors.push(...validatorResult.errors);
    } catch (error) {
      validation.data.warnings.push(
        `Khronos glTF Validator adapter failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const source: AssetReference = {
    assetId: options.assetId ?? `asset-${Date.now()}`,
    revision: options.revision ?? 0,
    kind: format,
    url: options.url ?? `local://${fileName}`,
    fileName,
    mimeType,
    sizeBytes: getSize(input),
    manifestVersion: KYXOS_ASSET_MANIFEST_VERSION,
  };
  const report = validation.data;
  const manifest: AssetManifest = {
    assetManifestVersion: KYXOS_ASSET_MANIFEST_VERSION,
    assetId: source.assetId,
    revision: source.revision,
    source,
    fileSizeBytes: report.fileSizeBytes,
    meshCount: report.meshCount,
    triangleCount: report.triangleCount,
    drawCallEstimate: report.drawCallEstimate,
    materialCount: report.materialCount,
    textureCount: report.textureCount,
    maxTextureSize: report.maxTextureSize,
    gpuMemoryEstimateBytes: report.gpuMemoryEstimateBytes,
    skeletonCount: report.skeletonCount,
    morphTargetCount: report.morphTargetCount,
    animationCount: report.animationCount,
    animationDurationSeconds: report.animationDurationSeconds,
    cameras: report.cameras,
    nodes: report.nodes,
    extensionsUsed: report.extensionsUsed,
    extensionsRequired: report.extensionsRequired,
    warnings: report.warnings,
    errors: report.errors,
    missingFiles: report.missingFiles,
    unsupportedExtensions: report.unsupportedExtensions,
    generatedAt: new Date().toISOString(),
  };
  return validation.code === 'KX_OK_WITH_FALLBACK'
    ? okWithFallback(
        { state: 'Ready', report, manifest, validation },
        validation.message ?? 'Asset inspected with fallback.',
      )
    : ok({ state: 'Ready', report, manifest, validation }, 'Asset inspected.');
}

export function createTusUploadController(
  input: Blob | ArrayBuffer,
  endpoint: string,
  options: {
    chunkSize?: number;
    onProgress?: (uploadedBytes: number, totalBytes: number, state: AssetUploadState) => void;
    uploadUrl?: string;
  } = {},
): TusUploadController {
  let state: AssetUploadState = 'Selecting';
  let uploadedBytes = 0;
  let cancelled = false;
  const totalBytes = getSize(input);
  const chunkSize = Math.max(1, options.chunkSize ?? 1024 * 1024);
  const uploadUrl = options.uploadUrl ?? `${endpoint.replace(/\/$/, '')}/mock-${Date.now()}`;

  const run = async () => {
    cancelled = false;
    state = uploadedBytes > 0 ? 'Uploading' : 'Validating';
    options.onProgress?.(uploadedBytes, totalBytes, state);
    await Promise.resolve();
    state = 'Uploading';
    while (uploadedBytes < totalBytes) {
      if (cancelled)
        return fail<{ uploadUrl: string; uploadedBytes: number }>(
          'KX_ASSET_UPLOAD_FAILED',
          'Upload was cancelled.',
          { uploadedBytes },
        );
      uploadedBytes = Math.min(totalBytes, uploadedBytes + chunkSize);
      options.onProgress?.(uploadedBytes, totalBytes, state);
      await Promise.resolve();
    }
    state = 'Processing';
    options.onProgress?.(uploadedBytes, totalBytes, state);
    await Promise.resolve();
    state = 'Ready';
    options.onProgress?.(uploadedBytes, totalBytes, state);
    return ok({ uploadUrl, uploadedBytes }, 'TUS upload completed.');
  };

  return {
    get state() {
      return state;
    },
    get uploadedBytes() {
      return uploadedBytes;
    },
    totalBytes,
    start: run,
    cancel: () => {
      cancelled = true;
      state = 'Failed';
    },
    resume: run,
  };
}
