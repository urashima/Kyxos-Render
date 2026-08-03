export const KYXOS_SCENE_CONTRACT_VERSION = '1.1.0';
export const KYXOS_VIEWER_API_VERSION = '1.1.0';

export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';
export type QualityPreset = 'low' | 'medium' | 'high' | 'cinematic' | 'ultra' | 'capture';
export type AlphaMode = 'opaque' | 'mask' | 'blend';
export type ColorSpace = 'srgb' | 'linear' | 'none';
export type AssetKind =
  | 'model'
  | 'texture'
  | 'environment'
  | 'thumbnail'
  | 'animation'
  | 'material'
  | 'script'
  | 'other';
export type SceneEffectName =
  | 'traa'
  | 'ssao'
  | 'gtao'
  | 'ssr'
  | 'ssgi'
  | 'temporalReprojection'
  | 'temporalDenoise'
  | 'poissonDenoise'
  | 'motionBlur'
  | 'bloom'
  | 'dof'
  | 'fxaa'
  | 'smaa'
  | 'ssaa'
  | 'lut'
  | 'lensDistortion'
  | 'sharpness'
  | 'sparkle'
  | 'gradualBackground';

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Vec4 { x: number; y: number; z: number; w: number }
export interface Transform { position: Vec3; rotation: Vec3; scale: Vec3 }

export interface SceneMetadata {
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  authorId?: string;
  tags?: string[];
  source?: { generator?: string; originalFilename?: string };
}

export interface RuntimeCompatibility {
  viewerApiMin: string;
  viewerApiMax?: string;
  contractMin?: string;
  contractMax?: string;
}

export interface CapabilityRequirement {
  name: string;
  required: boolean;
  fallback?: string;
}

export interface SceneAsset {
  id: string;
  uri: `asset://${string}`;
  contentHash: string;
  kind: AssetKind;
  mimeType: string;
  byteSize?: number;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface TextureRef {
  assetId: string;
  texCoord?: number;
  colorSpace?: ColorSpace;
  channel?: 'r' | 'g' | 'b' | 'a' | 'rgb' | 'rgba';
  offset?: Vec2;
  scale?: Vec2;
  rotation?: number;
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
  minFilter?: string;
  magFilter?: string;
}

export interface SceneMaterial {
  id: string;
  name: string;
  baseColor: Vec4;
  baseColorTexture?: TextureRef;
  metalness: number;
  metalnessTexture?: TextureRef;
  roughness: number;
  roughnessTexture?: TextureRef;
  normalTexture?: TextureRef;
  normalScale?: number;
  emissive: Vec3;
  emissiveIntensity?: number;
  emissiveTexture?: TextureRef;
  aoTexture?: TextureRef;
  opacity: number;
  alphaMode: AlphaMode;
  alphaCutoff?: number;
  doubleSided: boolean;
  clearcoat?: number;
  clearcoatRoughness?: number;
  clearcoatTexture?: TextureRef;
  clearcoatRoughnessTexture?: TextureRef;
  transmission?: number;
  transmissionTexture?: TextureRef;
  thickness?: number;
  thicknessTexture?: TextureRef;
  attenuationColor?: Vec3;
  attenuationDistance?: number;
  ior?: number;
  sheenColor?: Vec3;
  sheenRoughness?: number;
  specularIntensity?: number;
  specularColor?: Vec3;
  metadata?: Record<string, unknown>;
}

export interface SceneSkinBinding {
  skinIndex: number;
  joints: string[];
  skeletonNodeId?: string;
  inverseBindMatricesAccessor?: number;
}

export interface SceneTemplateInstance {
  templateId: string;
  instanceId: string;
  sourceNodeId: string;
  overrides: string[];
}

export interface SceneNode {
  id: string;
  name: string;
  parentId: string | null;
  children: string[];
  transform: Transform;
  visible: boolean;
  locked?: boolean;
  meshAssetId?: string;
  meshIndex?: number;
  materialSlots?: string[];
  cameraId?: string;
  lightId?: string;
  animationIds?: string[];
  skin?: SceneSkinBinding;
  morphWeights?: number[];
  morphTargetNames?: string[];
  materialVariantBindings?: Record<string, string[]>;
  template?: SceneTemplateInstance;
  metadata?: Record<string, unknown>;
}

export interface SceneAnimation {
  id: string;
  name: string;
  clipIndex: number;
  duration: number;
  loop: boolean;
  speed: number;
  autoplay?: boolean;
  trimStart?: number;
  trimEnd?: number;
}

export interface SceneEnvironment {
  assetId?: string;
  rotation: number;
  intensity: number;
  backgroundIntensity: number;
  backgroundBlur: number;
  backgroundColor: string;
  transparentBackground: boolean;
}

export interface SceneCamera {
  id: string;
  name: string;
  transform: Transform;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
  projection?: 'perspective' | 'orthographic';
  orthographicSize?: number;
  orbit?: { minDistance?: number; maxDistance?: number; minPolarAngle?: number; maxPolarAngle?: number };
  autoRotate?: boolean;
}

export interface SceneLight {
  id: string;
  name: string;
  type: 'directional' | 'point' | 'spot' | 'ambient';
  color: string;
  intensity: number;
  transform: Transform;
  castShadow: boolean;
  range?: number;
  decay?: number;
  innerConeAngle?: number;
  outerConeAngle?: number;
  shadow?: Record<string, number | boolean>;
}

export interface SceneMaterialVariant {
  id: string;
  name: string;
}

export type AnimationParameterType = 'boolean' | 'float' | 'integer' | 'trigger';
export interface AnimationGraphParameter {
  id: string;
  name: string;
  type: AnimationParameterType;
  defaultValue: boolean | number;
}

export interface AnimationGraphCondition {
  parameterId: string;
  operator:
    | 'equals'
    | 'notEquals'
    | 'greater'
    | 'greaterOrEqual'
    | 'less'
    | 'lessOrEqual'
    | 'set';
  value?: boolean | number;
}

export interface AnimationBlendTreeChild {
  clipId?: string;
  blendTree?: AnimationBlendTree;
  threshold?: number;
  position?: Vec2;
  speed?: number;
}

export interface AnimationBlendTree {
  type: '1d' | '2d-directional' | '2d-cartesian';
  parameterX: string;
  parameterY?: string;
  children: AnimationBlendTreeChild[];
}

export interface AnimationGraphState {
  id: string;
  name: string;
  clipId?: string;
  blendTree?: AnimationBlendTree;
  speed: number;
  loop: boolean;
  position: Vec2;
}

export interface AnimationGraphTransition {
  id: string;
  fromStateId: string | '*';
  toStateId: string;
  duration: number;
  exitTime?: number;
  conditions: AnimationGraphCondition[];
}

export interface AnimationStateGraph {
  id: string;
  name: string;
  initialStateId: string;
  states: AnimationGraphState[];
  transitions: AnimationGraphTransition[];
  parameters: AnimationGraphParameter[];
}

export interface SceneAssetFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface SceneEditorState {
  assetFolders?: SceneAssetFolder[];
  activeAssetFolderId?: string | null;
  deletedAssetIds?: string[];
  inspectorSections?: Record<string, boolean>;
}

export interface SceneEffectSettings {
  enabled: boolean;
  [parameter: string]: string | number | boolean | number[] | undefined;
}

export interface SceneRenderSettings {
  backend: BackendPreference;
  qualityPreset: QualityPreset;
  exposure: number;
  toneMapping: string;
  effects: Partial<Record<SceneEffectName, SceneEffectSettings>>;
}

export interface KyxosSceneContract {
  contractVersion: string;
  id: string;
  metadata: SceneMetadata;
  compatibility: RuntimeCompatibility;
  capabilities: CapabilityRequirement[];
  assets: Record<string, SceneAsset>;
  nodes: SceneNode[];
  materials: Record<string, SceneMaterial>;
  animations: SceneAnimation[];
  environment: SceneEnvironment;
  cameras: SceneCamera[];
  lights?: SceneLight[];
  materialVariants?: SceneMaterialVariant[];
  activeMaterialVariantId?: string;
  animationStateGraph?: AnimationStateGraph;
  editorState?: SceneEditorState;
  activeCameraId: string;
  renderSettings: SceneRenderSettings;
}

export type JsonPatchOperation =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };
export type ScenePatch = JsonPatchOperation[];

