import {
  assertSceneContract,
  sceneDigestInput,
  type KyxosSceneContract,
  type SceneAsset,
} from '@kyxos/scene-contract';

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
  };
}

function loadState(): LocalState {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Partial<LocalState>;
    return { ...emptyLocalState(), ...parsed };
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

function now(): string {
  return new Date().toISOString();
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

async function putBlob(hash: string, blob: Blob): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('blobs', 'readwrite');
    transaction.objectStore('blobs').put(blob, hash);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getBlob(hash: string): Promise<Blob | null> {
  const db = await openAssetDb();
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction('blobs').objectStore('blobs').get(hash);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
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
      requireSession(state);
      return state.projects
        .filter((project) => project.status === 'active')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((project) => structuredClone(project));
    },
    create: async (name: string): Promise<ProjectSummary> => {
      const state = loadState();
      requireSession(state);
      const timestamp = now();
      const project: ProjectSummary = {
        id: crypto.randomUUID(),
        name: name.trim() || 'Untitled Project',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.projects.push(project);
      saveState(state);
      return structuredClone(project);
    },
    get: async (id: string): Promise<ProjectSummary> => {
      const state = loadState();
      requireSession(state);
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error('Project not found.');
      return structuredClone(project);
    },
    rename: async (id: string, name: string): Promise<void> => {
      const state = loadState();
      requireSession(state);
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error('Project not found.');
      project.name = name.trim() || project.name;
      project.updatedAt = now();
      saveState(state);
    },
    archive: async (id: string): Promise<void> => {
      const state = loadState();
      requireSession(state);
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error('Project not found.');
      project.status = 'archived';
      project.updatedAt = now();
      saveState(state);
    },
    remove: async (id: string): Promise<void> => {
      const state = loadState();
      requireSession(state);
      if (state.releases.some((entry) => entry.projectId === id)) {
        throw new Error('Published projects must be archived; published snapshots are immutable.');
      }
      state.projects = state.projects.filter((entry) => entry.id !== id);
      delete state.drafts[id];
      saveState(state);
    },
    duplicate: async (id: string): Promise<ProjectSummary> => {
      const state = loadState();
      requireSession(state);
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
      if (state.drafts[id]) {
        state.drafts[project.id] = {
          ...structuredClone(state.drafts[id]),
          projectId: project.id,
          revision: 1,
          updatedAt: timestamp,
        };
      }
      saveState(state);
      return structuredClone(project);
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
  };

  drafts = {
    load: async (projectId: string): Promise<DraftRecord | null> => {
      const state = loadState();
      requireSession(state);
      return state.drafts[projectId] ? structuredClone(state.drafts[projectId]) : null;
    },
    save: async (
      projectId: string,
      contract: KyxosSceneContract,
      expectedRevision: number,
    ): Promise<{ revision: number }> => {
      assertSceneContract(contract);
      const state = loadState();
      requireSession(state);
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
      loadState().drafts[projectId]?.revision ?? 0,
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
      requireSession(state);
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
    list: async (projectId: string): Promise<ReleaseRecord[]> =>
      loadState()
        .releases.filter((entry) => entry.projectId === projectId)
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map((entry) => structuredClone(entry)),
    setCurrent: async (projectId: string, versionId: string): Promise<void> => {
      const state = loadState();
      requireSession(state);
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
      requireSession(state);
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

  constructor(private readonly options: SupabaseClientOptions) {
    this.token = sessionStorage.getItem('kyxos-token');
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
      if (!ticket.uploadUrl) throw new Error('Signed upload URL is missing.');
      const form = new FormData();
      form.append('cacheControl', '31536000');
      form.append('', file);
      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: { 'x-upsert': 'false', ...(ticket.headers ?? {}) },
        body: form,
      });
      if (!response.ok) {
        throw new Error(`Signed asset upload failed (${response.status}).`);
      }
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
