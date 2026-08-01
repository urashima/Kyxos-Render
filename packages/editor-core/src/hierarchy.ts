import type {
  KyxosSceneContract,
  SceneAnimation,
  SceneAsset,
  SceneCamera,
  SceneLight,
  SceneMaterial,
  SceneNode,
  ScenePatch,
  Transform,
} from '@kyxos/scene-contract';

export type HierarchyDropPosition = 'before' | 'inside' | 'after';
export type HierarchyNodeKind =
  | 'empty'
  | 'camera'
  | 'directional-light'
  | 'point-light'
  | 'spot-light';

export interface HierarchyRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  visible: boolean;
}

export interface HierarchyClipboardSnapshot {
  version: 1;
  sourceSceneId: string;
  roots: string[];
  nodes: SceneNode[];
  cameras: SceneCamera[];
  lights: SceneLight[];
  assets: Record<string, SceneAsset>;
  materials: Record<string, SceneMaterial>;
  animations: SceneAnimation[];
}

export interface HierarchyCommandHost {
  getScene(): KyxosSceneContract;
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

export interface HierarchyClipboard {
  copy(value: unknown): void;
  paste<T>(): T | null;
}

const identityTransform = (): Transform => ({
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

function nodeMap(nodes: SceneNode[]): Map<string, SceneNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function collectHierarchySubtreeIds(
  nodes: SceneNode[],
  roots: Iterable<string>,
): Set<string> {
  const result = new Set(roots);
  const byId = nodeMap(nodes);
  const stack = [...result];
  while (stack.length) {
    const node = byId.get(stack.pop()!);
    for (const child of node?.children ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      stack.push(child);
    }
  }
  return result;
}

export function hierarchyRootSelection(nodes: SceneNode[], ids: Iterable<string>): string[] {
  const selected = new Set(ids);
  const byId = nodeMap(nodes);
  return nodes
    .filter((node) => {
      if (!selected.has(node.id)) return false;
      let parentId = node.parentId;
      while (parentId) {
        if (selected.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return true;
    })
    .map((node) => node.id);
}

export function flattenHierarchy(
  nodes: SceneNode[],
  expanded: ReadonlySet<string>,
  query = '',
): HierarchyRow[] {
  const byId = nodeMap(nodes);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matched = new Set<string>();
  if (normalizedQuery) {
    for (const node of nodes) {
      if (
        node.name.toLocaleLowerCase().includes(normalizedQuery) ||
        String(node.metadata?.type ?? '').toLocaleLowerCase().includes(normalizedQuery) ||
        node.materialSlots?.some((slot) => slot.toLocaleLowerCase().includes(normalizedQuery))
      ) {
        matched.add(node.id);
        let parentId = node.parentId;
        while (parentId) {
          matched.add(parentId);
          parentId = byId.get(parentId)?.parentId ?? null;
        }
      }
    }
  }

  const rows: HierarchyRow[] = [];
  const visited = new Set<string>();
  const visit = (node: SceneNode, depth: number): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (!normalizedQuery || matched.has(node.id)) {
      rows.push({
        id: node.id,
        depth,
        hasChildren: node.children.length > 0,
        expanded: normalizedQuery ? true : expanded.has(node.id),
        visible: true,
      });
    }
    if (!normalizedQuery && !expanded.has(node.id)) return;
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child) visit(child, depth + 1);
    }
  };

  for (const node of nodes) {
    if (node.parentId == null || !byId.has(node.parentId)) visit(node, 0);
  }
  // Corrupt/cyclic input must remain inspectable, but collapsed descendants are
  // intentionally not visited a second time as synthetic roots.
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const chain = new Set<string>();
    let current: SceneNode | undefined = node;
    while (current && !visited.has(current.id)) {
      if (chain.has(current.id)) {
        visit(node, 0);
        break;
      }
      chain.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return rows;
}

export function rangeSelection(
  visibleIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  if (!anchorId) return [targetId];
  const anchor = visibleIds.indexOf(anchorId);
  const target = visibleIds.indexOf(targetId);
  if (anchor < 0 || target < 0) return [targetId];
  return visibleIds.slice(Math.min(anchor, target), Math.max(anchor, target) + 1);
}

function cameraFor(kind: HierarchyNodeKind, id: string, name: string): SceneCamera | null {
  if (kind !== 'camera') return null;
  return {
    id,
    name,
    transform: {
      position: { x: 3.4, y: 2.4, z: 4.8 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    target: { x: 0, y: 0.9, z: 0 },
    fov: 45,
    near: 0.01,
    far: 1000,
    projection: 'perspective',
  };
}

function lightFor(kind: HierarchyNodeKind, id: string, name: string): SceneLight | null {
  const type = kind.endsWith('-light') ? kind.slice(0, -6) : null;
  if (type !== 'directional' && type !== 'point' && type !== 'spot') return null;
  return {
    id,
    name,
    type,
    color: '#ffffff',
    intensity: type === 'directional' ? 3 : 20,
    transform: {
      position: { x: 2, y: 3, z: 2 },
      rotation: { x: -0.6, y: 0.6, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    castShadow: type !== 'point',
    range: type === 'directional' ? undefined : 10,
    decay: type === 'directional' ? undefined : 2,
    innerConeAngle: type === 'spot' ? 0.35 : undefined,
    outerConeAngle: type === 'spot' ? 0.6 : undefined,
  };
}

export class HierarchyService extends EventTarget {
  private readonly expanded = new Set<string>();
  private isolateSnapshot: Map<string, boolean> | null = null;

  constructor(
    private readonly host: HierarchyCommandHost,
    private readonly clipboard: HierarchyClipboard,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
  }

  rows(query = ''): HierarchyRow[] {
    return flattenHierarchy(this.host.getScene().nodes, this.expanded, query);
  }

  isExpanded(id: string): boolean {
    return this.expanded.has(id);
  }

  setExpanded(id: string, expanded: boolean): void {
    expanded ? this.expanded.add(id) : this.expanded.delete(id);
    this.dispatchEvent(new CustomEvent('expansion', { detail: { id, expanded } }));
  }

  toggleExpanded(id: string): void {
    this.setExpanded(id, !this.expanded.has(id));
  }

  expandAncestors(id: string): void {
    const byId = nodeMap(this.host.getScene().nodes);
    let parentId = byId.get(id)?.parentId ?? null;
    while (parentId) {
      this.expanded.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  add(kind: HierarchyNodeKind, parentId: string | null = null): string {
    const scene = this.host.getScene();
    if (parentId && !scene.nodes.some((node) => node.id === parentId)) {
      throw new Error('The requested hierarchy parent does not exist.');
    }
    if (kind.endsWith('-light') && (scene.lights?.length ?? 0) >= 4) {
      throw new Error('The current Scene Contract supports at most four lights.');
    }
    const nodeId = this.createId();
    const cameraId = kind === 'camera' ? this.createId() : undefined;
    const lightId = kind.endsWith('-light') ? this.createId() : undefined;
    const baseName =
      kind === 'empty'
        ? 'Empty'
        : kind === 'camera'
          ? 'Camera'
          : `${kind.slice(0, -6).replace(/^./, (value) => value.toUpperCase())} Light`;
    const uniqueName = this.uniqueName(baseName, scene.nodes.map((node) => node.name));
    const node: SceneNode = {
      id: nodeId,
      name: uniqueName,
      parentId,
      children: [],
      transform: identityTransform(),
      visible: true,
      cameraId,
      lightId,
      metadata: { type: kind },
    };
    const camera = cameraId ? cameraFor(kind, cameraId, uniqueName) : null;
    const light = lightId ? lightFor(kind, lightId, uniqueName) : null;

    this.host.execute(`Add ${uniqueName}`, (current) => {
      const nodes = structuredClone(current.nodes);
      nodes.push(node);
      if (parentId) {
        const parent = nodes.find((entry) => entry.id === parentId)!;
        parent.children.push(nodeId);
      }
      const patch: ScenePatch = [{ op: 'replace', path: '/nodes', value: nodes }];
      if (camera) patch.push({ op: 'replace', path: '/cameras', value: [...current.cameras, camera] });
      if (light) patch.push({ op: current.lights ? 'replace' : 'add', path: '/lights', value: [...(current.lights ?? []), light] });
      return patch;
    });
    if (parentId) this.expanded.add(parentId);
    return nodeId;
  }

  rename(id: string, name: string): void {
    const normalized = name.trim();
    if (!normalized) throw new Error('Node name cannot be empty.');
    const index = this.host.getScene().nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    this.host.execute('Rename node', () => [
      { op: 'replace', path: `/nodes/${index}/name`, value: normalized },
    ]);
  }

  setLocked(ids: Iterable<string>, locked: boolean): void {
    const selected = new Set(ids);
    this.host.execute(locked ? 'Lock nodes' : 'Unlock nodes', (scene) =>
      scene.nodes.flatMap((node, index) =>
        selected.has(node.id)
          ? [
              {
                op: node.locked == null ? ('add' as const) : ('replace' as const),
                path: `/nodes/${index}/locked`,
                value: locked,
              },
            ]
          : [],
      ),
    );
  }

  setVisible(ids: Iterable<string>, visible: boolean, recursive = false): void {
    const scene = this.host.getScene();
    const selected = recursive
      ? collectHierarchySubtreeIds(scene.nodes, ids)
      : new Set(ids);
    this.host.execute(visible ? 'Show nodes' : 'Hide nodes', (current) =>
      current.nodes.flatMap((node, index) =>
        selected.has(node.id)
          ? [{ op: 'replace' as const, path: `/nodes/${index}/visible`, value: visible }]
          : [],
      ),
    );
  }

  isolate(ids: Iterable<string>): void {
    const scene = this.host.getScene();
    const visible = collectHierarchySubtreeIds(scene.nodes, ids);
    if (!visible.size) return;
    this.isolateSnapshot = new Map(scene.nodes.map((node) => [node.id, node.visible]));
    this.host.execute('Isolate nodes', (current) =>
      current.nodes.map((node, index) => ({
        op: 'replace' as const,
        path: `/nodes/${index}/visible`,
        value: visible.has(node.id),
      })),
    );
  }

  unisolate(): void {
    if (!this.isolateSnapshot) return;
    const snapshot = this.isolateSnapshot;
    this.isolateSnapshot = null;
    this.host.execute('Unisolate nodes', (scene) =>
      scene.nodes.flatMap((node, index) => {
        const visible = snapshot.get(node.id);
        return visible == null
          ? []
          : [{ op: 'replace' as const, path: `/nodes/${index}/visible`, value: visible }];
      }),
    );
  }

  copy(ids: Iterable<string>): HierarchyClipboardSnapshot | null {
    const snapshot = this.createSnapshot(ids);
    if (snapshot) this.clipboard.copy(snapshot);
    return snapshot;
  }

  cut(ids: Iterable<string>): HierarchyClipboardSnapshot | null {
    const snapshot = this.copy(ids);
    if (snapshot) this.remove(snapshot.roots);
    return snapshot;
  }

  paste(parentId: string | null = null): string[] {
    const snapshot = this.clipboard.paste<HierarchyClipboardSnapshot>();
    if (!snapshot || snapshot.version !== 1) return [];
    const scene = this.host.getScene();
    if (parentId && !scene.nodes.some((node) => node.id === parentId)) return [];
    const result = this.cloneSnapshot(snapshot, scene, parentId);
    if ((scene.lights?.length ?? 0) + result.lights.length > 4) {
      throw new Error('Pasting this subtree would exceed the four-light Scene Contract limit.');
    }
    this.host.execute('Paste hierarchy', (current) => {
      const nodes = structuredClone(current.nodes);
      nodes.push(...result.nodes);
      if (parentId) {
        const parent = nodes.find((node) => node.id === parentId)!;
        parent.children.push(...result.roots);
      }
      return [
        { op: 'replace', path: '/assets', value: result.assets },
        { op: 'replace', path: '/materials', value: result.materials },
        { op: 'replace', path: '/animations', value: result.animations },
        { op: 'replace', path: '/cameras', value: [...current.cameras, ...result.cameras] },
        { op: current.lights ? 'replace' : 'add', path: '/lights', value: [...(current.lights ?? []), ...result.lights] },
        { op: 'replace', path: '/nodes', value: nodes },
      ];
    });
    if (parentId) this.expanded.add(parentId);
    return result.roots;
  }

  duplicate(ids: Iterable<string>): string[] {
    const scene = this.host.getScene();
    const snapshot = this.createSnapshot(ids);
    if (!snapshot) return [];
    const result = this.cloneSnapshot(snapshot, scene, undefined);
    if ((scene.lights?.length ?? 0) + result.lights.length > 4) {
      throw new Error('Duplicating this subtree would exceed the four-light Scene Contract limit.');
    }
    const originalRoots = snapshot.roots;
    this.host.execute('Duplicate hierarchy', (current) => {
      const nodes = structuredClone(current.nodes);
      nodes.push(...result.nodes);
      for (let index = 0; index < originalRoots.length; index += 1) {
        const source = current.nodes.find((node) => node.id === originalRoots[index]);
        const cloneId = result.roots[index];
        if (!source?.parentId) continue;
        const parent = nodes.find((node) => node.id === source.parentId);
        if (!parent) continue;
        const sourceIndex = parent.children.indexOf(source.id);
        parent.children.splice(sourceIndex + 1, 0, cloneId);
      }
      return [
        { op: 'replace', path: '/assets', value: result.assets },
        { op: 'replace', path: '/materials', value: result.materials },
        { op: 'replace', path: '/animations', value: result.animations },
        { op: 'replace', path: '/nodes', value: nodes },
        { op: 'replace', path: '/cameras', value: [...current.cameras, ...result.cameras] },
        { op: current.lights ? 'replace' : 'add', path: '/lights', value: [...(current.lights ?? []), ...result.lights] },
      ];
    });
    return result.roots;
  }

  remove(ids: Iterable<string>): void {
    const scene = this.host.getScene();
    const deleting = collectHierarchySubtreeIds(scene.nodes, ids);
    if (!deleting.size) return;
    this.host.execute('Delete hierarchy', (current) => {
      const nodes = current.nodes
        .filter((node) => !deleting.has(node.id))
        .map((node) => ({
          ...structuredClone(node),
          children: node.children.filter((child) => !deleting.has(child)),
        }));
      const cameraIds = new Set(nodes.flatMap((node) => (node.cameraId ? [node.cameraId] : [])));
      const lightIds = new Set(nodes.flatMap((node) => (node.lightId ? [node.lightId] : [])));
      const cameras = current.cameras.filter(
        (camera) => camera.id === current.activeCameraId || cameraIds.has(camera.id),
      );
      const lights = (current.lights ?? []).filter((light) => lightIds.has(light.id));
      return [
        { op: 'replace', path: '/nodes', value: nodes },
        { op: 'replace', path: '/cameras', value: cameras },
        { op: current.lights ? 'replace' : 'add', path: '/lights', value: lights },
      ];
    });
  }

  move(ids: Iterable<string>, targetId: string, position: HierarchyDropPosition): void {
    const scene = this.host.getScene();
    const roots = hierarchyRootSelection(scene.nodes, ids);
    if (!roots.length || roots.includes(targetId)) return;
    const moved = collectHierarchySubtreeIds(scene.nodes, roots);
    if (moved.has(targetId)) throw new Error('A hierarchy item cannot be moved into its own subtree.');
    const target = scene.nodes.find((node) => node.id === targetId);
    if (!target) return;
    const nextParentId = position === 'inside' ? target.id : target.parentId;

    this.host.execute('Move hierarchy', (current) => {
      const nodes = structuredClone(current.nodes);
      const byId = nodeMap(nodes);
      for (const node of nodes) {
        node.children = node.children.filter((child) => !roots.includes(child));
      }
      for (const rootId of roots) {
        const root = byId.get(rootId);
        if (root) root.parentId = nextParentId;
      }
      if (nextParentId) {
        const parent = byId.get(nextParentId)!;
        if (position === 'inside') {
          parent.children.push(...roots);
        } else {
          const targetIndex = parent.children.indexOf(targetId);
          parent.children.splice(targetIndex + (position === 'after' ? 1 : 0), 0, ...roots);
        }
      } else {
        const movingNodes = roots.map((id) => byId.get(id)!).filter(Boolean);
        const remaining = nodes.filter((node) => !roots.includes(node.id));
        const targetIndex = remaining.findIndex((node) => node.id === targetId);
        remaining.splice(targetIndex + (position === 'after' ? 1 : 0), 0, ...movingNodes);
        return [{ op: 'replace', path: '/nodes', value: remaining }];
      }
      return [{ op: 'replace', path: '/nodes', value: nodes }];
    });
    if (nextParentId) this.expanded.add(nextParentId);
  }

  moveToRoot(ids: Iterable<string>): void {
    const scene = this.host.getScene();
    const roots = hierarchyRootSelection(scene.nodes, ids);
    if (!roots.length) return;
    this.host.execute('Move hierarchy to root', (current) => {
      const nodes = structuredClone(current.nodes);
      for (const node of nodes) node.children = node.children.filter((child) => !roots.includes(child));
      const moving = roots.map((id) => nodes.find((node) => node.id === id)).filter(Boolean) as SceneNode[];
      for (const node of moving) node.parentId = null;
      return [{
        op: 'replace',
        path: '/nodes',
        value: [...nodes.filter((node) => !roots.includes(node.id)), ...moving],
      }];
    });
  }

  private createSnapshot(ids: Iterable<string>): HierarchyClipboardSnapshot | null {
    const scene = this.host.getScene();
    const roots = hierarchyRootSelection(scene.nodes, ids);
    if (!roots.length) return null;
    const subtree = collectHierarchySubtreeIds(scene.nodes, roots);
    const nodes = scene.nodes.filter((node) => subtree.has(node.id));
    const cameraIds = new Set(nodes.flatMap((node) => (node.cameraId ? [node.cameraId] : [])));
    const lightIds = new Set(nodes.flatMap((node) => (node.lightId ? [node.lightId] : [])));
    const assetIds = new Set(nodes.flatMap((node) => (node.meshAssetId ? [node.meshAssetId] : [])));
    const materialIds = new Set(nodes.flatMap((node) => node.materialSlots ?? []));
    const animationIds = new Set(nodes.flatMap((node) => node.animationIds ?? []));
    for (const materialId of materialIds) {
      const material = scene.materials[materialId];
      if (!material) continue;
      for (const key of Object.keys(material)) {
        const value = material[key as keyof SceneMaterial];
        if (value && typeof value === 'object' && 'assetId' in value) {
          assetIds.add(String((value as { assetId: string }).assetId));
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
      version: 1,
      sourceSceneId: scene.id,
      roots,
      nodes: structuredClone(nodes),
      cameras: structuredClone(scene.cameras.filter((camera) => cameraIds.has(camera.id))),
      lights: structuredClone((scene.lights ?? []).filter((light) => lightIds.has(light.id))),
      assets: Object.fromEntries(
        Object.entries(scene.assets)
          .filter(([id]) => assetIds.has(id))
          .map(([id, asset]) => [id, structuredClone(asset)]),
      ),
      materials: Object.fromEntries(
        Object.entries(scene.materials)
          .filter(([id]) => materialIds.has(id))
          .map(([id, material]) => [id, structuredClone(material)]),
      ),
      animations: structuredClone(
        scene.animations.filter((animation) => animationIds.has(animation.id)),
      ),
    };
  }

  private cloneSnapshot(
    snapshot: HierarchyClipboardSnapshot,
    destination: KyxosSceneContract,
    forcedParentId?: string | null,
  ) {
    const nodeIds = new Map(snapshot.nodes.map((node) => [node.id, this.createId()]));
    const cameraIds = new Map(snapshot.cameras.map((camera) => [camera.id, this.createId()]));
    const lightIds = new Map(snapshot.lights.map((light) => [light.id, this.createId()]));
    const assets = structuredClone(destination.assets);
    const assetIds = new Map<string, string>();
    for (const source of Object.values(snapshot.assets)) {
      const existing = Object.values(assets).find(
        (asset) => asset.contentHash === source.contentHash,
      );
      if (existing) {
        assetIds.set(source.id, existing.id);
      } else {
        const id = assets[source.id] ? this.createId() : source.id;
        assets[id] = { ...structuredClone(source), id };
        assetIds.set(source.id, id);
      }
    }
    for (const [sourceId, destinationId] of assetIds) {
      const asset = assets[destinationId];
      if (!asset || !Array.isArray(asset.metadata?.dependencies)) continue;
      asset.metadata = {
        ...asset.metadata,
        dependencies: asset.metadata.dependencies.map((dependency) =>
          typeof dependency === 'string' ? assetIds.get(dependency) ?? dependency : dependency,
        ),
      };
      assetIds.set(sourceId, destinationId);
    }
    const materials = structuredClone(destination.materials);
    const materialIds = new Map<string, string>();
    for (const source of Object.values(snapshot.materials)) {
      const id = materials[source.id] ? this.createId() : source.id;
      const material = { ...structuredClone(source), id };
      for (const key of Object.keys(material)) {
        const value = material[key as keyof SceneMaterial];
        if (value && typeof value === 'object' && 'assetId' in value) {
          (value as { assetId: string }).assetId =
            assetIds.get((value as { assetId: string }).assetId) ??
            (value as { assetId: string }).assetId;
        }
      }
      materials[id] = material;
      materialIds.set(source.id, id);
    }
    const animations = structuredClone(destination.animations);
    const animationIds = new Map<string, string>();
    for (const source of snapshot.animations) {
      const id = animations.some((animation) => animation.id === source.id)
        ? this.createId()
        : source.id;
      animations.push({ ...structuredClone(source), id });
      animationIds.set(source.id, id);
    }
    const rootSet = new Set(snapshot.roots);
    const templateInstanceIds = new Map<string, string>();
    const reservedNames = destination.nodes.map((node) => node.name);
    const nodes = snapshot.nodes.map((source) => {
      const id = nodeIds.get(source.id)!;
      const rootParent = rootSet.has(source.id)
        ? forcedParentId === undefined
          ? source.parentId
          : forcedParentId
        : source.parentId
          ? nodeIds.get(source.parentId) ?? source.parentId
          : null;
      const name = rootSet.has(source.id)
        ? this.uniqueName(`${source.name} Copy`, reservedNames)
        : source.name;
      if (rootSet.has(source.id)) reservedNames.push(name);
      const template = source.template && snapshot.sourceSceneId === destination.id
        ? {
            ...structuredClone(source.template),
            instanceId: templateInstanceIds.get(source.template.instanceId)
              ?? (() => {
                const instanceId = this.createId();
                templateInstanceIds.set(source.template!.instanceId, instanceId);
                return instanceId;
              })(),
            sourceNodeId: nodeIds.get(source.template.sourceNodeId) ?? source.template.sourceNodeId,
          }
        : undefined;
      return {
        ...structuredClone(source),
        id,
        name,
        parentId: rootParent,
        children: source.children.map((child) => nodeIds.get(child)!).filter(Boolean),
        cameraId: source.cameraId ? cameraIds.get(source.cameraId) : undefined,
        lightId: source.lightId ? lightIds.get(source.lightId) : undefined,
        meshAssetId: source.meshAssetId
          ? assetIds.get(source.meshAssetId) ?? source.meshAssetId
          : undefined,
        materialSlots: source.materialSlots?.map(
          (materialId) => materialIds.get(materialId) ?? materialId,
        ),
        animationIds: source.animationIds?.map(
          (animationId) => animationIds.get(animationId) ?? animationId,
        ),
        skin: source.skin
          ? {
              ...structuredClone(source.skin),
              joints: source.skin.joints.map((jointId) => nodeIds.get(jointId) ?? jointId),
              skeletonNodeId: source.skin.skeletonNodeId
                ? nodeIds.get(source.skin.skeletonNodeId) ?? source.skin.skeletonNodeId
                : undefined,
            }
          : undefined,
        materialVariantBindings: source.materialVariantBindings
          ? Object.fromEntries(Object.entries(source.materialVariantBindings).map(([variantId, slots]) => [
              variantId,
              slots.map((materialId) => materialIds.get(materialId) ?? materialId),
            ]))
          : undefined,
        template,
      } satisfies SceneNode;
    });
    return {
      roots: snapshot.roots.map((root) => nodeIds.get(root)!),
      nodes,
      cameras: snapshot.cameras.map((camera) => ({
        ...structuredClone(camera),
        id: cameraIds.get(camera.id)!,
      })),
      lights: snapshot.lights.map((light) => ({
        ...structuredClone(light),
        id: lightIds.get(light.id)!,
      })),
      assets,
      materials,
      animations,
    };
  }

  private uniqueName(base: string, names: string[]): string {
    const used = new Set(names.map((name) => name.toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base} ${suffix}`;
      if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    }
  }
}
