import { z } from 'zod';

export const KYXOS_VIEWER_VERSION = '1.0.0';
export const KYXOS_VIEWER_API_VERSION = 1;
export const KYXOS_SCENE_SCHEMA_VERSION = 1;
export const KYXOS_ASSET_MANIFEST_VERSION = 1;

export type KyxosStatusCode =
  | 'KX_OK'
  | 'KX_OK_WITH_FALLBACK'
  | 'KX_ASSET_INVALID'
  | 'KX_ASSET_FORMAT_UNSUPPORTED'
  | 'KX_ASSET_EXTENSION_UNSUPPORTED'
  | 'KX_ASSET_UPLOAD_FAILED'
  | 'KX_ASSET_PROCESSING_FAILED'
  | 'KX_SCENE_SCHEMA_TOO_NEW'
  | 'KX_SCENE_SCHEMA_MIGRATION_FAILED'
  | 'KX_VIEWER_API_INCOMPATIBLE'
  | 'KX_REQUIRED_CAPABILITY_MISSING'
  | 'KX_OPTIONAL_CAPABILITY_MISSING'
  | 'KX_RENDER_BACKEND_UNAVAILABLE'
  | 'KX_EFFECT_DISABLED_BY_RULE'
  | 'KX_RESOURCE_LOAD_FAILED'
  | 'KX_SAVE_CONFLICT'
  | 'KX_PERMISSION_DENIED'
  | 'KX_PUBLICATION_NOT_FOUND';

export interface KyxosResult<T> {
  ok: boolean;
  code: KyxosStatusCode;
  data?: T;
  message?: string;
  details?: Record<string, unknown>;
  fallbackApplied?: boolean;
}

export const ok = <T>(data: T, message = 'OK'): KyxosResult<T> => ({
  ok: true,
  code: 'KX_OK',
  data,
  message,
});

export const okWithFallback = <T>(
  data: T,
  message: string,
  details?: Record<string, unknown>,
): KyxosResult<T> => ({
  ok: true,
  code: 'KX_OK_WITH_FALLBACK',
  data,
  message,
  details,
  fallbackApplied: true,
});

export const fail = <T>(
  code: KyxosStatusCode,
  message: string,
  details?: Record<string, unknown>,
): KyxosResult<T> => ({
  ok: false,
  code,
  message,
  details,
});

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const QuatSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const Color3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const Color4Schema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export type Vec3 = z.infer<typeof Vec3Schema>;
export type Quat = z.infer<typeof QuatSchema>;
export type Color3 = z.infer<typeof Color3Schema>;
export type Color4 = z.infer<typeof Color4Schema>;

export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: Vec3Schema,
  quaternion: QuatSchema.optional(),
  scale: Vec3Schema,
});

export type TransformState = z.infer<typeof TransformSchema>;

