import './asset-thumbnail-parity.css';
import { createDurableApiClient } from '@kyxos/api-client/durable';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';
import { SceneDocument, type ProjectSession } from '@kyxos/editor-core';
import {
  createEmptySceneContract,
  type KyxosSceneContract,
  type SceneAsset,
  type SceneNode,
} from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const RENDERER_VERSION = 'asset-thumbnail-v4';
const WIDTH = 256;
const HEIGHT = 144;
const CACHE_DB = 'kyxos-studio-thumbnail-cache';
const CACHE_STORE = 'asset-thumbnails';
const RASTER_IMAGE_MIME = /^image\/(png|jpeg|webp|avif)$/i;
const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);
const assetClient = createDurableApiClient({
  url: backendConfig.supabaseUrl,
  anonKey: backendConfig.supabaseAnonKey,
  functionsUrl: backendConfig.functionsUrl,
});

type ThumbnailEligibility = 'renderable' | 'embedded' | 'unsupported' | 'nonvisual';

interface CachedThumbnail {
  assetId: string;
  contentHash: string;
  rendererVersion: string;
  dataUrl: string;
  width: number;
  height: number;
  generatedAt: string;
}

const memoryCache = new Map<string, CachedThumbnail>();
const cacheReads = new Map<string, Promise<CachedThumbnail | null>>();

async function ensureCloudSession(): Promise<boolean> {
  if (backendConfig.provider !== 'supabase') return true;
  return Boolean(await assetClient.auth.getSession());
}

function thumbnailEligibility(asset: SceneAsset): ThumbnailEligibility {
  if (asset.kind === 'model' || asset.kind === 'environment') return 'renderable';
  if (asset.kind !== 'texture') return 'nonvisual';
  if (asset.metadata?.embedded === true || typeof asset.metadata?.embeddedInAssetId === 'string') {
    return 'embedded';
  }
  return RASTER_IMAGE_MIME.test(asset.mimeType ?? '') ? 'renderable' : 'unsupported';
}

function thumbnailMatches(asset: SceneAsset, cached: CachedThumbnail | null | undefined): cached is CachedThumbnail {
  return Boolean(
    cached
    && cached.assetId === asset.id
    && cached.contentHash === asset.contentHash
    && cached.rendererVersion === RENDERER_VERSION
    && cached.dataUrl.startsWith('data:image/webp'),
  );
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE, { keyPath: 'assetId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Asset thumbnail cache could not be opened.'));
  });
}

