import { inspectAsset, type AssetImportResult } from '@kyxos/asset-importer';
import {
  createDefaultSceneDocument,
  createPublishedRevisionMetadata,
  fail,
  ok,
  type AssetReference,
  type KyxosResult,
  type KyxosSceneDocument,
  type ProjectMetadata,
  type PublishedRevisionMetadata,
} from '@kyxos/scene-contract';

export interface KyxosSession {
  userId: string;
  email: string;
  accessToken: string;
}

export interface KyxosProjectRecord {
  metadata: ProjectMetadata;
  draft: KyxosSceneDocument;
  draftRevision: number;
  publishedRevision: PublishedSceneRevision | null;
}

export interface PublishedSceneRevision {
  id: string;
  projectId: string;
  slug: string;
  revision: number;
  scene: KyxosSceneDocument;
  metadata: PublishedRevisionMetadata;
  createdAt: string;
}

export interface KyxosApiClient {
  readonly mode: 'mock' | 'supabase';
  signInWithMagicLink: (email: string) => Promise<KyxosResult<KyxosSession>>;
  getSession: () => Promise<KyxosResult<KyxosSession | null>>;
  signOut: () => Promise<KyxosResult<null>>;
  listProjects: () => Promise<KyxosResult<KyxosProjectRecord[]>>;
  createProject: (title: string) => Promise<KyxosResult<KyxosProjectRecord>>;
  getProject: (projectId: string) => Promise<KyxosResult<KyxosProjectRecord>>;
  renameProject: (projectId: string, title: string) => Promise<KyxosResult<KyxosProjectRecord>>;
  duplicateProject: (projectId: string) => Promise<KyxosResult<KyxosProjectRecord>>;
  deleteProject: (projectId: string) => Promise<KyxosResult<null>>;
  saveDraft: (
    projectId: string,
    document: KyxosSceneDocument,
    expectedRevision: number,
  ) => Promise<KyxosResult<KyxosProjectRecord>>;
  uploadAsset: (
    projectId: string,
    file: Blob | ArrayBuffer,
    options?: { fileName?: string; mimeType?: string },
  ) => Promise<KyxosResult<AssetImportResult>>;
  getSignedAssetUrl: (asset: AssetReference) => Promise<KyxosResult<string>>;
  publishProject: (
    projectId: string,
    visibility: 'unlisted' | 'public',
  ) => Promise<KyxosResult<PublishedSceneRevision>>;
  republishProject: (projectId: string) => Promise<KyxosResult<PublishedSceneRevision>>;
  unpublishProject: (projectId: string) => Promise<KyxosResult<KyxosProjectRecord>>;
  resolvePublicScene: (slug: string) => Promise<KyxosResult<PublishedSceneRevision>>;
  copyPublicLink: (slug: string, baseUrl?: string) => Promise<KyxosResult<string>>;
}

export interface KyxosApiClientOptions {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  storageBaseUrl?: string;
  ownerId?: string;
  ownerEmail?: string;
  fetchImpl?: typeof fetch;
  storage?: Storage;
}

const storageKey = 'kyxos-studio-v1-api-client';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || `scene-${Date.now()}`
  );
}

function now() {
  return new Date().toISOString();
}