export const ProjectMetadataSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  visibility: z.enum(['draft', 'unlisted', 'public', 'unpublished']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AssetReferenceSchema = z.object({
  assetId: z.string(),
  revision: z.number().int().nonnegative(),
  kind: z.enum(['glb', 'gltf-zip', 'hdr', 'exr', 'texture', 'video', 'sequence']),
  url: z.string(),
  fileName: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().optional(),
  manifestVersion: z.number().int().positive().default(KYXOS_ASSET_MANIFEST_VERSION),
});

export const AssetManifestSchema = z.object({
  assetManifestVersion: z.number().int().positive(),
  assetId: z.string(),
  revision: z.number().int().nonnegative(),
  source: AssetReferenceSchema,
  fileSizeBytes: z.number().int().nonnegative(),
  meshCount: z.number().int().nonnegative(),
  triangleCount: z.number().int().nonnegative(),
  drawCallEstimate: z.number().int().nonnegative(),
  materialCount: z.number().int().nonnegative(),
  textureCount: z.number().int().nonnegative(),
  maxTextureSize: z.number().int().nonnegative(),
  gpuMemoryEstimateBytes: z.number().int().nonnegative(),
  skeletonCount: z.number().int().nonnegative(),
  morphTargetCount: z.number().int().nonnegative(),
  animationCount: z.number().int().nonnegative(),
  animationDurationSeconds: z.number().nonnegative(),
  cameras: z.number().int().nonnegative(),
  nodes: z.number().int().nonnegative(),
  extensionsUsed: z.array(z.string()),
  extensionsRequired: z.array(z.string()),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  missingFiles: z.array(z.string()),
  unsupportedExtensions: z.array(z.string()),
  generatedAt: z.string(),
});

export const MaterialOverrideSchema = z.object({
  materialId: z.string(),
  displayName: z.string().optional(),
  baseColorFactor: Color4Schema.optional(),
  baseColorTextureUrl: z.string().optional(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  normalTextureUrl: z.string().optional(),
  normalScale: z.number().optional(),
  aoTextureUrl: z.string().optional(),
  aoIntensity: z.number().min(0).optional(),
  emissiveFactor: Color3Schema.optional(),
  emissiveTextureUrl: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  alphaMode: z.enum(['OPAQUE', 'MASK', 'BLEND']).optional(),
  alphaCutoff: z.number().min(0).max(1).optional(),
  doubleSided: z.boolean().optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  clearcoat: z.number().min(0).max(1).optional(),
  clearcoatRoughness: z.number().min(0).max(1).optional(),
  sheenColorFactor: Color3Schema.optional(),
  sheenRoughness: z.number().min(0).max(1).optional(),
  transmission: z.number().min(0).max(1).optional(),
  thickness: z.number().min(0).optional(),
  ior: z.number().min(1).max(2.5).optional(),
  specularIntensity: z.number().min(0).optional(),
  anisotropy: z.number().min(-1).max(1).optional(),
  iridescence: z.number().min(0).max(1).optional(),
});

export const EnvironmentSchema = z.object({
  environmentId: z.string(),
  type: z.enum(['builtin', 'hdr', 'exr', 'color', 'transparent']),
  url: z.string().optional(),
  rotation: z.number(),
  intensity: z.number().min(0),
  backgroundVisible: z.boolean(),
  backgroundBlur: z.number().min(0),
  backgroundIntensity: z.number().min(0),
  backgroundColor: z.string(),
  transparentBackground: z.boolean(),
});

export const SceneLightSchema = z.object({
  id: z.string(),
  type: z.enum(['directional', 'point', 'spot', 'hemisphere']),
  name: z.string(),
  color: z.string(),
  intensity: z.number().min(0),
  position: Vec3Schema,
  rotation: Vec3Schema,
  range: z.number().min(0).optional(),
  angle: z.number().min(0).optional(),
  penumbra: z.number().min(0).max(1).optional(),
  castShadow: z.boolean(),
  shadowResolution: z.number().int().positive().optional(),
  shadowBias: z.number().optional(),
});

export const CameraStateSchema = z.object({
  position: Vec3Schema,
  target: Vec3Schema,
  fov: z.number().positive(),
  near: z.number().positive(),
  far: z.number().positive(),
  defaultView: z.boolean(),
  orbitLimits: z
    .object({
      minAzimuthAngle: z.number().optional(),
      maxAzimuthAngle: z.number().optional(),
      minPolarAngle: z.number().optional(),
      maxPolarAngle: z.number().optional(),
    })
    .optional(),
  zoomLimits: z.object({ minDistance: z.number().positive(), maxDistance: z.number().positive() }).optional(),
  pitchLimits: z.object({ min: z.number(), max: z.number() }).optional(),
  panEnabled: z.boolean(),
  zoomEnabled: z.boolean(),
  autoRotate: z.boolean(),
  autoRotateSpeed: z.number(),
  damping: z.number().min(0),
});

export const AnimationStateSchema = z.object({
  clips: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      duration: z.number().nonnegative(),
      tracks: z.number().int().nonnegative(),
    }),
  ),
  defaultClipId: z.string().nullable(),
  activeClipId: z.string().nullable(),
  playing: z.boolean(),
  currentTime: z.number().nonnegative(),
  loop: z.enum(['once', 'repeat', 'pingpong']),
  speed: z.number(),
  autoplay: z.boolean(),
  crossFadeSeconds: z.number().min(0),
  defaultStartTime: z.number().nonnegative(),
});

export const EffectsSchema = z.object({
  quality: z.enum(['low', 'medium', 'high', 'cinematic', 'capture']),
  antiAliasing: z.enum(['none', 'traa', 'fxaa', 'smaa', 'ssaa']),
  ao: z.enum(['none', 'gtao', 'ssao']),
  reflection: z.enum(['none', 'ssr']),
  gi: z.enum(['none', 'ssgi']),
  bloom: z.object({ enabled: z.boolean(), strength: z.number().min(0) }),
  dof: z.object({ enabled: z.boolean(), focusDistance: z.number().positive() }),
  colorGrading: z.object({ lutUrl: z.string().optional(), intensity: z.number().min(0).max(1) }),
  sharpness: z.object({ enabled: z.boolean(), amount: z.number().min(0) }),
  advanced: z.record(z.string(), z.unknown()),
});

