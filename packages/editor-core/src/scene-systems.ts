import type {
  KyxosSceneContract,
  SceneEditorState,
  SceneNode,
  ScenePatch,
  Vec3,
} from '@kyxos/scene-contract';

export type SceneLayerSortMode = 'none' | 'manual' | 'material-mesh' | 'back-to-front' | 'front-to-back';

export interface SceneLayerDefinition {
  id: string;
  name: string;
  enabled: boolean;
  visible: boolean;
  order: number;
  opaqueSortMode: SceneLayerSortMode;
  transparentSortMode: SceneLayerSortMode;
  clearDepth?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SceneBatchGroupDefinition {
  id: string;
  name: string;
  dynamic: boolean;
  enabled: boolean;
  maxAabbSize: number;
  layerIds: string[];
  castShadow: boolean;
  receiveShadow: boolean;
  metadata?: Record<string, unknown>;
}

export interface SceneLightmapSettings {
  enabled: boolean;
  bakeMode: 'color' | 'color-direction';
  resolutionMultiplier: number;
  maxResolution: number;
  padding: number;
  samples: number;
  directSamples: number;
  indirectSamples: number;
  filtering: 'none' | 'bilateral' | 'gaussian';
  ambientBake: boolean;
  ambientBakeSpherePart: number;
}

export interface ScenePhysicsSettings {
  enabled: boolean;
  gravity: Vec3;
  fixedTimeStep: number;
  maxSubSteps: number;
  broadphase: 'dynamic-aabb-tree' | 'axis-sweep' | 'simple';
}

export type SceneColliderType = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' | 'compound';
export type SceneColliderAxis = 'x' | 'y' | 'z';

export interface SceneColliderComponent {
  enabled: boolean;
  type: SceneColliderType;
  center: Vec3;
  size?: Vec3;
  radius?: number;
  height?: number;
  axis?: SceneColliderAxis;
  meshAssetId?: string;
  convex?: boolean;
  trigger: boolean;
  friction: number;
  restitution: number;
  collisionGroup: number;
  collisionMask: number;
  metadata?: Record<string, unknown>;
}

export interface SceneRigidbodyComponent {
  enabled: boolean;
  type: 'static' | 'dynamic' | 'kinematic';
  mass: number;
  linearDamping: number;
  angularDamping: number;
  linearFactor: Vec3;
  angularFactor: Vec3;
  gravityFactor: number;
  continuousCollision: boolean;
  sleeping: boolean;
  metadata?: Record<string, unknown>;
}

export interface SceneLightmapNodeSettings {
  enabled: boolean;
  static: boolean;
  castShadows: boolean;
  receiveLightmap: boolean;
  scaleMultiplier: number;
}

declare module '@kyxos/scene-contract' {
  interface SceneEditorState {
    layers?: SceneLayerDefinition[];
    batchGroups?: SceneBatchGroupDefinition[];
    lightmapSettings?: SceneLightmapSettings;
    physicsSettings?: ScenePhysicsSettings;
  }

