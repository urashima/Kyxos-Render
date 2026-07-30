import { assertSceneContract, type KyxosSceneContract, type SceneAsset } from '@kyxos/scene-contract';

export interface Session { userId: string; email: string; accessToken?: string }
export interface ProjectSummary { id: string; name: string; description?: string; status: 'active' | 'archived'; thumbnail?: string; createdAt: string; updatedAt: string }
export interface DraftRecord { projectId: string; contract: KyxosSceneContract; revision: number; updatedAt: string }
export interface ReleaseRecord { id: string; projectId: string; versionNumber: number; sceneSnapshot: KyxosSceneContract; sceneDigest: string; slug: string; createdAt: string; isCurrent: boolean }
export interface UploadTicket { assetId: string; uploadUrl?: string; storageKey: string; headers?: Record<string, string>; alreadyExists?: boolean }
export interface AssetManifest { assets: Record<string, string> }

export interface KyxosApiClient {
  auth: { signIn(email: string, password: string): Promise<Session>; signOut(): Promise<void>; getSession(): Promise<Session | null> };
  projects: { list(): Promise<ProjectSummary[]>; create(name: string): Promise<ProjectSummary>; get(id: string): Promise<ProjectSummary>; rename(id: string, name: string): Promise<void>; archive(id: string): Promise<void>; remove(id: string): Promise<void>; duplicate(id: string): Promise<ProjectSummary> };
  assets: { createUpload(input: { hash: string; name: string; mimeType: string; byteSize: number }): Promise<UploadTicket>; upload(ticket: UploadTicket, file: Blob): Promise<void>; completeUpload(assetId: string, metadata?: Record<string, unknown>): Promise<void>; getManifest(assetIds: string[]): Promise<AssetManifest>; getBlobUrl(hash: string): Promise<string | null> };
  drafts: { load(projectId: string): Promise<DraftRecord | null>; save(projectId: string, contract: KyxosSceneContract, expectedRevision: number): Promise<{ revision: number }>; getRevision(projectId: string): Promise<number> };
  releases: { publish(projectId: string, contract: KyxosSceneContract, expectedRevision: number, thumbnail?: Blob): Promise<ReleaseRecord>; list(projectId: string): Promise<ReleaseRecord[]>; setCurrent(projectId: string, versionId: string): Promise<void>; disablePublic(projectId: string): Promise<void> };
  publicScenes: { resolveSlug(slug: string): Promise<ReleaseRecord>; getVersion(versionId: string): Promise<ReleaseRecord> };
}

const KEY = 'kyxos-studio-local-v1';
interface LocalState { session: Session | null; projects: ProjectSummary[]; drafts: Record<string, DraftRecord>; releases: ReleaseRecord[]; assets: Record<string, { id: string; hash: string; name: string; mimeType: string; byteSize: number; metadata?: Record<string, unknown> }>; current: Record<string, string>; disabled: string[] }
function loadState(): LocalState {
  const empty: LocalState = { session: null, projects: [], drafts: {}, releases: [], assets: {}, current: {}, disabled: [] };
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return empty }
}
function saveState(state: LocalState): void { localStorage.setItem(KEY, JSON.stringify(state)) }
function requireSession(state: LocalState): Session { if (!state.session) throw new Error('Authentication required.'); return state.session }
function now(): string { return new Date().toISOString() }
async function sha256(text: string): Promise<string> { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('') }
function slug(name: string): string { const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scene'; return `${normalized}-${crypto.randomUUID().slice(0, 8)}` }

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('kyxos-assets', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('blobs')) request.result.createObjectStore('blobs') };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function putBlob(hash: string, blob: Blob): Promise<void> { const db = await openAssetDb(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, hash); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close() }
async function getBlob(hash: string): Promise<Blob | null> { const db = await openAssetDb(); const value = await new Promise<Blob | null>((resolve, reject) => { const request = db.transaction('blobs').objectStore('blobs').get(hash); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error) }); db.close(); return value }

