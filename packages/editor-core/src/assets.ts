import type {
  AssetKind,
  KyxosSceneContract,
  SceneAsset,
  SceneAssetFolder,
  SceneMaterial,
  ScenePatch,
} from '@kyxos/scene-contract';

import { materialOverridePaths } from './schema';

export type AssetViewMode = 'grid' | 'list';
export type ImportTaskStage =
  | 'queued'
  | 'hashing'
  | 'uploading'
  | 'parsing'
  | 'building'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface AssetWorkspaceQuery {
  folderId?: string | null;
  query?: string;
  kinds?: AssetKind[];
  includeDeleted?: boolean;
}

export interface AssetReference {
  assetId: string;
  path: string;
  ownerType: 'node' | 'material' | 'environment' | 'asset';
  ownerId: string;
  label: string;
}

export interface AssetWorkspaceItem {
  asset: SceneAsset;
  folderId: string | null;
  deleted: boolean;
  dependencies: string[];
  reverseReferences: AssetReference[];
  thumbnailAssetId?: string;
}

export interface AssetCommandHost {
  getScene(): KyxosSceneContract;
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

export interface ImportTask<T = unknown> {
  id: string;
  name: string;
  stage: ImportTaskStage;
  progress: number;
  attempts: number;
  error?: string;
  result?: T;
  createdAt: number;
  updatedAt: number;
}

export interface ImportTaskContext {
  signal: AbortSignal;
  report(stage: Exclude<ImportTaskStage, 'queued' | 'complete' | 'failed' | 'cancelled'>, progress: number): void;
}

interface InternalImportTask<T> extends ImportTask<T> {
  worker: (context: ImportTaskContext) => Promise<T>;
  controller: AbortController;
}

function encode(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function metadata(asset: SceneAsset): Record<string, unknown> {
  return asset.metadata && typeof asset.metadata === 'object'
    ? structuredClone(asset.metadata)
    : {};
}

function folderId(asset: SceneAsset): string | null {
  const value = asset.metadata?.folderId;
  return typeof value === 'string' ? value : null;
}

function assetDependencies(asset: SceneAsset): string[] {
  const value = asset.metadata?.dependencies;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function materialTextureReferences(material: SceneMaterial): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(material)) {
    if (
      value &&
      typeof value === 'object' &&
      'assetId' in value &&
      typeof (value as { assetId?: unknown }).assetId === 'string'
    ) {
      result.push([key, (value as { assetId: string }).assetId]);
    }
  }
  return result;
}

export function collectAssetReferences(scene: KyxosSceneContract): AssetReference[] {
  const references: AssetReference[] = [];
  scene.nodes.forEach((node, index) => {
    if (node.meshAssetId) {
      references.push({
        assetId: node.meshAssetId,
        path: `/nodes/${index}/meshAssetId`,
        ownerType: 'node',
        ownerId: node.id,
        label: `${node.name} mesh`,
      });
    }
  });
  for (const [materialId, material] of Object.entries(scene.materials)) {
    for (const [property, assetId] of materialTextureReferences(material)) {
      references.push({
        assetId,
        path: `/materials/${encode(materialId)}/${property}/assetId`,
        ownerType: 'material',
        ownerId: materialId,
        label: `${material.name} ${property}`,
      });
    }
  }
  if (scene.environment.assetId) {
    references.push({
      assetId: scene.environment.assetId,
      path: '/environment/assetId',
      ownerType: 'environment',
      ownerId: scene.id,
      label: 'Scene environment',
    });
  }
  for (const asset of Object.values(scene.assets)) {
    for (const dependency of assetDependencies(asset)) {
      references.push({
        assetId: dependency,
        path: `/assets/${encode(asset.id)}/metadata/dependencies`,
        ownerType: 'asset',
        ownerId: asset.id,
        label: `${asset.name ?? asset.id} dependency`,
      });
    }
  }
  return references;
}

export class AssetWorkspaceService extends EventTarget {
  private viewModeValue: AssetViewMode = 'grid';

  constructor(
    private readonly host: AssetCommandHost,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
  }

  get viewMode(): AssetViewMode {
    return this.viewModeValue;
  }

  setViewMode(mode: AssetViewMode): void {
    this.viewModeValue = mode;
    this.dispatchEvent(new CustomEvent('view-mode', { detail: { mode } }));
  }

  folders(): SceneAssetFolder[] {
    return structuredClone(this.host.getScene().editorState?.assetFolders ?? []);
  }