function createProjectRecord(title: string, ownerId: string): KyxosProjectRecord {
  const id = `project-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const document = createDefaultSceneDocument({
    project: {
      id,
      ownerId,
      title,
      slug: slugify(title),
      visibility: 'draft',
      createdAt: now(),
      updatedAt: now(),
    },
  });
  return {
    metadata: clone(document.project),
    draft: document,
    draftRevision: 0,
    publishedRevision: null,
  };
}

function createStore(options: KyxosApiClientOptions) {
  const memory = {
    session: null as KyxosSession | null,
    projects: [] as KyxosProjectRecord[],
  };
  const localStorage = options.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);

  const load = () => {
    if (!localStorage) return memory;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return memory;
    try {
      const parsed = JSON.parse(raw) as typeof memory;
      memory.session = parsed.session;
      memory.projects = parsed.projects ?? [];
    } catch {
      localStorage.removeItem(storageKey);
    }
    return memory;
  };

  const save = () => {
    if (localStorage) localStorage.setItem(storageKey, JSON.stringify(memory));
  };

  return { load, save, memory };
}

export function createMockApiClient(options: KyxosApiClientOptions = {}): KyxosApiClient {
  const store = createStore(options);
  const ownerId = options.ownerId ?? 'local-user';
  const ownerEmail = options.ownerEmail ?? 'artist@example.com';

  const requireProject = (projectId: string): KyxosResult<KyxosProjectRecord> => {
    const state = store.load();
    const project = state.projects.find((item) => item.metadata.id === projectId);
    return project
      ? ok(clone(project), 'Project loaded.')
      : fail('KX_PERMISSION_DENIED', `Project ${projectId} was not found.`);
  };

  return {
    mode: 'mock',
    async signInWithMagicLink(email: string) {
      const state = store.load();
      state.session = {
        userId: ownerId,
        email,
        accessToken: `mock-token-${Date.now()}`,
      };
      store.save();
      return ok(clone(state.session), 'Mock magic link session created.');
    },
    async getSession() {
      const state = store.load();
      if (!state.session) {
        state.session = { userId: ownerId, email: ownerEmail, accessToken: 'mock-token' };
        store.save();
      }
      return ok(clone(state.session), 'Session loaded.');
    },
    async signOut() {
      const state = store.load();
      state.session = null;
      store.save();
      return ok(null, 'Signed out.');
    },
    async listProjects() {
      const state = store.load();
      if (state.projects.length === 0) {
        state.projects.push(createProjectRecord('Kyxos Acceptance Scene', ownerId));
        store.save();
      }
      return ok(clone(state.projects), 'Projects loaded.');
    },
    async createProject(title: string) {
      const state = store.load();
      const project = createProjectRecord(title, ownerId);
      state.projects.unshift(project);
      store.save();
      return ok(clone(project), 'Project created.');
    },
    async getProject(projectId: string) {
      return requireProject(projectId);
    },
    async renameProject(projectId: string, title: string) {
      const state = store.load();
      const project = state.projects.find((item) => item.metadata.id === projectId);
      if (!project) return fail('KX_PERMISSION_DENIED', `Project ${projectId} was not found.`);
      project.metadata.title = title;
      project.metadata.slug = slugify(title);
      project.metadata.updatedAt = now();
      project.draft.project = clone(project.metadata);
      store.save();
      return ok(clone(project), 'Project renamed.');
    },
    async duplicateProject(projectId: string) {
      const source = requireProject(projectId);
      if (!source.ok || !source.data) return source;
      const state = store.load();
      const duplicate = createProjectRecord(`${source.data.metadata.title} Copy`, ownerId);
      duplicate.draft = clone(source.data.draft);
      duplicate.draft.project = clone(duplicate.metadata);
      state.projects.unshift(duplicate);
      store.save();
      return ok(clone(duplicate), 'Project duplicated.');
    },
    async deleteProject(projectId: string) {
      const state = store.load();
      state.projects = state.projects.filter((project) => project.metadata.id !== projectId);
      store.save();
      return ok(null, 'Project deleted.');
    },
    async saveDraft(projectId: string, document: KyxosSceneDocument, expectedRevision: number) {
      const state = store.load();
      const project = state.projects.find((item) => item.metadata.id === projectId);
      if (!project) return fail('KX_PERMISSION_DENIED', `Project ${projectId} was not found.`);
      if (project.draftRevision !== expectedRevision) {
        return fail('KX_SAVE_CONFLICT', 'Draft revision conflict.', {
          expectedRevision,
          actualRevision: project.draftRevision,
        });
      }
      project.draft = clone(document);
      project.draftRevision += 1;
      project.metadata = clone(document.project);
      project.metadata.updatedAt = now();
      store.save();
      return ok(clone(project), 'Draft saved.');
    },
    async uploadAsset(projectId: string, file: Blob | ArrayBuffer, uploadOptions = {}) {
      const project = requireProject(projectId);
      if (!project.ok || !project.data) return fail(project.code, project.message ?? 'Project unavailable.');
      const result = await inspectAsset(file, {
        assetId: `asset-${Date.now()}`,
        revision: 0,
        url: `mock://users/${ownerId}/projects/${projectId}/assets/${Date.now()}/model.glb`,
        mimeType: uploadOptions.mimeType,
      });
      if (!result.ok || !result.data) return result;
      const state = store.load();
      const target = state.projects.find((item) => item.metadata.id === projectId);
      if (target) {
        target.draft.asset = result.data.manifest.source;
        target.draft.assetManifest = result.data.manifest;
        target.draft.project.updatedAt = now();
        target.metadata = clone(target.draft.project);
        target.draftRevision += 1;
        store.save();
      }
      return result;
    },
    async getSignedAssetUrl(asset: AssetReference) {
      return ok(asset.url, 'Mock signed asset URL resolved.');
    },
    async publishProject(projectId: string, visibility: 'unlisted' | 'public') {
      const state = store.load();
      const project = state.projects.find((item) => item.metadata.id === projectId);
      if (!project) return fail('KX_PERMISSION_DENIED', `Project ${projectId} was not found.`);
      const revision = (project.publishedRevision?.revision ?? 0) + 1;
      const slug = project.metadata.slug ?? slugify(project.metadata.title);
      project.draft.project.visibility = visibility;
      project.metadata = clone(project.draft.project);
      project.publishedRevision = {
        id: `revision-${projectId}-${revision}`,
        projectId,
        slug,
        revision,
        scene: clone(project.draft),
        metadata: createPublishedRevisionMetadata(revision, ['webgl2'], ['webgpu', 'ssgi', 'annotations']),
        createdAt: now(),
      };
      store.save();
      return ok(clone(project.publishedRevision), 'Project published.');
    },
    async republishProject(projectId: string) {
      const project = requireProject(projectId);
      if (!project.ok || !project.data) return fail(project.code, project.message ?? 'Project unavailable.');
      const visibility = project.data.metadata.visibility === 'public' ? 'public' : 'unlisted';
      return this.publishProject(projectId, visibility);
    },
    async unpublishProject(projectId: string) {
      const state = store.load();
      const project = state.projects.find((item) => item.metadata.id === projectId);
      if (!project) return fail('KX_PERMISSION_DENIED', `Project ${projectId} was not found.`);
      project.publishedRevision = null;
      project.metadata.visibility = 'unpublished';
      project.draft.project.visibility = 'unpublished';
      project.metadata.updatedAt = now();
      store.save();
      return ok(clone(project), 'Project unpublished.');
    },
    async resolvePublicScene(slug: string) {
      const state = store.load();
      const revision = state.projects.find(
        (project) => project.publishedRevision?.slug === slug,
      )?.publishedRevision;
      if (!revision) return fail('KX_PUBLICATION_NOT_FOUND', `Published scene ${slug} was not found.`);
      return ok(clone(revision), 'Published scene resolved.');
    },
    async copyPublicLink(
      slug: string,
      baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://urashima.github.io',
    ) {
      const url = `${baseUrl.replace(/\/$/, '')}/s/${slug}`;
      if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(url);
      return ok(url, 'Public link copied.');
    },
  };
}

