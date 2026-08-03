import type {
  KyxosSceneContract,
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
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function integer(value: unknown, fallback: number): number {
  return finite(value) ? Math.round(value) : fallback;
}

function normalizeName(value: string, fallback: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || fallback;
}

function uniqueName(values: Iterable<string>, base: string): string {
  const reserved = new Set([...values].map((value) => value.toLocaleLowerCase()));
  if (!reserved.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (reserved.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function normalizeVec3(value: Vec3 | undefined, fallback: Vec3): Vec3 {
  return {
    x: finite(value?.x) ? value.x : fallback.x,
    y: finite(value?.y) ? value.y : fallback.y,
    z: finite(value?.z) ? value.z : fallback.z,
  };
}

export function createDefaultSceneLayers(): SceneLayerDefinition[] {
  return [
    {
      id: 'world',
      name: 'World',
      enabled: true,
      visible: true,
      order: 0,
      opaqueSortMode: 'material-mesh',
      transparentSortMode: 'back-to-front',
    },
    {
      id: 'skybox',
      name: 'Skybox',
      enabled: true,
      visible: true,
      order: 10,
      opaqueSortMode: 'none',
      transparentSortMode: 'none',
      clearDepth: false,
    },
    {
      id: 'ui',
      name: 'UI',
      enabled: true,
      visible: true,
      order: 20,
      opaqueSortMode: 'manual',
      transparentSortMode: 'manual',
      clearDepth: true,
    },
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
  return {
    enabled: false,
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 4,
    broadphase: 'dynamic-aabb-tree',
  };
}

export function createDefaultCollider(type: SceneColliderType = 'box'): SceneColliderComponent {
  return {
    enabled: true,
    type,
    center: clone(ZERO),
    size: type === 'box' ? clone(ONE) : undefined,
    radius: type === 'sphere' || type === 'capsule' || type === 'cylinder' ? 0.5 : undefined,
    height: type === 'capsule' || type === 'cylinder' ? 1 : undefined,
    axis: type === 'capsule' || type === 'cylinder' ? 'y' : undefined,
    convex: type === 'mesh' ? true : undefined,
    trigger: false,
    friction: 0.5,
    restitution: 0,
    collisionGroup: 1,
    collisionMask: 0xffff,
  };
}

export function createDefaultRigidbody(
  type: SceneRigidbodyComponent['type'] = 'static',
): SceneRigidbodyComponent {
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
  return {
    enabled: false,
    static: true,
    castShadows: true,
    receiveLightmap: true,
    scaleMultiplier: 1,
  };
}

export function ensureSceneSystems(scene: KyxosSceneContract): KyxosSceneContract {
  const next = clone(scene);
  next.editorState ??= {};
  next.editorState.layers ??= createDefaultSceneLayers();
  next.editorState.batchGroups ??= [];
  next.editorState.lightmapSettings ??= createDefaultLightmapSettings();
  next.editorState.physicsSettings ??= createDefaultPhysicsSettings();
  const layerIds = new Set(next.editorState.layers.map((layer) => layer.id));
  const fallbackLayer = next.editorState.layers[0]?.id ?? 'world';
  for (const node of next.nodes) {
    const valid = (node.layerIds ?? []).filter((id) => layerIds.has(id));
    node.layerIds = valid.length ? [...new Set(valid)] : [fallbackLayer];
    node.batchGroupId ??= null;
  }
  return next;
}

function validateLayer(layer: SceneLayerDefinition, path: string, issues: SceneSystemsIssue[]): void {
  if (!Number.isInteger(layer.order)) {
    issues.push({ code: 'layer.invalid-order', severity: 'error', message: 'Layer order must be an integer.', path: `${path}/order`, layerId: layer.id });
  }
  if (!['none', 'manual', 'material-mesh', 'back-to-front', 'front-to-back'].includes(layer.opaqueSortMode)) {
    issues.push({ code: 'layer.invalid-order', severity: 'error', message: 'Opaque sort mode is invalid.', path: `${path}/opaqueSortMode`, layerId: layer.id });
  }
  if (!['none', 'manual', 'material-mesh', 'back-to-front', 'front-to-back'].includes(layer.transparentSortMode)) {
    issues.push({ code: 'layer.invalid-order', severity: 'error', message: 'Transparent sort mode is invalid.', path: `${path}/transparentSortMode`, layerId: layer.id });
  }
}

function validateCollider(
  scene: KyxosSceneContract,
  node: SceneNode,
  index: number,
  issues: SceneSystemsIssue[],
): void {
  const collider = node.collider;
  if (!collider) return;
  const path = `/nodes/${index}/collider`;
  if (!['box', 'sphere', 'capsule', 'cylinder', 'mesh', 'compound'].includes(collider.type)) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collider type is invalid.', path: `${path}/type`, nodeId: node.id });
  }
  if (!finite(collider.friction) || collider.friction < 0 || collider.friction > 1) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collider friction must be between 0 and 1.', path: `${path}/friction`, nodeId: node.id });
  }
  if (!finite(collider.restitution) || collider.restitution < 0 || collider.restitution > 1) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collider restitution must be between 0 and 1.', path: `${path}/restitution`, nodeId: node.id });
  }
  if (!Number.isInteger(collider.collisionGroup) || collider.collisionGroup < 0 || collider.collisionGroup > 0xffff) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collision group must be a 16-bit mask.', path: `${path}/collisionGroup`, nodeId: node.id });
  }
  if (!Number.isInteger(collider.collisionMask) || collider.collisionMask < 0 || collider.collisionMask > 0xffff) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collision mask must be a 16-bit mask.', path: `${path}/collisionMask`, nodeId: node.id });
  }
  if ((collider.type === 'sphere' || collider.type === 'capsule' || collider.type === 'cylinder') && (!finite(collider.radius) || collider.radius <= 0)) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collider radius must be positive.', path: `${path}/radius`, nodeId: node.id });
  }
  if ((collider.type === 'capsule' || collider.type === 'cylinder') && (!finite(collider.height) || collider.height <= 0)) {
    issues.push({ code: 'collider.invalid-settings', severity: 'error', message: 'Collider height must be positive.', path: `${path}/height`, nodeId: node.id });
  }
  if (collider.type === 'mesh') {
    const asset = collider.meshAssetId ? scene.assets[collider.meshAssetId] : null;
    if (!asset || asset.kind !== 'model') {
      issues.push({ code: 'collider.asset-missing', severity: 'error', message: 'Mesh collider must reference an existing model asset.', path: `${path}/meshAssetId`, nodeId: node.id });
    }
  }
}