  createFolder(name: string, parentId: string | null = null): string {
    const normalized = name.trim();
    if (!normalized) throw new Error('Folder name is required.');
    const scene = this.host.getScene();
    const folders = scene.editorState?.assetFolders ?? [];
    if (parentId && !folders.some((folder) => folder.id === parentId)) {
      throw new Error('Parent folder does not exist.');
    }
    const id = this.createId();
    const folder: SceneAssetFolder = { id, name: normalized, parentId };
    this.host.execute('Create asset folder', (current) => [
      {
        op: current.editorState ? 'replace' : 'add',
        path: '/editorState',
        value: {
          ...(current.editorState ?? {}),
          assetFolders: [...(current.editorState?.assetFolders ?? []), folder],
        },
      },
    ]);
    return id;
  }

  renameFolder(id: string, name: string): void {
    const normalized = name.trim();
    if (!normalized) throw new Error('Folder name is required.');
    this.host.execute('Rename asset folder', (scene) => {
      const folders = structuredClone(scene.editorState?.assetFolders ?? []);
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) return [];
      folder.name = normalized;
      return [
        {
          op: 'replace',
          path: '/editorState',
          value: { ...(scene.editorState ?? {}), assetFolders: folders },
        },
      ];
    });
  }

  moveFolder(id: string, parentId: string | null): void {
    const folders = this.folders();
    const folder = folders.find((entry) => entry.id === id);
    if (!folder) return;
    let cursor = parentId;
    while (cursor) {
      if (cursor === id) throw new Error('A folder cannot be moved into itself.');
      cursor = folders.find((entry) => entry.id === cursor)?.parentId ?? null;
    }
    this.host.execute('Move asset folder', (scene) => {
      const next = structuredClone(scene.editorState?.assetFolders ?? []);
      const target = next.find((entry) => entry.id === id);
      if (!target) return [];
      target.parentId = parentId;
      return [
        {
          op: 'replace',
          path: '/editorState',
          value: { ...(scene.editorState ?? {}), assetFolders: next },
        },
      ];
    });
  }