export const AnnotationSchema = z.object({
  id: z.string(),
  position: Vec3Schema,
  surfaceNormal: Vec3Schema,
  title: z.string(),
  markdown: z.string(),
  cameraPosition: Vec3Schema,
  cameraTarget: Vec3Schema,
  sortOrder: z.number(),
  visible: z.boolean(),
});

export const PresentationSettingsSchema = z.object({
  unitScale: z.number().positive(),
  upAxis: z.enum(['x', 'y', 'z']),
  placeOnGround: z.boolean(),
  centerToOrigin: z.boolean(),
  transparentBackground: z.boolean(),
});

export const ModelPresentationSchema = z.object({
  assetRootId: z.string(),
  presentationRootId: z.string(),
  transform: TransformSchema,
  hiddenObjectIds: z.array(z.string()),
  lockedObjectIds: z.array(z.string()),
  displayNames: z.record(z.string(), z.string()),
});

export const KyxosSceneDocumentSchema = z.object({
  sceneSchemaVersion: z.number().int().positive(),
  project: ProjectMetadataSchema,
  asset: AssetReferenceSchema.nullable(),
  assetManifest: AssetManifestSchema.nullable(),
  model: ModelPresentationSchema,
  materials: z.record(z.string(), MaterialOverrideSchema),
  environment: EnvironmentSchema,
  lights: z.array(SceneLightSchema).max(4),
  camera: CameraStateSchema,
  animation: AnimationStateSchema,
  effects: EffectsSchema,
  annotations: z.array(AnnotationSchema),
  presentation: PresentationSettingsSchema,
});

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
export type AssetReference = z.infer<typeof AssetReferenceSchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
export type MaterialOverride = z.infer<typeof MaterialOverrideSchema>;
export type EnvironmentState = z.infer<typeof EnvironmentSchema>;
export type SceneLight = z.infer<typeof SceneLightSchema>;
export type CameraState = z.infer<typeof CameraStateSchema>;
export type AnimationState = z.infer<typeof AnimationStateSchema>;
export type EffectsState = z.infer<typeof EffectsSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type PresentationSettings = z.infer<typeof PresentationSettingsSchema>;
export type ModelPresentation = z.infer<typeof ModelPresentationSchema>;
export type KyxosSceneDocument = z.infer<typeof KyxosSceneDocumentSchema>;

export interface SceneGraphNode {
  id: string;
  parentId: string | null;
  name: string;
  type: 'scene' | 'node' | 'mesh' | 'skinnedMesh' | 'light' | 'camera' | 'annotation';
  visible: boolean;
  locked: boolean;
  materialIds: string[];
  childIds: string[];
  transform: TransformState;
}

export interface RuntimeMaterial {
  id: string;
  name: string;
  type: string;
  override: MaterialOverride | null;
  baseColorFactor?: Color4;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  doubleSided?: boolean;
}

export interface AnimationClipSummary {
  id: string;
  name: string;
  duration: number;
  tracks: number;
}

export interface ViewerCapabilities {
  viewerVersion: string;
  apiVersion: number;
  sceneSchemaVersions: number[];
  assetManifestVersions: number[];
  features: Record<
    | 'skeletonAnimation'
    | 'morphAnimation'
    | 'animationPointer'
    | 'videoTexture'
    | 'ktx2'
    | 'meshopt'
    | 'draco'
    | 'hdr'
    | 'exr'
    | 'traa'
    | 'ssgi'
    | 'annotations'
    | 'webgpu'
    | 'webgl2',
    boolean
  >;
}

export type CompatibilityStatus = 'Compatible' | 'CompatibleWithFallback' | 'Incompatible';

export interface CompatibilityResult {
  status: CompatibilityStatus;
  code: KyxosStatusCode;
  missingRequiredCapabilities: string[];
  missingOptionalCapabilities: string[];
  message: string;
}

export interface PublishedRevisionMetadata {
  sceneSchemaVersion: number;
  minimumViewerVersion: string;
  testedViewerVersion: string;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  revision: number;
  createdAt: string;
}

export const createDefaultTransform = (): TransformState => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