function validateRigidbody(node: SceneNode, index: number, issues: SceneSystemsIssue[]): void {
  const rigidbody = node.rigidbody;
  if (!rigidbody) return;
  const path = `/nodes/${index}/rigidbody`;
  if (!['static', 'dynamic', 'kinematic'].includes(rigidbody.type)) {
    issues.push({ code: 'rigidbody.invalid-settings', severity: 'error', message: 'Rigidbody type is invalid.', path: `${path}/type`, nodeId: node.id });
  }
  if (!finite(rigidbody.mass) || rigidbody.mass < 0 || (rigidbody.type === 'dynamic' && rigidbody.mass <= 0)) {
    issues.push({ code: 'rigidbody.invalid-settings', severity: 'error', message: 'Dynamic rigidbody mass must be positive.', path: `${path}/mass`, nodeId: node.id });
  }
  for (const [property, value] of [
    ['linearDamping', rigidbody.linearDamping],
    ['angularDamping', rigidbody.angularDamping],
  ] as const) {
    if (!finite(value) || value < 0 || value > 1) {
      issues.push({ code: 'rigidbody.invalid-settings', severity: 'error', message: `${property} must be between 0 and 1.`, path: `${path}/${property}`, nodeId: node.id });
    }
  }
  if (!node.collider && rigidbody.type !== 'static') {
    issues.push({ code: 'rigidbody.collider-missing', severity: 'warning', message: 'Dynamic and kinematic rigidbodies should have a collider.', path, nodeId: node.id });
  }
}