export function createKyxosApiClient(options: KyxosApiClientOptions = {}): KyxosApiClient {
  if (!options.supabaseUrl || !options.supabaseAnonKey) return createMockApiClient(options);

  const fetchImpl = options.fetchImpl ?? fetch;
  const mock = createMockApiClient(options);
  const callFunction = async <T>(name: string, body: unknown): Promise<KyxosResult<T>> => {
    try {
      const response = await fetchImpl(`${options.supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          apikey: options.supabaseAnonKey ?? '',
          authorization: `Bearer ${options.supabaseAnonKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as KyxosResult<T>;
      return response.ok
        ? payload
        : fail(payload.code ?? 'KX_ASSET_UPLOAD_FAILED', payload.message ?? response.statusText);
    } catch {
      return fail(
        'KX_ASSET_UPLOAD_FAILED',
        'Supabase function call failed; use mock fallback for local development.',
      );
    }
  };

  return {
    ...mock,
    mode: 'supabase',
    publishProject: async (projectId, visibility) => {
      const remote = await callFunction<PublishedSceneRevision>('publish-project', { projectId, visibility });
      return remote.ok ? remote : mock.publishProject(projectId, visibility);
    },
    resolvePublicScene: async (slug) => {
      const remote = await callFunction<PublishedSceneRevision>('public-scene-resolver', { slug });
      return remote.ok ? remote : mock.resolvePublicScene(slug);
    },
    getSignedAssetUrl: async (asset) => {
      const remote = await callFunction<string>('signed-upload', { asset });
      return remote.ok ? remote : ok(asset.url, 'Falling back to stored asset URL.');
    },
  };
}
