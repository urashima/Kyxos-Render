import {
  LocalKyxosApiClient,
  SupabaseKyxosApiClient,
  type DraftRecord,
  type KyxosApiClient,
  type ProjectSummary,
  type ReleaseRecord,
  type SupabaseClientOptions,
  type WorkspaceRecord,
} from './index';
import {
  assertSceneContract,
  sceneDigestInput,
  type KyxosSceneContract,
} from '@kyxos/scene-contract';
import {
  recoverLocalAssetBlob,
  type LocalAssetIndexEntry,
} from './legacyAssetRecovery';

const LOCAL_KEY = 'kyxos-studio-local-v1';
const DB_NAME = 'kyxos-studio-durable';
const DB_VERSION = 1;
const STORES = ['drafts', 'workspaces', 'releases'] as const;
type StoreName = (typeof STORES)[number];

type LightweightDraft = Omit<DraftRecord, 'contract'> & { contract?: KyxosSceneContract };
type LightweightWorkspace = Omit<WorkspaceRecord, 'workspace'> & { workspace?: Record<string, unknown> };
type LightweightRelease = Omit<ReleaseRecord, 'sceneSnapshot'> & { sceneSnapshot?: KyxosSceneContract };

interface LocalStateShape {
  projects?: ProjectSummary[];
  drafts?: Record<string, LightweightDraft>;
  workspaces?: Record<string, LightweightWorkspace>;
  releases?: LightweightRelease[];
  assets?: Record<string, LocalAssetIndexEntry>;
  current?: Record<string, string>;
  disabled?: string[];
  [key: string]: unknown;
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

let localQueue = Promise.resolve();

function readState(): LocalStateShape {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as LocalStateShape;
  } catch {
    return {};
  }
}