export function validateSceneSystems(scene: KyxosSceneContract): SceneSystemsIssue[] {
  const issues: SceneSystemsIssue[] = [];
  const layers = scene.editorState?.layers ?? [];
  const layerIds = new Set<string>();
  const layerNames = new Set<string>();
  layers.forEach((layer, index) => {
    const path = `/editorState/layers/${index}`;
    if (!layer.id || layerIds.has(layer.id)) {
      issues.push({ code: 'layer.duplicate-id', severity: 'error', message: 'Layer IDs must be unique and non-empty.', path: `${path}/id`, layerId: layer.id });
    }
    layerIds.add(layer.id);
    const name = layer.name.trim().toLocaleLowerCase();
    if (!name || layerNames.has(name)) {
      issues.push({ code: 'layer.duplicate-name', severity: 'error', message: 'Layer names must be unique and non-empty.', path: `${path}/name`, layerId: layer.id });
    }
    layerNames.add(name);
    validateLayer(layer, path, issues);
  });

  const groups = scene.editorState?.batchGroups ?? [];
  const groupIds = new Set<string>();
  const groupNames = new Set<string>();
  groups.forEach((group, index) => {
    const path = `/editorState/batchGroups/${index}`;
    if (!group.id || groupIds.has(group.id)) {
      issues.push({ code: 'batch.duplicate-id', severity: 'error', message: 'Batch Group IDs must be unique and non-empty.', path: `${path}/id`, batchGroupId: group.id });
    }
    groupIds.add(group.id);
    const name = group.name.trim().toLocaleLowerCase();
    if (!name || groupNames.has(name)) {
      issues.push({ code: 'batch.duplicate-name', severity: 'error', message: 'Batch Group names must be unique and non-empty.', path: `${path}/name`, batchGroupId: group.id });
    }
    groupNames.add(name);
    if (!finite(group.maxAabbSize) || group.maxAabbSize <= 0) {
      issues.push({ code: 'batch.invalid-aabb', severity: 'error', message: 'Batch Group maximum AABB size must be positive.', path: `${path}/maxAabbSize`, batchGroupId: group.id });
    }
    for (const layerId of group.layerIds) {
      if (!layerIds.has(layerId)) {
        issues.push({ code: 'batch.layer-missing', severity: 'error', message: 'Batch Group references a layer that does not exist.', path: `${path}/layerIds`, batchGroupId: group.id, layerId });
      }
    }
  });

  scene.nodes.forEach((node, index) => {
    for (const layerId of node.layerIds ?? []) {
      if (!layerIds.has(layerId)) {
        issues.push({ code: 'layer.reference-missing', severity: 'error', message: 'Node references a layer that does not exist.', path: `/nodes/${index}/layerIds`, nodeId: node.id, layerId });
      }
    }
    if (node.batchGroupId && !groupIds.has(node.batchGroupId)) {
      issues.push({ code: 'batch.reference-missing', severity: 'error', message: 'Node references a Batch Group that does not exist.', path: `/nodes/${index}/batchGroupId`, nodeId: node.id, batchGroupId: node.batchGroupId });
    }
    validateCollider(scene, node, index, issues);
    validateRigidbody(node, index, issues);
    if (node.lightmap) {
      if (!finite(node.lightmap.scaleMultiplier) || node.lightmap.scaleMultiplier <= 0 || node.lightmap.scaleMultiplier > 16) {
        issues.push({ code: 'lightmap.invalid-settings', severity: 'error', message: 'Node lightmap scale multiplier must be between 0 and 16.', path: `/nodes/${index}/lightmap/scaleMultiplier`, nodeId: node.id });
      }
    }
  });

  const lightmap = scene.editorState?.lightmapSettings;
  if (lightmap) {
    if (!finite(lightmap.resolutionMultiplier) || lightmap.resolutionMultiplier <= 0 || lightmap.resolutionMultiplier > 8) {
      issues.push({ code: 'lightmap.invalid-settings', severity: 'error', message: 'Lightmap resolution multiplier must be between 0 and 8.', path: '/editorState/lightmapSettings/resolutionMultiplier' });
    }
    if (!Number.isInteger(lightmap.maxResolution) || lightmap.maxResolution < 64 || lightmap.maxResolution > 8192) {
      issues.push({ code: 'lightmap.invalid-settings', severity: 'error', message: 'Lightmap maximum resolution must be between 64 and 8192.', path: '/editorState/lightmapSettings/maxResolution' });
    }
    if (!Number.isInteger(lightmap.padding) || lightmap.padding < 0 || lightmap.padding > 64) {
      issues.push({ code: 'lightmap.invalid-settings', severity: 'error', message: 'Lightmap padding must be between 0 and 64.', path: '/editorState/lightmapSettings/padding' });
    }
  }

  const physics = scene.editorState?.physicsSettings;
  if (physics) {
    if (!finite(physics.fixedTimeStep) || physics.fixedTimeStep <= 0 || physics.fixedTimeStep > 1) {
      issues.push({ code: 'physics.invalid-settings', severity: 'error', message: 'Physics fixed time step must be between 0 and 1 second.', path: '/editorState/physicsSettings/fixedTimeStep' });
    }
    if (!Number.isInteger(physics.maxSubSteps) || physics.maxSubSteps < 1 || physics.maxSubSteps > 32) {
      issues.push({ code: 'physics.invalid-settings', severity: 'error', message: 'Physics maximum substeps must be between 1 and 32.', path: '/editorState/physicsSettings/maxSubSteps' });
    }
  }
  return issues;
}

