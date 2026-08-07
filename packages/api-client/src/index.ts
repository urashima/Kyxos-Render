import {
  assertSceneContract,
  sceneDigestInput,
  type KyxosSceneContract,
  type SceneAsset,
} from '@kyxos/scene-contract';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Session {
  userId: string;
  email: string;
  accessToken?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftRecord {
  projectId: string;
  contract: KyxosSceneContract;
  revision: number;
  updatedAt: string;
}

export interface ReleaseRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  sceneSnapshot: KyxosSceneContract;
  sceneDigest: string;
  slug: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface UploadTicket {
  assetId: string;
  uploadUrl?: string;
  uploadToken?: string;
  storageKey: string;
  headers?: Record<string, string>;
  alreadyExists?: boolean;
}

export interface AssetManifest {
  assets: Record<string, string>;
}

export type ProjectRole = 'owner' | 'editor' | 'viewer';
export interface ProjectMemberRecord {
  projectId: string;
  userId: string;
  email?: string;
  role: ProjectRole;
  createdAt: string;
}
export interface WorkspaceRecord {
  projectId: string;
  workspace: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}
export interface CollaborationPresence {
  projectId: string;
  userId: string;
  clientId: string;
  displayName: string;
  color: string;
  sceneId: string;
  selection: string[];
  camera?: Record<string, unknown>;
  updatedAt: number;
}
export interface CollaborationOperation {
  id: string;
  projectId: string;
  sceneId: string;
  clientId: string;
  userId: string;
  sequence: number;
  baseRevision: number;
  patch: unknown[];
  createdAt: string;
}
export interface CollaborationConnection {
  publishOperation(operation: CollaborationOperation): Promise<void>;
  publishPresence(presence: CollaborationPresence): Promise<void>;
  dispose(): void;
}
export interface BranchRecord {
  id: string;
  projectId: string;
  name: string;
  headCheckpointId: string | null;
  baseCheckpointId: string | null;
  createdBy: string;
  createdAt: string;
}
export interface CheckpointRecord {
  id: string;
  projectId: string;
  branchId: string;
  parentId: string | null;
  label: string;
  snapshot: KyxosSceneContract;
  createdBy: string;
  createdAt: string;
}
export interface SourceFileRecord {
  id: string;
  projectId: string;
  path: string;
  language: string;
  content: string;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

export interface KyxosApiClient {
  auth: {
    signIn(email: string, password: string): Promise<Session>;
    signOut(): Promise<void>;
    getSession(): Promise<Session | null>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
    create(name: string): Promise<ProjectSummary>;
    get(id: string): Promise<ProjectSummary>;
    rename(id: string, name: string): Promise<void>;
    archive(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    duplicate(id: string): Promise<ProjectSummary>;
  };
  members: {
    list(projectId: string): Promise<ProjectMemberRecord[]>;
    invite(projectId: string, email: string, role: Exclude<ProjectRole, 'owner'>): Promise<ProjectMemberRecord>;
    setRole(projectId: string, userId: string, role: Exclude<ProjectRole, 'owner'>): Promise<ProjectMemberRecord>;
    remove(projectId: string, userId: string): Promise<void>;
  };
  workspaces: {
    load(projectId: string): Promise<WorkspaceRecord | null>;
    save(projectId: string, workspace: Record<string, unknown>, expectedRevision: number): Promise<{ revision: number }>;
  };
  collaboration: {
    connect(input: {
      projectId: string;
      sceneId: string;
      clientId: string;
      onOperation(operation: CollaborationOperation): void;
      onPresence(presence: CollaborationPresence[]): void;
    }): Promise<CollaborationConnection>;
  };
  versions: {
    listBranches(projectId: string): Promise<BranchRecord[]>;
    createBranch(projectId: string, name: string, baseCheckpointId?: string | null): Promise<BranchRecord>;
    listCheckpoints(projectId: string, branchId?: string): Promise<CheckpointRecord[]>;
    createCheckpoint(projectId: string, branchId: string, label: string, snapshot: KyxosSceneContract): Promise<CheckpointRecord>;
  };
  sourceFiles: {
    list(projectId: string): Promise<SourceFileRecord[]>;
    save(projectId: string, path: string, language: string, content: string, expectedRevision: number): Promise<SourceFileRecord>;
    remove(projectId: string, path: string): Promise<void>;
  };
  assets: {
    createUpload(input: {
      hash: string;
      name: string;
      mimeType: string;
      byteSize: number;
    }): Promise<UploadTicket>;
    upload(ticket: UploadTicket, file: Blob): Promise<void>;
    completeUpload(assetId: string, metadata?: Record<string, unknown>): Promise<void>;
    getManifest(assetIds: string[]): Promise<AssetManifest>;
    getBlobUrl(hash: string): Promise<string | null>;
    restoreBlob?(hash: string, blob: Blob): Promise<void>;
  };
  drafts: {
    load(projectId: string): Promise<DraftRecord | null>;
    save(
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<{ revision: number }>;
    getRevision(projectId: string): Promise<number>;
  };
  releases: {
    publish(
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
      thumbnail?: Blob,
    ): Promise<ReleaseRecord>;
    list(projectId: string): Promise<ReleaseRecord[]>;
    setCurrent(projectId: string, versionId: string): Promise<void>;
    disablePublic(projectId: string): Promise<void>;
  };
  publicScenes: {
    resolveSlug(slug: string): Promise<ReleaseRecord>;
    getVersion(versionId: string): Promise<ReleaseRecord>;
  };
}

const LOCAL_KEY = 'kyxos-studio-local-v1';

interface LocalAsset {
  id: string;
  hash: string;
  name: string;
  mimeType: string;
  byteSize: number;
  completed?: boolean;
  metadata?: Record<string, unknown>;
}

interface LocalState {
  session: Session | null;
  projects: ProjectSummary[];
  drafts: Record<string, DraftRecord>;
  releases: ReleaseRecord[];
  assets: Record<string, LocalAsset>;
  current: Record<string, string>;
  disabled: string[];
  members: ProjectMemberRecord[];
  workspaces: Record<string, WorkspaceRecord>;
  operations: CollaborationOperation[];
  presence: CollaborationPresence[];
  branches: BranchRecord[];
  checkpoints: CheckpointRecord[];
  sourceFiles: SourceFileRecord[];
}

function emptyLocalState(): LocalState {
  return {
    session: null,
    projects: [],
    drafts: {},
    releases: [],
    assets: {},
    current: {},
    disabled: [],
    members: [],
    workspaces: {},
    operations: [],
    presence: [],
    branches: [],
    checkpoints: [],
    sourceFiles: [],
  };
}

function loadState(): LocalState {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Partial<LocalState>;
    const state = { ...emptyLocalState(), ...parsed };
    if (state.session) {
      for (const project of state.projects) {
        if (!state.members.some((member) => member.projectId === project.id)) {
          state.members.push({
            projectId: project.id,
            userId: state.session.userId,
            email: state.session.email,
            role: 'owner',
            createdAt: project.createdAt,
          });
        }
      }
    }
    return state;
  } catch {
    return emptyLocalState();
  }
}

function saveState(state: LocalState): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

function requireSession(state: LocalState): Session {
  if (!state.session) throw new Error('Authentication required.');
  return state.session;
}

function localRole(state: LocalState, projectId: string): ProjectRole | null {
  const session = requireSession(state);
  return state.members.find((member) => member.projectId === projectId && member.userId === session.userId)?.role ?? null;
}

function requireLocalRole(state: LocalState, projectId: string, roles: ProjectRole[]): ProjectRole {
  const role = localRole(state, projectId);
  if (!role || !roles.includes(role)) throw new Error('Project permission denied.');
  return role;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeSourcePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Source file path must be a safe project-relative path.');
  }
  return normalized.slice(0, 320);
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

const localCollaborationHub = new EventTarget();

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('kyxos-assets', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('blobs')) {
        request.result.createObjectStore('blobs');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface StoredAssetBlobRecord {
  bytes: ArrayBuffer;
  type: string;
}

function decodeStoredAssetBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredAssetBlobRecord>;
  if (!(record.bytes instanceof ArrayBuffer)) return null;
  return new Blob([record.bytes], {
    type: typeof record.type === 'string' && record.type
      ? record.type
      : 'application/octet-stream',
  });
}

async function putBlob(hash: string, blob: Blob): Promise<void> {
  const persistable: StoredAssetBlobRecord = {
    bytes: await blob.arrayBuffer(),
    type: blob.type || 'application/octet-stream',
  };
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('blobs', 'readwrite');
      const request = transaction.objectStore('blobs').put(persistable, hash);
      const failure = () => reject(
        transaction.error
          ?? request.error
          ?? new Error(`IndexedDB rejected asset bytes ${hash}.`),
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = failure;
      transaction.onabort = failure;
      request.onerror = failure;
    });
  } finally {
    db.close();
  }
}

async function getBlob(hash: string): Promise<Blob | null> {
  const db = await openAssetDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('blobs').objectStore('blobs').get(hash);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return decodeStoredAssetBlob(value);
  } finally {
    db.close();
  }
}