  interface SceneNode {
    layerIds?: string[];
    batchGroupId?: string | null;
    collider?: SceneColliderComponent;
    rigidbody?: SceneRigidbodyComponent;
    lightmap?: SceneLightmapNodeSettings;
  }
}

export interface SceneSystemsIssue {
  code:
    | 'layer.duplicate-id'
    | 'layer.duplicate-name'
    | 'layer.invalid-order'
    | 'layer.reference-missing'
    | 'batch.duplicate-id'
    | 'batch.duplicate-name'
    | 'batch.layer-missing'
    | 'batch.reference-missing'
    | 'batch.invalid-aabb'
    | 'lightmap.invalid-settings'
    | 'physics.invalid-settings'
    | 'collider.invalid-settings'
    | 'collider.asset-missing'
    | 'rigidbody.invalid-settings'
    | 'rigidbody.collider-missing';
  severity: 'error' | 'warning';
  message: string;
  path: string;
  nodeId?: string;
  layerId?: string;
  batchGroupId?: string;
}

export interface SceneSystemsSummary {
  layers: number;
  batchGroups: number;
  layeredNodes: number;
  batchedNodes: number;
  colliders: number;
  rigidbodies: number;
  lightmappedNodes: number;
  issues: number;
}

export interface SceneSystemsCommandHost {
  getScene(): KyxosSceneContract;
  execute(label: string, patch: (scene: KyxosSceneContract) => ScenePatch, mergeKey?: string): void;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };
const SORT_MODES: SceneLayerSortMode[] = ['none', 'manual', 'material-mesh', 'back-to-front', 'front-to-back'];
const COLLIDER_TYPES: SceneColliderType[] = ['box', 'sphere', 'capsule', 'cylinder', 'mesh', 'compound'];

function clone<T>(value: T): T { return structuredClone(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)) }
function integer(value: unknown, fallback: number): number { return finite(value) ? Math.round(value) : fallback }
function normalizeName(value: string, fallback: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || fallback;
}
function uniqueName(values: Iterable<string>, base: string): string {
  const names = new Set([...values].map((value) => value.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}
function vec3(value: Vec3 | undefined, fallback: Vec3): Vec3 {
  return {
    x: finite(value?.x) ? value.x : fallback.x,
    y: finite(value?.y) ? value.y : fallback.y,
    z: finite(value?.z) ? value.z : fallback.z,
  };
}

export function createDefaultSceneLayers(): SceneLayerDefinition[] {
  return [
    { id: 'world', name: 'World', enabled: true, visible: true, order: 0, opaqueSortMode: 'material-mesh', transparentSortMode: 'back-to-front' },
    { id: 'skybox', name: 'Skybox', enabled: true, visible: true, order: 10, opaqueSortMode: 'none', transparentSortMode: 'none', clearDepth: false },
    { id: 'ui', name: 'UI', enabled: true, visible: true, order: 20, opaqueSortMode: 'manual', transparentSortMode: 'manual', clearDepth: true },
  ];
}

export function createDefaultLightmapSettings(): SceneLightmapSettings {
  return {
    enabled: false,
    bakeMode: 'color-direction',
    resolutionMultiplier: 1,
    maxResolution: 2048,
    padding: 4,
    samples: 16,
    directSamples: 16,
    indirectSamples: 64,
    filtering: 'bilateral',
    ambientBake: false,
    ambientBakeSpherePart: 0.4,
  };
}

export function createDefaultPhysicsSettings(): ScenePhysicsSettings {
  return { enabled: false, gravity: { x: 0, y: -9.81, z: 0 }, fixedTimeStep: 1 / 60, maxSubSteps: 4, broadphase: 'dynamic-aabb-tree' };
}

export function createDefaultCollider(type: SceneColliderType = 'box'): SceneColliderComponent {
  return {
    enabled: true,
    type,
    center: clone(ZERO),
    size: type === 'box' ? clone(ONE) : undefined,
    radius: ['sphere', 'capsule', 'cylinder'].includes(type) ? 0.5 : undefined,
    height: ['capsule', 'cylinder'].includes(type) ? 1 : undefined,
    axis: ['capsule', 'cylinder'].includes(type) ? 'y' : undefined,
    convex: type === 'mesh' ? true : undefined,
    trigger: false,
    friction: 0.5,
    restitution: 0,
    collisionGroup: 1,
    collisionMask: 0xffff,
  };
}

export function createDefaultRigidbody(type: SceneRigidbodyComponent['type'] = 'static'): SceneRigidbodyComponent {
  return {
    enabled: true,
    type,
    mass: type === 'dynamic' ? 1 : 0,
    linearDamping: 0,
    angularDamping: 0,
    linearFactor: clone(ONE),
    angularFactor: clone(ONE),
    gravityFactor: 1,
    continuousCollision: false,
    sleeping: false,
  };
}

export function createDefaultNodeLightmapSettings(): SceneLightmapNodeSettings {
  return { enabled: false, static: true, castShadows: true, receiveLightmap: true, scaleMultiplier: 1 };
}

export function ensureSceneSystems(scene: KyxosSceneContract): KyxosSceneContract {
  const next = clone(scene);
  next.editorState ??= {};
  next.editorState.layers ??= createDefaultSceneLayers();
  next.editorState.batchGroups ??= [];
  next.editorState.lightmapSettings ??= createDefaultLightmapSettings();
  next.editorState.physicsSettings ??= createDefaultPhysicsSettings();
  const layers = new Set(next.editorState.layers.map((layer) => layer.id));
  const fallback = next.editorState.layers[0]?.id ?? 'world';
  for (const node of next.nodes) {
    const assigned = [...new Set((node.layerIds ?? []).filter((id) => layers.has(id)))];
    node.layerIds = assigned.length ? assigned : [fallback];
    node.batchGroupId ??= null;
  }
  return next;
}

function issue(issues: SceneSystemsIssue[], value: SceneSystemsIssue): void { issues.push(value) }

function validateCollider(scene: KyxosSceneContract, node: SceneNode, index: number, issues: SceneSystemsIssue[]): void {
  const value = node.collider;
  if (!value) return;
  const path = `/nodes/${index}/collider`;
  const invalid = (message: string, suffix: string) => issue(issues, { code: 'collider.invalid-settings', severity: 'error', message, path: `${path}/${suffix}`, nodeId: node.id });
  if (!COLLIDER_TYPES.includes(value.type)) invalid('Collider type is invalid.', 'type');
  if (!finite(value.friction) || value.friction < 0 || value.friction > 1) invalid('Collider friction must be between 0 and 1.', 'friction');
  if (!finite(value.restitution) || value.restitution < 0 || value.restitution > 1) invalid('Collider restitution must be between 0 and 1.', 'restitution');
  if (!Number.isInteger(value.collisionGroup) || value.collisionGroup < 0 || value.collisionGroup > 0xffff) invalid('Collision group must be a 16-bit mask.', 'collisionGroup');
  if (!Number.isInteger(value.collisionMask) || value.collisionMask < 0 || value.collisionMask > 0xffff) invalid('Collision mask must be a 16-bit mask.', 'collisionMask');
  if (['sphere', 'capsule', 'cylinder'].includes(value.type) && (!finite(value.radius) || value.radius <= 0)) invalid('Collider radius must be positive.', 'radius');
  if (['capsule', 'cylinder'].includes(value.type) && (!finite(value.height) || value.height <= 0)) invalid('Collider height must be positive.', 'height');
  if (value.type === 'box' && (!value.size || [value.size.x, value.size.y, value.size.z].some((entry) => !finite(entry) || entry <= 0))) invalid('Box collider size must be positive.', 'size');
  if (value.type === 'mesh') {
    const asset = value.meshAssetId ? scene.assets[value.meshAssetId] : undefined;
    if (!asset || asset.kind !== 'model') issue(issues, { code: 'collider.asset-missing', severity: 'error', message: 'Mesh collider must reference an existing model asset.', path: `${path}/meshAssetId`, nodeId: node.id });
  }
}

function validateRigidbody(node: SceneNode, index: number, issues: SceneSystemsIssue[]): void {
  const value = node.rigidbody;
  if (!value) return;
  const path = `/nodes/${index}/rigidbody`;
  const invalid = (message: string, suffix: string) => issue(issues, { code: 'rigidbody.invalid-settings', severity: 'error', message, path: `${path}/${suffix}`, nodeId: node.id });
  if (!['static', 'dynamic', 'kinematic'].includes(value.type)) invalid('Rigidbody type is invalid.', 'type');
  if (!finite(value.mass) || value.mass < 0 || (value.type === 'dynamic' && value.mass <= 0)) invalid('Dynamic rigidbody mass must be positive.', 'mass');
  if (!finite(value.linearDamping) || value.linearDamping < 0 || value.linearDamping > 1) invalid('Linear damping must be between 0 and 1.', 'linearDamping');
  if (!finite(value.angularDamping) || value.angularDamping < 0 || value.angularDamping > 1) invalid('Angular damping must be between 0 and 1.', 'angularDamping');
  if (!finite(value.gravityFactor)) invalid('Gravity factor must be finite.', 'gravityFactor');
  if (!node.collider && value.type !== 'static') issue(issues, { code: 'rigidbody.collider-missing', severity: 'warning', message: 'Dynamic and kinematic rigidbodies should have a collider.', path, nodeId: node.id });
}

export function validateSceneSystems(scene: KyxosSceneContract): SceneSystemsIssue[] {
  const issues: SceneSystemsIssue[] = [];
  const layers = scene.editorState?.layers ?? [];
  const layerIds = new Set<string>();
  const layerNames = new Set<string>();
  layers.forEach((layer, index) => {
    const path = `/editorState/layers/${index}`;
    if (!layer.id || layerIds.has(layer.id)) issue(issues, { code: 'layer.duplicate-id', severity: 'error', message: 'Layer IDs must be unique and non-empty.', path: `${path}/id`, layerId: layer.id });
    layerIds.add(layer.id);
    const name = layer.name.trim().toLocaleLowerCase();
    if (!name || layerNames.has(name)) issue(issues, { code: 'layer.duplicate-name', severity: 'error', message: 'Layer names must be unique and non-empty.', path: `${path}/name`, layerId: layer.id });
    layerNames.add(name);
    if (!Number.isInteger(layer.order) || !SORT_MODES.includes(layer.opaqueSortMode) || !SORT_MODES.includes(layer.transparentSortMode)) {
      issue(issues, { code: 'layer.invalid-order', severity: 'error', message: 'Layer order or sort mode is invalid.', path, layerId: layer.id });
    }
  });

  const groups = scene.editorState?.batchGroups ?? [];
  const groupIds = new Set<string>();
  const groupNames = new Set<string>();
  groups.forEach((group, index) => {
    const path = `/editorState/batchGroups/${index}`;
    if (!group.id || groupIds.has(group.id)) issue(issues, { code: 'batch.duplicate-id', severity: 'error', message: 'Batch Group IDs must be unique and non-empty.', path: `${path}/id`, batchGroupId: group.id });
    groupIds.add(group.id);
    const name = group.name.trim().toLocaleLowerCase();
    if (!name || groupNames.has(name)) issue(issues, { code: 'batch.duplicate-name', severity: 'error', message: 'Batch Group names must be unique and non-empty.', path: `${path}/name`, batchGroupId: group.id });
    groupNames.add(name);
    if (!finite(group.maxAabbSize) || group.maxAabbSize <= 0) issue(issues, { code: 'batch.invalid-aabb', severity: 'error', message: 'Batch Group maximum AABB size must be positive.', path: `${path}/maxAabbSize`, batchGroupId: group.id });
    for (const layerId of group.layerIds) if (!layerIds.has(layerId)) issue(issues, { code: 'batch.layer-missing', severity: 'error', message: 'Batch Group references a missing layer.', path: `${path}/layerIds`, batchGroupId: group.id, layerId });
  });

  scene.nodes.forEach((node, index) => {
    for (const layerId of node.layerIds ?? []) if (!layerIds.has(layerId)) issue(issues, { code: 'layer.reference-missing', severity: 'error', message: 'Node references a missing layer.', path: `/nodes/${index}/layerIds`, nodeId: node.id, layerId });
    if (node.batchGroupId && !groupIds.has(node.batchGroupId)) issue(issues, { code: 'batch.reference-missing', severity: 'error', message: 'Node references a missing Batch Group.', path: `/nodes/${index}/batchGroupId`, nodeId: node.id, batchGroupId: node.batchGroupId });
    validateCollider(scene, node, index, issues);
    validateRigidbody(node, index, issues);
    if (node.lightmap && (!finite(node.lightmap.scaleMultiplier) || node.lightmap.scaleMultiplier <= 0 || node.lightmap.scaleMultiplier > 16)) issue(issues, { code: 'lightmap.invalid-settings', severity: 'error', message: 'Node lightmap scale must be between 0 and 16.', path: `/nodes/${index}/lightmap/scaleMultiplier`, nodeId: node.id });
  });

  const lightmap = scene.editorState?.lightmapSettings;
  if (lightmap) {
    const valid = finite(lightmap.resolutionMultiplier) && lightmap.resolutionMultiplier > 0 && lightmap.resolutionMultiplier <= 8
      && Number.isInteger(lightmap.maxResolution) && lightmap.maxResolution >= 64 && lightmap.maxResolution <= 8192
      && Number.isInteger(lightmap.padding) && lightmap.padding >= 0 && lightmap.padding <= 64
      && Number.isInteger(lightmap.samples) && lightmap.samples > 0
      && Number.isInteger(lightmap.directSamples) && lightmap.directSamples > 0
      && Number.isInteger(lightmap.indirectSamples) && lightmap.indirectSamples > 0
      && finite(lightmap.ambientBakeSpherePart) && lightmap.ambientBakeSpherePart >= 0 && lightmap.ambientBakeSpherePart <= 1;
    if (!valid) issue(issues, { code: 'lightmap.invalid-settings', severity: 'error', message: 'Scene lightmap settings are outside supported ranges.', path: '/editorState/lightmapSettings' });
  }

  const physics = scene.editorState?.physicsSettings;
  if (physics) {
    const valid = finite(physics.gravity.x) && finite(physics.gravity.y) && finite(physics.gravity.z)
      && finite(physics.fixedTimeStep) && physics.fixedTimeStep > 0 && physics.fixedTimeStep <= 1
      && Number.isInteger(physics.maxSubSteps) && physics.maxSubSteps >= 1 && physics.maxSubSteps <= 32
      && ['dynamic-aabb-tree', 'axis-sweep', 'simple'].includes(physics.broadphase);
    if (!valid) issue(issues, { code: 'physics.invalid-settings', severity: 'error', message: 'Scene physics settings are invalid.', path: '/editorState/physicsSettings' });
  }
  return issues;
}

export function summarizeSceneSystems(scene: KyxosSceneContract): SceneSystemsSummary {
  return {
    layers: scene.editorState?.layers?.length ?? 0,
    batchGroups: scene.editorState?.batchGroups?.length ?? 0,
    layeredNodes: scene.nodes.filter((node) => node.layerIds?.length).length,
    batchedNodes: scene.nodes.filter((node) => Boolean(node.batchGroupId)).length,
    colliders: scene.nodes.filter((node) => Boolean(node.collider)).length,
    rigidbodies: scene.nodes.filter((node) => Boolean(node.rigidbody)).length,
    lightmappedNodes: scene.nodes.filter((node) => node.lightmap?.enabled).length,
    issues: validateSceneSystems(scene).length,
  };
}

export class SceneSystemsService extends EventTarget {
  constructor(private readonly host: SceneSystemsCommandHost, private readonly createId: () => string = () => crypto.randomUUID()) { super() }

  ensure(): void {
    const scene = this.host.getScene();
    const next = ensureSceneSystems(scene);
    if (JSON.stringify(scene.editorState) === JSON.stringify(next.editorState) && JSON.stringify(scene.nodes) === JSON.stringify(next.nodes)) return;
    this.host.execute('Initialize scene systems', () => [
      { op: scene.editorState ? 'replace' : 'add', path: '/editorState', value: next.editorState },
      { op: 'replace', path: '/nodes', value: next.nodes },
    ]);
    this.emit('ensure');
  }

  addLayer(name = 'Layer'): string {
    const id = this.createId();
    this.host.execute('Add layer', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      layers.push({ id, name: uniqueName(layers.map((entry) => entry.name), normalizeName(name, 'Layer')), enabled: true, visible: true, order: layers.length ? Math.max(...layers.map((entry) => entry.order)) + 10 : 0, opaqueSortMode: 'material-mesh', transparentSortMode: 'back-to-front' });
      return this.editorStatePatch(scene, { layers });
    });
    this.emit('layer:add', { id });
    return id;
  }

  updateLayer(id: string, changes: Partial<Omit<SceneLayerDefinition, 'id'>>): void {
    this.host.execute('Edit layer', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      const layer = layers.find((entry) => entry.id === id);
      if (!layer) throw new Error('Layer not found.');
      if (changes.name != null) layer.name = uniqueName(layers.filter((entry) => entry.id !== id).map((entry) => entry.name), normalizeName(changes.name, layer.name));
      if (changes.enabled != null) layer.enabled = Boolean(changes.enabled);
      if (changes.visible != null) layer.visible = Boolean(changes.visible);
      if (changes.order != null) layer.order = integer(changes.order, layer.order);
      if (changes.opaqueSortMode) layer.opaqueSortMode = changes.opaqueSortMode;
      if (changes.transparentSortMode) layer.transparentSortMode = changes.transparentSortMode;
      if (changes.clearDepth != null) layer.clearDepth = Boolean(changes.clearDepth);
      if (changes.metadata !== undefined) layer.metadata = changes.metadata ? clone(changes.metadata) : undefined;
      return this.editorStatePatch(scene, { layers });
    }, `layer:${id}`);
    this.emit('layer:update', { id });
  }

  removeLayer(id: string, replacementId?: string): void {
    this.host.execute('Delete layer', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      if (layers.length <= 1) throw new Error('A scene must keep at least one layer.');
      const replacement = replacementId && replacementId !== id && layers.some((entry) => entry.id === replacementId)
        ? replacementId
        : layers.find((entry) => entry.id !== id)?.id;
      if (!replacement) throw new Error('A replacement layer is required.');
      const nodes = clone(scene.nodes).map((node) => ({ ...node, layerIds: [...new Set((node.layerIds ?? []).map((layerId) => layerId === id ? replacement : layerId))] }));
      const batchGroups = clone(scene.editorState?.batchGroups ?? []).map((group) => ({ ...group, layerIds: [...new Set(group.layerIds.map((layerId) => layerId === id ? replacement : layerId))] }));
      return [
        ...this.editorStatePatch(scene, { layers: layers.filter((entry) => entry.id !== id), batchGroups }),
        { op: 'replace', path: '/nodes', value: nodes },
      ];
    });
    this.emit('layer:remove', { id });
  }

  reorderLayers(ids: string[]): void {
    this.host.execute('Reorder layers', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      const byId = new Map(layers.map((entry) => [entry.id, entry]));
      if (ids.length !== layers.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) throw new Error('Layer order must contain every layer exactly once.');
      return this.editorStatePatch(scene, { layers: ids.map((id, index) => ({ ...byId.get(id)!, order: index * 10 })) });
    });
    this.emit('layer:reorder', { ids });
  }

  assignLayers(nodeIds: Iterable<string>, layerIds: Iterable<string>): void {
    const selected = new Set(nodeIds);
    const assigned = [...new Set(layerIds)];
    this.host.execute('Assign node layers', (scene) => {
      const valid = new Set((scene.editorState?.layers ?? createDefaultSceneLayers()).map((entry) => entry.id));
      if (!assigned.length || assigned.some((id) => !valid.has(id))) throw new Error('Every assigned layer must exist.');
      const patch: ScenePatch = [];
      scene.nodes.forEach((node, index) => {
        if (!selected.has(node.id)) return;
        patch.push({ op: node.layerIds == null ? 'add' : 'replace', path: `/nodes/${index}/layerIds`, value: assigned });
      });
      return patch;
    });
    this.emit('node:layers', { nodeIds: [...selected], layerIds: assigned });
  }

  addBatchGroup(name = 'Batch Group'): string {
    const id = this.createId();
    this.host.execute('Add Batch Group', (scene) => {
      const groups = clone(scene.editorState?.batchGroups ?? []);
      const layers = scene.editorState?.layers ?? createDefaultSceneLayers();
      groups.push({ id, name: uniqueName(groups.map((entry) => entry.name), normalizeName(name, 'Batch Group')), dynamic: false, enabled: true, maxAabbSize: 100, layerIds: [layers[0]?.id ?? 'world'], castShadow: true, receiveShadow: true });
      return this.editorStatePatch(scene, { batchGroups: groups });
    });
    this.emit('batch:add', { id });
    return id;
  }

  updateBatchGroup(id: string, changes: Partial<Omit<SceneBatchGroupDefinition, 'id'>>): void {
    this.host.execute('Edit Batch Group', (scene) => {
      const groups = clone(scene.editorState?.batchGroups ?? []);
      const group = groups.find((entry) => entry.id === id);
      if (!group) throw new Error('Batch Group not found.');
      if (changes.name != null) group.name = uniqueName(groups.filter((entry) => entry.id !== id).map((entry) => entry.name), normalizeName(changes.name, group.name));
      if (changes.dynamic != null) group.dynamic = Boolean(changes.dynamic);
      if (changes.enabled != null) group.enabled = Boolean(changes.enabled);
      if (changes.maxAabbSize != null) group.maxAabbSize = Math.max(0.01, Number(changes.maxAabbSize));
      if (changes.layerIds) group.layerIds = [...new Set(changes.layerIds)];
      if (changes.castShadow != null) group.castShadow = Boolean(changes.castShadow);
      if (changes.receiveShadow != null) group.receiveShadow = Boolean(changes.receiveShadow);
      if (changes.metadata !== undefined) group.metadata = changes.metadata ? clone(changes.metadata) : undefined;
      return this.editorStatePatch(scene, { batchGroups: groups });
    }, `batch:${id}`);
    this.emit('batch:update', { id });
  }

  removeBatchGroup(id: string): void {
    this.host.execute('Delete Batch Group', (scene) => {
      const patch: ScenePatch = this.editorStatePatch(scene, { batchGroups: (scene.editorState?.batchGroups ?? []).filter((entry) => entry.id !== id) });
      scene.nodes.forEach((node, index) => {
        if (node.batchGroupId === id) patch.push({ op: 'replace', path: `/nodes/${index}/batchGroupId`, value: null });
      });
      return patch;
    });
    this.emit('batch:remove', { id });
  }

  assignBatchGroup(nodeIds: Iterable<string>, groupId: string | null): void {
    const selected = new Set(nodeIds);
    this.host.execute('Assign Batch Group', (scene) => {
      if (groupId && !(scene.editorState?.batchGroups ?? []).some((entry) => entry.id === groupId)) throw new Error('Batch Group not found.');
      const patch: ScenePatch = [];
      scene.nodes.forEach((node, index) => {
        if (!selected.has(node.id)) return;
        patch.push({ op: node.batchGroupId === undefined ? 'add' : 'replace', path: `/nodes/${index}/batchGroupId`, value: groupId });
      });
      return patch;
    });
    this.emit('node:batch', { nodeIds: [...selected], groupId });
  }

  setCollider(nodeIds: Iterable<string>, value: SceneColliderComponent | null): void { this.setNodeComponent('collider', nodeIds, value, 'Set Collider') }
  setRigidbody(nodeIds: Iterable<string>, value: SceneRigidbodyComponent | null): void { this.setNodeComponent('rigidbody', nodeIds, value, 'Set Rigidbody') }
  setNodeLightmap(nodeIds: Iterable<string>, value: SceneLightmapNodeSettings | null): void { this.setNodeComponent('lightmap', nodeIds, value, 'Set Node Lightmap') }

  setLightmapSettings(changes: Partial<SceneLightmapSettings>): void {
    this.host.execute('Edit Lightmap Settings', (scene) => this.editorStatePatch(scene, { lightmapSettings: { ...(scene.editorState?.lightmapSettings ?? createDefaultLightmapSettings()), ...clone(changes) } }), 'scene:lightmap-settings');
    this.emit('lightmap:settings');
  }

  setPhysicsSettings(changes: Partial<ScenePhysicsSettings>): void {
    this.host.execute('Edit Physics Settings', (scene) => {
      const value = { ...(scene.editorState?.physicsSettings ?? createDefaultPhysicsSettings()), ...clone(changes) };
      if (changes.gravity) value.gravity = vec3(changes.gravity, value.gravity);
      return this.editorStatePatch(scene, { physicsSettings: value });
    }, 'scene:physics-settings');
    this.emit('physics:settings');
  }

  private setNodeComponent<K extends 'collider' | 'rigidbody' | 'lightmap'>(key: K, nodeIds: Iterable<string>, value: SceneNode[K] | null, label: string): void {
    const selected = new Set(nodeIds);
    this.host.execute(label, (scene) => {
      const patch: ScenePatch = [];
      scene.nodes.forEach((node, index) => {
        if (!selected.has(node.id)) return;
        if (value == null) {
          if (node[key] != null) patch.push({ op: 'remove', path: `/nodes/${index}/${key}` });
          return;
        }
        patch.push({ op: node[key] == null ? 'add' : 'replace', path: `/nodes/${index}/${key}`, value: clone(value) });
      });
      return patch;
    });
    this.emit(`node:${key}`, { nodeIds: [...selected] });
  }

  private editorStatePatch(scene: KyxosSceneContract, changes: Partial<SceneEditorState>): ScenePatch {
    return [{ op: scene.editorState ? 'replace' : 'add', path: '/editorState', value: { ...(scene.editorState ?? {}), ...clone(changes) } }];
  }

  private emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { type, ...clone(detail as Record<string, unknown>) } }));
  }
}

export function effectiveNodeLayers(scene: KyxosSceneContract, node: SceneNode): SceneLayerDefinition[] {
  const layers = scene.editorState?.layers ?? createDefaultSceneLayers();
  const ids = new Set(node.layerIds?.length ? node.layerIds : [layers[0]?.id]);
  return layers.filter((layer) => ids.has(layer.id) && layer.enabled).sort((left, right) => left.order - right.order);
}

export function batchGroupMembers(scene: KyxosSceneContract, groupId: string): SceneNode[] {
  return scene.nodes.filter((node) => node.batchGroupId === groupId).map(clone);
}

export function collisionPairsEnabled(left: SceneColliderComponent, right: SceneColliderComponent): boolean {
  return (left.collisionMask & right.collisionGroup) !== 0 && (right.collisionMask & left.collisionGroup) !== 0;
}
