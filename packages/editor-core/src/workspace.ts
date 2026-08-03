import {
  assertSceneContract,
  cloneSceneContract,
  createEmptySceneContract,
  type KyxosSceneContract,
  type SceneAnimation,
  type SceneCamera,
  type SceneLight,
  type SceneMaterial,
  type SceneNode,
} from '@kyxos/scene-contract';

import { collectHierarchySubtreeIds, hierarchyRootSelection } from './hierarchy';

export interface WorkspaceScene {
  id: string;
  name: string;
  document: KyxosSceneContract;
  createdAt: string;
  updatedAt: string;
}

export interface SceneTemplateSnapshot {
  nodes: SceneNode[];
  roots: string[];
  assets: KyxosSceneContract['assets'];
  materials: Record<string, SceneMaterial>;
  animations: SceneAnimation[];
  cameras: SceneCamera[];
  lights: SceneLight[];
}

export interface SceneTemplateDefinition {
  id: string;
  name: string;
  revision: number;
  snapshot: SceneTemplateSnapshot;
  sourceSceneId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspace {
  version: 1;
  projectId: string;
  activeSceneId: string;
  scenes: WorkspaceScene[];
  templates: SceneTemplateDefinition[];
}

export interface TemplateOverride {
  sourceNodeId: string;
  instanceNodeId: string;
  path: string;
  templateValue: unknown;
  instanceValue: unknown;
}

const INSTANCE_COMPARE_KEYS: Array<keyof SceneNode> = [
  'name',
  'transform',
  'visible',
  'locked',
  'meshAssetId',
  'meshIndex',
  'materialSlots',
  'cameraId',
  'lightId',
  'animationIds',
  'skin',
  'morphWeights',
  'morphTargetNames',
  'materialVariantBindings',
  'metadata',
];

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function valueAt(root: unknown, path: string): unknown {
  let value: any = root;
  for (const part of path.slice(1).split('/').filter(Boolean).map(unescapePointer)) {
    value = value?.[Array.isArray(value) ? Number(part) : part];
  }
  return value;
}

function assignAt(root: any, path: string, value: unknown): void {
  const parts = path.slice(1).split('/').filter(Boolean).map(unescapePointer);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = parent[Array.isArray(parent) ? Number(part) : part];
  }
  const key = parts.at(-1)!;
  parent[Array.isArray(parent) ? Number(key) : key] = structuredClone(value);
}

function leafDifferences(left: unknown, right: unknown, basePath = ''): string[] {
  if (equal(left, right)) return [];
  if (
    left == null ||
    right == null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return [basePath || '/'];
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return [basePath || '/'];
    return left.flatMap((value, index) =>
      leafDifferences(value, right[index], `${basePath}/${index}`),
    );
  }
  const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)]);
  return [...keys].flatMap((key) =>
    leafDifferences(
      (left as any)[key],
      (right as any)[key],
      `${basePath}/${escapePointer(key)}`,
    ),
  );
}

function uniqueName(base: string, values: Iterable<string>): string {
  const names = new Set(values);
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function collectTemplateSnapshot(
  scene: KyxosSceneContract,
  selectedIds: Iterable<string>,
): SceneTemplateSnapshot {
  const roots = hierarchyRootSelection(scene.nodes, selectedIds);
  if (!roots.length) throw new Error('Select at least one hierarchy node to create a template.');
  const nodeIds = collectHierarchySubtreeIds(scene.nodes, roots);
  const nodes = scene.nodes.filter((node) => nodeIds.has(node.id));
  const materialIds = new Set(nodes.flatMap((node) => node.materialSlots ?? []));
  const animationIds = new Set(nodes.flatMap((node) => node.animationIds ?? []));
  const cameraIds = new Set(nodes.flatMap((node) => (node.cameraId ? [node.cameraId] : [])));
  const lightIds = new Set(nodes.flatMap((node) => (node.lightId ? [node.lightId] : [])));
  const assetIds = new Set(nodes.flatMap((node) => (node.meshAssetId ? [node.meshAssetId] : [])));
  for (const materialId of materialIds) {
    const material = scene.materials[materialId];
    if (!material) continue;
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && 'assetId' in value) {
        const assetId = (value as { assetId?: unknown }).assetId;
        if (typeof assetId === 'string') assetIds.add(assetId);
      }
    }
  }
  const pendingAssets = [...assetIds];
  while (pendingAssets.length) {
    const asset = scene.assets[pendingAssets.pop()!];
    const dependencies = asset?.metadata?.dependencies;
    if (!Array.isArray(dependencies)) continue;
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string' || assetIds.has(dependency)) continue;
      assetIds.add(dependency);
      pendingAssets.push(dependency);
    }
  }
  return {
    roots,
    nodes: structuredClone(nodes),
    assets: Object.fromEntries(
      [...assetIds].flatMap((id) => (scene.assets[id] ? [[id, structuredClone(scene.assets[id])]] : [])),
    ),
    materials: Object.fromEntries(
      [...materialIds].flatMap((id) => (scene.materials[id] ? [[id, structuredClone(scene.materials[id])]] : [])),
    ),
    animations: structuredClone(scene.animations.filter((entry) => animationIds.has(entry.id))),
    cameras: structuredClone(scene.cameras.filter((entry) => cameraIds.has(entry.id))),
    lights: structuredClone((scene.lights ?? []).filter((entry) => lightIds.has(entry.id))),
  };
}