export function summarizeSceneSystems(scene: KyxosSceneContract): SceneSystemsSummary {
  const issues = validateSceneSystems(scene);
  return {
    layers: scene.editorState?.layers?.length ?? 0,
    batchGroups: scene.editorState?.batchGroups?.length ?? 0,
    layeredNodes: scene.nodes.filter((node) => node.layerIds?.length).length,
    batchedNodes: scene.nodes.filter((node) => Boolean(node.batchGroupId)).length,
    colliders: scene.nodes.filter((node) => Boolean(node.collider)).length,
    rigidbodies: scene.nodes.filter((node) => Boolean(node.rigidbody)).length,
    lightmappedNodes: scene.nodes.filter((node) => node.lightmap?.enabled).length,
    issues: issues.length,
  };
}

export class SceneSystemsService extends EventTarget {
  constructor(
    private readonly host: SceneSystemsCommandHost,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
  }

  ensure(): void {
    const scene = this.host.getScene();
    const next = ensureSceneSystems(scene);
    if (JSON.stringify(scene.editorState) === JSON.stringify(next.editorState)
      && JSON.stringify(scene.nodes) === JSON.stringify(next.nodes)) return;
    this.host.execute('Initialize scene systems', () => [
      {
        op: scene.editorState ? 'replace' : 'add',
        path: '/editorState',
        value: next.editorState,
      },
      { op: 'replace', path: '/nodes', value: next.nodes },
    ]);
    this.emit('change', { type: 'ensure' });
  }