export class LocalKyxosApiClient implements KyxosApiClient {
  auth = {
    signIn: async (email: string, _password: string): Promise<Session> => {
      const normalized = email.trim().toLowerCase();
      if (!normalized || !normalized.includes('@')) throw new Error('A valid email is required.');
      const state = loadState();
      state.session = { userId: `local:${normalized}`, email: normalized };
      saveState(state);
      return structuredClone(state.session);
    },
    signOut: async (): Promise<void> => {
      const state = loadState();
      state.session = null;
      saveState(state);
    },
    getSession: async (): Promise<Session | null> => {
      const session = loadState().session;
      return session ? structuredClone(session) : null;
    },
  };

  projects = {
    list: async (): Promise<ProjectSummary[]> => {
      const state = loadState();
      const session = requireSession(state);
      const accessible = new Set(
        state.members.filter((member) => member.userId === session.userId).map((member) => member.projectId),
      );
      return state.projects
        .filter((project) => project.status === 'active' && accessible.has(project.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((project) => structuredClone(project));
    },
    create: async (name: string): Promise<ProjectSummary> => {
      const state = loadState();
      const session = requireSession(state);
      const timestamp = now();
      const project: ProjectSummary = {
        id: crypto.randomUUID(),
        name: name.trim() || 'Untitled Project',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.projects.push(project);
      state.members.push({
        projectId: project.id,
        userId: session.userId,
        email: session.email,
        role: 'owner',
        createdAt: timestamp,
      });
      saveState(state);
      return structuredClone(project);
    },
    get: async (id: string): Promise<ProjectSummary> => {
      const state = loadState();
      requireLocalRole(state, id, ['owner', 'editor', 'viewer']);
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error('Project not found.');
      return structuredClone(project);
    },
    rename: async (id: string, name: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, id, ['owner', 'editor']);
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error('Project not found.');
      project.name = name.trim() || project.name;
      project.updatedAt = now();
      saveState(state);
    },
    archive: async (id: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, id, ['owner', 'editor']);
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error('Project not found.');
      project.status = 'archived';
      project.updatedAt = now();
      saveState(state);
    },
    remove: async (id: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, id, ['owner']);
      if (state.releases.some((entry) => entry.projectId === id)) {
        throw new Error('Published projects must be archived; published snapshots are immutable.');
      }
      state.projects = state.projects.filter((entry) => entry.id !== id);
      delete state.drafts[id];
      delete state.workspaces[id];
      state.members = state.members.filter((entry) => entry.projectId !== id);
      state.sourceFiles = state.sourceFiles.filter((entry) => entry.projectId !== id);
      saveState(state);
    },
    duplicate: async (id: string): Promise<ProjectSummary> => {
      const state = loadState();
      const session = requireSession(state);
      requireLocalRole(state, id, ['owner', 'editor']);
      const source = state.projects.find((entry) => entry.id === id);
      if (!source) throw new Error('Project not found.');
      const timestamp = now();
      const project: ProjectSummary = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        name: `${source.name} Copy`,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.projects.push(project);
      state.members.push({
        projectId: project.id,
        userId: session.userId,
        email: session.email,
        role: 'owner',
        createdAt: timestamp,
      });
      if (state.drafts[id]) {
        state.drafts[project.id] = {
          ...structuredClone(state.drafts[id]),
          projectId: project.id,
          revision: 1,
          updatedAt: timestamp,
        };
      }
      if (state.workspaces[id]) {
        state.workspaces[project.id] = {
          ...structuredClone(state.workspaces[id]),
          projectId: project.id,
          revision: 1,
          updatedAt: timestamp,
        };
      }
      state.sourceFiles.push(...state.sourceFiles
        .filter((entry) => entry.projectId === id)
        .map((entry) => ({
          ...structuredClone(entry),
          id: crypto.randomUUID(),
          projectId: project.id,
          revision: 1,
          updatedBy: session.userId,
          updatedAt: timestamp,
        })));
      saveState(state);
      return structuredClone(project);
    },
  };