function writeState(state: LocalStateShape): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch (error) {
    throw new Error(
      `Local project metadata could not be saved. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord(storeName: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(structuredClone(value), key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function getRecord<T>(storeName: StoreName, key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function deleteRecord(storeName: StoreName, key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  if (locks) return locks.request('kyxos-local-durable-state', task);
  const run = localQueue.then(task, task);
  localQueue = run.then(() => undefined, () => undefined);
  return run;
}

function draftMeta(record: DraftRecord): LightweightDraft {
  const { contract: _contract, ...metadata } = record;
  return metadata;
}

function workspaceMeta(record: WorkspaceRecord): LightweightWorkspace {
  const { workspace: _workspace, ...metadata } = record;
  return metadata;
}

function releaseMeta(record: ReleaseRecord): LightweightRelease {
  const { sceneSnapshot: _sceneSnapshot, ...metadata } = record;
  return metadata;
}

async function migrateLegacyHeavyState(): Promise<void> {
  await exclusive(async () => {
    const state = readState();
    let changed = false;

    for (const [projectId, value] of Object.entries(state.drafts ?? {})) {
      if (!value?.contract) continue;
      const record = value as DraftRecord;
      await putRecord('drafts', projectId, record);
      state.drafts![projectId] = draftMeta(record);
      changed = true;
    }

    for (const [projectId, value] of Object.entries(state.workspaces ?? {})) {
      if (!value?.workspace) continue;
      const record = value as WorkspaceRecord;
      await putRecord('workspaces', projectId, record);
      state.workspaces![projectId] = workspaceMeta(record);
      changed = true;
    }

    for (let index = 0; index < (state.releases ?? []).length; index += 1) {
      const value = state.releases![index];
      if (!value?.sceneSnapshot) continue;
      const record = value as ReleaseRecord;
      await putRecord('releases', record.id, record);
      state.releases![index] = releaseMeta(record);
      changed = true;
    }

    if (changed) writeState(state);
  });
}

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function publicSlug(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'scene';
  return `${normalized}-${crypto.randomUUID().slice(0, 8)}`;
}

async function hydrateRelease(metadata: LightweightRelease): Promise<ReleaseRecord> {
  if (metadata.sceneSnapshot) return metadata as ReleaseRecord;
  const record = await getRecord<ReleaseRecord>('releases', metadata.id);
  if (!record) throw new Error(`Published scene snapshot is missing for release ${metadata.id}.`);
  return record;
}

function gateNamespace<T extends object>(namespace: T, ready: Promise<void>): T {
  return new Proxy(namespace, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => ready.then(() => method(...args));
    },
  });
}

function gateClient(client: KyxosApiClient, ready: Promise<void>): KyxosApiClient {
  const mutable = client as unknown as Record<string, object>;
  for (const key of [
    'auth',
    'projects',
    'members',
    'workspaces',
    'collaboration',
    'versions',
    'sourceFiles',
    'assets',
    'drafts',
    'releases',
    'publicScenes',
  ]) {
    mutable[key] = gateNamespace(mutable[key], ready);
  }
  return client;
}

function createDurableLocalClient(): KyxosApiClient {
  const ready = migrateLegacyHeavyState();
  const client = gateClient(new LocalKyxosApiClient(), ready);
  const originalProjects = client.projects;
  const originalAssets = client.assets;

  client.projects = {
    ...originalProjects,
    duplicate: async (projectId: string): Promise<ProjectSummary> => {
      await ready;
      const [draft, workspace] = await Promise.all([
        getRecord<DraftRecord>('drafts', projectId),
        getRecord<WorkspaceRecord>('workspaces', projectId),
      ]);
      const project = await originalProjects.duplicate(projectId);
      if (draft) {
        const copy: DraftRecord = {
          ...structuredClone(draft),
          projectId: project.id,
          revision: 1,
          updatedAt: new Date().toISOString(),
        };
        await putRecord('drafts', project.id, copy);
      }
      if (workspace) {
        const copy: WorkspaceRecord = {
          ...structuredClone(workspace),
          projectId: project.id,
          revision: 1,
          updatedAt: new Date().toISOString(),
        };
        await putRecord('workspaces', project.id, copy);
      }
      return project;
    },
    remove: async (projectId: string): Promise<void> => {
      await ready;
      await originalProjects.remove(projectId);
      await Promise.all([
        deleteRecord('drafts', projectId),
        deleteRecord('workspaces', projectId),
      ]);
    },
  };

  client.assets = {
    createUpload: async (input) => {
      await ready;
      return exclusive(() => originalAssets.createUpload(input));
    },
    upload: async (ticket, file) => {
      await ready;
      await originalAssets.upload(ticket, file);
    },
    completeUpload: async (assetId, metadata) => {
      await ready;
      await exclusive(() => originalAssets.completeUpload(assetId, metadata));
    },
    getManifest: async (assetIds) => {
      await ready;
      return exclusive(() => originalAssets.getManifest(assetIds));
    },
    getBlobUrl: async (hash) => {
      await ready;
      return exclusive(() => originalAssets.getBlobUrl(hash));
    },
    restoreBlob: async (hash, blob) => {
      await ready;
      if (!originalAssets.restoreBlob) {
        throw new Error('This asset provider cannot restore local Blobs.');
      }
      await exclusive(() => originalAssets.restoreBlob!(hash, blob));
    },
  };

  client.drafts = {
    load: async (projectId: string): Promise<DraftRecord | null> => {
      await ready;
      return getRecord<DraftRecord>('drafts', projectId);
    },
    save: async (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<{ revision: number }> => {
      await ready;
      assertSceneContract(contract);
      return exclusive(async () => {
        const current = await getRecord<DraftRecord>('drafts', projectId);
        if ((current?.revision ?? 0) !== expectedRevision) {
          throw new Error(
            `Revision conflict: expected ${expectedRevision}, current ${current?.revision ?? 0}.`,
          );
        }
        const record: DraftRecord = {
          projectId,
          contract: structuredClone(contract),
          revision: expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        };
        await putRecord('drafts', projectId, record);
        const state = readState();
        state.drafts ??= {};
        state.drafts[projectId] = draftMeta(record);
        const project = state.projects?.find((entry) => entry.id === projectId);
        if (project) project.updatedAt = record.updatedAt;
        writeState(state);
        return { revision: record.revision };
      });
    },
    getRevision: async (projectId: string): Promise<number> => {
      await ready;
      return (await getRecord<DraftRecord>('drafts', projectId))?.revision ?? 0;
    },
  };

  client.workspaces = {
    load: async (projectId: string): Promise<WorkspaceRecord | null> => {
      await ready;
      return getRecord<WorkspaceRecord>('workspaces', projectId);
    },
    save: async (
      projectId: string,
      workspace: Record<string, unknown>,
      expectedRevision: number,
    ): Promise<{ revision: number }> => {
      await ready;
      return exclusive(async () => {
        const current = await getRecord<WorkspaceRecord>('workspaces', projectId);
        if ((current?.revision ?? 0) !== expectedRevision) {
          throw new Error(
            `Workspace revision conflict: expected ${expectedRevision}, current ${current?.revision ?? 0}.`,
          );
        }
        if (workspace.version !== 1) throw new Error('Unsupported workspace version.');
        const record: WorkspaceRecord = {
          projectId,
          workspace: structuredClone(workspace),
          revision: expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        };
        await putRecord('workspaces', projectId, record);
        const state = readState();
        state.workspaces ??= {};
        state.workspaces[projectId] = workspaceMeta(record);
        writeState(state);
        return { revision: record.revision };
      });
    },
  };

  client.releases = {
    publish: async (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<ReleaseRecord> => {
      await ready;
      assertSceneContract(contract);
      return exclusive(async () => {
        const draft = await getRecord<DraftRecord>('drafts', projectId);
        if (!draft || draft.revision !== expectedRevision) {
          throw new Error('Publish revision conflict. Flush autosave before publishing.');
        }

        const [draftDigest, contractDigest] = await Promise.all([
          sha256(sceneDigestInput(draft.contract)),
          sha256(sceneDigestInput(contract)),
        ]);
        if (draftDigest !== contractDigest) {
          throw new Error('The scene changed after the last successful save. Save again before publishing.');
        }

        const state = readState();
        const project = state.projects?.find((entry) => entry.id === projectId);
        if (!project) throw new Error('Project not found.');
        state.assets ??= {};
        let repairedAssetIndex = false;
        for (const [assetKey, asset] of Object.entries(contract.assets)) {
          let blobUrl = await originalAssets.getBlobUrl(asset.contentHash);
          let recovered = null;
          if (!blobUrl) {
            recovered = await recoverLocalAssetBlob(assetKey, asset, state.assets);
            if (recovered) blobUrl = await originalAssets.getBlobUrl(asset.contentHash);
          }
          if (!blobUrl) {
            throw new Error(
              `Missing asset ${asset.contentHash}. No matching Blob exists in local browser storage (legacy-recovery-v2).`,
            );
          }
          URL.revokeObjectURL(blobUrl);

          const stored = state.assets[assetKey];
          if (
            !stored ||
            stored.hash !== asset.contentHash ||
            stored.completed === false ||
            recovered
          ) {
            state.assets[assetKey] = {
              id: asset.id || assetKey,
              hash: asset.contentHash,
              name: asset.name ?? asset.id ?? assetKey,
              mimeType: asset.mimeType ?? 'application/octet-stream',
              byteSize: asset.byteSize ?? 0,
              completed: true,
              metadata: {
                ...(stored?.metadata ?? {}),
                recoveredFromSceneContract: true,
                ...(recovered ? {
                  recoveredFromLegacyBlobKey: recovered.sourceKey,
                  actualContentHash: recovered.actualHash,
                } : {}),
              },
            };
            repairedAssetIndex = true;
          }
        }
        if (repairedAssetIndex) writeState(state);

        state.releases ??= [];
        const existingMeta = state.releases.find(
          (entry) => entry.projectId === projectId && entry.sceneDigest === contractDigest,
        );
        if (existingMeta) {
          for (const entry of state.releases) {
            if (entry.projectId === projectId) entry.isCurrent = entry.id === existingMeta.id;
          }
          state.current ??= {};
          state.current[projectId] = existingMeta.id;
          state.disabled = (state.disabled ?? []).filter((id) => id !== projectId);
          writeState(state);
          return hydrateRelease(existingMeta);
        }

        const versionNumber = state.releases.filter(
          (entry) => entry.projectId === projectId,
        ).length + 1;
        const existingSlug = state.releases.find(
          (entry) => entry.projectId === projectId,
        )?.slug;
        const release: ReleaseRecord = {
          id: crypto.randomUUID(),
          projectId,
          versionNumber,
          sceneSnapshot: structuredClone(contract),
          sceneDigest: contractDigest,
          slug: existingSlug ?? publicSlug(project.name),
          createdAt: new Date().toISOString(),
          isCurrent: true,
        };
        await putRecord('releases', release.id, release);
        for (const entry of state.releases) {
          if (entry.projectId === projectId) entry.isCurrent = false;
        }
        state.releases.push(releaseMeta(release));
        state.current ??= {};
        state.current[projectId] = release.id;
        state.disabled = (state.disabled ?? []).filter((id) => id !== projectId);
        writeState(state);
        return structuredClone(release);
      });
    },
    list: async (projectId: string): Promise<ReleaseRecord[]> => {
      await ready;
      const state = readState();
      const metadata = (state.releases ?? [])
        .filter((entry) => entry.projectId === projectId)
        .sort((left, right) => right.versionNumber - left.versionNumber);
      return Promise.all(metadata.map(hydrateRelease));
    },
    setCurrent: async (projectId: string, versionId: string): Promise<void> => {
      await ready;
      await exclusive(async () => {
        const state = readState();
        const release = (state.releases ?? []).find(
          (entry) => entry.projectId === projectId && entry.id === versionId,
        );
        if (!release) throw new Error('Release not found.');
        for (const entry of state.releases ?? []) {
          if (entry.projectId === projectId) entry.isCurrent = entry.id === versionId;
        }
        state.current ??= {};
        state.current[projectId] = versionId;
        state.disabled = (state.disabled ?? []).filter((id) => id !== projectId);
        writeState(state);
      });
    },
    disablePublic: async (projectId: string): Promise<void> => {
      await ready;
      await exclusive(async () => {
        const state = readState();
        state.disabled ??= [];
        if (!state.disabled.includes(projectId)) state.disabled.push(projectId);
        writeState(state);
      });
    },
  };

  client.publicScenes = {
    resolveSlug: async (slug: string): Promise<ReleaseRecord> => {
      await ready;
      const state = readState();
      const metadata = (state.releases ?? []).find(
        (entry) => entry.slug === slug && entry.isCurrent,
      );
      if (!metadata || (state.disabled ?? []).includes(metadata.projectId)) {
        throw new Error('Public link is disabled or does not exist.');
      }
      return hydrateRelease(metadata);
    },
    getVersion: async (versionId: string): Promise<ReleaseRecord> => {
      await ready;
      const state = readState();
      const metadata = (state.releases ?? []).find((entry) => entry.id === versionId);
      if (!metadata || (state.disabled ?? []).includes(metadata.projectId)) {
        throw new Error('Published version does not exist or public access is disabled.');
      }
      return hydrateRelease(metadata);
    },
  };

  return client;
}

export function createDurableApiClient(
  options?: Partial<SupabaseClientOptions>,
): KyxosApiClient {
  return options?.url && options?.anonKey
    ? new SupabaseKyxosApiClient(options as SupabaseClientOptions)
    : createDurableLocalClient();
}