function instantiateTemplate(
  template: SceneTemplateDefinition,
  scene: KyxosSceneContract,
  parentId: string | null,
  createId: () => string,
): { document: KyxosSceneContract; instanceId: string; rootIds: string[] } {
  if (parentId && !scene.nodes.some((node) => node.id === parentId)) {
    throw new Error('Template parent does not exist.');
  }
  const result = cloneSceneContract(scene);
  const instanceId = createId();
  const nodeIds = new Map(template.snapshot.nodes.map((node) => [node.id, createId()]));
  const assetIds = new Map<string, string>();
  const materialIds = new Map(Object.keys(template.snapshot.materials).map((id) => [id, createId()]));
  const animationIds = new Map(template.snapshot.animations.map((entry) => [entry.id, createId()]));
  const cameraIds = new Map(template.snapshot.cameras.map((entry) => [entry.id, createId()]));
  const lightIds = new Map(template.snapshot.lights.map((entry) => [entry.id, createId()]));

  for (const source of Object.values(template.snapshot.assets)) {
    const existing = Object.values(result.assets).find((asset) => asset.contentHash === source.contentHash);
    const id = existing?.id ?? (result.assets[source.id] ? createId() : source.id);
    assetIds.set(source.id, id);
    if (!existing) result.assets[id] = { ...structuredClone(source), id };
  }
  for (const [sourceId, id] of assetIds) {
    const asset = result.assets[id];
    if (!asset || !Array.isArray(asset.metadata?.dependencies)) continue;
    asset.metadata = {
      ...asset.metadata,
      dependencies: asset.metadata.dependencies.map((dependency) =>
        typeof dependency === 'string' ? assetIds.get(dependency) ?? dependency : dependency,
      ),
    };
    assetIds.set(sourceId, id);
  }
  for (const [sourceId, material] of Object.entries(template.snapshot.materials)) {
    const id = materialIds.get(sourceId)!;
    const clone = { ...structuredClone(material), id };
    for (const key of Object.keys(clone)) {
      const value = clone[key as keyof SceneMaterial];
      if (value && typeof value === 'object' && 'assetId' in value) {
        (value as { assetId: string }).assetId = assetIds.get((value as { assetId: string }).assetId)
          ?? (value as { assetId: string }).assetId;
      }
    }
    result.materials[id] = clone;
  }
  result.animations.push(
    ...template.snapshot.animations.map((animation) => ({
      ...structuredClone(animation),
      id: animationIds.get(animation.id)!,
    })),
  );
  result.cameras.push(
    ...template.snapshot.cameras.map((camera) => ({
      ...structuredClone(camera),
      id: cameraIds.get(camera.id)!,
    })),
  );
  result.lights = [
    ...(result.lights ?? []),
    ...template.snapshot.lights.map((light) => ({
      ...structuredClone(light),
      id: lightIds.get(light.id)!,
    })),
  ];
  if (result.lights.length > 4) {
    throw new Error('Instantiating this template would exceed the four-light Scene Contract limit.');
  }

  const clonedNodes = template.snapshot.nodes.map((source) => {
    const root = template.snapshot.roots.includes(source.id);
    return {
      ...structuredClone(source),
      id: nodeIds.get(source.id)!,
      parentId: root ? parentId : source.parentId ? nodeIds.get(source.parentId) ?? null : null,
      children: source.children.flatMap((id) => (nodeIds.has(id) ? [nodeIds.get(id)!] : [])),
      meshAssetId: source.meshAssetId ? assetIds.get(source.meshAssetId) ?? source.meshAssetId : undefined,
      materialSlots: source.materialSlots?.map((id) => materialIds.get(id) ?? id),
      materialVariantBindings: source.materialVariantBindings
        ? Object.fromEntries(Object.entries(source.materialVariantBindings).map(([variantId, slots]) => [
            variantId,
            slots.map((id) => materialIds.get(id) ?? id),
          ]))
        : undefined,
      animationIds: source.animationIds?.map((id) => animationIds.get(id) ?? id),
      cameraId: source.cameraId ? cameraIds.get(source.cameraId) : undefined,
      lightId: source.lightId ? lightIds.get(source.lightId) : undefined,
      skin: source.skin
        ? {
            ...structuredClone(source.skin),
            joints: source.skin.joints.map((id) => nodeIds.get(id) ?? id),
            skeletonNodeId: source.skin.skeletonNodeId
              ? nodeIds.get(source.skin.skeletonNodeId) ?? source.skin.skeletonNodeId
              : undefined,
          }
        : undefined,
      template: {
        templateId: template.id,
        instanceId,
        sourceNodeId: source.id,
        overrides: [],
      },
    } satisfies SceneNode;
  });
  result.nodes.push(...clonedNodes);
  if (parentId) result.nodes.find((node) => node.id === parentId)!.children.push(
    ...template.snapshot.roots.map((id) => nodeIds.get(id)!),
  );
  result.metadata.updatedAt = new Date().toISOString();
  return {
    document: result,
    instanceId,
    rootIds: template.snapshot.roots.map((id) => nodeIds.get(id)!),
  };
}