  members = {
    list: async (projectId: string): Promise<ProjectMemberRecord[]> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.members.filter((member) => member.projectId === projectId).map((member) => structuredClone(member));
    },
    invite: async (
      projectId: string,
      email: string,
      role: Exclude<ProjectRole, 'owner'>,
    ): Promise<ProjectMemberRecord> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner']);
      const normalized = email.trim().toLowerCase();
      if (!normalized.includes('@')) throw new Error('A valid member email is required.');
      let member = state.members.find((entry) => entry.projectId === projectId && entry.userId === `local:${normalized}`);
      if (member) member.role = role;
      else {
        member = { projectId, userId: `local:${normalized}`, email: normalized, role, createdAt: now() };
        state.members.push(member);
      }
      saveState(state);
      return structuredClone(member);
    },
    setRole: async (
      projectId: string,
      userId: string,
      role: Exclude<ProjectRole, 'owner'>,
    ): Promise<ProjectMemberRecord> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner']);
      const member = state.members.find((entry) => entry.projectId === projectId && entry.userId === userId && entry.role !== 'owner');
      if (!member) throw new Error('Project member not found.');
      member.role = role;
      saveState(state);
      return structuredClone(member);
    },
    remove: async (projectId: string, userId: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner']);
      state.members = state.members.filter((entry) => !(entry.projectId === projectId && entry.userId === userId && entry.role !== 'owner'));
      saveState(state);
    },
  };

  workspaces = {
    load: async (projectId: string): Promise<WorkspaceRecord | null> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.workspaces[projectId] ? structuredClone(state.workspaces[projectId]) : null;
    },
    save: async (
      projectId: string,
      workspace: Record<string, unknown>,
      expectedRevision: number,
    ): Promise<{ revision: number }> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const current = state.workspaces[projectId];
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Workspace revision conflict.');
      if (workspace.version !== 1) throw new Error('Unsupported workspace version.');
      const revision = expectedRevision + 1;
      state.workspaces[projectId] = { projectId, workspace: structuredClone(workspace), revision, updatedAt: now() };
      saveState(state);
      return { revision };
    },
  };

  collaboration = {
    connect: async (input: {
      projectId: string;
      sceneId: string;
      clientId: string;
      onOperation(operation: CollaborationOperation): void;
      onPresence(presence: CollaborationPresence[]): void;
    }): Promise<CollaborationConnection> => {
      const state = loadState();
      const session = requireSession(state);
      requireLocalRole(state, input.projectId, ['owner', 'editor', 'viewer']);
      const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`kyxos-project:${input.projectId}`);
      const receive = (payload: any) => {
        if (payload?.type === 'operation' && payload.operation?.sceneId === input.sceneId) input.onOperation(payload.operation);
        if (payload?.type === 'presence') input.onPresence(payload.presence);
      };
      const onLocal = (event: Event) => receive((event as CustomEvent).detail);
      const onBroadcast = (event: MessageEvent) => receive(event.data);
      localCollaborationHub.addEventListener(input.projectId, onLocal);
      channel?.addEventListener('message', onBroadcast);
      input.onPresence(state.presence.filter((entry) => entry.projectId === input.projectId));
      return {
        publishOperation: async (operation) => {
          const latest = loadState();
          requireLocalRole(latest, input.projectId, ['owner', 'editor']);
          if (operation.userId !== session.userId) throw new Error('Operation user does not match the session.');
          if (!latest.operations.some((entry) => entry.id === operation.id)) latest.operations.push(structuredClone(operation));
          latest.operations = latest.operations.slice(-5_000);
          saveState(latest);
          const payload = { type: 'operation', operation: structuredClone(operation) };
          localCollaborationHub.dispatchEvent(new CustomEvent(input.projectId, { detail: payload }));
          channel?.postMessage(payload);
        },
        publishPresence: async (presence) => {
          const latest = loadState();
          const latestSession = requireSession(latest);
          requireLocalRole(latest, input.projectId, ['owner', 'editor', 'viewer']);
          if (
            latestSession.userId !== session.userId ||
            presence.projectId !== input.projectId ||
            presence.userId !== session.userId ||
            presence.clientId !== input.clientId
          ) {
            throw new Error('Presence identity does not match the collaboration session.');
          }
          const index = latest.presence.findIndex((entry) => entry.projectId === input.projectId && entry.userId === presence.userId && entry.clientId === presence.clientId);
          if (index >= 0) latest.presence[index] = structuredClone(presence);
          else latest.presence.push(structuredClone(presence));
          latest.presence = latest.presence.filter((entry) => Date.now() - entry.updatedAt < 60_000);
          saveState(latest);
          const payload = { type: 'presence', presence: latest.presence.filter((entry) => entry.projectId === input.projectId) };
          localCollaborationHub.dispatchEvent(new CustomEvent(input.projectId, { detail: payload }));
          channel?.postMessage(payload);
        },
        dispose() {
          localCollaborationHub.removeEventListener(input.projectId, onLocal);
          channel?.removeEventListener('message', onBroadcast);
          channel?.close();
        },
      };
    },
  };

  versions = {
    listBranches: async (projectId: string): Promise<BranchRecord[]> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.branches.filter((entry) => entry.projectId === projectId).map((entry) => structuredClone(entry));
    },
    createBranch: async (projectId: string, name: string, baseCheckpointId: string | null = null): Promise<BranchRecord> => {
      const state = loadState();
      const session = requireSession(state);
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const branch: BranchRecord = {
        id: crypto.randomUUID(), projectId, name: name.trim() || 'Branch',
        headCheckpointId: baseCheckpointId, baseCheckpointId,
        createdBy: session.userId, createdAt: now(),
      };
      state.branches.push(branch);
      saveState(state);
      return structuredClone(branch);
    },
    listCheckpoints: async (projectId: string, branchId?: string): Promise<CheckpointRecord[]> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.checkpoints.filter((entry) => entry.projectId === projectId && (!branchId || entry.branchId === branchId)).map((entry) => structuredClone(entry));
    },
    createCheckpoint: async (
      projectId: string,
      branchId: string,
      label: string,
      snapshot: KyxosSceneContract,
    ): Promise<CheckpointRecord> => {
      assertSceneContract(snapshot);
      const state = loadState();
      const session = requireSession(state);
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const branch = state.branches.find((entry) => entry.id === branchId && entry.projectId === projectId);
      if (!branch) throw new Error('Version branch not found.');
      const checkpoint: CheckpointRecord = {
        id: crypto.randomUUID(), projectId, branchId, parentId: branch.headCheckpointId,
        label: label.trim() || 'Checkpoint', snapshot: structuredClone(snapshot),
        createdBy: session.userId, createdAt: now(),
      };
      state.checkpoints.push(checkpoint);
      branch.headCheckpointId = checkpoint.id;
      saveState(state);
      return structuredClone(checkpoint);
    },
  };

  sourceFiles = {
    list: async (projectId: string): Promise<SourceFileRecord[]> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.sourceFiles
        .filter((entry) => entry.projectId === projectId)
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((entry) => structuredClone(entry));
    },
    save: async (
      projectId: string,
      path: string,
      language: string,
      content: string,
      expectedRevision: number,
    ): Promise<SourceFileRecord> => {
      const state = loadState();
      const session = requireSession(state);
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const normalized = normalizeSourcePath(path);
      const existing = state.sourceFiles.find((entry) => entry.projectId === projectId && entry.path === normalized);
      if ((existing?.revision ?? 0) !== expectedRevision) throw new Error('Source file revision conflict.');
      const record: SourceFileRecord = existing ?? {
        id: crypto.randomUUID(), projectId, path: normalized, language, content: '', revision: 0,
        updatedBy: session.userId, updatedAt: now(),
      };
      record.language = language || 'plaintext';
      record.content = content;
      record.revision += 1;
      record.updatedBy = session.userId;
      record.updatedAt = now();
      if (!existing) state.sourceFiles.push(record);
      saveState(state);
      return structuredClone(record);
    },
    remove: async (projectId: string, path: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const normalized = normalizeSourcePath(path);
      state.sourceFiles = state.sourceFiles.filter((entry) => !(entry.projectId === projectId && entry.path === normalized));
      saveState(state);
    },
  };

  assets = {
    createUpload: async ({
      hash,
      name,
      mimeType,
      byteSize,
    }: {
      hash: string;
      name: string;
      mimeType: string;
      byteSize: number;
    }): Promise<UploadTicket> => {
      const state = loadState();
      requireSession(state);
      const existing = Object.values(state.assets).find((asset) => asset.hash === hash);
      if (existing) {
        return {
          assetId: existing.id,
          storageKey: hash,
          alreadyExists: existing.completed !== false,
        };
      }
      const id = crypto.randomUUID();
      state.assets[id] = {
        id,
        hash,
        name: name.normalize('NFKC').replace(/[^\w. -]/g, '_').slice(0, 180),
        mimeType,
        byteSize,
        completed: false,
      };
      saveState(state);
      return { assetId: id, storageKey: hash };
    },
    upload: async (ticket: UploadTicket, file: Blob): Promise<void> => {
      if (ticket.alreadyExists) return;
      await putBlob(ticket.storageKey, file);
    },
    completeUpload: async (
      assetId: string,
      metadata?: Record<string, unknown>,
    ): Promise<void> => {
      const state = loadState();
      requireSession(state);
      const asset = state.assets[assetId];
      if (!asset) throw new Error('Asset not found.');
      const blob = await getBlob(asset.hash);
      if (!blob) throw new Error('Uploaded asset data is missing.');
      if (blob.size !== asset.byteSize) throw new Error('Uploaded byte size does not match.');
      if ((await hashBlob(blob)) !== asset.hash) throw new Error('Uploaded content hash does not match.');
      asset.completed = true;
      asset.metadata = structuredClone(metadata ?? {});
      saveState(state);
    },
    getManifest: async (assetIds: string[]): Promise<AssetManifest> => {
      const state = loadState();
      const assets: Record<string, string> = {};
      for (const id of [...new Set(assetIds)]) {
        const asset = state.assets[id];
        if (!asset || asset.completed === false) continue;
        const blob = await getBlob(asset.hash);
        if (blob) assets[`asset://${asset.hash}`] = URL.createObjectURL(blob);
      }
      return { assets };
    },
    getBlobUrl: async (hash: string): Promise<string | null> => {
      const blob = await getBlob(hash);
      return blob ? URL.createObjectURL(blob) : null;
    },
    restoreBlob: async (hash: string, blob: Blob): Promise<void> => {
      if (!hash || !blob.size) throw new Error('Recovered asset Blob is empty.');
      await putBlob(hash, blob);
      const persisted = await getBlob(hash);
      if (!persisted || persisted.size !== blob.size) {
        throw new Error('Recovered asset Blob could not be verified after persistence.');
      }
    },
  };

  drafts = {
    load: async (projectId: string): Promise<DraftRecord | null> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.drafts[projectId] ? structuredClone(state.drafts[projectId]) : null;
    },
    save: async (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<{ revision: number }> => {
      assertSceneContract(contract);
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const current = state.drafts[projectId];
      if ((current?.revision ?? 0) !== expectedRevision) {
        throw new Error(
          `Revision conflict: expected ${expectedRevision}, current ${current?.revision ?? 0}.`,
        );
      }
      const revision = expectedRevision + 1;
      const timestamp = now();
      state.drafts[projectId] = {
        projectId,
        contract: structuredClone(contract),
        revision,
        updatedAt: timestamp,
      };
      const project = state.projects.find((entry) => entry.id === projectId);
      if (project) project.updatedAt = timestamp;
      saveState(state);
      return { revision };
    },
    getRevision: async (projectId: string): Promise<number> =>
      (() => {
        const state = loadState();
        requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
        return state.drafts[projectId]?.revision ?? 0;
      })(),
  };

  releases = {
    publish: async (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
      _thumbnail?: Blob,
    ): Promise<ReleaseRecord> => {
      assertSceneContract(contract);
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const draft = state.drafts[projectId];
      if (!draft || draft.revision !== expectedRevision) {
        throw new Error('Publish revision conflict. Flush autosave before publishing.');
      }
      const project = state.projects.find((entry) => entry.id === projectId);
      if (!project) throw new Error('Project not found.');
      for (const asset of Object.values(contract.assets)) {
        const stored = Object.values(state.assets).find(
          (entry) => entry.hash === asset.contentHash && entry.completed !== false,
        );
        if (!stored) throw new Error(`Missing asset ${asset.contentHash}.`);
      }

      const digest = await sha256(sceneDigestInput(contract));
      const existing = state.releases.find(
        (entry) => entry.projectId === projectId && entry.sceneDigest === digest,
      );
      if (existing) {
        for (const release of state.releases) {
          if (release.projectId === projectId) release.isCurrent = release.id === existing.id;
        }
        state.current[projectId] = existing.id;
        state.disabled = state.disabled.filter((id) => id !== projectId);
        saveState(state);
        return structuredClone(existing);
      }

      const versionNumber =
        state.releases.filter((entry) => entry.projectId === projectId).length + 1;
      const existingSlug = state.releases.find((entry) => entry.projectId === projectId)?.slug;
      const release: ReleaseRecord = {
        id: crypto.randomUUID(),
        projectId,
        versionNumber,
        sceneSnapshot: structuredClone(contract),
        sceneDigest: digest,
        slug: existingSlug ?? publicSlug(project.name),
        createdAt: now(),
        isCurrent: true,
      };
      for (const entry of state.releases) {
        if (entry.projectId === projectId) entry.isCurrent = false;
      }
      state.releases.push(release);
      state.current[projectId] = release.id;
      state.disabled = state.disabled.filter((id) => id !== projectId);
      saveState(state);
      return structuredClone(release);
    },
    list: async (projectId: string): Promise<ReleaseRecord[]> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor', 'viewer']);
      return state.releases
        .filter((entry) => entry.projectId === projectId)
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map((entry) => structuredClone(entry));
    },
    setCurrent: async (projectId: string, versionId: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor']);
      const version = state.releases.find(
        (entry) => entry.id === versionId && entry.projectId === projectId,
      );
      if (!version) throw new Error('Release not found.');
      for (const entry of state.releases) {
        if (entry.projectId === projectId) entry.isCurrent = entry.id === versionId;
      }
      state.current[projectId] = versionId;
      state.disabled = state.disabled.filter((id) => id !== projectId);
      saveState(state);
    },
    disablePublic: async (projectId: string): Promise<void> => {
      const state = loadState();
      requireLocalRole(state, projectId, ['owner', 'editor']);
      if (!state.disabled.includes(projectId)) state.disabled.push(projectId);
      saveState(state);
    },
  };

  publicScenes = {
    resolveSlug: async (slugValue: string): Promise<ReleaseRecord> => {
      const state = loadState();
      const release = state.releases.find(
        (entry) => entry.slug === slugValue && entry.isCurrent,
      );
      if (!release || state.disabled.includes(release.projectId)) {
        throw new Error('Public link is disabled or does not exist.');
      }
      return structuredClone(release);
    },
    getVersion: async (versionId: string): Promise<ReleaseRecord> => {
      const state = loadState();
      const release = state.releases.find((entry) => entry.id === versionId);
      if (!release || state.disabled.includes(release.projectId)) {
        throw new Error('Published version does not exist or public access is disabled.');
      }
      return structuredClone(release);
    },
  };
}

