import type {
  KyxosSceneContract,
  SceneNode,
  ScenePatch,
  SceneTemplateInstance,
} from '@kyxos/scene-contract';

export type TemplateNodeProperties = Omit<
  SceneNode,
  'id' | 'parentId' | 'children' | 'template'
>;

export interface SceneTemplateNodeSnapshot {
  sourceNodeId: string;
  parentSourceNodeId: string | null;
  childSourceNodeIds: string[];
  properties: TemplateNodeProperties;
}

export interface SceneTemplateDefinition {
  id: string;
  name: string;
  version: number;
  rootSourceNodeId: string;
  nodes: SceneTemplateNodeSnapshot[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SceneTemplateInstanceRecord {
  instanceId: string;
  templateId: string;
  rootNodeId: string;
  templateVersion: number;
  baseNodes: SceneTemplateNodeSnapshot[];
  createdAt: string;
  updatedAt: string;
}

declare module '@kyxos/scene-contract' {
  interface SceneEditorState {
    templates?: SceneTemplateDefinition[];
    templateInstances?: SceneTemplateInstanceRecord[];
  }
}

export type TemplateConflictKind =
  | 'template-missing'
  | 'instance-root-missing'
  | 'instance-node-missing'
  | 'template-node-added'
  | 'template-node-deleted'
  | 'value-conflict'
  | 'hierarchy-conflict'
  | 'duplicate-source-binding';

export interface TemplateConflict {
  id: string;
  kind: TemplateConflictKind;
  instanceId: string;
  templateId: string;
  sourceNodeId?: string;
  nodeId?: string;
  path?: string;
  baseValue?: unknown;
  templateValue?: unknown;
  instanceValue?: unknown;
  message: string;
  blocking: boolean;
}

export type TemplateConflictResolution = 'template' | 'instance' | 'unlink';
export type TemplateConflictResolutionMap = Record<string, TemplateConflictResolution>;

export interface TemplateOverride {
  sourceNodeId: string;
  nodeId: string;
  path: string;
  baseValue: unknown;
  instanceValue: unknown;
}

export interface TemplateValidationIssue {
  code:
    | 'template.duplicate-id'
    | 'template.duplicate-name'
    | 'template.invalid-version'
    | 'template.root-missing'
    | 'template.source-duplicate'
    | 'template.parent-missing'
    | 'template.child-missing'
    | 'template.hierarchy-mismatch'
    | 'instance.duplicate-id'
    | 'instance.template-missing'
    | 'instance.root-missing'
    | 'instance.binding-duplicate'
    | 'instance.binding-template-mismatch';
  path: string;
  message: string;
  severity: 'error' | 'warning';
  templateId?: string;
  instanceId?: string;
  nodeId?: string;
}

export interface TemplateRepairAction {
  code:
    | 'drop-duplicate-template'
    | 'drop-duplicate-instance-record'
    | 'unlink-missing-template'
    | 'create-missing-instance-record'
    | 'repair-instance-root'
    | 'unlink-duplicate-source';
  message: string;
  templateId?: string;
  instanceId?: string;
  nodeId?: string;
}

export interface TemplateRepairResult {
  scene: KyxosSceneContract;
  actions: TemplateRepairAction[];
}

export interface TemplateCommandHost {
  getScene(): KyxosSceneContract;
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

const PROPERTY_PATHS = [
  '/name',
  '/transform',
  '/visible',
  '/locked',
  '/meshAssetId',
  '/meshIndex',
  '/materialSlots',
  '/cameraId',
  '/lightId',
  '/animationIds',
  '/skin',
  '/morphWeights',
  '/morphTargetNames',
  '/materialVariantBindings',
  '/metadata',
] as const;

const HIERARCHY_PATHS = ['/parentSourceNodeId', '/childSourceNodeIds'] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function cleanName(value: string, fallback: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || fallback;
}

function uniqueName(values: Iterable<string>, base: string): string {
  const names = new Set([...values].map((value) => value.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function editorState(scene: KyxosSceneContract): NonNullable<KyxosSceneContract['editorState']> {
  return clone(scene.editorState ?? {});
}

function replaceAuthoringState(
  scene: KyxosSceneContract,
  nodes: SceneNode[],
  state: NonNullable<KyxosSceneContract['editorState']>,
): ScenePatch {
  return [
    { op: 'replace', path: '/nodes', value: nodes },
    { op: scene.editorState ? 'replace' : 'add', path: '/editorState', value: state },
  ];
}

function snapshotProperties(node: SceneNode): TemplateNodeProperties {
  const {
    id: _id,
    parentId: _parentId,
    children: _children,
    template: _template,
    ...properties
  } = node;
  return clone(properties);
}

function snapshotValue(snapshot: SceneTemplateNodeSnapshot | undefined, path: string): unknown {
  if (!snapshot) return undefined;
  if (path === '/parentSourceNodeId') return snapshot.parentSourceNodeId;
  if (path === '/childSourceNodeIds') return snapshot.childSourceNodeIds;
  return clone((snapshot.properties as Record<string, unknown>)[path.slice(1)]);
}

function setSnapshotValue(snapshot: SceneTemplateNodeSnapshot, path: string, value: unknown): void {
  if (path === '/parentSourceNodeId') {
    snapshot.parentSourceNodeId = value == null ? null : String(value);
    return;
  }
  if (path === '/childSourceNodeIds') {
    snapshot.childSourceNodeIds = Array.isArray(value) ? value.map(String) : [];
    return;
  }
  const key = path.slice(1) as keyof TemplateNodeProperties;
  if (value === undefined) delete snapshot.properties[key];
  else snapshot.properties[key] = clone(value) as never;
}

function templateNodesById(nodes: SceneTemplateNodeSnapshot[]): Map<string, SceneTemplateNodeSnapshot> {
  return new Map(nodes.map((node) => [node.sourceNodeId, node]));
}

function instanceBindings(scene: KyxosSceneContract, instanceId: string): SceneNode[] {
  return scene.nodes.filter((node) => node.template?.instanceId === instanceId);
}

function instanceNodeMaps(scene: KyxosSceneContract, instanceId: string): {
  bySource: Map<string, SceneNode>;
  duplicates: SceneNode[];
} {
  const bySource = new Map<string, SceneNode>();
  const duplicates: SceneNode[] = [];
  for (const node of instanceBindings(scene, instanceId)) {
    const sourceId = node.template!.sourceNodeId;
    if (bySource.has(sourceId)) duplicates.push(node);
    else bySource.set(sourceId, node);
  }
  return { bySource, duplicates };
}

function instanceSnapshot(
  scene: KyxosSceneContract,
  instanceId: string,
  node: SceneNode,
): SceneTemplateNodeSnapshot {
  const parent = node.parentId ? scene.nodes.find((entry) => entry.id === node.parentId) : undefined;
  const parentSourceNodeId = parent?.template?.instanceId === instanceId
    ? parent.template.sourceNodeId
    : null;
  const childSourceNodeIds = node.children
    .map((id) => scene.nodes.find((entry) => entry.id === id))
    .filter((entry): entry is SceneNode => Boolean(entry?.template?.instanceId === instanceId))
    .map((entry) => entry.template!.sourceNodeId);
  return {
    sourceNodeId: node.template!.sourceNodeId,
    parentSourceNodeId,
    childSourceNodeIds,
    properties: snapshotProperties(node),
  };
}

function subtree(scene: KyxosSceneContract, rootNodeId: string): SceneNode[] {
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const root = byId.get(rootNodeId);
  if (!root) throw new Error('Template root node not found.');
  const result: SceneNode[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: SceneNode): void => {
    if (visiting.has(node.id)) throw new Error('Cannot capture a hierarchy cycle as a template.');
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    result.push(node);
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child) visit(child);
    }
    visiting.delete(node.id);
    visited.add(node.id);
  };
  visit(root);
  return result;
}

export function captureTemplateDefinition(
  scene: KyxosSceneContract,
  rootNodeId: string,
  options: {
    id: string;
    name?: string;
    version?: number;
    createdAt?: string;
    metadata?: Record<string, unknown>;
  },
): SceneTemplateDefinition {
  const nodes = subtree(scene, rootNodeId);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const sourceByNode = new Map<string, string>();
  const usedSources = new Set<string>();
  for (const node of nodes) {
    const candidate = node.template?.sourceNodeId || node.id;
    let sourceId = candidate;
    let suffix = 2;
    while (usedSources.has(sourceId)) sourceId = `${candidate}-${suffix++}`;
    usedSources.add(sourceId);
    sourceByNode.set(node.id, sourceId);
  }
  const now = new Date().toISOString();
  const snapshots = nodes.map((node) => ({
    sourceNodeId: sourceByNode.get(node.id)!,
    parentSourceNodeId: node.parentId && nodeIds.has(node.parentId)
      ? sourceByNode.get(node.parentId) ?? null
      : null,
    childSourceNodeIds: node.children
      .filter((id) => nodeIds.has(id))
      .map((id) => sourceByNode.get(id)!),
    properties: snapshotProperties(node),
  }));
  return {
    id: options.id,
    name: cleanName(options.name ?? scene.nodes.find((node) => node.id === rootNodeId)?.name ?? 'Template', 'Template'),
    version: Math.max(1, Math.round(options.version ?? 1)),
    rootSourceNodeId: sourceByNode.get(rootNodeId)!,
    nodes: snapshots,
    createdAt: options.createdAt ?? now,
    updatedAt: now,
    metadata: options.metadata ? clone(options.metadata) : undefined,
  };
}

export function computeTemplateOverrides(
  scene: KyxosSceneContract,
  instanceId: string,
): TemplateOverride[] {
  const record = scene.editorState?.templateInstances?.find((entry) => entry.instanceId === instanceId);
  if (!record) return [];
  const base = templateNodesById(record.baseNodes);
  const { bySource } = instanceNodeMaps(scene, instanceId);
  const overrides: TemplateOverride[] = [];
  for (const [sourceNodeId, node] of bySource) {
    const current = instanceSnapshot(scene, instanceId, node);
    const baseNode = base.get(sourceNodeId);
    if (!baseNode) continue;
    for (const path of [...PROPERTY_PATHS, ...HIERARCHY_PATHS]) {
      const baseValue = snapshotValue(baseNode, path);
      const instanceValue = snapshotValue(current, path);
      if (!equal(baseValue, instanceValue)) {
        overrides.push({
          sourceNodeId,
          nodeId: node.id,
          path,
          baseValue: clone(baseValue),
          instanceValue: clone(instanceValue),
        });
      }
    }
  }
  return overrides.sort((left, right) =>
    left.sourceNodeId.localeCompare(right.sourceNodeId) || left.path.localeCompare(right.path));
}

function conflictId(instanceId: string, kind: TemplateConflictKind, sourceNodeId = '', path = ''): string {
  return `${instanceId}:${kind}:${sourceNodeId}:${path}`;
}

export function findTemplateConflicts(
  scene: KyxosSceneContract,
  instanceId: string,
): TemplateConflict[] {
  const record = scene.editorState?.templateInstances?.find((entry) => entry.instanceId === instanceId);
  if (!record) return [];
  const template = scene.editorState?.templates?.find((entry) => entry.id === record.templateId);
  if (!template) {
    return [{
      id: conflictId(instanceId, 'template-missing'),
      kind: 'template-missing',
      instanceId,
      templateId: record.templateId,
      message: 'The source template no longer exists.',
      blocking: true,
    }];
  }
  if (!scene.nodes.some((node) => node.id === record.rootNodeId)) {
    return [{
      id: conflictId(instanceId, 'instance-root-missing'),
      kind: 'instance-root-missing',
      instanceId,
      templateId: template.id,
      message: 'The recorded instance root no longer exists.',
      blocking: true,
    }];
  }

  const base = templateNodesById(record.baseNodes);
  const currentTemplate = templateNodesById(template.nodes);
  const { bySource, duplicates } = instanceNodeMaps(scene, instanceId);
  const conflicts: TemplateConflict[] = duplicates.map((node) => ({
    id: conflictId(instanceId, 'duplicate-source-binding', node.template!.sourceNodeId, node.id),
    kind: 'duplicate-source-binding',
    instanceId,
    templateId: template.id,
    sourceNodeId: node.template!.sourceNodeId,
    nodeId: node.id,
    message: `More than one instance node is bound to source ${node.template!.sourceNodeId}.`,
    blocking: true,
  }));
  const sourceIds = new Set([...base.keys(), ...currentTemplate.keys(), ...bySource.keys()]);
  for (const sourceNodeId of sourceIds) {
    const baseNode = base.get(sourceNodeId);
    const templateNode = currentTemplate.get(sourceNodeId);
    const instanceNode = bySource.get(sourceNodeId);
    if (!templateNode && instanceNode) {
      conflicts.push({
        id: conflictId(instanceId, 'template-node-deleted', sourceNodeId),
        kind: 'template-node-deleted',
        instanceId,
        templateId: template.id,
        sourceNodeId,
        nodeId: instanceNode.id,
        message: 'The template deleted this node while the instance still contains it.',
        blocking: true,
      });
      continue;
    }
    if (templateNode && !instanceNode && baseNode) {
      conflicts.push({
        id: conflictId(instanceId, 'instance-node-missing', sourceNodeId),
        kind: 'instance-node-missing',
        instanceId,
        templateId: template.id,
        sourceNodeId,
        message: 'The instance deleted a node that still exists in the template.',
        blocking: true,
      });
      continue;
    }
    if (templateNode && !instanceNode && !baseNode) {
      conflicts.push({
        id: conflictId(instanceId, 'template-node-added', sourceNodeId),
        kind: 'template-node-added',
        instanceId,
        templateId: template.id,
        sourceNodeId,
        message: 'The template added a new node.',
        blocking: false,
      });
      continue;
    }
    if (!templateNode || !instanceNode || !baseNode) continue;
    const instanceState = instanceSnapshot(scene, instanceId, instanceNode);
    for (const path of [...PROPERTY_PATHS, ...HIERARCHY_PATHS]) {
      const baseValue = snapshotValue(baseNode, path);
      const templateValue = snapshotValue(templateNode, path);
      const instanceValue = snapshotValue(instanceState, path);
      const templateChanged = !equal(baseValue, templateValue);
      const instanceChanged = !equal(baseValue, instanceValue);
      if (templateChanged && instanceChanged && !equal(templateValue, instanceValue)) {
        const hierarchy = HIERARCHY_PATHS.includes(path as never);
        conflicts.push({
          id: conflictId(instanceId, hierarchy ? 'hierarchy-conflict' : 'value-conflict', sourceNodeId, path),
          kind: hierarchy ? 'hierarchy-conflict' : 'value-conflict',
          instanceId,
          templateId: template.id,
          sourceNodeId,
          nodeId: instanceNode.id,
          path,
          baseValue: clone(baseValue),
          templateValue: clone(templateValue),
          instanceValue: clone(instanceValue),
          message: `Template and instance both changed ${path.slice(1)}.`,
          blocking: true,
        });
      }
    }
  }
  return conflicts.sort((left, right) => left.id.localeCompare(right.id));
}

function createNodeFromSnapshot(
  snapshot: SceneTemplateNodeSnapshot,
  nodeId: string,
  parentId: string | null,
  childIds: string[],
  binding: SceneTemplateInstance,
): SceneNode {
  return {
    id: nodeId,
    parentId,
    children: childIds,
    ...clone(snapshot.properties),
    template: clone(binding),
  };
}

export function instantiateTemplate(
  scene: KyxosSceneContract,
  templateId: string,
  options: {
    instanceId: string;
    parentId?: string | null;
    nodeIdForSource: (sourceNodeId: string) => string;
    now?: string;
  },
): { scene: KyxosSceneContract; rootNodeId: string; record: SceneTemplateInstanceRecord } {
  const template = scene.editorState?.templates?.find((entry) => entry.id === templateId);
  if (!template) throw new Error('Template not found.');
  if (scene.editorState?.templateInstances?.some((entry) => entry.instanceId === options.instanceId)) {
    throw new Error('Template instance ID already exists.');
  }
  const idBySource = new Map(template.nodes.map((node) => [node.sourceNodeId, options.nodeIdForSource(node.sourceNodeId)]));
  if (new Set(idBySource.values()).size !== idBySource.size) throw new Error('Generated instance node IDs must be unique.');
  const rootNodeId = idBySource.get(template.rootSourceNodeId);
  if (!rootNodeId) throw new Error('Template root source node is missing.');
  const nodes = clone(scene.nodes);
  const parentId = options.parentId ?? null;
  if (parentId && !nodes.some((node) => node.id === parentId)) throw new Error('Instance parent node not found.');
  for (const snapshot of template.nodes) {
    const nodeId = idBySource.get(snapshot.sourceNodeId)!;
    const internalParent = snapshot.parentSourceNodeId ? idBySource.get(snapshot.parentSourceNodeId) ?? null : null;
    const resolvedParent = snapshot.sourceNodeId === template.rootSourceNodeId ? parentId : internalParent;
    const childIds = snapshot.childSourceNodeIds.map((sourceId) => idBySource.get(sourceId)).filter((id): id is string => Boolean(id));
    nodes.push(createNodeFromSnapshot(snapshot, nodeId, resolvedParent, childIds, {
      templateId: template.id,
      instanceId: options.instanceId,
      sourceNodeId: snapshot.sourceNodeId,
      overrides: [],
    }));
  }
  if (parentId) {
    const parent = nodes.find((node) => node.id === parentId)!;
    if (!parent.children.includes(rootNodeId)) parent.children.push(rootNodeId);
  }
  const now = options.now ?? new Date().toISOString();
  const record: SceneTemplateInstanceRecord = {
    instanceId: options.instanceId,
    templateId: template.id,
    rootNodeId,
    templateVersion: template.version,
    baseNodes: clone(template.nodes),
    createdAt: now,
    updatedAt: now,
  };
  const state = editorState(scene);
  state.templateInstances = [...(state.templateInstances ?? []), record];
  return { scene: { ...clone(scene), nodes, editorState: state }, rootNodeId, record };
}

function applyProperties(node: SceneNode, snapshot: SceneTemplateNodeSnapshot): void {
  const binding = node.template;
  const id = node.id;
  const parentId = node.parentId;
  const children = node.children;
  Object.assign(node, clone(snapshot.properties));
  node.id = id;
  node.parentId = parentId;
  node.children = children;
  node.template = binding;
}

export function applyTemplateUpdate(
  scene: KyxosSceneContract,
  instanceId: string,
  resolutions: TemplateConflictResolutionMap = {},
  createNodeId: (sourceNodeId: string) => string = (sourceNodeId) => crypto.randomUUID() || sourceNodeId,
): KyxosSceneContract {
  const next = clone(scene);
  const state = editorState(next);
  const record = state.templateInstances?.find((entry) => entry.instanceId === instanceId);
  if (!record) throw new Error('Template instance record not found.');
  const template = state.templates?.find((entry) => entry.id === record.templateId);
  if (!template) throw new Error('Template not found.');
  const conflicts = findTemplateConflicts(next, instanceId);
  const unresolved = conflicts.filter((conflict) => conflict.blocking && !resolutions[conflict.id]);
  if (unresolved.length) throw new Error(`Resolve ${unresolved.length} template conflicts before applying.`);

  const base = templateNodesById(record.baseNodes);
  const templateBySource = templateNodesById(template.nodes);
  const { bySource, duplicates } = instanceNodeMaps(next, instanceId);
  for (const duplicate of duplicates) {
    const conflict = conflicts.find((entry) => entry.kind === 'duplicate-source-binding' && entry.nodeId === duplicate.id);
    const resolution = conflict ? resolutions[conflict.id] : undefined;
    if (resolution === 'unlink') duplicate.template = undefined;
    else throw new Error('Duplicate source bindings must be unlinked before applying.');
  }

  const idBySource = new Map([...bySource].map(([sourceId, node]) => [sourceId, node.id]));
  for (const sourceId of templateBySource.keys()) {
    if (!idBySource.has(sourceId)) idBySource.set(sourceId, createNodeId(sourceId));
  }
  if (new Set(idBySource.values()).size !== idBySource.size) throw new Error('Generated node IDs must be unique.');

  for (const [sourceId, templateNode] of templateBySource) {
    let node = bySource.get(sourceId);
    if (!node) {
      const missingConflict = conflicts.find((entry) => entry.sourceNodeId === sourceId && entry.kind === 'instance-node-missing');
      if (missingConflict && resolutions[missingConflict.id] === 'instance') continue;
      const nodeId = idBySource.get(sourceId)!;
      node = createNodeFromSnapshot(templateNode, nodeId, null, [], {
        templateId: template.id,
        instanceId,
        sourceNodeId: sourceId,
        overrides: [],
      });
      next.nodes.push(node);
      bySource.set(sourceId, node);
    }
    const baseNode = base.get(sourceId);
    const currentInstance = instanceSnapshot(next, instanceId, node);
    const merged = clone(templateNode);
    if (baseNode) {
      for (const path of [...PROPERTY_PATHS, ...HIERARCHY_PATHS]) {
        const baseValue = snapshotValue(baseNode, path);
        const templateValue = snapshotValue(templateNode, path);
        const instanceValue = snapshotValue(currentInstance, path);
        const localChanged = !equal(baseValue, instanceValue);
        if (!localChanged) continue;
        const conflict = conflicts.find((entry) => entry.sourceNodeId === sourceId && entry.path === path);
        const resolution = conflict ? resolutions[conflict.id] : 'instance';
        if (resolution === 'instance') setSnapshotValue(merged, path, instanceValue);
      }
    }
    applyProperties(node, merged);
  }

  for (const [sourceId, node] of bySource) {
    if (templateBySource.has(sourceId)) continue;
    const conflict = conflicts.find((entry) => entry.kind === 'template-node-deleted' && entry.sourceNodeId === sourceId);
    const resolution = conflict ? resolutions[conflict.id] : undefined;
    if (resolution === 'unlink' || resolution === 'instance') node.template = undefined;
    else if (resolution === 'template') {
      const parent = node.parentId ? next.nodes.find((entry) => entry.id === node.parentId) : undefined;
      if (parent) parent.children = parent.children.filter((id) => id !== node.id);
      next.nodes = next.nodes.filter((entry) => entry.id !== node.id);
    }
  }

  const liveBySource = instanceNodeMaps(next, instanceId).bySource;
  for (const [sourceId, node] of liveBySource) {
    const templateNode = templateBySource.get(sourceId);
    if (!templateNode) continue;
    const parentId = templateNode.parentSourceNodeId
      ? liveBySource.get(templateNode.parentSourceNodeId)?.id ?? null
      : (sourceId === template.rootSourceNodeId
          ? next.nodes.find((entry) => entry.id === record.rootNodeId)?.parentId ?? null
          : null);
    node.parentId = parentId;
    node.children = templateNode.childSourceNodeIds
      .map((childSourceId) => liveBySource.get(childSourceId)?.id)
      .filter((id): id is string => Boolean(id));
  }

  const overrides = computeTemplateOverrides(next, instanceId);
  const pathsBySource = new Map<string, string[]>();
  for (const override of overrides) {
    const paths = pathsBySource.get(override.sourceNodeId) ?? [];
    paths.push(override.path);
    pathsBySource.set(override.sourceNodeId, paths);
  }
  for (const [sourceId, node] of liveBySource) {
    if (node.template) node.template.overrides = pathsBySource.get(sourceId) ?? [];
  }
  record.templateVersion = template.version;
  record.baseNodes = clone(template.nodes);
  record.updatedAt = new Date().toISOString();
  next.editorState = state;
  return next;
}

export function revertTemplateOverrides(
  scene: KyxosSceneContract,
  instanceId: string,
  paths?: Iterable<string>,
): KyxosSceneContract {
  const next = clone(scene);
  const record = next.editorState?.templateInstances?.find((entry) => entry.instanceId === instanceId);
  const template = record && next.editorState?.templates?.find((entry) => entry.id === record.templateId);
  if (!record || !template) throw new Error('Template instance or template not found.');
  const selected = paths ? new Set(paths) : null;
  const templateBySource = templateNodesById(template.nodes);
  const { bySource } = instanceNodeMaps(next, instanceId);
  for (const [sourceId, node] of bySource) {
    const templateNode = templateBySource.get(sourceId);
    if (!templateNode) continue;
    const current = instanceSnapshot(next, instanceId, node);
    for (const path of [...PROPERTY_PATHS, ...HIERARCHY_PATHS]) {
      const key = `${sourceId}${path}`;
      if (selected && !selected.has(key) && !selected.has(path)) continue;
      setSnapshotValue(current, path, snapshotValue(templateNode, path));
    }
    applyProperties(node, current);
  }
  return applyTemplateUpdate(next, instanceId, {}, (sourceId) => `${instanceId}-${sourceId}`);
}

export function unlinkTemplateInstance(scene: KyxosSceneContract, instanceId: string): KyxosSceneContract {
  const next = clone(scene);
  for (const node of next.nodes) {
    if (node.template?.instanceId === instanceId) node.template = undefined;
  }
  if (next.editorState?.templateInstances) {
    next.editorState.templateInstances = next.editorState.templateInstances.filter((entry) => entry.instanceId !== instanceId);
  }
  return next;
}

export function validateTemplateState(scene: KyxosSceneContract): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  const templates = scene.editorState?.templates ?? [];
  const templateIds = new Set<string>();
  const templateNames = new Set<string>();
  templates.forEach((template, index) => {
    const path = `/editorState/templates/${index}`;
    if (!template.id || templateIds.has(template.id)) issues.push({ code: 'template.duplicate-id', path: `${path}/id`, message: 'Template IDs must be unique.', severity: 'error', templateId: template.id });
    templateIds.add(template.id);
    const name = template.name.trim().toLocaleLowerCase();
    if (!name || templateNames.has(name)) issues.push({ code: 'template.duplicate-name', path: `${path}/name`, message: 'Template names must be unique.', severity: 'error', templateId: template.id });
    templateNames.add(name);
    if (!Number.isInteger(template.version) || template.version < 1) issues.push({ code: 'template.invalid-version', path: `${path}/version`, message: 'Template version must be a positive integer.', severity: 'error', templateId: template.id });
    const bySource = templateNodesById(template.nodes);
    if (!bySource.has(template.rootSourceNodeId)) issues.push({ code: 'template.root-missing', path: `${path}/rootSourceNodeId`, message: 'Template root source node is missing.', severity: 'error', templateId: template.id });
    if (bySource.size !== template.nodes.length) issues.push({ code: 'template.source-duplicate', path: `${path}/nodes`, message: 'Template source node IDs must be unique.', severity: 'error', templateId: template.id });
    template.nodes.forEach((node, nodeIndex) => {
      if (node.parentSourceNodeId && !bySource.has(node.parentSourceNodeId)) issues.push({ code: 'template.parent-missing', path: `${path}/nodes/${nodeIndex}/parentSourceNodeId`, message: 'Template node parent is missing.', severity: 'error', templateId: template.id });
      for (const childId of node.childSourceNodeIds) {
        const child = bySource.get(childId);
        if (!child) issues.push({ code: 'template.child-missing', path: `${path}/nodes/${nodeIndex}/childSourceNodeIds`, message: 'Template node child is missing.', severity: 'error', templateId: template.id });
        else if (child.parentSourceNodeId !== node.sourceNodeId) issues.push({ code: 'template.hierarchy-mismatch', path: `${path}/nodes/${nodeIndex}/childSourceNodeIds`, message: 'Template parent and child hierarchy disagree.', severity: 'error', templateId: template.id });
      }
    });
  });

  const records = scene.editorState?.templateInstances ?? [];
  const instanceIds = new Set<string>();
  records.forEach((record, index) => {
    const path = `/editorState/templateInstances/${index}`;
    if (!record.instanceId || instanceIds.has(record.instanceId)) issues.push({ code: 'instance.duplicate-id', path: `${path}/instanceId`, message: 'Template instance IDs must be unique.', severity: 'error', instanceId: record.instanceId });
    instanceIds.add(record.instanceId);
    if (!templateIds.has(record.templateId)) issues.push({ code: 'instance.template-missing', path: `${path}/templateId`, message: 'Template instance source is missing.', severity: 'error', instanceId: record.instanceId, templateId: record.templateId });
    if (!scene.nodes.some((node) => node.id === record.rootNodeId)) issues.push({ code: 'instance.root-missing', path: `${path}/rootNodeId`, message: 'Template instance root is missing.', severity: 'error', instanceId: record.instanceId });
    const bound = instanceBindings(scene, record.instanceId);
    const sources = new Set<string>();
    for (const node of bound) {
      if (sources.has(node.template!.sourceNodeId)) issues.push({ code: 'instance.binding-duplicate', path: `/nodes/${scene.nodes.indexOf(node)}/template/sourceNodeId`, message: 'Instance source binding is duplicated.', severity: 'error', instanceId: record.instanceId, nodeId: node.id });
      sources.add(node.template!.sourceNodeId);
      if (node.template!.templateId !== record.templateId) issues.push({ code: 'instance.binding-template-mismatch', path: `/nodes/${scene.nodes.indexOf(node)}/template/templateId`, message: 'Node binding template does not match the instance record.', severity: 'error', instanceId: record.instanceId, nodeId: node.id });
    }
  });
  return issues;
}

export function repairCorruptedTemplateInstances(scene: KyxosSceneContract): TemplateRepairResult {
  const next = clone(scene);
  const actions: TemplateRepairAction[] = [];
  const state = editorState(next);
  const uniqueTemplates: SceneTemplateDefinition[] = [];
  const templateIds = new Set<string>();
  for (const template of state.templates ?? []) {
    if (templateIds.has(template.id)) {
      actions.push({ code: 'drop-duplicate-template', templateId: template.id, message: `Dropped duplicate template ${template.id}.` });
      continue;
    }
    templateIds.add(template.id);
    uniqueTemplates.push(template);
  }
  state.templates = uniqueTemplates;

  const uniqueRecords: SceneTemplateInstanceRecord[] = [];
  const recordIds = new Set<string>();
  for (const record of state.templateInstances ?? []) {
    if (recordIds.has(record.instanceId)) {
      actions.push({ code: 'drop-duplicate-instance-record', instanceId: record.instanceId, message: `Dropped duplicate instance record ${record.instanceId}.` });
      continue;
    }
    recordIds.add(record.instanceId);
    if (!templateIds.has(record.templateId)) {
      for (const node of next.nodes) if (node.template?.instanceId === record.instanceId) node.template = undefined;
      actions.push({ code: 'unlink-missing-template', instanceId: record.instanceId, templateId: record.templateId, message: `Unlinked instance ${record.instanceId} because its template is missing.` });
      continue;
    }
    const bindings = instanceBindings(next, record.instanceId);
    if (!next.nodes.some((node) => node.id === record.rootNodeId)) {
      const inferred = bindings.find((node) => {
        const parent = node.parentId ? next.nodes.find((entry) => entry.id === node.parentId) : undefined;
        return parent?.template?.instanceId !== record.instanceId;
      });
      if (inferred) {
        record.rootNodeId = inferred.id;
        actions.push({ code: 'repair-instance-root', instanceId: record.instanceId, nodeId: inferred.id, message: `Repaired root for instance ${record.instanceId}.` });
      }
    }
    const sources = new Set<string>();
    for (const node of bindings) {
      if (sources.has(node.template!.sourceNodeId)) {
        node.template = undefined;
        actions.push({ code: 'unlink-duplicate-source', instanceId: record.instanceId, nodeId: node.id, message: `Unlinked duplicate source binding on ${node.id}.` });
      } else sources.add(node.template!.sourceNodeId);
    }
    uniqueRecords.push(record);
  }

  const knownInstances = new Set(uniqueRecords.map((record) => record.instanceId));
  const grouped = new Map<string, SceneNode[]>();
  for (const node of next.nodes) {
    if (!node.template || knownInstances.has(node.template.instanceId)) continue;
    const group = grouped.get(node.template.instanceId) ?? [];
    group.push(node);
    grouped.set(node.template.instanceId, group);
  }
  for (const [instanceId, bindings] of grouped) {
    const templateId = bindings[0].template!.templateId;
    const template = uniqueTemplates.find((entry) => entry.id === templateId);
    if (!template) {
      for (const node of bindings) node.template = undefined;
      actions.push({ code: 'unlink-missing-template', instanceId, templateId, message: `Unlinked orphan bindings for missing template ${templateId}.` });
      continue;
    }
    const root = bindings.find((node) => {
      const parent = node.parentId ? next.nodes.find((entry) => entry.id === node.parentId) : undefined;
      return parent?.template?.instanceId !== instanceId;
    }) ?? bindings[0];
    const now = new Date().toISOString();
    uniqueRecords.push({
      instanceId,
      templateId,
      rootNodeId: root.id,
      templateVersion: template.version,
      baseNodes: clone(template.nodes),
      createdAt: now,
      updatedAt: now,
    });
    actions.push({ code: 'create-missing-instance-record', instanceId, templateId, nodeId: root.id, message: `Created missing instance record ${instanceId}.` });
  }
  state.templateInstances = uniqueRecords;
  next.editorState = state;
  return { scene: next, actions };
}

export class TemplatePipelineService extends EventTarget {
  constructor(
    private readonly host: TemplateCommandHost,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
  }

  createTemplate(rootNodeId: string, name?: string): string {
    const scene = this.host.getScene();
    const templateId = this.createId();
    const existingNames = scene.editorState?.templates?.map((entry) => entry.name) ?? [];
    const template = captureTemplateDefinition(scene, rootNodeId, {
      id: templateId,
      name: uniqueName(existingNames, cleanName(name ?? 'Template', 'Template')),
    });
    this.host.execute('Create Template', (current) => {
      const state = editorState(current);
      state.templates = [...(state.templates ?? []), template];
      return [{ op: current.editorState ? 'replace' : 'add', path: '/editorState', value: state }];
    });
    this.emit('change', { type: 'template:create', templateId });
    return templateId;
  }

  updateTemplateFromInstance(instanceId: string): void {
    this.host.execute('Apply Instance To Template', (scene) => {
      const state = editorState(scene);
      const record = state.templateInstances?.find((entry) => entry.instanceId === instanceId);
      const templateIndex = state.templates?.findIndex((entry) => entry.id === record?.templateId) ?? -1;
      if (!record || templateIndex < 0) throw new Error('Template instance or source template not found.');
      const current = state.templates![templateIndex];
      state.templates![templateIndex] = captureTemplateDefinition(scene, record.rootNodeId, {
        id: current.id,
        name: current.name,
        version: current.version + 1,
        createdAt: current.createdAt,
        metadata: current.metadata,
      });
      return [{ op: scene.editorState ? 'replace' : 'add', path: '/editorState', value: state }];
    });
    this.emit('change', { type: 'template:update', instanceId });
  }

  instantiate(templateId: string, parentId: string | null = null): { instanceId: string; rootNodeId: string } {
    const scene = this.host.getScene();
    const template = scene.editorState?.templates?.find((entry) => entry.id === templateId);
    if (!template) throw new Error('Template not found.');
    const instanceId = this.createId();
    const idBySource = new Map(template.nodes.map((node) => [node.sourceNodeId, this.createId()]));
    const result = instantiateTemplate(scene, templateId, {
      instanceId,
      parentId,
      nodeIdForSource: (sourceId) => idBySource.get(sourceId)!,
    });
    this.host.execute('Instantiate Template', (current) => {
      const applied = instantiateTemplate(current, templateId, {
        instanceId,
        parentId,
        nodeIdForSource: (sourceId) => idBySource.get(sourceId)!,
        now: result.record.createdAt,
      });
      return replaceAuthoringState(current, applied.scene.nodes, applied.scene.editorState ?? {});
    });
    this.emit('change', { type: 'instance:create', templateId, instanceId, rootNodeId: result.rootNodeId });
    return { instanceId, rootNodeId: result.rootNodeId };
  }

  apply(instanceId: string, resolutions: TemplateConflictResolutionMap = {}): void {
    this.host.execute('Apply Template Update', (scene) => {
      const applied = applyTemplateUpdate(scene, instanceId, resolutions, () => this.createId());
      return replaceAuthoringState(scene, applied.nodes, applied.editorState ?? {});
    });
    this.emit('change', { type: 'instance:apply', instanceId });
  }

  revert(instanceId: string, paths?: Iterable<string>): void {
    this.host.execute('Revert Template Overrides', (scene) => {
      const reverted = revertTemplateOverrides(scene, instanceId, paths);
      return replaceAuthoringState(scene, reverted.nodes, reverted.editorState ?? {});
    });
    this.emit('change', { type: 'instance:revert', instanceId });
  }

  unlink(instanceId: string): void {
    this.host.execute('Unlink Template Instance', (scene) => {
      const unlinked = unlinkTemplateInstance(scene, instanceId);
      return replaceAuthoringState(scene, unlinked.nodes, unlinked.editorState ?? {});
    });
    this.emit('change', { type: 'instance:unlink', instanceId });
  }

  repair(): TemplateRepairAction[] {
    const preview = repairCorruptedTemplateInstances(this.host.getScene());
    if (!preview.actions.length) return [];
    this.host.execute('Repair Template Instances', (scene) => {
      const repaired = repairCorruptedTemplateInstances(scene);
      return replaceAuthoringState(scene, repaired.scene.nodes, repaired.scene.editorState ?? {});
    });
    this.emit('change', { type: 'template:repair', actions: preview.actions });
    return preview.actions;
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}