async function readCachedThumbnail(asset: SceneAsset): Promise<CachedThumbnail | null> {
  const hot = memoryCache.get(asset.id);
  if (thumbnailMatches(asset, hot)) return hot;
  const existingRead = cacheReads.get(asset.id);
  if (existingRead) return existingRead;

  const promise = (async () => {
    const db = await openCacheDb();
    try {
      const value = await new Promise<CachedThumbnail | null>((resolve, reject) => {
        const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(asset.id);
        request.onsuccess = () => resolve((request.result as CachedThumbnail | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
      if (thumbnailMatches(asset, value)) {
        memoryCache.set(asset.id, value);
        return value;
      }
      return null;
    } finally {
      db.close();
      cacheReads.delete(asset.id);
    }
  })();
  cacheReads.set(asset.id, promise);
  return promise;
}

async function writeCachedThumbnail(asset: SceneAsset, dataUrl: string): Promise<CachedThumbnail> {
  const record: CachedThumbnail = {
    assetId: asset.id,
    contentHash: asset.contentHash,
    rendererVersion: RENDERER_VERSION,
    dataUrl,
    width: WIDTH,
    height: HEIGHT,
    generatedAt: new Date().toISOString(),
  };
  const db = await openCacheDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      transaction.objectStore(CACHE_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
  memoryCache.set(asset.id, record);
  return record;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function rasterize(blob: Blob, checker = false): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable for asset thumbnails.');
    if (checker) {
      const size = 12;
      for (let y = 0; y < HEIGHT; y += size) {
        for (let x = 0; x < WIDTH; x += size) {
          context.fillStyle = ((x / size + y / size) & 1) === 0 ? '#242a33' : '#171b22';
          context.fillRect(x, y, size, size);
        }
      }
    } else {
      context.fillStyle = '#11151d';
      context.fillRect(0, 0, WIDTH, HEIGHT);
    }
    const scale = Math.min(WIDTH / bitmap.width, HEIGHT / bitmap.height);
    const width = Math.max(1, bitmap.width * scale);
    const height = Math.max(1, bitmap.height * scale);
    context.drawImage(bitmap, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
    return canvas.toDataURL('image/webp', 0.82);
  } finally {
    bitmap.close();
  }
}

function addAncestors(nodesById: Map<string, SceneNode>, keep: Set<string>, id: string): void {
  let current = nodesById.get(id);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    keep.add(current.id);
    if (!current.parentId) break;
    current = nodesById.get(current.parentId);
  }
}

function collectAssetNodes(nodes: SceneNode[], assetId: string): { keep: Set<string>; focus: string[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const focusNodes = nodes.filter((node) => node.meshAssetId === assetId);
  const focus = focusNodes.map((node) => node.id);
  const keep = new Set<string>();

  for (const node of focusNodes) {
    addAncestors(byId, keep, node.id);
    for (const jointId of node.skin?.joints ?? []) addAncestors(byId, keep, jointId);
    if (node.skin?.skeletonNodeId) addAncestors(byId, keep, node.skin.skeletonNodeId);
  }

  return { keep, focus };
}

function thumbnailNode(node: SceneNode, keep: Set<string>): SceneNode {
  const clone = structuredClone(node);
  clone.parentId = clone.parentId && keep.has(clone.parentId) ? clone.parentId : null;
  clone.children = clone.children.filter((childId) => keep.has(childId));
  // Asset thumbnails represent the imported file itself, not current scene
  // material overrides, authored cameras/lights or animation playback state.
  delete clone.materialSlots;
  delete clone.materialVariantBindings;
  delete clone.cameraId;
  delete clone.lightId;
  delete clone.animationIds;
  return clone;
}

function isolatedModelScene(source: KyxosSceneContract, assetId: string): { scene: KyxosSceneContract; focus: string[] } | null {
  const asset = source.assets[assetId];
  if (!asset) return null;
  const { keep, focus } = collectAssetNodes(source.nodes, assetId);
  if (!focus.length) return null;

  const scene = createEmptySceneContract(`Thumbnail · ${asset.name ?? 'Model'}`);
  scene.assets = { [assetId]: structuredClone(asset) };
  scene.nodes = source.nodes
    .filter((node) => keep.has(node.id))
    .map((node) => thumbnailNode(node, keep));
  scene.materials = {};
  scene.animations = [];
  scene.materialVariants = [];
  scene.activeMaterialVariantId = undefined;
  scene.animationStateGraph = undefined;
  scene.editorState = undefined;
  scene.environment.backgroundColor = '#171b22';
  scene.environment.intensity = 0.35;
  scene.environment.backgroundIntensity = 0.15;
  scene.renderSettings.backend = 'webgl2';
  scene.renderSettings.qualityPreset = 'low';
  scene.renderSettings.effects = {};
  scene.lights = [
    {
      id: crypto.randomUUID(),
      name: 'Thumbnail Key',
      type: 'directional',
      color: '#ffffff',
      intensity: 2.4,
      transform: {
        position: { x: 3, y: 4, z: 5 },
        rotation: { x: -0.55, y: 0.65, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      castShadow: false,
    },
    {
      id: crypto.randomUUID(),
      name: 'Thumbnail Fill',
      type: 'ambient',
      color: '#d9e4ff',
      intensity: 0.8,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      castShadow: false,
    },
  ];
  return { scene, focus };
}

function isolatedEnvironmentScene(source: KyxosSceneContract, assetId: string): KyxosSceneContract | null {
  const asset = source.assets[assetId];
  if (!asset) return null;
  const scene = createEmptySceneContract(`Thumbnail · ${asset.name ?? 'Environment'}`);
  scene.assets = { [assetId]: structuredClone(asset) };
  scene.environment.assetId = assetId;
  scene.environment.intensity = Math.max(0.15, source.environment.intensity);
  scene.environment.backgroundIntensity = Math.max(0.15, source.environment.backgroundIntensity);
  scene.environment.backgroundBlur = Math.min(0.35, source.environment.backgroundBlur);
  scene.renderSettings.backend = 'webgl2';
  scene.renderSettings.qualityPreset = 'low';
  scene.renderSettings.effects = {};
  return scene;
}

async function renderWithViewer(scene: KyxosSceneContract, focus: string[] = []): Promise<string> {
  const manifest = await assetClient.assets.getManifest(Object.keys(scene.assets));
  const resolver = {
    resolve(asset: { uri: string }): string {
      const url = manifest.assets[asset.uri];
      if (!url) throw new Error(`Thumbnail asset is unavailable: ${asset.uri}`);
      return url;
    },
  };
  const host = document.createElement('div');
  host.className = 'kx-thumbnail-render-host';
  host.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 216;
  host.append(canvas);
  document.body.append(host);
  const adapter = new BrowserKyxosViewportAdapter(resolver, { backend: 'webgl2', quality: 'low' });
  try {
    await adapter.mount(canvas);
    await adapter.loadDocument(new SceneDocument(scene));
    if (focus.length) adapter.frame(focus);
    await delay(90);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return await rasterize(await adapter.captureThumbnail());
  } finally {
    adapter.dispose();
    host.remove();
  }
}

async function generateThumbnail(scene: KyxosSceneContract, asset: SceneAsset): Promise<string | null> {
  if (asset.kind === 'texture') {
    const existingManifest = await assetClient.assets.getManifest([asset.id]);
    const sourceUrl = existingManifest.assets[asset.uri];
    if (!sourceUrl) throw new Error(`Texture thumbnail source is unavailable for ${asset.id}.`);
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Texture thumbnail download failed (${response.status}).`);
    return await rasterize(await response.blob(), true);
  }
  if (asset.kind === 'model') {
    const isolated = isolatedModelScene(scene, asset.id);
    return isolated ? await renderWithViewer(isolated.scene, isolated.focus) : null;
  }
  if (asset.kind === 'environment') {
    const isolated = isolatedEnvironmentScene(scene, asset.id);
    return isolated ? await renderWithViewer(isolated) : null;
  }
  return null;
}

function mountCachedThumbnail(card: HTMLElement, asset: SceneAsset, cached: CachedThumbnail): void {
  if (!thumbnailMatches(asset, cached)) return;
  card.classList.add('has-generated-thumbnail');
  card.dataset.thumbnailRenderer = cached.rendererVersion;
  card.dataset.thumbnailSourceHash = cached.contentHash;
  card.dataset.thumbnailEligibility = 'renderable';
  const current = card.querySelector<HTMLElement>(':scope > .asset-thumbnail');
  if (current instanceof HTMLImageElement && current.src === cached.dataUrl) return;
  const image = document.createElement('img');
  image.className = 'asset-thumbnail';
  image.src = cached.dataUrl;
  image.alt = '';
  image.decoding = 'async';
  if (current) current.replaceWith(image);
  else card.prepend(image);
}

function decorateCards(session: ProjectSession): void {
  const scene = session.document.value;
  document.querySelectorAll<HTMLElement>('.asset-workspace-item[data-asset-id]').forEach((card) => {
    const assetId = card.dataset.assetId;
    const asset = assetId ? scene.assets[assetId] : undefined;
    if (!asset) return;
    const eligibility = thumbnailEligibility(asset);
    card.dataset.thumbnailKind = asset.kind;
    card.dataset.thumbnailEligibility = eligibility;
    let badge = card.querySelector<HTMLElement>('.kx-asset-kind-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'kx-asset-kind-badge';
      card.prepend(badge);
    }
    badge.textContent = asset.kind === 'environment' ? 'HDR' : asset.kind === 'texture' ? 'TEX' : asset.kind === 'model' ? '3D' : asset.kind.slice(0, 3).toUpperCase();

    if (eligibility !== 'renderable') {
      card.classList.remove('has-generated-thumbnail');
      delete card.dataset.thumbnailRenderer;
      delete card.dataset.thumbnailSourceHash;
      return;
    }

    const hot = memoryCache.get(asset.id);
    if (thumbnailMatches(asset, hot)) {
      mountCachedThumbnail(card, asset, hot);
      return;
    }
    card.classList.remove('has-generated-thumbnail');
    delete card.dataset.thumbnailRenderer;
    delete card.dataset.thumbnailSourceHash;
    void readCachedThumbnail(asset).then((cached) => {
      if (!cached || !card.isConnected) return;
      const currentAsset = session.document.value.assets[asset.id];
      if (currentAsset && thumbnailEligibility(currentAsset) === 'renderable') {
        mountCachedThumbnail(card, currentAsset, cached);
      }
    }).catch((error) => console.warn('[Kyxos] Asset thumbnail cache read failed.', error));
  });
}

function stripLegacyThumbnailMetadata(session: ProjectSession): void {
  const fresh = session.document.value;
  let changed = false;
  for (const asset of Object.values(fresh.assets)) {
    if (!asset.metadata) continue;
    const metadata = { ...asset.metadata };
    let assetChanged = false;
    for (const key of [
      'thumbnailDataUrl',
      'thumbnailRenderer',
      'thumbnailSourceHash',
      'thumbnailGeneratedAt',
      'thumbnailWidth',
      'thumbnailHeight',
    ]) {
      if (key in metadata) {
        delete metadata[key];
        assetChanged = true;
      }
    }
    if (!assetChanged) continue;
    asset.metadata = metadata;
    changed = true;
  }
  if (changed) session.document.replace(fresh, 'asset-thumbnail-cache-cleanup');
}

const originalBindSession = BrowserKyxosViewportAdapter.prototype.bindSession;
BrowserKyxosViewportAdapter.prototype.bindSession = function bindSessionWithAssetThumbnails(
  session: ProjectSession,
): () => void {
  const disposeOriginal = originalBindSession.call(this, session);
  let disposed = false;
  let timer = 0;
  let running = false;

  const scan = async () => {
    if (disposed || running) return;
    running = true;
    try {
      decorateCards(session);
      stripLegacyThumbnailMetadata(session);
      if (!(await ensureCloudSession())) {
        document.documentElement.dataset.assetThumbnailState = 'auth-required';
        return;
      }
      const snapshot = session.document.value;
      const candidates = Object.values(snapshot.assets).filter((asset) =>
        thumbnailEligibility(asset) === 'renderable',
      );
      for (const asset of candidates) {
        if (disposed) break;
        try {
          const cached = await readCachedThumbnail(asset);
          if (cached) continue;
          document.documentElement.dataset.assetThumbnailState = `rendering:${asset.id}`;
          const thumbnailDataUrl = await generateThumbnail(snapshot, asset);
          if (!thumbnailDataUrl) continue;
          const current = session.document.value.assets[asset.id];
          if (!current || current.contentHash !== asset.contentHash || thumbnailEligibility(current) !== 'renderable') continue;
          const record = await writeCachedThumbnail(current, thumbnailDataUrl);
          document.querySelectorAll<HTMLElement>(`.asset-workspace-item[data-asset-id="${CSS.escape(current.id)}"]`)
            .forEach((card) => mountCachedThumbnail(card, current, record));
        } catch (error) {
          console.warn(`[Kyxos] Asset thumbnail generation failed for ${asset.name ?? asset.id}.`, error);
        }
      }
      document.documentElement.dataset.assetThumbnailState = 'idle';
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void scan(), 1100);
  };
  const onChange = () => schedule();
  session.document.addEventListener('change', onChange);
  const domObserver = new MutationObserver(() => decorateCards(session));
  domObserver.observe(document.documentElement, { childList: true, subtree: true });
  schedule();

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    domObserver.disconnect();
    session.document.removeEventListener('change', onChange);
    disposeOriginal();
  };
};