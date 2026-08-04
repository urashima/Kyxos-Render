import type {
  AssetKind,
  ColorSpace,
  KyxosSceneContract,
  SceneAsset,
  SceneMaterial,
  ScenePatch,
  TextureRef,
} from '@kyxos/scene-contract';

export type AssetCreatorKind =
  | 'material'
  | 'json'
  | 'text'
  | 'script'
  | 'shader'
  | 'html'
  | 'css'
  | 'i18n'
  | 'bundle';

export type AssetProcessingTaskKind =
  | 'texture-convert'
  | 'texture-recompress'
  | 'thumbnail-regenerate'
  | 'model-unwrap'
  | 'cubemap-prefilter'
  | 'bundle-build';

export type AssetProcessingTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SceneAssetBundle {
  id: string;
  name: string;
  assetIds: string[];
  includeDependencies: boolean;
  preload: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetProcessingTask {
  id: string;
  kind: AssetProcessingTaskKind;
  assetIds: string[];
  status: AssetProcessingTaskStatus;
  progress: number;
  options: Record<string, unknown>;
  dependsOn: string[];
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  outputs?: string[];
}

export interface AssetProcessingLogEntry {
  id: string;
  taskId: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  createdAt: string;
}

declare module '@kyxos/scene-contract' {
  interface SceneEditorState {
    assetBundles?: SceneAssetBundle[];
    assetProcessingTasks?: AssetProcessingTask[];
    assetProcessingLog?: AssetProcessingLogEntry[];
  }
}

export interface AssetCreatorRequest {
  creator: AssetCreatorKind;
  id: string;
  name: string;
  folderId?: string | null;
  content?: string | Record<string, unknown>;
  language?: string;
  bundleAssetIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface PreparedAssetContent {
  filename: string;
  mimeType: string;
  kind: AssetKind;
  bytes: Uint8Array;
  metadata: Record<string, unknown>;
  material?: SceneMaterial;
  bundle?: SceneAssetBundle;
}

export interface StoredAssetContent {
  uri: `asset://${string}`;
  contentHash: string;
  byteSize: number;
}

export interface AssetContentStore {
  write(input: {
    id: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<StoredAssetContent>;
  remove?(asset: SceneAsset): Promise<void>;
}

export interface AssetPipelineCommandHost {
  getScene(): KyxosSceneContract;
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

export interface AssetTaskExecutionContext {
  task: AssetProcessingTask;
  scene: KyxosSceneContract;
  signal: AbortSignal;
  report(progress: number, message?: string): void;
}

export interface AssetTaskExecutionResult {
  outputs?: string[];
  patch?: ScenePatch;
  messages?: Array<{ level?: 'info' | 'warning' | 'error'; message: string }>;
}

export type AssetTaskHandler = (
  context: AssetTaskExecutionContext,
) => Promise<AssetTaskExecutionResult>;

export interface AssetReference {
  assetId: string;
  path: string;
  role:
    | 'mesh'
    | 'texture-color'
    | 'texture-data'
    | 'environment'
    | 'animation'
    | 'collider'
    | 'bundle'
    | 'other';
}

export interface AssetUsageReport {
  usedAssetIds: string[];
  orphanAssetIds: string[];
  missingAssetIds: string[];
  references: AssetReference[];
}

export interface AssetColorSpaceRecommendation {
  assetId: string;
  current?: ColorSpace;
  recommended: ColorSpace;
  roles: string[];
  conflict: boolean;
  reason: string;
}

export interface AssetPipelineIssue {
  code:
    | 'asset.id-mismatch'
    | 'asset.uri-invalid'
    | 'asset.hash-missing'
    | 'asset.mime-invalid'
    | 'asset.folder-missing'
    | 'bundle.duplicate-id'
    | 'bundle.duplicate-name'
    | 'bundle.asset-missing'
    | 'task.duplicate-id'
    | 'task.asset-missing'
    | 'task.dependency-missing'
    | 'task.dependency-cycle'
    | 'task.progress-invalid'
    | 'task.options-invalid';
  severity: 'error' | 'warning';
  path: string;
  message: string;
  assetId?: string;
  bundleId?: string;
  taskId?: string;
}

const encoder = new TextEncoder();
const TEXT_CREATORS = new Set<AssetCreatorKind>([
  'json', 'text', 'script', 'shader', 'html', 'css', 'i18n',
]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeName(value: string, fallback: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || fallback;
}

function safeId(value: string): string {
  const id = value.normalize('NFKC').replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error('Asset ID is required.');
  return id.slice(0, 180);
}

function uniqueName(values: Iterable<string>, base: string): string {
  const names = new Set([...values].map((value) => value.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function extensionForCreator(creator: AssetCreatorKind): string {
  switch (creator) {
    case 'material': return '.material.json';
    case 'json': return '.json';
    case 'text': return '.txt';
    case 'script': return '.ts';
    case 'shader': return '.wgsl';
    case 'html': return '.html';
    case 'css': return '.css';
    case 'i18n': return '.i18n.json';
    case 'bundle': return '.bundle.json';
  }
}

function mimeForCreator(creator: AssetCreatorKind): string {
  switch (creator) {
    case 'material':
    case 'json':
    case 'i18n':
    case 'bundle': return 'application/json';
    case 'script': return 'text/typescript';
    case 'shader': return 'text/wgsl';
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    case 'text': return 'text/plain';
  }
}

function kindForCreator(creator: AssetCreatorKind): AssetKind {
  switch (creator) {
    case 'material': return 'material';
    case 'script': return 'script';
    default: return 'other';
  }
}

function defaultMaterial(id: string, name: string): SceneMaterial {
  return {
    id,
    name,
    baseColor: { x: 1, y: 1, z: 1, w: 1 },
    metalness: 0,
    roughness: 0.5,
    emissive: { x: 0, y: 0, z: 0 },
    opacity: 1,
    alphaMode: 'opaque',
    doubleSided: false,
  };
}

function defaultTextContent(creator: AssetCreatorKind, name: string, language?: string): string {
  switch (creator) {
    case 'json': return '{}\n';
    case 'i18n': return JSON.stringify({ locale: language || 'en-US', messages: {} }, null, 2) + '\n';
    case 'script': return `export function ${name.replace(/[^a-zA-Z0-9_$]/g, '_')}(): void {\n  // TODO\n}\n`;
    case 'shader': return '@vertex\nfn vertexMain() -> @builtin(position) vec4f {\n  return vec4f(0.0, 0.0, 0.0, 1.0);\n}\n';
    case 'html': return '<!doctype html>\n<html><head><meta charset="utf-8"></head><body></body></html>\n';
    case 'css': return ':root {\n  color-scheme: dark;\n}\n';
    case 'text': return '';
    default: return '';
  }
}

function stringifyContent(value: string | Record<string, unknown> | undefined, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2) + '\n';
  return fallback;
}

export function prepareAssetContent(
  scene: KyxosSceneContract,
  request: AssetCreatorRequest,
  now = new Date().toISOString(),
): PreparedAssetContent {
  const id = safeId(request.id);
  if (scene.assets[id]) throw new Error(`Asset ${id} already exists.`);
  const baseName = normalizeName(request.name, 'Untitled');
  const name = uniqueName(
    Object.values(scene.assets).map((asset) => asset.name ?? asset.id),
    baseName,
  );
  const filename = `${name}${extensionForCreator(request.creator)}`;
  const metadata: Record<string, unknown> = {
    creator: request.creator,
    createdAt: now,
    ...(request.folderId ? { folderId: request.folderId } : {}),
    ...(request.language ? { language: request.language } : {}),
    ...(request.metadata ? clone(request.metadata) : {}),
  };

  if (request.creator === 'material') {
    const material = defaultMaterial(id, name);
    return {
      filename,
      mimeType: mimeForCreator(request.creator),
      kind: 'material',
      bytes: encoder.encode(JSON.stringify(material, null, 2) + '\n'),
      metadata,
      material,
    };
  }

  if (request.creator === 'bundle') {
    const assetIds = [...new Set(request.bundleAssetIds ?? [])];
    const missing = assetIds.filter((assetId) => !scene.assets[assetId]);
    if (missing.length) throw new Error(`Bundle references missing assets: ${missing.join(', ')}`);
    const bundle: SceneAssetBundle = {
      id,
      name,
      assetIds,
      includeDependencies: true,
      preload: false,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    return {
      filename,
      mimeType: 'application/json',
      kind: 'other',
      bytes: encoder.encode(JSON.stringify(bundle, null, 2) + '\n'),
      metadata: { ...metadata, assetType: 'bundle' },
      bundle,
    };
  }

  if (!TEXT_CREATORS.has(request.creator)) throw new Error('Unsupported asset creator.');
  const content = stringifyContent(
    request.content,
    defaultTextContent(request.creator, name, request.language),
  );
  if ((request.creator === 'json' || request.creator === 'i18n') && content.trim()) {
    try { JSON.parse(content); } catch (error) {
      throw new Error(`Invalid JSON content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    filename,
    mimeType: mimeForCreator(request.creator),
    kind: kindForCreator(request.creator),
    bytes: encoder.encode(content),
    metadata,
  };
}

function editorStatePatch(
  scene: KyxosSceneContract,
  changes: Partial<NonNullable<KyxosSceneContract['editorState']>>,
): ScenePatch {
  return [{
    op: scene.editorState ? 'replace' : 'add',
    path: '/editorState',
    value: { ...(scene.editorState ?? {}), ...clone(changes) },
  }];
}

export class AssetAuthoringService extends EventTarget {
  constructor(
    private readonly host: AssetPipelineCommandHost,
    private readonly store: AssetContentStore,
  ) {
    super();
  }

  async create(request: AssetCreatorRequest): Promise<SceneAsset> {
    const scene = this.host.getScene();
    const prepared = prepareAssetContent(scene, request);
    let stored: StoredAssetContent;
    try {
      stored = await this.store.write({
        id: request.id,
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        bytes: prepared.bytes,
      });
    } catch (error) {
      throw new Error(`Failed to persist ${prepared.filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const asset: SceneAsset = {
      id: safeId(request.id),
      uri: stored.uri,
      contentHash: stored.contentHash,
      kind: prepared.kind,
      mimeType: prepared.mimeType,
      byteSize: stored.byteSize,
      name: prepared.filename,
      metadata: prepared.metadata,
    };
    try {
      this.host.execute(`Create ${request.creator} asset`, (current) => {
        if (current.assets[asset.id]) throw new Error(`Asset ${asset.id} already exists.`);
        const patch: ScenePatch = [{ op: 'add', path: `/assets/${escapePointer(asset.id)}`, value: asset }];
        if (prepared.material) patch.push({
          op: current.materials[prepared.material.id] ? 'replace' : 'add',
          path: `/materials/${escapePointer(prepared.material.id)}`,
          value: prepared.material,
        });
        if (prepared.bundle) patch.push(...editorStatePatch(current, {
          assetBundles: [...(current.editorState?.assetBundles ?? []), prepared.bundle],
        }));
        return patch;
      });
    } catch (error) {
      await this.store.remove?.(asset).catch(() => undefined);
      throw error;
    }
    this.emit('change', { type: 'asset:create', asset: clone(asset) });
    return clone(asset);
  }

  updateBundle(bundleId: string, changes: Partial<Omit<SceneAssetBundle, 'id' | 'createdAt'>>): void {
    this.host.execute('Edit Asset Bundle', (scene) => {
      const bundles = clone(scene.editorState?.assetBundles ?? []);
      const bundle = bundles.find((entry) => entry.id === bundleId);
      if (!bundle) throw new Error('Asset Bundle not found.');
      if (changes.name != null) bundle.name = normalizeName(changes.name, bundle.name);
      if (changes.assetIds) {
        const ids = [...new Set(changes.assetIds)];
        const missing = ids.filter((id) => !scene.assets[id]);
        if (missing.length) throw new Error(`Bundle references missing assets: ${missing.join(', ')}`);
        bundle.assetIds = ids;
      }
      if (changes.includeDependencies != null) bundle.includeDependencies = Boolean(changes.includeDependencies);
      if (changes.preload != null) bundle.preload = Boolean(changes.preload);
      if (changes.tags) bundle.tags = [...new Set(changes.tags.map((tag) => normalizeName(tag, '')).filter(Boolean))];
      if (changes.metadata !== undefined) (bundle as SceneAssetBundle & { metadata?: Record<string, unknown> }).metadata = changes.metadata ? clone(changes.metadata) : undefined;
      bundle.updatedAt = new Date().toISOString();
      return editorStatePatch(scene, { assetBundles: bundles });
    }, `asset-bundle:${bundleId}`);
    this.emit('change', { type: 'bundle:update', bundleId });
  }

  removeBundle(bundleId: string): void {
    this.host.execute('Delete Asset Bundle', (scene) => editorStatePatch(scene, {
      assetBundles: (scene.editorState?.assetBundles ?? []).filter((entry) => entry.id !== bundleId),
    }));
    this.emit('change', { type: 'bundle:remove', bundleId });
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function textureReferences(material: SceneMaterial, materialPath: string): AssetReference[] {
  const result: AssetReference[] = [];
  const visit = (key: keyof SceneMaterial, role: AssetReference['role']): void => {
    const ref = material[key] as TextureRef | undefined;
    if (ref?.assetId) result.push({ assetId: ref.assetId, path: `${materialPath}/${String(key)}/assetId`, role });
  };
  visit('baseColorTexture', 'texture-color');
  visit('emissiveTexture', 'texture-color');
  visit('metalnessTexture', 'texture-data');
  visit('roughnessTexture', 'texture-data');
  visit('normalTexture', 'texture-data');
  visit('aoTexture', 'texture-data');
  visit('clearcoatTexture', 'texture-data');
  visit('clearcoatRoughnessTexture', 'texture-data');
  visit('transmissionTexture', 'texture-data');
  visit('thicknessTexture', 'texture-data');
  return result;
}

export function collectAssetReferences(scene: KyxosSceneContract): AssetReference[] {
  const references: AssetReference[] = [];
  scene.nodes.forEach((node, index) => {
    if (node.meshAssetId) references.push({ assetId: node.meshAssetId, path: `/nodes/${index}/meshAssetId`, role: 'mesh' });
    const collider = node as typeof node & { collider?: { meshAssetId?: string } };
    if (collider.collider?.meshAssetId) references.push({ assetId: collider.collider.meshAssetId, path: `/nodes/${index}/collider/meshAssetId`, role: 'collider' });
  });
  Object.entries(scene.materials).forEach(([id, material]) => references.push(...textureReferences(material, `/materials/${escapePointer(id)}`)));
  if (scene.environment.assetId) references.push({ assetId: scene.environment.assetId, path: '/environment/assetId', role: 'environment' });
  for (const bundle of scene.editorState?.assetBundles ?? []) {
    bundle.assetIds.forEach((assetId, index) => references.push({ assetId, path: `/editorState/assetBundles/${escapePointer(bundle.id)}/assetIds/${index}`, role: 'bundle' }));
  }
  return references;
}

export function analyzeAssetUsage(scene: KyxosSceneContract): AssetUsageReport {
  const references = collectAssetReferences(scene);
  const existing = new Set(Object.keys(scene.assets));
  const referenced = new Set(references.map((entry) => entry.assetId));
  const usedAssetIds = [...referenced].filter((id) => existing.has(id)).sort();
  const missingAssetIds = [...referenced].filter((id) => !existing.has(id)).sort();
  const orphanAssetIds = [...existing].filter((id) => !referenced.has(id)).sort();
  return { usedAssetIds, orphanAssetIds, missingAssetIds, references };
}

export function recommendTextureColorSpaces(scene: KyxosSceneContract): AssetColorSpaceRecommendation[] {
  const references = collectAssetReferences(scene).filter((entry) => entry.role.startsWith('texture-'));
  const byAsset = new Map<string, AssetReference[]>();
  for (const reference of references) {
    const list = byAsset.get(reference.assetId) ?? [];
    list.push(reference);
    byAsset.set(reference.assetId, list);
  }
  const recommendations: AssetColorSpaceRecommendation[] = [];
  for (const [assetId, refs] of byAsset) {
    const asset = scene.assets[assetId];
    if (!asset || asset.kind !== 'texture') continue;
    const roles = [...new Set(refs.map((entry) => entry.role))];
    const hasColor = roles.includes('texture-color');
    const hasData = roles.includes('texture-data');
    const recommended: ColorSpace = hasColor && !hasData ? 'srgb' : 'linear';
    const current = typeof asset.metadata?.colorSpace === 'string'
      && ['srgb', 'linear', 'none'].includes(asset.metadata.colorSpace)
      ? asset.metadata.colorSpace as ColorSpace
      : undefined;
    recommendations.push({
      assetId,
      current,
      recommended,
      roles,
      conflict: hasColor && hasData,
      reason: hasColor && hasData
        ? 'Texture is used by both color and data slots; duplicate it or set color space per reference.'
        : hasColor
          ? 'Color and emissive textures should decode from sRGB.'
          : 'Normal, mask and scalar textures should remain linear.',
    });
  }
  return recommendations.sort((left, right) => left.assetId.localeCompare(right.assetId));
}

export function expandBundleAssetIds(
  scene: KyxosSceneContract,
  bundle: SceneAssetBundle,
): string[] {
  const result = new Set(bundle.assetIds.filter((id) => Boolean(scene.assets[id])));
  if (!bundle.includeDependencies) return [...result].sort();
  const references = collectAssetReferences(scene);
  let changed = true;
  while (changed) {
    changed = false;
    for (const reference of references) {
      if (result.has(reference.assetId)) continue;
      if (reference.role === 'bundle') continue;
      const ownerMatch = reference.path.match(/^\/materials\/([^/]+)/);
      const materialId = ownerMatch ? ownerMatch[1].replace(/~1/g, '/').replace(/~0/g, '~') : null;
      if (materialId && result.has(materialId)) {
        result.add(reference.assetId);
        changed = true;
      }
    }
    for (const node of scene.nodes) {
      if (!node.meshAssetId || !result.has(node.meshAssetId)) continue;
      for (const materialId of node.materialSlots ?? []) {
        if (scene.assets[materialId] && !result.has(materialId)) {
          result.add(materialId);
          changed = true;
        }
      }
    }
  }
  return [...result].sort();
}

export function validateProcessingOptions(
  kind: AssetProcessingTaskKind,
  options: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const enumValue = (key: string, values: string[]): void => {
    if (options[key] != null && !values.includes(String(options[key]))) errors.push(`${key} is invalid.`);
  };
  const range = (key: string, minimum: number, maximum: number): void => {
    if (options[key] != null && (!finite(options[key]) || Number(options[key]) < minimum || Number(options[key]) > maximum)) {
      errors.push(`${key} must be between ${minimum} and ${maximum}.`);
    }
  };
  switch (kind) {
    case 'texture-convert':
      enumValue('format', ['png', 'jpeg', 'webp', 'ktx2']);
      range('quality', 0, 1);
      range('maxSize', 1, 16384);
      break;
    case 'texture-recompress':
      enumValue('codec', ['etc1s', 'uastc', 'webp', 'jpeg']);
      range('quality', 0, 255);
      range('rdo', 0, 10);
      break;
    case 'thumbnail-regenerate':
      range('width', 16, 4096);
      range('height', 16, 4096);
      enumValue('background', ['transparent', 'environment', 'solid']);
      break;
    case 'model-unwrap':
      range('padding', 0, 64);
      range('texelDensity', 0.01, 4096);
      enumValue('channel', ['uv0', 'uv1', 'uv2', 'uv3']);
      break;
    case 'cubemap-prefilter':
      range('resolution', 16, 4096);
      range('samples', 1, 8192);
      break;
    case 'bundle-build':
      enumValue('compression', ['none', 'gzip', 'brotli']);
      break;
  }
  return errors;
}

export function createProcessingTask(input: {
  id: string;
  kind: AssetProcessingTaskKind;
  assetIds: Iterable<string>;
  options?: Record<string, unknown>;
  dependsOn?: Iterable<string>;
  maxAttempts?: number;
  now?: string;
}): AssetProcessingTask {
  const options = clone(input.options ?? {});
  const errors = validateProcessingOptions(input.kind, options);
  if (errors.length) throw new Error(errors.join(' '));
  return {
    id: safeId(input.id),
    kind: input.kind,
    assetIds: [...new Set(input.assetIds)],
    status: 'queued',
    progress: 0,
    options,
    dependsOn: [...new Set(input.dependsOn ?? [])],
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(10, Math.round(input.maxAttempts ?? 1))),
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function taskDependencyCycle(tasks: AssetProcessingTask[], startId: string): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return visit(startId);
}

export function validateAssetPipeline(scene: KyxosSceneContract): AssetPipelineIssue[] {
  const issues: AssetPipelineIssue[] = [];
  for (const [id, asset] of Object.entries(scene.assets)) {
    const path = `/assets/${escapePointer(id)}`;
    if (asset.id !== id) issues.push({ code: 'asset.id-mismatch', severity: 'error', path: `${path}/id`, message: 'Asset key and ID must match.', assetId: id });
    if (!/^asset:\/\/[^\s]+$/.test(asset.uri)) issues.push({ code: 'asset.uri-invalid', severity: 'error', path: `${path}/uri`, message: 'Asset URI must use asset://.', assetId: id });
    if (!asset.contentHash) issues.push({ code: 'asset.hash-missing', severity: 'error', path: `${path}/contentHash`, message: 'Asset content hash is required.', assetId: id });
    if (!asset.mimeType.includes('/')) issues.push({ code: 'asset.mime-invalid', severity: 'error', path: `${path}/mimeType`, message: 'Asset MIME type is invalid.', assetId: id });
    const folderId = asset.metadata?.folderId;
    if (typeof folderId === 'string' && !(scene.editorState?.assetFolders ?? []).some((folder) => folder.id === folderId)) {
      issues.push({ code: 'asset.folder-missing', severity: 'warning', path: `${path}/metadata/folderId`, message: 'Asset folder no longer exists.', assetId: id });
    }
  }
  const bundleIds = new Set<string>();
  const bundleNames = new Set<string>();
  (scene.editorState?.assetBundles ?? []).forEach((bundle, index) => {
    const path = `/editorState/assetBundles/${index}`;
    if (!bundle.id || bundleIds.has(bundle.id)) issues.push({ code: 'bundle.duplicate-id', severity: 'error', path: `${path}/id`, message: 'Asset Bundle IDs must be unique.', bundleId: bundle.id });
    bundleIds.add(bundle.id);
    const name = bundle.name.trim().toLocaleLowerCase();
    if (!name || bundleNames.has(name)) issues.push({ code: 'bundle.duplicate-name', severity: 'error', path: `${path}/name`, message: 'Asset Bundle names must be unique.', bundleId: bundle.id });
    bundleNames.add(name);
    bundle.assetIds.forEach((assetId, assetIndex) => {
      if (!scene.assets[assetId]) issues.push({ code: 'bundle.asset-missing', severity: 'error', path: `${path}/assetIds/${assetIndex}`, message: 'Asset Bundle member is missing.', bundleId: bundle.id, assetId });
    });
  });
  const tasks = scene.editorState?.assetProcessingTasks ?? [];
  const taskIds = new Set<string>();
  tasks.forEach((task, index) => {
    const path = `/editorState/assetProcessingTasks/${index}`;
    if (!task.id || taskIds.has(task.id)) issues.push({ code: 'task.duplicate-id', severity: 'error', path: `${path}/id`, message: 'Task IDs must be unique.', taskId: task.id });
    taskIds.add(task.id);
    task.assetIds.forEach((assetId, assetIndex) => {
      if (!scene.assets[assetId] && !bundleIds.has(assetId)) issues.push({ code: 'task.asset-missing', severity: 'error', path: `${path}/assetIds/${assetIndex}`, message: 'Task input asset is missing.', taskId: task.id, assetId });
    });
    if (!finite(task.progress) || task.progress < 0 || task.progress > 1) issues.push({ code: 'task.progress-invalid', severity: 'error', path: `${path}/progress`, message: 'Task progress must be between 0 and 1.', taskId: task.id });
    const optionErrors = validateProcessingOptions(task.kind, task.options);
    if (optionErrors.length) issues.push({ code: 'task.options-invalid', severity: 'error', path: `${path}/options`, message: optionErrors.join(' '), taskId: task.id });
  });
  tasks.forEach((task, index) => {
    task.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!taskIds.has(dependency)) issues.push({ code: 'task.dependency-missing', severity: 'error', path: `/editorState/assetProcessingTasks/${index}/dependsOn/${dependencyIndex}`, message: 'Task dependency is missing.', taskId: task.id });
    });
    if (taskDependencyCycle(tasks, task.id)) issues.push({ code: 'task.dependency-cycle', severity: 'error', path: `/editorState/assetProcessingTasks/${index}/dependsOn`, message: 'Task dependency graph contains a cycle.', taskId: task.id });
  });
  return issues;
}

export class AssetProcessingQueue extends EventTarget {
  private readonly handlers = new Map<AssetProcessingTaskKind, AssetTaskHandler>();
  private readonly controllers = new Map<string, AbortController>();
  private running = 0;

  constructor(
    private readonly host: AssetPipelineCommandHost,
    private readonly concurrency = 2,
    handlers?: Partial<Record<AssetProcessingTaskKind, AssetTaskHandler>>,
  ) {
    super();
    for (const [kind, handler] of Object.entries(handlers ?? {})) if (handler) this.handlers.set(kind as AssetProcessingTaskKind, handler);
  }

  register(kind: AssetProcessingTaskKind, handler: AssetTaskHandler): () => void {
    this.handlers.set(kind, handler);
    return () => { if (this.handlers.get(kind) === handler) this.handlers.delete(kind); };
  }

  enqueue(task: AssetProcessingTask): void {
    this.host.execute(`Queue ${task.kind}`, (scene) => {
      const tasks = clone(scene.editorState?.assetProcessingTasks ?? []);
      if (tasks.some((entry) => entry.id === task.id)) throw new Error(`Task ${task.id} already exists.`);
      const missingInputs = task.assetIds.filter((id) => !scene.assets[id] && !(scene.editorState?.assetBundles ?? []).some((bundle) => bundle.id === id));
      if (missingInputs.length) throw new Error(`Task inputs are missing: ${missingInputs.join(', ')}`);
      const missingDependencies = task.dependsOn.filter((id) => !tasks.some((entry) => entry.id === id));
      if (missingDependencies.length) throw new Error(`Task dependencies are missing: ${missingDependencies.join(', ')}`);
      tasks.push(clone(task));
      if (taskDependencyCycle(tasks, task.id)) throw new Error('Task dependency graph contains a cycle.');
      return editorStatePatch(scene, { assetProcessingTasks: tasks });
    });
    this.emit('change', { type: 'task:queued', taskId: task.id });
    void this.pump();
  }

  cancel(taskId: string): void {
    this.controllers.get(taskId)?.abort();
    this.updateTask(taskId, (task) => {
      if (task.status === 'completed' || task.status === 'failed') return;
      task.status = 'cancelled';
      task.completedAt = new Date().toISOString();
    }, 'Cancel Asset Task');
    this.emit('change', { type: 'task:cancelled', taskId });
  }

  retry(taskId: string): void {
    this.updateTask(taskId, (task) => {
      if (task.status !== 'failed' && task.status !== 'cancelled') throw new Error('Only failed or cancelled tasks can be retried.');
      task.status = 'queued';
      task.progress = 0;
      task.error = undefined;
      task.startedAt = undefined;
      task.completedAt = undefined;
    }, 'Retry Asset Task');
    void this.pump();
  }

  async drain(): Promise<void> {
    while (true) {
      await this.pump();
      const tasks = this.host.getScene().editorState?.assetProcessingTasks ?? [];
      if (!tasks.some((task) => task.status === 'queued' || task.status === 'running')) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private async pump(): Promise<void> {
    while (this.running < Math.max(1, this.concurrency)) {
      const scene = this.host.getScene();
      const tasks = scene.editorState?.assetProcessingTasks ?? [];
      const ready = tasks.find((task) => task.status === 'queued' && task.dependsOn.every((id) => tasks.find((entry) => entry.id === id)?.status === 'completed'));
      if (!ready) return;
      this.running += 1;
      void this.execute(ready.id).finally(() => {
        this.running -= 1;
        void this.pump();
      });
    }
  }

  private async execute(taskId: string): Promise<void> {
    const initial = this.host.getScene().editorState?.assetProcessingTasks?.find((task) => task.id === taskId);
    if (!initial || initial.status !== 'queued') return;
    const handler = this.handlers.get(initial.kind);
    if (!handler) {
      this.fail(taskId, `No handler is registered for ${initial.kind}.`);
      return;
    }
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    this.updateTask(taskId, (task) => {
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      task.attempts += 1;
      task.progress = 0;
    }, 'Start Asset Task');
    try {
      const current = this.host.getScene();
      const task = current.editorState?.assetProcessingTasks?.find((entry) => entry.id === taskId)!;
      const result = await handler({
        task: clone(task),
        scene: clone(current),
        signal: controller.signal,
        report: (progress, message) => {
          this.updateTask(taskId, (entry) => { entry.progress = Math.max(entry.progress, Math.min(1, Math.max(0, progress))); }, 'Update Asset Task');
          if (message) this.log(taskId, 'info', message);
        },
      });
      if (controller.signal.aborted) return;
      this.host.execute(`Complete ${task.kind}`, (scene) => {
        const tasks = clone(scene.editorState?.assetProcessingTasks ?? []);
        const target = tasks.find((entry) => entry.id === taskId);
        if (!target) return [];
        target.status = 'completed';
        target.progress = 1;
        target.completedAt = new Date().toISOString();
        target.outputs = [...new Set(result.outputs ?? [])];
        return [
          ...(result.patch ?? []),
          ...editorStatePatch(scene, { assetProcessingTasks: tasks }),
        ];
      });
      for (const message of result.messages ?? []) this.log(taskId, message.level ?? 'info', message.message);
      this.emit('change', { type: 'task:completed', taskId });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const latest = this.host.getScene().editorState?.assetProcessingTasks?.find((task) => task.id === taskId);
      if (latest && latest.attempts < latest.maxAttempts) {
        this.updateTask(taskId, (task) => {
          task.status = 'queued';
          task.progress = 0;
          task.error = message;
        }, 'Requeue Asset Task');
        this.log(taskId, 'warning', `Attempt ${latest.attempts} failed; retrying: ${message}`);
      } else this.fail(taskId, message);
    } finally {
      this.controllers.delete(taskId);
    }
  }

  private fail(taskId: string, message: string): void {
    this.updateTask(taskId, (task) => {
      task.status = 'failed';
      task.error = message;
      task.completedAt = new Date().toISOString();
    }, 'Fail Asset Task');
    this.log(taskId, 'error', message);
    this.emit('change', { type: 'task:failed', taskId, error: message });
  }

  private updateTask(taskId: string, mutate: (task: AssetProcessingTask) => void, label: string): void {
    this.host.execute(label, (scene) => {
      const tasks = clone(scene.editorState?.assetProcessingTasks ?? []);
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) throw new Error(`Task ${taskId} not found.`);
      mutate(task);
      return editorStatePatch(scene, { assetProcessingTasks: tasks });
    }, `asset-task:${taskId}`);
  }

  private log(taskId: string, level: AssetProcessingLogEntry['level'], message: string): void {
    this.host.execute('Log Asset Task', (scene) => {
      const log = clone(scene.editorState?.assetProcessingLog ?? []);
      log.push({
        id: `${taskId}:${Date.now()}:${log.length}`,
        taskId,
        level,
        message: message.slice(0, 2000),
        createdAt: new Date().toISOString(),
      });
      if (log.length > 1000) log.splice(0, log.length - 1000);
      return editorStatePatch(scene, { assetProcessingLog: log });
    });
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}