  deleteFolder(id: string): void {
    this.host.execute('Delete asset folder', (scene) => {
      const folders = scene.editorState?.assetFolders ?? [];
      const deleting = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of folders) {
          if (folder.parentId && deleting.has(folder.parentId) && !deleting.has(folder.id)) {
            deleting.add(folder.id);
            changed = true;
          }
        }
      }
      const assets = Object.fromEntries(
        Object.entries(scene.assets).map(([assetId, asset]) => {
          if (!deleting.has(folderId(asset) ?? '')) return [assetId, asset];
          const next = structuredClone(asset);
          next.metadata = metadata(next);
          delete next.metadata.folderId;
          return [assetId, next];
        }),
      );
      return [
        { op: 'replace', path: '/assets', value: assets },
        {
          op: 'replace',
          path: '/editorState',
          value: {
            ...(scene.editorState ?? {}),
            assetFolders: folders.filter((folder) => !deleting.has(folder.id)),
          },
        },
      ];
    });
  }

  list(query: AssetWorkspaceQuery = {}): AssetWorkspaceItem[] {
    const scene = this.host.getScene();
    const references = collectAssetReferences(scene);
    const deleted = new Set(scene.editorState?.deletedAssetIds ?? []);
    const normalized = query.query?.trim().toLocaleLowerCase() ?? '';
    const kinds = new Set(query.kinds ?? []);
    return Object.values(scene.assets)
      .filter((asset) => query.includeDeleted || !deleted.has(asset.id))
      .filter((asset) => query.folderId === undefined || folderId(asset) === query.folderId)
      .filter((asset) => !kinds.size || kinds.has(asset.kind))
      .filter(
        (asset) =>
          !normalized ||
          (asset.name ?? '').toLocaleLowerCase().includes(normalized) ||
          asset.kind.includes(normalized) ||
          asset.contentHash.includes(normalized),
      )
      .map((asset) => ({
        asset: structuredClone(asset),
        folderId: folderId(asset),
        deleted: deleted.has(asset.id),
        dependencies: assetDependencies(asset),
        reverseReferences: references.filter((reference) => reference.assetId === asset.id),
        thumbnailAssetId:
          typeof asset.metadata?.thumbnailAssetId === 'string'
            ? asset.metadata.thumbnailAssetId
            : asset.kind === 'texture' || asset.kind === 'environment'
              ? asset.id
              : undefined,
      }));
  }

  rename(assetId: string, name: string): void {
    const normalized = name.trim();
    if (!normalized) throw new Error('Asset name is required.');
    this.updateAsset(assetId, 'Rename asset', (asset) => ({ ...asset, name: normalized }));
  }

  move(assetIds: Iterable<string>, targetFolderId: string | null): void {
    const selected = new Set(assetIds);
    const folders = this.folders();
    if (targetFolderId && !folders.some((folder) => folder.id === targetFolderId)) {
      throw new Error('Target folder does not exist.');
    }
    this.host.execute('Move assets', (scene) => {
      const assets = structuredClone(scene.assets);
      for (const id of selected) {
        const asset = assets[id];
        if (!asset) continue;
        asset.metadata = metadata(asset);
        if (targetFolderId) asset.metadata.folderId = targetFolderId;
        else delete asset.metadata.folderId;
      }
      return [{ op: 'replace', path: '/assets', value: assets }];
    });
  }

  remove(assetIds: Iterable<string>): void {
    const selected = new Set(assetIds);
    this.host.execute('Move assets to trash', (scene) => {
      const deleted = new Set(scene.editorState?.deletedAssetIds ?? []);
      for (const id of selected) if (scene.assets[id]) deleted.add(id);
      return [
        {
          op: scene.editorState ? 'replace' : 'add',
          path: '/editorState',
          value: { ...(scene.editorState ?? {}), deletedAssetIds: [...deleted] },
        },
      ];
    });
  }

  restore(assetIds: Iterable<string>): void {
    const selected = new Set(assetIds);
    this.host.execute('Restore assets', (scene) => [
      {
        op: scene.editorState ? 'replace' : 'add',
        path: '/editorState',
        value: {
          ...(scene.editorState ?? {}),
          deletedAssetIds: (scene.editorState?.deletedAssetIds ?? []).filter(
            (id) => !selected.has(id),
          ),
        },
      },
    ]);
  }

  purge(assetIds: Iterable<string>): void {
    const selected = new Set(assetIds);
    const scene = this.host.getScene();
    const blocking = collectAssetReferences(scene).filter((reference) =>
      selected.has(reference.assetId),
    );
    if (blocking.length) {
      throw new Error(
        `Asset is still referenced by ${blocking.map((entry) => entry.label).join(', ')}.`,
      );
    }
    this.host.execute('Delete assets permanently', (current) => {
      const assets = Object.fromEntries(
        Object.entries(current.assets).filter(([id]) => !selected.has(id)),
      );
      return [
        { op: 'replace', path: '/assets', value: assets },
        {
          op: current.editorState ? 'replace' : 'add',
          path: '/editorState',
          value: {
            ...(current.editorState ?? {}),
            deletedAssetIds: (current.editorState?.deletedAssetIds ?? []).filter(
              (id) => !selected.has(id),
            ),
          },
        },
      ];
    });
  }

  duplicate(assetId: string): string | null {
    const scene = this.host.getScene();
    const source = scene.assets[assetId];
    if (!source) return null;
    const id = this.createId();
    const asset: SceneAsset = {
      ...structuredClone(source),
      id,
      name: `${source.name ?? 'Asset'} Copy`,
      metadata: { ...metadata(source), duplicatedFrom: source.id },
    };
    this.host.execute('Duplicate asset', () => [
      { op: 'add', path: `/assets/${encode(id)}`, value: asset },
    ]);
    return id;
  }

  private updateAsset(
    assetId: string,
    label: string,
    update: (asset: SceneAsset) => SceneAsset,
  ): void {
    this.host.execute(label, (scene) => {
      const asset = scene.assets[assetId];
      return asset
        ? [
            {
              op: 'replace' as const,
              path: `/assets/${encode(assetId)}`,
              value: update(structuredClone(asset)),
            },
          ]
        : [];
    });
  }
}

export class ImportTaskQueue<T = unknown> extends EventTarget {
  private readonly tasksById = new Map<string, InternalImportTask<T>>();
  private active = 0;

  constructor(
    private readonly concurrency = 2,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
  }

  enqueue(name: string, worker: (context: ImportTaskContext) => Promise<T>): string {
    const now = Date.now();
    const task: InternalImportTask<T> = {
      id: this.createId(),
      name,
      stage: 'queued',
      progress: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      worker,
      controller: new AbortController(),
    };
    this.tasksById.set(task.id, task);
    this.emit();
    this.pump();
    return task.id;
  }