export interface ContractValidationIssue { path: string; code: string; message: string }
export interface ContractValidationResult { valid: boolean; issues: ContractValidationIssue[] }

export interface ViewerCapabilityDescription {
  viewerApiVersion: string;
  sceneContract: { min: string; max: string };
  backend: 'webgpu' | 'webgl2';
  effects: Record<string, { available: boolean; parameters?: Record<string, unknown>; reason?: string }>;
  textureFormats: string[];
  maxTextureSize: number;
  animation: { clips: boolean; seek: boolean; speed: boolean; stateGraph: boolean; blendTrees: boolean };
  picking: { available: boolean; multiSelect: boolean };
}

export interface AssetResolver {
  resolve(asset: SceneAsset): Promise<string> | string;
}

export function getContractVersion(): string { return KYXOS_SCENE_CONTRACT_VERSION }

export function getRuntimeCompatibility(): RuntimeCompatibility {
  return { viewerApiMin: '1.1.0', contractMin: '1.0.0', contractMax: KYXOS_SCENE_CONTRACT_VERSION };
}

function issue(issues: ContractValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function validVec2(value: unknown): value is Vec2 {
  return isRecord(value) && finite(value.x) && finite(value.y);
}
function validVec3(value: unknown): value is Vec3 {
  return isRecord(value) && finite(value.x) && finite(value.y) && finite(value.z);
}
function validVec4(value: unknown): value is Vec4 {
  return isRecord(value) && finite(value.x) && finite(value.y) && finite(value.z) && finite(value.w);
}
function validTransform(value: unknown): value is Transform {
  return isRecord(value) && validVec3(value.position) && validVec3(value.rotation) && validVec3(value.scale);
}
function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}
function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
}
function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(value);
}

