import './project-thumbnails-ui.css';
import { createDurableApiClient } from '@kyxos/api-client/durable';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';

const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);
const client = backendConfig.error
  ? null
  : createDurableApiClient({
      url: backendConfig.supabaseUrl,
      anonKey: backendConfig.supabaseAnonKey,
      functionsUrl: backendConfig.functionsUrl,
    });

let generation = 0;

async function refreshClientSession(): Promise<boolean> {
  if (!client || backendConfig.provider !== 'supabase') return Boolean(client);
  return Boolean(await client.auth.getSession());
}

function cloudHeaders(): Headers {
  const headers = new Headers();
  const token = sessionStorage.getItem('kyxos-token');
  if (backendConfig.supabaseAnonKey) headers.set('apikey', backendConfig.supabaseAnonKey);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function cloudThumbnailUrls(projectIds: string[]): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  if (
    backendConfig.provider !== 'supabase'
    || !backendConfig.supabaseUrl
    || !backendConfig.supabaseAnonKey
    || !client
    || !projectIds.length
  ) return output;

  const ids = projectIds.map(encodeURIComponent).join(',');
  const projectsResponse = await fetch(
    `${backendConfig.supabaseUrl.replace(/\/$/, '')}/rest/v1/projects?select=id,thumbnail_asset_id&id=in.(${ids})`,
    { headers: cloudHeaders() },
  );
  if (!projectsResponse.ok) return output;
  const projectRows = await projectsResponse.json() as Array<{ id: string; thumbnail_asset_id: string | null }>;
  const thumbnailIds = [...new Set(projectRows.map((row) => row.thumbnail_asset_id).filter((value): value is string => Boolean(value)))];
  if (!thumbnailIds.length) return output;

  const assetIds = thumbnailIds.map(encodeURIComponent).join(',');
  const assetsResponse = await fetch(
    `${backendConfig.supabaseUrl.replace(/\/$/, '')}/rest/v1/assets?select=id,content_hash&id=in.(${assetIds})`,
    { headers: cloudHeaders() },
  );
  if (!assetsResponse.ok) return output;
  const assetRows = await assetsResponse.json() as Array<{ id: string; content_hash: string }>;
  const hashById = new Map(assetRows.map((row) => [row.id, row.content_hash]));
  const manifest = await client.assets.getManifest(thumbnailIds);

  for (const row of projectRows) {
    if (!row.thumbnail_asset_id) continue;
    const hash = hashById.get(row.thumbnail_asset_id);
    const url = hash ? manifest.assets[`asset://${hash}`] : undefined;
    if (url) output.set(row.id, url);
  }
  return output;
}

function mountImage(thumb: HTMLElement, url: string, name: string): void {
  if (thumb.dataset.thumbnailUrl === url && thumb.dataset.thumbnailLoaded === 'true') return;
  thumb.dataset.thumbnailUrl = url;
  thumb.dataset.hasThumbnail = 'true';
  thumb.dataset.thumbnailLoaded = 'loading';
  const image = document.createElement('img');
  image.src = url;
  image.alt = `${name} scene thumbnail`;
  image.decoding = 'async';
  image.loading = 'lazy';
  image.addEventListener('load', () => {
    if (thumb.dataset.thumbnailUrl !== url) return;
    thumb.replaceChildren(image);
    thumb.dataset.thumbnailLoaded = 'true';
  }, { once: true });
  image.addEventListener('error', () => {
    if (thumb.dataset.thumbnailUrl === url) thumb.dataset.thumbnailLoaded = 'false';
  }, { once: true });
}

async function hydrateProjectThumbnails(screen: HTMLElement, force = false): Promise<void> {
  if (!client || screen.dataset.kxProjectThumbnails === 'loading') return;
  if (!force && screen.dataset.kxProjectThumbnails === 'ready') return;
  screen.dataset.kxProjectThumbnails = 'loading';
  const currentGeneration = ++generation;
  try {
    if (!(await refreshClientSession())) {
      screen.dataset.kxProjectThumbnails = 'auth-required';
      return;
    }
    const projects = await client.projects.list();
    const cloudUrls = await cloudThumbnailUrls(projects.map((project) => project.id));
    if (!screen.isConnected || currentGeneration !== generation) return;
    const cards = [...screen.querySelectorAll<HTMLElement>('.project-card')];
    cards.forEach((card, index) => {
      const project = projects[index];
      if (!project) return;
      card.dataset.projectId = project.id;
      const thumb = card.querySelector<HTMLElement>('.project-thumb');
      if (!thumb) return;
      const url = cloudUrls.get(project.id) ?? project.thumbnail;
      thumb.dataset.hasThumbnail = String(Boolean(url));
      if (url) mountImage(thumb, url, project.name);
      else {
        thumb.dataset.thumbnailLoaded = 'false';
        thumb.setAttribute('aria-label', `${project.name} has no generated thumbnail yet`);
      }
    });
    screen.dataset.kxProjectThumbnails = 'ready';
  } catch (error) {
    console.warn('[Kyxos] Project thumbnail hydration failed.', error);
    // Project list owns auth/error handling. Thumbnail hydration must never block navigation.
    screen.dataset.kxProjectThumbnails = 'unavailable';
  }
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.projects-screen').forEach((screen) => {
    void hydrateProjectThumbnails(screen);
  });
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('kx:project-thumbnail-updated', () => {
  document.querySelectorAll<HTMLElement>('.projects-screen').forEach((screen) => {
    screen.dataset.kxProjectThumbnails = '';
    void hydrateProjectThumbnails(screen, true);
  });
});
scan();