  list(): ImportTask<T>[] {
    return [...this.tasksById.values()].map(({ worker: _worker, controller: _controller, ...task }) =>
      structuredClone(task),
    );
  }

  cancel(id: string): void {
    const task = this.tasksById.get(id);
    if (!task || ['complete', 'failed', 'cancelled'].includes(task.stage)) return;
    task.controller.abort();
    if (task.stage === 'queued') {
      task.stage = 'cancelled';
      task.updatedAt = Date.now();
      this.emit();
    }
  }

  retry(id: string): void {
    const task = this.tasksById.get(id);
    if (!task || (task.stage !== 'failed' && task.stage !== 'cancelled')) return;
    task.controller = new AbortController();
    task.stage = 'queued';
    task.progress = 0;
    task.error = undefined;
    task.result = undefined;
    task.updatedAt = Date.now();
    this.emit();
    this.pump();
  }

  remove(id: string): void {
    const task = this.tasksById.get(id);
    if (!task || !['complete', 'failed', 'cancelled'].includes(task.stage)) return;
    this.tasksById.delete(id);
    this.emit();
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const next = [...this.tasksById.values()].find((task) => task.stage === 'queued');
      if (!next) return;
      this.active += 1;
      next.attempts += 1;
      next.stage = 'hashing';
      next.updatedAt = Date.now();
      this.emit();
      void this.run(next).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(task: InternalImportTask<T>): Promise<void> {
    try {
      task.result = await task.worker({
        signal: task.controller.signal,
        report: (stage, progress) => {
          if (task.controller.signal.aborted) return;
          task.stage = stage;
          task.progress = Math.max(0, Math.min(1, progress));
          task.updatedAt = Date.now();
          this.emit();
        },
      });
      if (task.controller.signal.aborted) {
        task.stage = 'cancelled';
      } else {
        task.stage = 'complete';
        task.progress = 1;
      }
    } catch (error) {
      task.stage = task.controller.signal.aborted ? 'cancelled' : 'failed';
      task.error = error instanceof Error ? error.message : String(error);
    }
    task.updatedAt = Date.now();
    this.emit();
  }

  private emit(): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { tasks: this.list() } }));
  }
}

export type ReimportMode = 'replace' | 'keep-overrides' | 'reset-overrides';

export function mergeReimportedScene(
  current: KyxosSceneContract,
  imported: KyxosSceneContract,
  mode: ReimportMode,
): KyxosSceneContract {
  if (mode === 'replace') return structuredClone(imported);
  const next = structuredClone(imported);
  next.editorState = structuredClone(current.editorState);

  const currentMaterials = new Map<number, SceneMaterial>();
  for (const material of Object.values(current.materials)) {
    const index = material.metadata?.gltfMaterialIndex;
    if (typeof index === 'number') currentMaterials.set(index, material);
  }
  for (const material of Object.values(next.materials)) {
    const index = material.metadata?.gltfMaterialIndex;
    const previous = typeof index === 'number' ? currentMaterials.get(index) : undefined;
    if (!previous) continue;
    const importedOriginal = structuredClone(material.metadata?.original ?? material);
    if (mode === 'keep-overrides') {
      for (const key of materialOverridePaths(previous)) {
        (material as unknown as Record<string, unknown>)[key] = structuredClone(
          (previous as unknown as Record<string, unknown>)[key],
        );
      }
    }
    material.metadata = { ...(material.metadata ?? {}), original: importedOriginal };
  }

  const currentNodes = new Map<number, (typeof current.nodes)[number]>();
  for (const node of current.nodes) {
    const index = node.metadata?.gltfNodeIndex;
    if (typeof index === 'number') currentNodes.set(index, node);
  }
  for (const node of next.nodes) {
    const index = node.metadata?.gltfNodeIndex;
    const previous = typeof index === 'number' ? currentNodes.get(index) : undefined;
    if (!previous || mode !== 'keep-overrides') continue;
    node.transform = structuredClone(previous.transform);
    node.visible = previous.visible;
    node.locked = previous.locked;
    if (previous.morphWeights) node.morphWeights = structuredClone(previous.morphWeights);
  }

  for (const [id, asset] of Object.entries(current.assets)) {
    if (asset.kind !== 'model' && !next.assets[id]) next.assets[id] = structuredClone(asset);
  }
  if (current.environment.assetId) next.environment = structuredClone(current.environment);
  next.renderSettings = structuredClone(current.renderSettings);
  return next;
}
