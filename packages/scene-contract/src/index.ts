export const KYXOS_SCENE_CONTRACT_VERSION = '1.1.0';
export const KYXOS_VIEWER_API_VERSION = '1.1.0';

export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'capture';
export type AlphaMode = 'opaque' | 'mask' | 'blend';
export type ColorSpace = 'srgb' | 'linear' | 'none';
export type AssetKind = 'model' | 'texture' | 'environment' | 'thumbnail' | 'other';
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
  | 'sharpness'
  | 'sparkle';

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
  offset?: Vec2;
  scale?: Vec2;
  rotation?: number;
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
  metadata?: Record<string, unknown>;
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
  shadow?: Record<string, number | boolean>;
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
  animation: { clips: boolean; seek: boolean; speed: boolean };
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
function validVec3(value: unknown): value is Vec3 {
  return isRecord(value) && finite(value.x) && finite(value.y) && finite(value.z);
}
function validTransform(value: unknown): value is Transform {
  return isRecord(value) && validVec3(value.position) && validVec3(value.rotation) && validVec3(value.scale);
}

export function validateSceneContract(value: unknown): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(value)) return { valid: false, issues: [{ path: '', code: 'type', message: 'Scene Contract must be an object.' }] };
  if (typeof value.contractVersion !== 'string') issue(issues, '/contractVersion', 'required', 'contractVersion is required.');
  if (typeof value.id !== 'string' || !value.id) issue(issues, '/id', 'required', 'A stable scene id is required.');
  if (!isRecord(value.metadata) || typeof value.metadata.name !== 'string') issue(issues, '/metadata/name', 'required', 'metadata.name is required.');
  if (!isRecord(value.compatibility) || typeof value.compatibility.viewerApiMin !== 'string') issue(issues, '/compatibility/viewerApiMin', 'required', 'viewerApiMin is required.');
  if (!isRecord(value.assets)) issue(issues, '/assets', 'type', 'assets must be a record.');
  else for (const [id, asset] of Object.entries(value.assets)) {
    if (!isRecord(asset)) { issue(issues, `/assets/${id}`, 'type', 'Asset must be an object.'); continue; }
    if (asset.id !== id) issue(issues, `/assets/${id}/id`, 'stable-id', 'Asset key and id must match.');
    if (typeof asset.uri !== 'string' || !asset.uri.startsWith('asset://')) issue(issues, `/assets/${id}/uri`, 'asset-uri', 'Assets must use asset://<content-hash>.');
    if (typeof asset.contentHash !== 'string' || !asset.contentHash) issue(issues, `/assets/${id}/contentHash`, 'required', 'contentHash is required.');
    if (typeof asset.uri === 'string' && /token=|signature=|sig=|jwt=/i.test(asset.uri)) issue(issues, `/assets/${id}/uri`, 'secret', 'Temporary or signed URLs are forbidden in contracts.');
  }
  if (!Array.isArray(value.nodes)) issue(issues, '/nodes', 'type', 'nodes must be an array.');
  else {
    const ids = new Set<string>();
    for (let index = 0; index < value.nodes.length; index += 1) {
      const node = value.nodes[index]; const path = `/nodes/${index}`;
      if (!isRecord(node)) { issue(issues, path, 'type', 'Node must be an object.'); continue; }
      if (typeof node.id !== 'string' || !node.id) issue(issues, `${path}/id`, 'required', 'Node id is required.');
      else if (ids.has(node.id)) issue(issues, `${path}/id`, 'duplicate', 'Node ids must be unique.'); else ids.add(node.id);
      if (typeof node.name !== 'string') issue(issues, `${path}/name`, 'required', 'Node name is required.');
      if (!validTransform(node.transform)) issue(issues, `${path}/transform`, 'transform', 'Position, rotation and scale must contain finite x/y/z values.');
      if (!Array.isArray(node.children)) issue(issues, `${path}/children`, 'type', 'children must be an array.');
      if (typeof node.visible !== 'boolean') issue(issues, `${path}/visible`, 'type', 'visible must be boolean.');
    }
    for (let index = 0; index < value.nodes.length; index += 1) {
      const node = value.nodes[index] as Record<string, unknown>;
      if (typeof node?.parentId === 'string' && !ids.has(node.parentId)) issue(issues, `/nodes/${index}/parentId`, 'reference', 'parentId does not reference an existing node.');
    }
  }
  if (!isRecord(value.materials)) issue(issues, '/materials', 'type', 'materials must be a record.');
  if (!Array.isArray(value.animations)) issue(issues, '/animations', 'type', 'animations must be an array.');
  if (!isRecord(value.environment)) issue(issues, '/environment', 'type', 'environment is required.');
  if (!Array.isArray(value.cameras) || value.cameras.length === 0) issue(issues, '/cameras', 'required', 'At least one camera is required.');
  if (typeof value.activeCameraId !== 'string') issue(issues, '/activeCameraId', 'required', 'activeCameraId is required.');
  if (!isRecord(value.renderSettings) || !isRecord(value.renderSettings.effects)) issue(issues, '/renderSettings', 'required', 'renderSettings and effects are required.');
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
    assets: {}, nodes: [], materials: {}, animations: [],
    environment: { rotation: 0, intensity: 1, backgroundIntensity: 1, backgroundBlur: 0, backgroundColor: '#111827', transparentBackground: false },
    cameras: [{ id: cameraId, name: 'Camera', transform: { position: { x: 3, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, target: { x: 0, y: 1, z: 0 }, fov: 45, near: 0.01, far: 1000 }],
    activeCameraId: cameraId,
    renderSettings: { backend: 'auto', qualityPreset: 'high', exposure: 1, toneMapping: 'AgX', effects: {} }
  };
}

export function cloneSceneContract(contract: KyxosSceneContract): KyxosSceneContract {
  return structuredClone(contract);
}

export function sceneDigestInput(contract: KyxosSceneContract): string {
  const clone = cloneSceneContract(contract);
  clone.metadata.updatedAt = '';
  return JSON.stringify(clone, Object.keys(clone).sort());
}