export class LocalKyxosApiClient implements KyxosApiClient {
  auth = {
    signIn: async (email: string, _password: string) => { const state = loadState(); state.session = { userId: `local:${email.toLowerCase()}`, email }; saveState(state); return state.session },
    signOut: async () => { const state = loadState(); state.session = null; saveState(state) },
    getSession: async () => loadState().session,
  };
  projects = {
    list: async () => { const state = loadState(); requireSession(state); return state.projects.filter((project) => project.status === 'active').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) },
    create: async (name: string) => { const state = loadState(); requireSession(state); const project: ProjectSummary = { id: crypto.randomUUID(), name: name.trim() || 'Untitled Project', status: 'active', createdAt: now(), updatedAt: now() }; state.projects.push(project); saveState(state); return project },
    get: async (id: string) => { const state = loadState(); requireSession(state); const project = state.projects.find((entry) => entry.id === id); if (!project) throw new Error('Project not found.'); return project },
    rename: async (id: string, name: string) => { const state = loadState(); requireSession(state); const project = state.projects.find((entry) => entry.id === id); if (!project) throw new Error('Project not found.'); project.name = name.trim(); project.updatedAt = now(); saveState(state) },
    archive: async (id: string) => { const state = loadState(); requireSession(state); const project = state.projects.find((entry) => entry.id === id); if (project) { project.status = 'archived'; project.updatedAt = now(); saveState(state) } },
    remove: async (id: string) => { const state = loadState(); requireSession(state); if (state.releases.some((entry) => entry.projectId === id)) throw new Error('Published projects must be archived; published assets and snapshots are immutable.'); state.projects = state.projects.filter((entry) => entry.id !== id); delete state.drafts[id]; saveState(state) },
    duplicate: async (id: string) => { const state = loadState(); requireSession(state); const source = state.projects.find((entry) => entry.id === id); if (!source) throw new Error('Project not found.'); const project: ProjectSummary = { ...source, id: crypto.randomUUID(), name: `${source.name} Copy`, createdAt: now(), updatedAt: now() }; state.projects.push(project); if (state.drafts[id]) state.drafts[project.id] = { ...structuredClone(state.drafts[id]), projectId: project.id, revision: 1 }; saveState(state); return project },
  };
  assets = {
    createUpload: async ({ hash, name, mimeType, byteSize }: { hash: string; name: string; mimeType: string; byteSize: number }) => { const state = loadState(); requireSession(state); const existing = Object.values(state.assets).find((asset) => asset.hash === hash); if (existing) return { assetId: existing.id, storageKey: hash, alreadyExists: true }; const id = crypto.randomUUID(); state.assets[id] = { id, hash, name: name.replace(/[^\w. -]/g, '_'), mimeType, byteSize }; saveState(state); return { assetId: id, storageKey: hash } },
    upload: async (ticket: UploadTicket, file: Blob) => { if (!ticket.alreadyExists) await putBlob(ticket.storageKey, file) },
    completeUpload: async (assetId: string, metadata?: Record<string, unknown>) => { const state = loadState(); if (!state.assets[assetId]) throw new Error('Asset not found.'); state.assets[assetId].metadata = structuredClone(metadata ?? {}); saveState(state) },
    getManifest: async (assetIds: string[]) => { const state = loadState(); const assets: Record<string, string> = {}; for (const id of assetIds) { const asset = state.assets[id]; if (!asset) continue; const blob = await getBlob(asset.hash); if (blob) assets[`asset://${asset.hash}`] = URL.createObjectURL(blob) } return { assets } },
    getBlobUrl: async (hash: string) => { const blob = await getBlob(hash); return blob ? URL.createObjectURL(blob) : null },
  };
  drafts = {
    load: async (projectId: string) => { const state = loadState(); requireSession(state); return state.drafts[projectId] ? structuredClone(state.drafts[projectId]) : null },
    save: async (projectId: string, contract: KyxosSceneContract, expectedRevision: number) => { assertSceneContract(contract); const state = loadState(); requireSession(state); const current = state.drafts[projectId]; if ((current?.revision ?? 0) !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, current ${current?.revision ?? 0}.`); const revision = expectedRevision + 1; state.drafts[projectId] = { projectId, contract: structuredClone(contract), revision, updatedAt: now() }; const project = state.projects.find((entry) => entry.id === projectId); if (project) project.updatedAt = now(); saveState(state); return { revision } },
    getRevision: async (projectId: string) => loadState().drafts[projectId]?.revision ?? 0,
  };
  releases = {
    publish: async (projectId: string, contract: KyxosSceneContract, expectedRevision: number, _thumbnail?: Blob) => { assertSceneContract(contract); const state = loadState(); requireSession(state); const draft = state.drafts[projectId]; if (!draft || draft.revision !== expectedRevision) throw new Error('Publish revision conflict. Flush autosave before publishing.'); const project = state.projects.find((entry) => entry.id === projectId); if (!project) throw new Error('Project not found.'); for (const asset of Object.values(contract.assets)) if (!Object.values(state.assets).some((entry) => entry.hash === asset.contentHash)) throw new Error(`Missing asset ${asset.contentHash}.`); const versionNumber = state.releases.filter((entry) => entry.projectId === projectId).length + 1; const existingSlug = state.releases.find((entry) => entry.projectId === projectId)?.slug; const release: ReleaseRecord = { id: crypto.randomUUID(), projectId, versionNumber, sceneSnapshot: structuredClone(contract), sceneDigest: await sha256(JSON.stringify(contract)), slug: existingSlug ?? slug(project.name), createdAt: now(), isCurrent: true }; state.releases.filter((entry) => entry.projectId === projectId).forEach((entry) => { entry.isCurrent = false }); state.releases.push(release); state.current[projectId] = release.id; state.disabled = state.disabled.filter((id) => id !== projectId); saveState(state); return release },
    list: async (projectId: string) => loadState().releases.filter((entry) => entry.projectId === projectId).sort((a, b) => b.versionNumber - a.versionNumber),
    setCurrent: async (projectId: string, versionId: string) => { const state = loadState(); const version = state.releases.find((entry) => entry.id === versionId && entry.projectId === projectId); if (!version) throw new Error('Release not found.'); state.releases.filter((entry) => entry.projectId === projectId).forEach((entry) => { entry.isCurrent = entry.id === versionId }); state.current[projectId] = versionId; saveState(state) },
    disablePublic: async (projectId: string) => { const state = loadState(); if (!state.disabled.includes(projectId)) state.disabled.push(projectId); saveState(state) },
  };
  publicScenes = {
    resolveSlug: async (publicSlug: string) => { const state = loadState(); const release = state.releases.find((entry) => entry.slug === publicSlug && entry.isCurrent); if (!release || state.disabled.includes(release.projectId)) throw new Error('Public link is disabled or does not exist.'); return structuredClone(release) },
    getVersion: async (versionId: string) => { const state = loadState(); const release = state.releases.find((entry) => entry.id === versionId); if (!release || state.disabled.includes(release.projectId)) throw new Error('Published version does not exist or public access is disabled.'); return structuredClone(release) },
  };
}

export interface SupabaseClientOptions { url: string; anonKey: string; functionsUrl?: string }
export class SupabaseKyxosApiClient implements KyxosApiClient {
  private token: string | null = null;
  constructor(private readonly options: SupabaseClientOptions) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.options.functionsUrl ?? `${this.options.url}/functions/v1`}/${path}`, { ...init, headers: { 'content-type': 'application/json', apikey: this.options.anonKey, authorization: `Bearer ${this.token ?? this.options.anonKey}`, ...init.headers } });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`); return response.json() as Promise<T>;
  }
  auth = {
    signIn: async (email: string, password: string) => { const response = await fetch(`${this.options.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: this.options.anonKey }, body: JSON.stringify({ email, password }) }); if (!response.ok) throw new Error(await response.text()); const data = await response.json(); this.token = data.access_token; sessionStorage.setItem('kyxos-token', this.token ?? ''); return { userId: data.user.id, email: data.user.email, accessToken: data.access_token } },
    signOut: async () => { if (this.token) await fetch(`${this.options.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: this.options.anonKey, authorization: `Bearer ${this.token}` } }); this.token = null; sessionStorage.removeItem('kyxos-token') },
    getSession: async () => { this.token ??= sessionStorage.getItem('kyxos-token'); if (!this.token) return null; const response = await fetch(`${this.options.url}/auth/v1/user`, { headers: { apikey: this.options.anonKey, authorization: `Bearer ${this.token}` } }); if (!response.ok) return null; const user = await response.json(); return { userId: user.id, email: user.email, accessToken: this.token } },
  };
  projects = {
    list: () => this.request<ProjectSummary[]>('projects'), create: (name: string) => this.request<ProjectSummary>('projects', { method: 'POST', body: JSON.stringify({ name }) }), get: (id: string) => this.request<ProjectSummary>(`projects/${id}`), rename: async (id: string, name: string) => { await this.request(`projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }) }, archive: async (id: string) => { await this.request(`projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }) }, remove: async (id: string) => { await this.request(`projects/${id}`, { method: 'DELETE' }) }, duplicate: (id: string) => this.request<ProjectSummary>(`projects/${id}/duplicate`, { method: 'POST' }),
  };
  assets = {
    createUpload: (input: { hash: string; name: string; mimeType: string; byteSize: number }) => this.request<UploadTicket>('assets/upload', { method: 'POST', body: JSON.stringify(input) }),
    upload: async (ticket: UploadTicket, file: Blob) => { if (!ticket.uploadUrl || ticket.alreadyExists) return; const response = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file }); if (!response.ok) throw new Error('Signed asset upload failed.') },
    completeUpload: async (assetId: string, metadata?: Record<string, unknown>) => { await this.request('assets/complete', { method: 'POST', body: JSON.stringify({ assetId, metadata }) }) },
    getManifest: (assetIds: string[]) => this.request<AssetManifest>('assets/manifest', { method: 'POST', body: JSON.stringify({ assetIds }) }), getBlobUrl: async () => null,
  };
  drafts = { load: (projectId: string) => this.request<DraftRecord | null>(`drafts/${projectId}`), save: (projectId: string, contract: KyxosSceneContract, expectedRevision: number) => this.request<{ revision: number }>(`drafts/${projectId}`, { method: 'PUT', body: JSON.stringify({ contract, expectedRevision }) }), getRevision: async (projectId: string) => (await this.request<{ revision: number }>(`drafts/${projectId}/revision`)).revision };
  releases = { publish: (projectId: string, contract: KyxosSceneContract, expectedRevision: number) => this.request<ReleaseRecord>('releases/publish', { method: 'POST', body: JSON.stringify({ projectId, contract, expectedRevision }) }), list: (projectId: string) => this.request<ReleaseRecord[]>(`releases?projectId=${encodeURIComponent(projectId)}`), setCurrent: async (projectId: string, versionId: string) => { await this.request('releases/current', { method: 'POST', body: JSON.stringify({ projectId, versionId }) }) }, disablePublic: async (projectId: string) => { await this.request('releases/disable', { method: 'POST', body: JSON.stringify({ projectId }) }) } };
  publicScenes = { resolveSlug: (slugValue: string) => this.request<ReleaseRecord>(`public/slug/${encodeURIComponent(slugValue)}`), getVersion: (versionId: string) => this.request<ReleaseRecord>(`public/version/${encodeURIComponent(versionId)}`) };
}

export function createApiClient(options?: Partial<SupabaseClientOptions>): KyxosApiClient {
  return options?.url && options?.anonKey ? new SupabaseKyxosApiClient(options as SupabaseClientOptions) : new LocalKyxosApiClient();
}

export async function hashBlob(blob: Blob): Promise<string> { const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('') }
export function assetResolverFromManifest(manifest: AssetManifest) { return { resolve(asset: SceneAsset): string { const url = manifest.assets[asset.uri]; if (!url) throw new Error(`Asset is unavailable: ${asset.uri}`); return url } } }