function validateTextureRef(
  value: unknown,
  path: string,
  assets: Record<string, unknown>,
  issues: ContractValidationIssue[],
): void {
  if (value == null) return;
  if (!isRecord(value)) {
    issue(issues, path, 'type', 'Texture reference must be an object.');
    return;
  }
  if (typeof value.assetId !== 'string' || !assets[value.assetId]) {
    issue(issues, `${path}/assetId`, 'reference', 'Texture assetId must reference an existing asset.');
  } else if ((assets[value.assetId] as Record<string, unknown>).kind !== 'texture') {
    issue(issues, `${path}/assetId`, 'asset-kind', 'Material textures must reference texture assets.');
  }
  if (value.texCoord != null && (!Number.isInteger(value.texCoord) || Number(value.texCoord) < 0)) {
    issue(issues, `${path}/texCoord`, 'range', 'texCoord must be a non-negative integer.');
  }
  if (value.colorSpace != null && !['srgb', 'linear', 'none'].includes(String(value.colorSpace))) {
    issue(issues, `${path}/colorSpace`, 'enum', 'Unsupported texture color space.');
  }
  if (
    value.channel != null &&
    !['r', 'g', 'b', 'a', 'rgb', 'rgba'].includes(String(value.channel))
  ) {
    issue(issues, `${path}/channel`, 'enum', 'Unsupported texture channel mapping.');
  }
  for (const key of ['wrapS', 'wrapT']) {
    if (
      value[key] != null &&
      !['repeat', 'clamp', 'mirror'].includes(String(value[key]))
    ) {
      issue(issues, `${path}/${key}`, 'enum', 'Unsupported texture wrapping mode.');
    }
  }
  if (
    value.minFilter != null &&
    !['nearest', 'linear', 'nearestMipNearest', 'linearMipNearest', 'nearestMipLinear', 'linearMipLinear'].includes(String(value.minFilter))
  ) {
    issue(issues, `${path}/minFilter`, 'enum', 'Unsupported texture minification filter.');
  }
  if (value.magFilter != null && !['nearest', 'linear'].includes(String(value.magFilter))) {
    issue(issues, `${path}/magFilter`, 'enum', 'Unsupported texture magnification filter.');
  }
  if (value.offset != null && !validVec2(value.offset)) issue(issues, `${path}/offset`, 'vector', 'Texture offset must contain finite x/y values.');
  if (value.scale != null && !validVec2(value.scale)) issue(issues, `${path}/scale`, 'vector', 'Texture scale must contain finite x/y values.');
  if (value.rotation != null && !finite(value.rotation)) issue(issues, `${path}/rotation`, 'number', 'Texture rotation must be finite.');
}

function validateAnimationBlendTree(
  value: unknown,
  path: string,
  parameterIds: ReadonlySet<string>,
  animationIds: ReadonlySet<string>,
  issues: ContractValidationIssue[],
  depth = 0,
): void {
  if (depth > 16 || !isRecord(value) || !['1d', '2d-directional', '2d-cartesian'].includes(String(value.type)) || !Array.isArray(value.children)) {
    issue(issues, path, 'type', 'Animation blend tree is invalid.');
    return;
  }
  if (!parameterIds.has(String(value.parameterX))) issue(issues, `${path}/parameterX`, 'reference', 'Blend parameterX is missing.');
  if (value.type !== '1d' && !parameterIds.has(String(value.parameterY))) issue(issues, `${path}/parameterY`, 'reference', '2D blend trees require parameterY.');
  value.children.forEach((child, index) => {
    const childPath = `${path}/children/${index}`;
    if (!isRecord(child)) {
      issue(issues, childPath, 'type', 'Blend child must be an object.');
      return;
    }
    if (child.speed != null && !finite(child.speed)) issue(issues, `${childPath}/speed`, 'number', 'Blend child speed must be finite.');
    if (value.type === '1d' && child.threshold != null && !finite(child.threshold)) issue(issues, `${childPath}/threshold`, 'number', 'Blend threshold must be finite.');
    if (value.type !== '1d' && !validVec2(child.position)) issue(issues, `${childPath}/position`, 'vector', '2D blend child position is required.');
    if (child.blendTree != null) {
      if (child.clipId != null) issue(issues, childPath, 'exclusive', 'A blend child cannot contain both clipId and blendTree.');
      validateAnimationBlendTree(child.blendTree, `${childPath}/blendTree`, parameterIds, animationIds, issues, depth + 1);
    } else if (typeof child.clipId !== 'string' || !animationIds.has(child.clipId)) {
      issue(issues, `${childPath}/clipId`, 'reference', 'Blend child clipId must reference an animation.');
    }
  });
}