export const createDefaultCamera = (): CameraState => ({
  position: [4.8, 3.2, 6.6],
  target: [0, 0.9, 0],
  fov: 45,
  near: 0.05,
  far: 100,
  defaultView: true,
  zoomLimits: { minDistance: 1.5, maxDistance: 18 },
  panEnabled: true,
  zoomEnabled: true,
  autoRotate: false,
  autoRotateSpeed: 1,
  damping: 0.055,
});

export const createDefaultEnvironment = (): EnvironmentState => ({
  environmentId: 'studio',
  type: 'builtin',
  rotation: 0,
  intensity: 0.75,
  backgroundVisible: true,
  backgroundBlur: 0,
  backgroundIntensity: 1,
  backgroundColor: '#111827',
  transparentBackground: false,
});

export const createDefaultEffects = (): EffectsState => ({
  quality: 'high',
  antiAliasing: 'traa',
  ao: 'gtao',
  reflection: 'ssr',
  gi: 'ssgi',
  bloom: { enabled: true, strength: 0.5 },
  dof: { enabled: false, focusDistance: 4 },
  colorGrading: { intensity: 0.65 },
  sharpness: { enabled: true, amount: 0.25 },
  advanced: {},
});

export function createDefaultSceneDocument(overrides: Partial<KyxosSceneDocument> = {}): KyxosSceneDocument {
  const now = new Date().toISOString();
  const id = overrides.project?.id ?? 'local-project';
  const base: KyxosSceneDocument = {
    sceneSchemaVersion: KYXOS_SCENE_SCHEMA_VERSION,
    project: {
      id,
      ownerId: overrides.project?.ownerId ?? 'local-user',
      title: overrides.project?.title ?? 'Untitled Kyxos Scene',
      slug: overrides.project?.slug ?? id,
      description: overrides.project?.description ?? '',
      thumbnailUrl: overrides.project?.thumbnailUrl,
      visibility: overrides.project?.visibility ?? 'draft',
      createdAt: overrides.project?.createdAt ?? now,
      updatedAt: overrides.project?.updatedAt ?? now,
    },
    asset: null,
    assetManifest: null,
    model: {
      assetRootId: 'asset-root',
      presentationRootId: 'presentation-root',
      transform: createDefaultTransform(),
      hiddenObjectIds: [],
      lockedObjectIds: [],
      displayNames: {},
    },
    materials: {},
    environment: createDefaultEnvironment(),
    lights: [],
    camera: createDefaultCamera(),
    animation: {
      clips: [],
      defaultClipId: null,
      activeClipId: null,
      playing: false,
      currentTime: 0,
      loop: 'repeat',
      speed: 1,
      autoplay: false,
      crossFadeSeconds: 0.25,
      defaultStartTime: 0,
    },
    effects: createDefaultEffects(),
    annotations: [],
    presentation: {
      unitScale: 1,
      upAxis: 'y',
      placeOnGround: true,
      centerToOrigin: true,
      transparentBackground: false,
    },
  };

  return KyxosSceneDocumentSchema.parse({
    ...base,
    ...overrides,
    project: { ...base.project, ...overrides.project },
    model: { ...base.model, ...overrides.model },
    environment: { ...base.environment, ...overrides.environment },
    camera: { ...base.camera, ...overrides.camera },
    animation: { ...base.animation, ...overrides.animation },
    effects: { ...base.effects, ...overrides.effects },
    presentation: { ...base.presentation, ...overrides.presentation },
  });
}