export function createProjectWorkspace(
  projectId: string,
  initial?: KyxosSceneContract,
): ProjectWorkspace {
  const document = cloneSceneContract(initial ?? createEmptySceneContract('Scene 1'));
  const timestamp = new Date().toISOString();
  const sceneId = document.id;
  return {
    version: 1,
    projectId,
    activeSceneId: sceneId,
    scenes: [{ id: sceneId, name: document.metadata.name, document, createdAt: timestamp, updatedAt: timestamp }],
    templates: [],
  };
}

export class SceneWorkspaceService extends EventTarget {
  private state: ProjectWorkspace;

  constructor(
    workspace: ProjectWorkspace,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    super();
    if (workspace.version !== 1 || !workspace.scenes.length) throw new Error('Invalid project workspace.');
    if (!workspace.scenes.some((scene) => scene.id === workspace.activeSceneId)) {
      throw new Error('The active scene does not exist.');
    }
    workspace.scenes.forEach((scene) => assertSceneContract(scene.document));
    this.state = structuredClone(workspace);
  }

  get value(): ProjectWorkspace {
    return structuredClone(this.state);
  }

  get activeScene(): WorkspaceScene {
    return structuredClone(this.scene(this.state.activeSceneId));
  }

  select(sceneId: string): WorkspaceScene {
    const scene = this.scene(sceneId);
    this.state.activeSceneId = sceneId;
    this.emit('scene-selected', { sceneId });
    return structuredClone(scene);
  }