export function validateSceneContract(value: unknown): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: '', code: 'type', message: 'Scene Contract must be an object.' }] };
  }

  if (!isSemver(value.contractVersion)) issue(issues, '/contractVersion', 'semver', 'contractVersion must be semantic version text.');
  if (typeof value.id !== 'string' || !value.id) issue(issues, '/id', 'required', 'A stable scene id is required.');
  if (!isRecord(value.metadata) || typeof value.metadata.name !== 'string' || !value.metadata.name.trim()) {
    issue(issues, '/metadata/name', 'required', 'metadata.name is required.');
  } else {
    if (typeof value.metadata.createdAt !== 'string') issue(issues, '/metadata/createdAt', 'required', 'metadata.createdAt is required.');
    if (typeof value.metadata.updatedAt !== 'string') issue(issues, '/metadata/updatedAt', 'required', 'metadata.updatedAt is required.');
  }
  if (!isRecord(value.compatibility) || !isSemver(value.compatibility.viewerApiMin)) {
    issue(issues, '/compatibility/viewerApiMin', 'semver', 'viewerApiMin is required and must be semantic version text.');
  }
  if (!Array.isArray(value.capabilities)) {
    issue(issues, '/capabilities', 'type', 'capabilities must be an array.');
  } else {
    value.capabilities.forEach((capability, index) => {
      if (!isRecord(capability) || typeof capability.name !== 'string' || typeof capability.required !== 'boolean') {
        issue(issues, `/capabilities/${index}`, 'type', 'Capability requires name and required fields.');
      }
    });
  }

  const assets = isRecord(value.assets) ? value.assets : {};
  if (!isRecord(value.assets)) {
    issue(issues, '/assets', 'type', 'assets must be a record.');
  } else {
    for (const [id, asset] of Object.entries(value.assets)) {
      const path = `/assets/${id}`;
      if (!isRecord(asset)) {
        issue(issues, path, 'type', 'Asset must be an object.');
        continue;
      }
      if (asset.id !== id) issue(issues, `${path}/id`, 'stable-id', 'Asset key and id must match.');
      if (typeof asset.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(asset.contentHash)) {
        issue(issues, `${path}/contentHash`, 'hash', 'contentHash must be a lowercase SHA-256 hex digest.');
      }
      if (asset.uri !== `asset://${String(asset.contentHash ?? '')}`) {
        issue(issues, `${path}/uri`, 'asset-uri', 'Asset URI must exactly match asset://<content-hash>.');
      }
      if (!['model', 'texture', 'environment', 'thumbnail', 'animation', 'material', 'script', 'other'].includes(String(asset.kind))) {
        issue(issues, `${path}/kind`, 'enum', 'Unsupported asset kind.');
      }
      if (typeof asset.mimeType !== 'string' || !asset.mimeType.includes('/')) issue(issues, `${path}/mimeType`, 'mime', 'mimeType is required.');
      if (asset.byteSize != null && (!Number.isInteger(asset.byteSize) || Number(asset.byteSize) <= 0 || Number(asset.byteSize) > 536870912)) {
        issue(issues, `${path}/byteSize`, 'range', 'byteSize must be between 1 byte and 512 MB.');
      }
    }
  }

  const materials = isRecord(value.materials) ? value.materials : {};
  if (!isRecord(value.materials)) {
    issue(issues, '/materials', 'type', 'materials must be a record.');
  } else {
    for (const [id, material] of Object.entries(value.materials)) {
      const path = `/materials/${id}`;
      if (!isRecord(material)) {
        issue(issues, path, 'type', 'Material must be an object.');
        continue;
      }
      if (material.id !== id) issue(issues, `${path}/id`, 'stable-id', 'Material key and id must match.');
      if (typeof material.name !== 'string') issue(issues, `${path}/name`, 'required', 'Material name is required.');
      if (!validVec4(material.baseColor)) issue(issues, `${path}/baseColor`, 'vector', 'baseColor must contain finite x/y/z/w values.');
      if (!inRange(material.metalness, 0, 1)) issue(issues, `${path}/metalness`, 'range', 'metalness must be between 0 and 1.');
      if (!inRange(material.roughness, 0, 1)) issue(issues, `${path}/roughness`, 'range', 'roughness must be between 0 and 1.');
      if (!validVec3(material.emissive)) issue(issues, `${path}/emissive`, 'vector', 'emissive must contain finite x/y/z values.');
      if (!inRange(material.opacity, 0, 1)) issue(issues, `${path}/opacity`, 'range', 'opacity must be between 0 and 1.');
      if (!['opaque', 'mask', 'blend'].includes(String(material.alphaMode))) issue(issues, `${path}/alphaMode`, 'enum', 'Unsupported alpha mode.');
      if (material.alphaCutoff != null && !inRange(material.alphaCutoff, 0, 1)) issue(issues, `${path}/alphaCutoff`, 'range', 'alphaCutoff must be between 0 and 1.');
      if (typeof material.doubleSided !== 'boolean') issue(issues, `${path}/doubleSided`, 'type', 'doubleSided must be boolean.');
      for (const key of [
        'baseColorTexture',
        'metalnessTexture',
        'roughnessTexture',
        'normalTexture',
        'emissiveTexture',
        'aoTexture',
        'clearcoatTexture',
        'clearcoatRoughnessTexture',
        'transmissionTexture',
        'thicknessTexture',
      ]) {
        validateTextureRef(material[key], `${path}/${key}`, assets, issues);
      }
      for (const key of [
        'clearcoat',
        'clearcoatRoughness',
        'transmission',
        'sheenRoughness',
        'specularIntensity',
      ]) {
        if (material[key] != null && !inRange(material[key], 0, 1)) {
          issue(issues, `${path}/${key}`, 'range', `${key} must be between 0 and 1.`);
        }
      }
      if (material.ior != null && !inRange(material.ior, 1, 2.333)) {
        issue(issues, `${path}/ior`, 'range', 'ior must be between 1 and 2.333.');
      }
      if (material.thickness != null && (!finite(material.thickness) || material.thickness < 0)) {
        issue(issues, `${path}/thickness`, 'range', 'thickness must be non-negative.');
      }
    }
  }

  const cameraIds = new Set<string>();
  if (!Array.isArray(value.cameras) || value.cameras.length === 0) {
    issue(issues, '/cameras', 'required', 'At least one camera is required.');
  } else {
    value.cameras.forEach((camera, index) => {
      const path = `/cameras/${index}`;
      if (!isRecord(camera)) {
        issue(issues, path, 'type', 'Camera must be an object.');
        return;
      }
      if (typeof camera.id !== 'string' || !camera.id || cameraIds.has(camera.id)) issue(issues, `${path}/id`, 'duplicate', 'Camera id must be unique.');
      else cameraIds.add(camera.id);
      if (!validTransform(camera.transform)) issue(issues, `${path}/transform`, 'transform', 'Camera transform is invalid.');
      if (!validVec3(camera.target)) issue(issues, `${path}/target`, 'vector', 'Camera target is invalid.');
      if (!inRange(camera.fov, 1, 179)) issue(issues, `${path}/fov`, 'range', 'Camera FOV must be between 1 and 179 degrees.');
      if (camera.projection != null && !['perspective', 'orthographic'].includes(String(camera.projection))) issue(issues, `${path}/projection`, 'enum', 'Unsupported camera projection.');
      if (camera.orthographicSize != null && (!finite(camera.orthographicSize) || Number(camera.orthographicSize) <= 0)) issue(issues, `${path}/orthographicSize`, 'range', 'Orthographic size must be positive.');
      if (!finite(camera.near) || Number(camera.near) <= 0) issue(issues, `${path}/near`, 'range', 'Camera near must be positive.');
      if (!finite(camera.far) || Number(camera.far) <= Number(camera.near)) issue(issues, `${path}/far`, 'range', 'Camera far must be greater than near.');
    });
  }
  if (typeof value.activeCameraId !== 'string' || !cameraIds.has(value.activeCameraId)) {
    issue(issues, '/activeCameraId', 'reference', 'activeCameraId must reference an existing camera.');
  }

  const lights = value.lights == null ? [] : value.lights;
  const lightIds = new Set<string>();
  if (!Array.isArray(lights)) {
    issue(issues, '/lights', 'type', 'lights must be an array.');
  } else {
    if (lights.length > 4) issue(issues, '/lights', 'limit', 'V1 supports at most four lights.');
    lights.forEach((light, index) => {
      const path = `/lights/${index}`;
      if (!isRecord(light)) {
        issue(issues, path, 'type', 'Light must be an object.');
        return;
      }
      if (typeof light.id !== 'string' || !light.id || lightIds.has(light.id)) issue(issues, `${path}/id`, 'duplicate', 'Light id must be unique.');
      else lightIds.add(light.id);
      if (!['directional', 'point', 'spot', 'ambient'].includes(String(light.type))) issue(issues, `${path}/type`, 'enum', 'Unsupported light type.');
      if (!isHexColor(light.color)) issue(issues, `${path}/color`, 'color', 'Light color must be a hex color.');
      if (!finite(light.intensity) || Number(light.intensity) < 0) issue(issues, `${path}/intensity`, 'range', 'Light intensity must be non-negative.');
      if (!validTransform(light.transform)) issue(issues, `${path}/transform`, 'transform', 'Light transform is invalid.');
      if (typeof light.castShadow !== 'boolean') issue(issues, `${path}/castShadow`, 'type', 'castShadow must be boolean.');
      if (light.range != null && (!finite(light.range) || Number(light.range) < 0)) issue(issues, `${path}/range`, 'range', 'Light range must be non-negative.');
      if (light.decay != null && (!finite(light.decay) || Number(light.decay) < 0)) issue(issues, `${path}/decay`, 'range', 'Light decay must be non-negative.');
      if (light.innerConeAngle != null && !inRange(light.innerConeAngle, 0, Math.PI / 2)) issue(issues, `${path}/innerConeAngle`, 'range', 'Inner cone angle is invalid.');
      if (light.outerConeAngle != null && !inRange(light.outerConeAngle, 0, Math.PI / 2)) issue(issues, `${path}/outerConeAngle`, 'range', 'Outer cone angle is invalid.');
    });
  }

  const animationIds = new Set<string>();
  if (!Array.isArray(value.animations)) {
    issue(issues, '/animations', 'type', 'animations must be an array.');
  } else {
    value.animations.forEach((animation, index) => {
      const path = `/animations/${index}`;
      if (!isRecord(animation)) {
        issue(issues, path, 'type', 'Animation must be an object.');
        return;
      }
      if (typeof animation.id !== 'string' || !animation.id || animationIds.has(animation.id)) issue(issues, `${path}/id`, 'duplicate', 'Animation id must be unique.');
      else animationIds.add(animation.id);
      if (!Number.isInteger(animation.clipIndex) || Number(animation.clipIndex) < 0) issue(issues, `${path}/clipIndex`, 'range', 'clipIndex must be a non-negative integer.');
      if (!finite(animation.duration) || Number(animation.duration) < 0) issue(issues, `${path}/duration`, 'range', 'duration must be non-negative.');
      if (!finite(animation.speed) || Number(animation.speed) < 0) issue(issues, `${path}/speed`, 'range', 'speed must be non-negative.');
      if (typeof animation.loop !== 'boolean') issue(issues, `${path}/loop`, 'type', 'loop must be boolean.');
      if (animation.trimStart != null && (!finite(animation.trimStart) || Number(animation.trimStart) < 0)) issue(issues, `${path}/trimStart`, 'range', 'trimStart must be non-negative.');
      if (animation.trimEnd != null && (!finite(animation.trimEnd) || Number(animation.trimEnd) > Number(animation.duration))) issue(issues, `${path}/trimEnd`, 'range', 'trimEnd must not exceed duration.');
    });
  }

  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodeIds = new Set<string>();
  if (!Array.isArray(value.nodes)) {
    issue(issues, '/nodes', 'type', 'nodes must be an array.');
  } else {
    for (let index = 0; index < value.nodes.length; index += 1) {
      const node = value.nodes[index];
      const path = `/nodes/${index}`;
      if (!isRecord(node)) {
        issue(issues, path, 'type', 'Node must be an object.');
        continue;
      }
      if (typeof node.id !== 'string' || !node.id) issue(issues, `${path}/id`, 'required', 'Node id is required.');
      else if (nodeIds.has(node.id)) issue(issues, `${path}/id`, 'duplicate', 'Node ids must be unique.');
      else nodeIds.add(node.id);
      if (typeof node.name !== 'string') issue(issues, `${path}/name`, 'required', 'Node name is required.');
      if (node.parentId !== null && typeof node.parentId !== 'string') issue(issues, `${path}/parentId`, 'type', 'parentId must be a node id or null.');
      if (!validTransform(node.transform)) issue(issues, `${path}/transform`, 'transform', 'Position, rotation and scale must contain finite x/y/z values.');
      if (!Array.isArray(node.children) || node.children.some((child) => typeof child !== 'string')) issue(issues, `${path}/children`, 'type', 'children must be an array of node ids.');
      if (Array.isArray(node.children) && new Set(node.children).size !== node.children.length) issue(issues, `${path}/children`, 'duplicate', 'children must not contain duplicate ids.');
      if (typeof node.visible !== 'boolean') issue(issues, `${path}/visible`, 'type', 'visible must be boolean.');
      if (node.meshAssetId != null) {
        const asset = assets[String(node.meshAssetId)];
        if (!isRecord(asset) || asset.kind !== 'model') issue(issues, `${path}/meshAssetId`, 'reference', 'meshAssetId must reference a model asset.');
      }
      if (Array.isArray(node.materialSlots)) {
        node.materialSlots.forEach((materialId, slot) => {
          if (typeof materialId !== 'string' || !materials[materialId]) issue(issues, `${path}/materialSlots/${slot}`, 'reference', 'Material slot must reference an existing material.');
        });
      }
      if (node.cameraId != null && !cameraIds.has(String(node.cameraId))) issue(issues, `${path}/cameraId`, 'reference', 'cameraId must reference an existing camera.');
      if (node.lightId != null && !lightIds.has(String(node.lightId))) issue(issues, `${path}/lightId`, 'reference', 'lightId must reference an existing light.');
      if (Array.isArray(node.animationIds)) {
        node.animationIds.forEach((animationId, animationIndex) => {
          if (typeof animationId !== 'string' || !animationIds.has(animationId)) issue(issues, `${path}/animationIds/${animationIndex}`, 'reference', 'animationId must reference an existing animation.');
        });
      }
      if (node.morphWeights != null && (!Array.isArray(node.morphWeights) || node.morphWeights.some((entry) => !finite(entry)))) {
        issue(issues, `${path}/morphWeights`, 'number-array', 'Morph weights must contain finite numbers.');
      }
      if (node.morphTargetNames != null && (!Array.isArray(node.morphTargetNames) || node.morphTargetNames.some((entry) => typeof entry !== 'string'))) {
        issue(issues, `${path}/morphTargetNames`, 'type', 'Morph target names must be strings.');
      }
      if (node.skin != null) {
        if (!isRecord(node.skin) || !Number.isInteger(node.skin.skinIndex) || !Array.isArray(node.skin.joints)) {
          issue(issues, `${path}/skin`, 'type', 'Skin binding requires skinIndex and joints.');
        }
      }
    }

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!isRecord(node) || typeof node.id !== 'string') continue;
      if (typeof node.parentId === 'string') {
        if (!nodeIds.has(node.parentId)) issue(issues, `/nodes/${index}/parentId`, 'reference', 'parentId does not reference an existing node.');
        if (node.parentId === node.id) issue(issues, `/nodes/${index}/parentId`, 'cycle', 'A node cannot parent itself.');
        const parent = nodes.find((candidate) => isRecord(candidate) && candidate.id === node.parentId) as Record<string, unknown> | undefined;
        if (parent && Array.isArray(parent.children) && !parent.children.includes(node.id)) issue(issues, `/nodes/${index}/parentId`, 'hierarchy', 'Parent children and child parentId must agree.');
      }
      if (Array.isArray(node.children)) {
        for (const childId of node.children) {
          if (!nodeIds.has(String(childId))) issue(issues, `/nodes/${index}/children`, 'reference', `Child ${String(childId)} does not exist.`);
          const child = nodes.find((candidate) => isRecord(candidate) && candidate.id === childId) as Record<string, unknown> | undefined;
          if (child && child.parentId !== node.id) issue(issues, `/nodes/${index}/children`, 'hierarchy', 'Child parentId and parent children must agree.');
        }
      }
      const visited = new Set<string>([node.id]);
      let parentId = typeof node.parentId === 'string' ? node.parentId : null;
      while (parentId) {
        if (visited.has(parentId)) {
          issue(issues, `/nodes/${index}/parentId`, 'cycle', 'Hierarchy contains a parent cycle.');
          break;
        }
        visited.add(parentId);
        const parent = nodes.find((candidate) => isRecord(candidate) && candidate.id === parentId) as Record<string, unknown> | undefined;
        parentId = parent && typeof parent.parentId === 'string' ? parent.parentId : null;
      }
    }
  }

  const variants = value.materialVariants == null ? [] : value.materialVariants;
  const variantIds = new Set<string>();
  if (!Array.isArray(variants)) {
    issue(issues, '/materialVariants', 'type', 'materialVariants must be an array.');
  } else {
    variants.forEach((variant, index) => {
      if (!isRecord(variant) || typeof variant.id !== 'string' || typeof variant.name !== 'string') {
        issue(issues, `/materialVariants/${index}`, 'type', 'Material variants require id and name.');
      } else if (variantIds.has(variant.id)) {
        issue(issues, `/materialVariants/${index}/id`, 'duplicate', 'Material variant ids must be unique.');
      } else {
        variantIds.add(variant.id);
      }
    });
  }
  if (value.activeMaterialVariantId != null && !variantIds.has(String(value.activeMaterialVariantId))) {
    issue(issues, '/activeMaterialVariantId', 'reference', 'Active material variant must reference a variant.');
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!isRecord(node) || !isRecord(node.materialVariantBindings)) continue;
    for (const [variantId, slots] of Object.entries(node.materialVariantBindings)) {
      if (!variantIds.has(variantId)) issue(issues, `/nodes/${index}/materialVariantBindings/${variantId}`, 'reference', 'Unknown material variant.');
      if (!Array.isArray(slots) || slots.some((materialId) => typeof materialId !== 'string' || !materials[materialId])) issue(issues, `/nodes/${index}/materialVariantBindings/${variantId}`, 'reference', 'Variant slots must reference existing materials.');
    }
  }

  if (value.animationStateGraph != null) {
    const graph = value.animationStateGraph;
    if (!isRecord(graph) || !Array.isArray(graph.states) || !Array.isArray(graph.transitions) || !Array.isArray(graph.parameters)) {
      issue(issues, '/animationStateGraph', 'type', 'Animation state graph is malformed.');
    } else {
      const stateIds = new Set<string>();
      const parameterIds = new Set<string>();
      const parameterTypes = new Map<string, string>();
      graph.parameters.forEach((parameter, index) => {
        const path = `/animationStateGraph/parameters/${index}`;
        if (!isRecord(parameter) || typeof parameter.id !== 'string' || !parameter.id || typeof parameter.name !== 'string' || !parameter.name.trim() || !['boolean', 'float', 'integer', 'trigger'].includes(String(parameter.type))) {
          issue(issues, path, 'type', 'Animation parameter is invalid.');
        } else if (parameterIds.has(parameter.id)) {
          issue(issues, `${path}/id`, 'duplicate', 'Animation parameter IDs must be unique.');
        } else {
          parameterIds.add(parameter.id);
          parameterTypes.set(parameter.id, String(parameter.type));
          const booleanType = parameter.type === 'boolean' || parameter.type === 'trigger';
          if ((booleanType && typeof parameter.defaultValue !== 'boolean') || (!booleanType && !finite(parameter.defaultValue))) {
            issue(issues, `${path}/defaultValue`, 'type', 'Animation parameter default does not match its type.');
          }
        }
      });
      graph.states.forEach((graphState, index) => {
        const path = `/animationStateGraph/states/${index}`;
        if (!isRecord(graphState) || typeof graphState.id !== 'string' || !graphState.id || typeof graphState.name !== 'string' || !graphState.name.trim() || !validVec2(graphState.position) || !finite(graphState.speed) || graphState.speed < 0 || typeof graphState.loop !== 'boolean') issue(issues, path, 'type', 'Animation state is invalid.');
        else {
          if (stateIds.has(graphState.id)) issue(issues, `${path}/id`, 'duplicate', 'Animation state IDs must be unique.');
          else stateIds.add(graphState.id);
          if (graphState.clipId != null && graphState.blendTree != null) issue(issues, path, 'exclusive', 'A state cannot contain both clipId and blendTree.');
          if (graphState.clipId != null && !animationIds.has(String(graphState.clipId))) issue(issues, `${path}/clipId`, 'reference', 'State clipId must reference an animation.');
          if (graphState.blendTree != null) validateAnimationBlendTree(graphState.blendTree, `${path}/blendTree`, parameterIds, animationIds, issues);
        }
      });
      if (!stateIds.has(String(graph.initialStateId))) issue(issues, '/animationStateGraph/initialStateId', 'reference', 'Initial state must reference a graph state.');
      const transitionIds = new Set<string>();
      graph.transitions.forEach((transition, index) => {
        const path = `/animationStateGraph/transitions/${index}`;
        if (!isRecord(transition) || typeof transition.id !== 'string' || !transition.id || (transition.fromStateId !== '*' && !stateIds.has(String(transition.fromStateId))) || !stateIds.has(String(transition.toStateId)) || !Array.isArray(transition.conditions) || !finite(transition.duration) || transition.duration < 0 || (transition.exitTime != null && (!finite(transition.exitTime) || transition.exitTime < 0))) {
          issue(issues, `/animationStateGraph/transitions/${index}`, 'reference', 'Animation transition is invalid.');
          return;
        }
        if (transitionIds.has(transition.id)) issue(issues, `${path}/id`, 'duplicate', 'Animation transition IDs must be unique.');
        else transitionIds.add(transition.id);
        if (transition.fromStateId === transition.toStateId) issue(issues, path, 'cycle', 'A transition cannot target its source state.');
        transition.conditions.forEach((condition, conditionIndex) => {
          const conditionPath = `${path}/conditions/${conditionIndex}`;
          if (!isRecord(condition) || !parameterIds.has(String(condition.parameterId)) || !['equals', 'notEquals', 'greater', 'greaterOrEqual', 'less', 'lessOrEqual', 'set'].includes(String(condition.operator))) {
            issue(issues, conditionPath, 'reference', 'Animation transition condition is invalid.');
            return;
          }
          const parameterType = parameterTypes.get(String(condition.parameterId));
          if (condition.operator === 'set' && parameterType !== 'boolean' && parameterType !== 'trigger') issue(issues, `${conditionPath}/operator`, 'type', 'Set conditions require a boolean or trigger parameter.');
          if (condition.operator !== 'set' && condition.value === undefined) issue(issues, `${conditionPath}/value`, 'required', 'This condition requires a comparison value.');
        });
      });
    }
  }

  if (!isRecord(value.environment)) {
    issue(issues, '/environment', 'type', 'environment is required.');
  } else {
    if (value.environment.assetId != null) {
      const environmentAsset = assets[String(value.environment.assetId)];
      if (!isRecord(environmentAsset) || environmentAsset.kind !== 'environment') issue(issues, '/environment/assetId', 'reference', 'Environment assetId must reference an environment asset.');
    }
    for (const key of ['rotation', 'intensity', 'backgroundIntensity', 'backgroundBlur']) {
      if (!finite(value.environment[key])) issue(issues, `/environment/${key}`, 'number', `${key} must be finite.`);
    }
    if (!isHexColor(value.environment.backgroundColor)) issue(issues, '/environment/backgroundColor', 'color', 'backgroundColor must be a hex color.');
    if (typeof value.environment.transparentBackground !== 'boolean') issue(issues, '/environment/transparentBackground', 'type', 'transparentBackground must be boolean.');
  }

  if (!isRecord(value.renderSettings) || !isRecord(value.renderSettings.effects)) {
    issue(issues, '/renderSettings', 'required', 'renderSettings and effects are required.');
  } else {
    if (!['auto', 'webgpu', 'webgl2'].includes(String(value.renderSettings.backend))) issue(issues, '/renderSettings/backend', 'enum', 'Unsupported backend preference.');
    if (!['low', 'medium', 'high', 'cinematic', 'ultra', 'capture'].includes(String(value.renderSettings.qualityPreset))) issue(issues, '/renderSettings/qualityPreset', 'enum', 'Unsupported quality preset.');
    if (!finite(value.renderSettings.exposure) || Number(value.renderSettings.exposure) < 0) issue(issues, '/renderSettings/exposure', 'range', 'Exposure must be non-negative.');
    if (typeof value.renderSettings.toneMapping !== 'string') issue(issues, '/renderSettings/toneMapping', 'type', 'toneMapping must be a string.');
    for (const [effectName, settings] of Object.entries(value.renderSettings.effects)) {
      if (!isRecord(settings) || typeof settings.enabled !== 'boolean') {
        issue(issues, `/renderSettings/effects/${effectName}`, 'type', 'Effect settings require an enabled boolean.');
        continue;
      }
      for (const [parameter, parameterValue] of Object.entries(settings)) {
        if (typeof parameterValue === 'number' && !Number.isFinite(parameterValue)) issue(issues, `/renderSettings/effects/${effectName}/${parameter}`, 'number', 'Effect numeric parameters must be finite.');
        if (Array.isArray(parameterValue) && parameterValue.some((entry) => !finite(entry))) issue(issues, `/renderSettings/effects/${effectName}/${parameter}`, 'number-array', 'Effect numeric arrays must contain only finite values.');
      }
    }
  }

  const serialized = JSON.stringify(value);
  if (/<script|javascript:|onerror\s*=|onload\s*=/i.test(serialized)) issue(issues, '', 'xss', 'Executable HTML or JavaScript is forbidden in Scene Contract data.');
  if (/service[_-]?role|jwt[_-]?secret|access[_-]?token/i.test(serialized)) issue(issues, '', 'secret', 'Identity and service secrets are forbidden in Scene Contract data.');
  return { valid: issues.length === 0, issues };
}