export interface SupabaseClientOptions {
  url: string;
  anonKey: string;
  functionsUrl?: string;
}

export class SupabaseKyxosApiClient implements KyxosApiClient {
  private token: string | null = null;
  private readonly realtimeClient: SupabaseClient;

  constructor(private readonly options: SupabaseClientOptions) {
    this.token = sessionStorage.getItem('kyxos-token');
    this.realtimeClient = createClient(options.url, options.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    if (this.token) this.realtimeClient.realtime.setAuth(this.token);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.options.anonKey);
    headers.set('authorization', `Bearer ${this.token ?? this.options.anonKey}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const base = this.options.functionsUrl ?? `${this.options.url}/functions/v1`;
    const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text || response.statusText}`);
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  auth = {
    signIn: async (email: string, password: string): Promise<Session> => {
      const response = await fetch(`${this.options.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: this.options.anonKey },
        body: JSON.stringify({ email, password }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || 'Sign in failed.');
      const data = JSON.parse(text);
      this.token = data.access_token;
      sessionStorage.setItem('kyxos-token', this.token ?? '');
      this.realtimeClient.realtime.setAuth(this.token);
      return {
        userId: data.user.id,
        email: data.user.email,
        accessToken: data.access_token,
      };
    },
    signOut: async (): Promise<void> => {
      if (this.token) {
        await fetch(`${this.options.url}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            apikey: this.options.anonKey,
            authorization: `Bearer ${this.token}`,
          },
        }).catch(() => undefined);
      }
      this.token = null;
      this.realtimeClient.realtime.setAuth();
      sessionStorage.removeItem('kyxos-token');
    },
    getSession: async (): Promise<Session | null> => {
      this.token ??= sessionStorage.getItem('kyxos-token');
      if (!this.token) return null;
      const response = await fetch(`${this.options.url}/auth/v1/user`, {
        headers: {
          apikey: this.options.anonKey,
          authorization: `Bearer ${this.token}`,
        },
      });
      if (!response.ok) {
        this.token = null;
        sessionStorage.removeItem('kyxos-token');
        return null;
      }
      const user = await response.json();
      return { userId: user.id, email: user.email, accessToken: this.token };
    },
  };

  projects = {
    list: (): Promise<ProjectSummary[]> => this.request('projects'),
    create: (name: string): Promise<ProjectSummary> =>
      this.request('projects', { method: 'POST', body: JSON.stringify({ name }) }),
    get: (id: string): Promise<ProjectSummary> => this.request(`projects/${id}`),
    rename: async (id: string, name: string): Promise<void> => {
      await this.request(`projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
    },
    archive: async (id: string): Promise<void> => {
      await this.request(`projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
    },
    remove: async (id: string): Promise<void> => {
      await this.request(`projects/${id}`, { method: 'DELETE' });
    },
    duplicate: (id: string): Promise<ProjectSummary> =>
      this.request(`projects/${id}/duplicate`, { method: 'POST' }),
  };

  members = {
    list: (projectId: string): Promise<ProjectMemberRecord[]> =>
      this.request(`projects/${projectId}/members`),
    invite: (
      projectId: string,
      email: string,
      role: Exclude<ProjectRole, 'owner'>,
    ): Promise<ProjectMemberRecord> =>
      this.request(`projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),
    setRole: (
      projectId: string,
      userId: string,
      role: Exclude<ProjectRole, 'owner'>,
    ): Promise<ProjectMemberRecord> =>
      this.request(`projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    remove: async (projectId: string, userId: string): Promise<void> => {
      await this.request(`projects/${projectId}/members/${userId}`, { method: 'DELETE' });
    },
  };

  workspaces = {
    load: (projectId: string): Promise<WorkspaceRecord | null> =>
      this.request(`workspaces/${projectId}`),
    save: (
      projectId: string,
      workspace: Record<string, unknown>,
      expectedRevision: number,
    ): Promise<{ revision: number }> =>
      this.request(`workspaces/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ workspace, expectedRevision }),
      }),
  };

  collaboration = {
    connect: async (input: {
      projectId: string;
      sceneId: string;
      clientId: string;
      onOperation(operation: CollaborationOperation): void;
      onPresence(presence: CollaborationPresence[]): void;
    }): Promise<CollaborationConnection> => {
      if (!this.token) throw new Error('Authentication required for realtime collaboration.');
      this.realtimeClient.realtime.setAuth(this.token);
      const channel = this.realtimeClient.channel(`project:${input.projectId}`, {
        config: {
          private: true,
          broadcast: { self: false, ack: true },
          presence: { key: input.clientId },
        },
      });
      channel
        .on('broadcast', { event: 'operation' }, (message: any) => {
          const operation = message.payload as CollaborationOperation;
          if (operation.sceneId === input.sceneId) input.onOperation(operation);
        })
        .on('presence', { event: 'sync' }, () => {
          const states = Object.values(channel.presenceState())
            .flat()
            .filter((entry: any) => entry.projectId === input.projectId)
            .map((entry: any) => entry as CollaborationPresence);
          input.onPresence(states);
        });
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Realtime connection timed out.')), 10_000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') { window.clearTimeout(timeout); resolve() }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            window.clearTimeout(timeout);
            reject(new Error(`Realtime connection failed: ${status}.`));
          }
        });
      });
      return {
        publishOperation: async (operation) => {
          await this.request(`collaboration/${input.projectId}/operations`, {
            method: 'POST', body: JSON.stringify(operation),
          });
          const result = await channel.send({ type: 'broadcast', event: 'operation', payload: operation });
          if (result !== 'ok') throw new Error(`Realtime operation broadcast failed: ${result}.`);
        },
        publishPresence: async (presence) => {
          await this.request(`collaboration/${input.projectId}/presence`, {
            method: 'POST', body: JSON.stringify(presence),
          });
          const result = await channel.track(presence);
          if (result !== 'ok') throw new Error(`Realtime presence update failed: ${result}.`);
        },
        dispose: () => { void this.realtimeClient.removeChannel(channel) },
      };
    },
  };

  versions = {
    listBranches: (projectId: string): Promise<BranchRecord[]> =>
      this.request(`versions/${projectId}/branches`),
    createBranch: (projectId: string, name: string, baseCheckpointId: string | null = null): Promise<BranchRecord> =>
      this.request(`versions/${projectId}/branches`, {
        method: 'POST', body: JSON.stringify({ name, baseCheckpointId }),
      }),
    listCheckpoints: (projectId: string, branchId?: string): Promise<CheckpointRecord[]> =>
      this.request(`versions/${projectId}/checkpoints${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`),
    createCheckpoint: (
      projectId: string,
      branchId: string,
      label: string,
      snapshot: KyxosSceneContract,
    ): Promise<CheckpointRecord> =>
      this.request(`versions/${projectId}/checkpoints`, {
        method: 'POST', body: JSON.stringify({ branchId, label, snapshot }),
      }),
  };

  sourceFiles = {
    list: (projectId: string): Promise<SourceFileRecord[]> =>
      this.request(`source-files/${projectId}`),
    save: (
      projectId: string,
      path: string,
      language: string,
      content: string,
      expectedRevision: number,
    ): Promise<SourceFileRecord> =>
      this.request(`source-files/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ path, language, content, expectedRevision }),
      }),
    remove: async (projectId: string, path: string): Promise<void> => {
      await this.request(`source-files/${projectId}?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    },
  };

  assets = {
    createUpload: (input: {
      hash: string;
      name: string;
      mimeType: string;
      byteSize: number;
    }): Promise<UploadTicket> =>
      this.request('assets/upload', { method: 'POST', body: JSON.stringify(input) }),
    upload: async (ticket: UploadTicket, file: Blob): Promise<void> => {
      if (ticket.alreadyExists) return;
      if (!ticket.uploadToken) throw new Error('Signed upload token is missing.');
      const { error } = await this.realtimeClient.storage
        .from('kyxos-assets')
        .uploadToSignedUrl(ticket.storageKey, ticket.uploadToken, file, {
          cacheControl: '31536000',
          contentType: file.type || 'application/octet-stream',
        });
      if (error) throw new Error(`Signed asset upload failed: ${error.message}`);
    },
    completeUpload: async (
      assetId: string,
      metadata?: Record<string, unknown>,
    ): Promise<void> => {
      await this.request('assets/complete', {
        method: 'POST',
        body: JSON.stringify({ assetId, metadata }),
      });
    },
    getManifest: (assetIds: string[]): Promise<AssetManifest> =>
      this.request('assets/manifest', {
        method: 'POST',
        body: JSON.stringify({ assetIds }),
      }),
    getBlobUrl: async (): Promise<string | null> => null,
  };

  drafts = {
    load: (projectId: string): Promise<DraftRecord | null> =>
      this.request(`drafts/${projectId}`),
    save: (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<{ revision: number }> =>
      this.request(`drafts/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ contract, expectedRevision }),
      }),
    getRevision: async (projectId: string): Promise<number> =>
      (await this.request<{ revision: number }>(`drafts/${projectId}/revision`)).revision,
  };

  releases = {
    publish: (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<ReleaseRecord> =>
      this.request('releases/publish', {
        method: 'POST',
        body: JSON.stringify({ projectId, contract, expectedRevision }),
      }),
    list: (projectId: string): Promise<ReleaseRecord[]> =>
      this.request(`releases?projectId=${encodeURIComponent(projectId)}`),
    setCurrent: async (projectId: string, versionId: string): Promise<void> => {
      await this.request('releases/current', {
        method: 'POST',
        body: JSON.stringify({ projectId, versionId }),
      });
    },
    disablePublic: async (projectId: string): Promise<void> => {
      await this.request('releases/disable', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });
    },
  };

  publicScenes = {
    resolveSlug: (slugValue: string): Promise<ReleaseRecord> =>
      this.request(`public/slug/${encodeURIComponent(slugValue)}`),
    getVersion: (versionId: string): Promise<ReleaseRecord> =>
      this.request(`public/version/${encodeURIComponent(versionId)}`),
  };
}

export function createApiClient(
  options?: Partial<SupabaseClientOptions>,
): KyxosApiClient {
  return options?.url && options?.anonKey
    ? new SupabaseKyxosApiClient(options as SupabaseClientOptions)
    : new LocalKyxosApiClient();
}

export async function hashBlob(blob: Blob): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function assetResolverFromManifest(manifest: AssetManifest) {
  return {
    resolve(asset: SceneAsset): string {
      const url = manifest.assets[asset.uri];
      if (!url) throw new Error(`Asset is unavailable: ${asset.uri}`);
      return url;
    },
  };
}
