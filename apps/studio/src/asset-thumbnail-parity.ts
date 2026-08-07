import './asset-thumbnail-parity.css';
import { createDurableApiClient } from '@kyxos/api-client/durable';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';
import { SceneDocument, type ProjectSession } from '@kyxos/editor-core';
import type { KyxosSceneContract, SceneAsset, SceneNode } from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const RENDERER_VERSION = 'asset-thumbnail-v2';
const WIDTH = 256;
const HEIGHT = 144;
const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);
const assetClient = createDurableApiClient({
  url: backendConfig.supabaseUrl,
  anonKey: backendConfig.supabaseAnonKey,
  functionsUrl: backendConfig.functionsUrl,
});

async function ensureCloudSession(): Promise<boolean> {
  if (backendConfig.provider !== 'supabase') return true;
  return Boolean(await assetClient.auth.getSession());
}

function thumbnailIsCurrent(asset: SceneAsset): boolean {
  return asset.metadata?.thumbnailRenderer === RENDERER_VERSION
    && asset.metadata?.thumbnailSourceHash === asset.contentHash
    && typeof asset.metadata?.thumbnailDataUrl === 'string';
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

function collectAssetNodes(nodes: SceneNode[], assetId: string): { keep: Set<string>; focus: string[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const focus = nodes.filter((node) => node.meshAssetId === assetId).map((node) => node.id);
  const keep = new Set(focus);

  // Preserve hierarchy transforms above meshes.
  for (const id of focus) {
    let current = byId.get(id);
    const visited = new Set<string>();
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      keep.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  // Preserve descendants such as child meshes, skeleton branches and authored
  // helper nodes below an imported GLB root.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && keep.has(node.parentId) && !keep.has(node.id)) {
        keep.add(node.id);
        changed = true;
      }
    }
  }
  return { keep, focus };
}

function isolatedModelScene(source: KyxosSceneContract, assetId: string): { scene: KyxosSceneContract; focus: string[] } | null {
  const { keep, focus } = collectAssetNodes(source.nodes, assetId);
  if (!focus.length) return null;
  const scene = structuredClone(source);
  scene.nodes = scene.nodes.filter((node) => keep.has(node.id));
  scene.animations = [];
  return { scene, focus };
}

function isolatedEnvironmentScene(source: KyxosSceneContract, assetId: string): KyxosSceneContract {
  const scene = structuredClone(source);
  scene.nodes = [];
  scene.animations = [];
  scene.environment.assetId = assetId;
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
  const existingManifest = await assetClient.assets.getManifest([asset.id]);
  const sourceUrl = existingManifest.assets[asset.uri];
  if (asset.kind === 'texture' && sourceUrl && /^image\/(png|jpeg|webp)$/i.test(asset.mimeType ?? '')) {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Texture thumbnail download failed (${response.status}).`);
    return await rasterize(await response.blob(), true);
  }
  if (asset.kind === 'model') {
    const isolated = isolatedModelScene(scene, asset.id);
    return isolated ? await renderWithViewer(isolated.scene, isolated.focus) : null;
  }
  if (asset.kind === 'environment') {
    return await renderWithViewer(isolatedEnvironmentScene(scene, asset.id));
  }
  return null;
}

function decorateCards(session: ProjectSession): void {
  const scene = session.document.value;
  document.querySelectorAll<HTMLElement>('.asset-workspace-item[data-asset-id]').forEach((card) => {
    const assetId = card.dataset.assetId;
    const asset = assetId ? scene.assets[assetId] : undefined;
    if (!asset) return;
    card.dataset.thumbnailKind = asset.kind;
    card.classList.toggle('has-generated-thumbnail', thumbnailIsCurrent(asset));
    let badge = card.querySelector<HTMLElement>('.kx-asset-kind-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'kx-asset-kind-badge';
      card.prepend(badge);
    }
    badge.textContent = asset.kind === 'environment' ? 'HDR' : asset.kind === 'texture' ? 'TEX' : asset.kind === 'model' ? '3D' : asset.kind.slice(0, 3).toUpperCase();
  });
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
      if (!(await ensureCloudSession())) {
        document.documentElement.dataset.assetThumbnailState = 'auth-required';
        return;
      }
      const snapshot = session.document.value;
      const pending = Object.values(snapshot.assets).filter((asset) =>
        ['model', 'texture', 'environment'].includes(asset.kind)
        && !thumbnailIsCurrent(asset),
      );
      for (const asset of pending) {
        if (disposed) break;
        try {
          document.documentElement.dataset.assetThumbnailState = `rendering:${asset.id}`;
          const thumbnailDataUrl = await generateThumbnail(snapshot, asset);
          if (!thumbnailDataUrl) continue;
          const fresh = session.document.value;
          const current = fresh.assets[asset.id];
          if (!current || current.contentHash !== asset.contentHash) continue;
          current.metadata = {
            ...(current.metadata ?? {}),
            thumbnailDataUrl,
            thumbnailRenderer: RENDERER_VERSION,
            thumbnailSourceHash: current.contentHash,
            thumbnailGeneratedAt: new Date().toISOString(),
            thumbnailWidth: WIDTH,
            thumbnailHeight: HEIGHT,
          };
          session.document.replace(fresh, 'asset-thumbnail-renderer');
          decorateCards(session);
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