export function assertSceneContract(value: unknown): asserts value is KyxosSceneContract {
  const result = validateSceneContract(value);
  if (!result.valid) throw new Error(result.issues.map((entry) => `${entry.path || '/'}: ${entry.message}`).join('\n'));
}

export function createEmptySceneContract(name = 'Untitled Scene'): KyxosSceneContract {
  const now = new Date().toISOString();
  const cameraId = crypto.randomUUID();
  return {
    contractVersion: KYXOS_SCENE_CONTRACT_VERSION,
    id: crypto.randomUUID(),
    metadata: { name, createdAt: now, updatedAt: now },
    compatibility: getRuntimeCompatibility(),
    capabilities: [],
    assets: {},
    nodes: [],
    materials: {},
    animations: [],
    environment: {
      rotation: 0,
      intensity: 1,
      backgroundIntensity: 1,
      backgroundBlur: 0,
      backgroundColor: '#111827',
      transparentBackground: false,
    },
    cameras: [
      {
        id: cameraId,
        name: 'Camera',
        transform: {
          position: { x: 3, y: 2, z: 5 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        target: { x: 0, y: 1, z: 0 },
        fov: 45,
        near: 0.01,
        far: 1000,
      },
    ],
    materialVariants: [],
    editorState: {
      assetFolders: [],
      activeAssetFolderId: null,
      deletedAssetIds: [],
      inspectorSections: {},
    },
    activeCameraId: cameraId,
    renderSettings: {
      backend: 'auto',
      qualityPreset: 'high',
      exposure: 1,
      toneMapping: 'AgX',
      effects: {},
    },
  };
}

export function cloneSceneContract(contract: KyxosSceneContract): KyxosSceneContract {
  return structuredClone(contract);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function sceneDigestInput(contract: KyxosSceneContract): string {
  const clone = cloneSceneContract(contract);
  clone.metadata.updatedAt = '';
  return JSON.stringify(canonicalize(clone));
}