  addLayer(name = 'Layer'): string {
    const id = this.createId();
    this.host.execute('Add layer', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      layers.push({
        id,
        name: uniqueName(layers.map((layer) => layer.name), normalizeName(name, 'Layer')),
        enabled: true,
        visible: true,
        order: layers.length ? Math.max(...layers.map((layer) => layer.order)) + 10 : 0,
        opaqueSortMode: 'material-mesh',
        transparentSortMode: 'back-to-front',
      });
      return this.editorStatePatch(scene, { layers });
    });
    this.emit('change', { type: 'layer:add', id });
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
    this.emit('change', { type: 'layer:update', id });
  }

  removeLayer(id: string, replacementId?: string): void {
    this.host.execute('Delete layer', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      if (layers.length <= 1) throw new Error('A scene must keep at least one layer.');
      const replacement = replacementId && replacementId !== id
        ? layers.find((layer) => layer.id === replacementId)?.id
        : layers.find((layer) => layer.id !== id)?.id;
      if (!replacement) throw new Error('A replacement layer is required.');
      const nodes = clone(scene.nodes).map((node) => ({
        ...node,
        layerIds: [...new Set((node.layerIds ?? []).map((layerId) => layerId === id ? replacement : layerId))],
      }));
      const batchGroups = clone(scene.editorState?.batchGroups ?? []).map((group) => ({
        ...group,
        layerIds: [...new Set(group.layerIds.map((layerId) => layerId === id ? replacement : layerId))],
      }));
      return [
        ...this.editorStatePatch(scene, { layers: layers.filter((layer) => layer.id !== id), batchGroups }),
        { op: 'replace', path: '/nodes', value: nodes },
      ];
    });
    this.emit('change', { type: 'layer:remove', id });
  }

  reorderLayers(ids: string[]): void {
    this.host.execute('Reorder layers', (scene) => {
      const layers = clone(scene.editorState?.layers ?? createDefaultSceneLayers());
      const byId = new Map(layers.map((layer) => [layer.id, layer]));
      if (ids.length !== layers.length || ids.some((id) => !byId.has(id)) || new Set(ids).size !== ids.length) {
        throw new Error('Layer order must contain every layer exactly once.');
      }
      const ordered = ids.map((id, index) => ({ ...byId.get(id)!, order: index * 10 }));
      return this.editorStatePatch(scene, { layers: ordered });
    });
    this.emit('change', { type: 'layer:reorder', ids: [...ids] });
  }

  assignLayers(nodeIds: Iterable<string>, layerIds: Iterable<string>): void {
    const selected = new Set(nodeIds);
    const assigned = [...new Set(layerIds)];
    this.host.execute('Assign node layers', (scene) => {
      const valid = new Set((scene.editorState?.layers ?? createDefaultSceneLayers()).map((layer) => layer.id));
      if (!assigned.length || assigned.some((id) => !valid.has(id))) throw new Error('Every assigned layer must exist.');
      return scene.nodes.flatMap((node, index) => selected.has(node.id)
        ? [{
            op: node.layerIds == null ? 'add' as const : 'replace' as const,
            path: `/nodes/${index}/layerIds`,
            value: assigned,
          }]
        : []);
    });
    this.emit('change', { type: 'node:layers', nodeIds: [...selected], layerIds: assigned });
  }

  addBatchGroup(name = 'Batch Group'): string {
    const id = this.createId();
    this.host.execute('Add Batch Group', (scene) => {
      const groups = clone(scene.editorState?.batchGroups ?? []);
      const layers = scene.editorState?.layers ?? createDefaultSceneLayers();
      groups.push({
        id,
        name: uniqueName(groups.map((group) => group.name), normalizeName(name, 'Batch Group')),
        dynamic: false,
        enabled: true,
        maxAabbSize: 100,
        layerIds: [layers[0]?.id ?? 'world'],
        castShadow: true,
        receiveShadow: true,
      });
      return this.editorStatePatch(scene, { batchGroups: groups });
    });
    this.emit('change', { type: 'batch:add', id });
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
    this.emit('change', { type: 'batch:update', id });
  }

  removeBatchGroup(id: string): void {
    this.host.execute('Delete Batch Group', (scene) => [
      ...this.editorStatePatch(scene, {
        batchGroups: (scene.editorState?.batchGroups ?? []).filter((group) => group.id !== id),
      }),
      ...scene.nodes.flatMap((node, index) => node.batchGroupId === id
        ? [{ op: 'replace' as const, path: `/nodes/${index}/batchGroupId`, value: null }]
        : []),
    ]);
    this.emit('change', { type: 'batch:remove', id });
  }

  assignBatchGroup(nodeIds: Iterable<string>, groupId: string | null): void {
    const selected = new Set(nodeIds);
    this.host.execute('Assign Batch Group', (scene) => {
      if (groupId && !(scene.editorState?.batchGroups ?? []).some((group) => group.id === groupId)) {
        throw new Error('Batch Group not found.');
      }
      return scene.nodes.flatMap((node, index) => selected.has(node.id)
        ? [{
            op: node.batchGroupId === undefined ? 'add' as const : 'replace' as const,
            path: `/nodes/${index}/batchGroupId`,
            value: groupId,
          }]
        : []);
    });
    this.emit('change', { type: 'node:batch', nodeIds: [...selected], groupId });
  }

  setCollider(nodeIds: Iterable<string>, collider: SceneColliderComponent | null): void {
    this.setNodeComponent('collider', nodeIds, collider, 'Set Collider');
  }

  setRigidbody(nodeIds: Iterable<string>, rigidbody: SceneRigidbodyComponent | null): void {
    this.setNodeComponent('rigidbody', nodeIds, rigidbody, 'Set Rigidbody');
  }

  setNodeLightmap(nodeIds: Iterable<string>, lightmap: SceneLightmapNodeSettings | null): void {
    this.setNodeComponent('lightmap', nodeIds, lightmap, 'Set Node Lightmap');
  }

  setLightmapSettings(settings: Partial<SceneLightmapSettings>): void {
    this.host.execute('Edit Lightmap Settings', (scene) => {
      const value = { ...(scene.editorState?.lightmapSettings ?? createDefaultLightmapSettings()), ...clone(settings) };
      return this.editorStatePatch(scene, { lightmapSettings: value });
    }, 'scene:lightmap-settings');
    this.emit('change', { type: 'lightmap:settings' });
  }

  setPhysicsSettings(settings: Partial<ScenePhysicsSettings>): void {
    this.host.execute('Edit Physics Settings', (scene) => {
      const value = { ...(scene.editorState?.physicsSettings ?? createDefaultPhysicsSettings()), ...clone(settings) };
      if (settings.gravity) value.gravity = normalizeVec3(settings.gravity, value.gravity);
      return this.editorStatePatch(scene, { physicsSettings: value });
    }, 'scene:physics-settings');
    this.emit('change', { type: 'physics:settings' });
  }

  private setNodeComponent<K extends 'collider' | 'rigidbody' | 'lightmap'>(
    key: K,
    nodeIds: Iterable<string>,
    value: SceneNode[K] | null,
    label: string,
  ): void {
    const selected = new Set(nodeIds);
    this.host.execute(label, (scene) => scene.nodes.flatMap((node, index) => {
      if (!selected.has(node.id)) return [];
      if (value == null) return node[key] == null ? [] : [{ op: 'remove' as const, path: `/nodes/${index}/${key}` }];
      return [{
        op: node[key] == null ? 'add' as const : 'replace' as const,
        path: `/nodes/${index}/${key}`,
        value: clone(value),
      }];
    }));
    this.emit('change', { type: `node:${key}`, nodeIds: [...selected] });
  }

  private editorStatePatch(
    scene: KyxosSceneContract,
    changes: Partial<NonNullable<KyxosSceneContract['editorState']>>,
  ): ScenePatch {
    const value = { ...(scene.editorState ?? {}), ...clone(changes) };
    return [{
      op: scene.editorState ? 'replace' : 'add',
      path: '/editorState',
      value,
    }];
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}

export function effectiveNodeLayers(
  scene: KyxosSceneContract,
  node: SceneNode,
): SceneLayerDefinition[] {
  const layers = scene.editorState?.layers ?? createDefaultSceneLayers();
  const ids = node.layerIds?.length ? new Set(node.layerIds) : new Set([layers[0]?.id]);
  return layers
    .filter((layer) => ids.has(layer.id) && layer.enabled)
    .sort((left, right) => left.order - right.order);
}

export function batchGroupMembers(
  scene: KyxosSceneContract,
  groupId: string,
): SceneNode[] {
  return scene.nodes.filter((node) => node.batchGroupId === groupId).map(clone);
}

export function collisionPairsEnabled(
  left: SceneColliderComponent,
  right: SceneColliderComponent,
): boolean {
  return (left.collisionMask & right.collisionGroup) !== 0
    && (right.collisionMask & left.collisionGroup) !== 0;
}