export function migrateSceneDocument(input: unknown): KyxosResult<KyxosSceneDocument> {
  const maybeDocument = input as { sceneSchemaVersion?: unknown };
  const version =
    typeof maybeDocument?.sceneSchemaVersion === 'number' ? maybeDocument.sceneSchemaVersion : 1;

  if (version > KYXOS_SCENE_SCHEMA_VERSION) {
    return fail('KX_SCENE_SCHEMA_TOO_NEW', `Scene schema ${version} is newer than this runtime supports.`, {
      current: KYXOS_SCENE_SCHEMA_VERSION,
      received: version,
    });
  }

  try {
    if (version === 1) {
      return ok(KyxosSceneDocumentSchema.parse(input), 'Scene document is current.');
    }
    return fail('KX_SCENE_SCHEMA_MIGRATION_FAILED', `No migration is registered for schema ${version}.`);
  } catch (error) {
    return fail('KX_SCENE_SCHEMA_MIGRATION_FAILED', 'Scene document validation failed.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function getDefaultViewerCapabilities(
  overrides: Partial<ViewerCapabilities> = {},
): ViewerCapabilities {
  return {
    viewerVersion: KYXOS_VIEWER_VERSION,
    apiVersion: KYXOS_VIEWER_API_VERSION,
    sceneSchemaVersions: [KYXOS_SCENE_SCHEMA_VERSION],
    assetManifestVersions: [KYXOS_ASSET_MANIFEST_VERSION],
    features: {
      skeletonAnimation: true,
      morphAnimation: true,
      animationPointer: true,
      videoTexture: true,
      ktx2: true,
      meshopt: true,
      draco: true,
      hdr: true,
      exr: true,
      traa: true,
      ssgi: true,
      annotations: true,
      webgpu: true,
      webgl2: true,
      ...overrides.features,
    },
    ...overrides,
  };
}

function compareSemver(a: string, b: string) {
  const left = a.split('.').map((part) => Number(part) || 0);
  const right = b.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function checkSceneCompatibility(
  document: KyxosSceneDocument,
  capabilities: ViewerCapabilities,
  revision?: Partial<PublishedRevisionMetadata>,
): CompatibilityResult {
  if (!capabilities.sceneSchemaVersions.includes(document.sceneSchemaVersion)) {
    return {
      status: 'Incompatible',
      code: 'KX_SCENE_SCHEMA_TOO_NEW',
      missingRequiredCapabilities: [],
      missingOptionalCapabilities: [],
      message: `Scene schema ${document.sceneSchemaVersion} is not supported.`,
    };
  }

  const manifestVersion = document.assetManifest?.assetManifestVersion ?? KYXOS_ASSET_MANIFEST_VERSION;
  if (!capabilities.assetManifestVersions.includes(manifestVersion)) {
    return {
      status: 'Incompatible',
      code: 'KX_VIEWER_API_INCOMPATIBLE',
      missingRequiredCapabilities: [`assetManifest:${manifestVersion}`],
      missingOptionalCapabilities: [],
      message: `Asset manifest ${manifestVersion} is not supported.`,
    };
  }

  if (
    revision?.minimumViewerVersion &&
    compareSemver(capabilities.viewerVersion, revision.minimumViewerVersion) < 0
  ) {
    return {
      status: 'Incompatible',
      code: 'KX_VIEWER_API_INCOMPATIBLE',
      missingRequiredCapabilities: [`viewer>=${revision.minimumViewerVersion}`],
      missingOptionalCapabilities: [],
      message: `Viewer ${capabilities.viewerVersion} is older than the published revision requires.`,
    };
  }

  const required = revision?.requiredCapabilities ?? [];
  const optional = revision?.optionalCapabilities ?? [];
  const missingRequired = required.filter(
    (feature) => capabilities.features[feature as keyof ViewerCapabilities['features']] !== true,
  );
  const missingOptional = optional.filter(
    (feature) => capabilities.features[feature as keyof ViewerCapabilities['features']] !== true,
  );

  if (missingRequired.length > 0) {
    return {
      status: 'Incompatible',
      code: 'KX_REQUIRED_CAPABILITY_MISSING',
      missingRequiredCapabilities: missingRequired,
      missingOptionalCapabilities: missingOptional,
      message: `Missing required viewer capabilities: ${missingRequired.join(', ')}.`,
    };
  }

  if (missingOptional.length > 0) {
    return {
      status: 'CompatibleWithFallback',
      code: 'KX_OPTIONAL_CAPABILITY_MISSING',
      missingRequiredCapabilities: [],
      missingOptionalCapabilities: missingOptional,
      message: `Optional viewer capabilities will use fallback: ${missingOptional.join(', ')}.`,
    };
  }

  return {
    status: 'Compatible',
    code: 'KX_OK',
    missingRequiredCapabilities: [],
    missingOptionalCapabilities: [],
    message: 'Scene is compatible.',
  };
}

export function createPublishedRevisionMetadata(
  revision: number,
  requiredCapabilities: string[] = [],
  optionalCapabilities: string[] = [],
): PublishedRevisionMetadata {
  return {
    sceneSchemaVersion: KYXOS_SCENE_SCHEMA_VERSION,
    minimumViewerVersion: KYXOS_VIEWER_VERSION,
    testedViewerVersion: KYXOS_VIEWER_VERSION,
    requiredCapabilities,
    optionalCapabilities,
    revision,
    createdAt: new Date().toISOString(),
  };
}