  createScene(name = 'Untitled Scene', source?: KyxosSceneContract): WorkspaceScene {
    const id = this.createId();
    const timestamp = this.clock();
    const document = source ? cloneSceneContract(source) : createEmptySceneContract(name);
    document.id = id;
    document.metadata.name = name.trim() || 'Untitled Scene';
    document.metadata.createdAt = timestamp;
    document.metadata.updatedAt = timestamp;
    const scene: WorkspaceScene = {
      id,
      name: document.metadata.name,
      document,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.scenes.push(scene);
    this.state.activeSceneId = id;
    this.emit('scene-created', { sceneId: id });
    return structuredClone(scene);
  }

  duplicateScene(sceneId: string): WorkspaceScene {
    const source = this.scene(sceneId);
    const name = uniqueName(`${source.name} Copy`, this.state.scenes.map((scene) => scene.name));
    return this.createScene(name, source.document);
  }

  renameScene(sceneId: string, name: string): void {
    const normalized = name.trim();
    if (!normalized) throw new Error('Scene name is required.');
    const scene = this.scene(sceneId);
    scene.name = normalized;
    scene.document.metadata.name = normalized;
    scene.updatedAt = this.clock();
    scene.document.metadata.updatedAt = scene.updatedAt;
    this.emit('scene-renamed', { sceneId });
  }

  deleteScene(sceneId: string): void {
    if (this.state.scenes.length === 1) throw new Error('A project must contain at least one scene.');
    const index = this.state.scenes.findIndex((scene) => scene.id === sceneId);
    if (index < 0) return;
    this.state.scenes.splice(index, 1);
    if (this.state.activeSceneId === sceneId) {
      this.state.activeSceneId = this.state.scenes[Math.min(index, this.state.scenes.length - 1)].id;
    }
    this.emit('scene-deleted', { sceneId, activeSceneId: this.state.activeSceneId });
  }

  updateScene(sceneId: string, document: KyxosSceneContract): void {
    assertSceneContract(document);
    const scene = this.scene(sceneId);
    scene.document = cloneSceneContract(document);
    scene.name = document.metadata.name;
    scene.updatedAt = this.clock();
    this.emit('scene-updated', { sceneId });
  }

  createTemplate(sceneId: string, nodeIds: Iterable<string>, name = 'Template'): SceneTemplateDefinition {
    const scene = this.scene(sceneId);
    const timestamp = this.clock();
    const template: SceneTemplateDefinition = {
      id: this.createId(),
      name: uniqueName(name.trim() || 'Template', this.state.templates.map((entry) => entry.name)),
      revision: 1,
      snapshot: collectTemplateSnapshot(scene.document, nodeIds),
      sourceSceneId: sceneId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.templates.push(template);
    this.emit('template-created', { templateId: template.id });
    return structuredClone(template);
  }

  renameTemplate(templateId: string, name: string): void {
    const normalized = name.trim();
    if (!normalized) throw new Error('Template name is required.');
    const template = this.template(templateId);
    template.name = normalized;
    template.updatedAt = this.clock();
    this.emit('template-updated', { templateId });
  }

  deleteTemplate(templateId: string): void {
    const referenced = this.state.scenes.some((scene) =>
      scene.document.nodes.some((node) => node.template?.templateId === templateId),
    );
    if (referenced) throw new Error('Delete or unpack template instances before deleting the template.');
    this.state.templates = this.state.templates.filter((entry) => entry.id !== templateId);
    this.emit('template-deleted', { templateId });
  }

  instantiate(templateId: string, sceneId: string, parentId: string | null = null): string[] {
    const template = this.template(templateId);
    const scene = this.scene(sceneId);
    const result = instantiateTemplate(template, scene.document, parentId, this.createId);
    scene.document = result.document;
    scene.updatedAt = this.clock();
    this.emit('template-instantiated', { templateId, sceneId, instanceId: result.instanceId });
    return result.rootIds;
  }

  overrides(sceneId: string, instanceId: string): TemplateOverride[] {
    const scene = this.scene(sceneId);
    const instanceNodes = scene.document.nodes.filter((node) => node.template?.instanceId === instanceId);
    const templateId = instanceNodes[0]?.template?.templateId;
    if (!templateId) return [];
    const template = this.template(templateId);
    const sourceById = new Map(template.snapshot.nodes.map((node) => [node.id, node]));
    const result: TemplateOverride[] = [];
    for (const node of instanceNodes) {
      const source = sourceById.get(node.template!.sourceNodeId);
      if (!source) continue;
      for (const key of INSTANCE_COMPARE_KEYS) {
        for (const suffix of leafDifferences(source[key], node[key], `/${escapePointer(String(key))}`)) {
          result.push({
            sourceNodeId: source.id,
            instanceNodeId: node.id,
            path: suffix,
            templateValue: structuredClone(valueAt(source, suffix)),
            instanceValue: structuredClone(valueAt(node, suffix)),
          });
        }
      }
    }
    return result;
  }

  refreshOverrideMetadata(sceneId: string, instanceId: string): TemplateOverride[] {
    const scene = this.scene(sceneId);
    const overrides = this.overrides(sceneId, instanceId);
    const byNode = new Map<string, string[]>();
    for (const override of overrides) {
      const paths = byNode.get(override.instanceNodeId) ?? [];
      paths.push(override.path);
      byNode.set(override.instanceNodeId, paths);
    }
    for (const node of scene.document.nodes) {
      if (node.template?.instanceId === instanceId) node.template.overrides = byNode.get(node.id) ?? [];
    }
    scene.updatedAt = this.clock();
    this.emit('instance-overrides', { sceneId, instanceId, count: overrides.length });
    return overrides;
  }

  resetOverrides(sceneId: string, instanceId: string, paths?: string[]): void {
    const scene = this.scene(sceneId);
    const instanceNodes = scene.document.nodes.filter((node) => node.template?.instanceId === instanceId);
    const templateId = instanceNodes[0]?.template?.templateId;
    if (!templateId) return;
    const template = this.template(templateId);
    const sourceById = new Map(template.snapshot.nodes.map((node) => [node.id, node]));
    const requested = paths ? new Set(paths) : null;
    for (const node of instanceNodes) {
      const source = sourceById.get(node.template!.sourceNodeId);
      if (!source) continue;
      const resetPaths = this.overrides(sceneId, instanceId)
        .filter((entry) => entry.instanceNodeId === node.id && (!requested || requested.has(entry.path)))
        .map((entry) => entry.path);
      for (const path of resetPaths) assignAt(node, path, valueAt(source, path));
    }
    this.refreshOverrideMetadata(sceneId, instanceId);
    this.emit('instance-reset', { sceneId, instanceId });
  }

  applyOverrides(sceneId: string, instanceId: string, paths?: string[]): void {
    const instanceOverrides = this.overrides(sceneId, instanceId);
    if (!instanceOverrides.length) return;
    const requested = paths ? new Set(paths) : null;
    const applicable = instanceOverrides.filter((entry) => !requested || requested.has(entry.path));
    const instanceNodes = this.scene(sceneId).document.nodes.filter(
      (node) => node.template?.instanceId === instanceId,
    );
    const templateId = instanceNodes[0]?.template?.templateId;
    if (!templateId) return;
    const template = this.template(templateId);
    const sourceById = new Map(template.snapshot.nodes.map((node) => [node.id, node]));
    const linkedInstances: Array<{
      sceneId: string;
      instanceId: string;
      preserved: Set<string>;
    }> = [];
    for (const candidateScene of this.state.scenes) {
      const instanceIds = new Set(
        candidateScene.document.nodes
          .filter((node) => node.template?.templateId === templateId)
          .map((node) => node.template!.instanceId),
      );
      for (const candidate of instanceIds) {
        linkedInstances.push({
          sceneId: candidateScene.id,
          instanceId: candidate,
          // Capture overrides against the old template before changing it. If
          // this is calculated afterwards, the template update itself is
          // mistaken for an instance override and never propagates.
          preserved: new Set(this.overrides(candidateScene.id, candidate).map(
            (entry) => `${entry.sourceNodeId}:${entry.path}`,
          )),
        });
      }
    }
    for (const override of applicable) {
      const source = sourceById.get(override.sourceNodeId);
      if (source) assignAt(source, override.path, override.instanceValue);
    }
    template.revision += 1;
    template.updatedAt = this.clock();

    for (const linked of linkedInstances) {
      if (linked.sceneId === sceneId && linked.instanceId === instanceId) continue;
      const linkedScene = this.scene(linked.sceneId);
      for (const override of applicable) {
        if (linked.preserved.has(`${override.sourceNodeId}:${override.path}`)) continue;
        const node = linkedScene.document.nodes.find((entry) =>
          entry.template?.instanceId === linked.instanceId &&
          entry.template.sourceNodeId === override.sourceNodeId,
        );
        const source = sourceById.get(override.sourceNodeId);
        if (node && source) assignAt(node, override.path, valueAt(source, override.path));
      }
      this.refreshOverrideMetadata(linked.sceneId, linked.instanceId);
    }
    this.refreshOverrideMetadata(sceneId, instanceId);
    this.emit('template-applied', { templateId, sceneId, instanceId });
  }

  unpackInstance(sceneId: string, instanceId: string): void {
    const scene = this.scene(sceneId);
    for (const node of scene.document.nodes) {
      if (node.template?.instanceId === instanceId) delete node.template;
    }
    scene.updatedAt = this.clock();
    this.emit('instance-unpacked', { sceneId, instanceId });
  }

  private scene(id: string): WorkspaceScene {
    const scene = this.state.scenes.find((entry) => entry.id === id);
    if (!scene) throw new Error(`Scene ${id} does not exist.`);
    return scene;
  }

  private template(id: string): SceneTemplateDefinition {
    const template = this.state.templates.find((entry) => entry.id === id);
    if (!template) throw new Error(`Template ${id} does not exist.`);
    return template;
  }

  private emit(type: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
  }
}
