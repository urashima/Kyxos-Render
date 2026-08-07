import './release-thumbnails-ui.css';
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

interface PublishedVersionThumbnailRow {
  id: string;
  version_number: number;
  thumbnail_asset_id: string | null;
}

interface ThumbnailAssetRow {
  id: string;
  content_hash: string;
}

function cloudHeaders(): Headers {
  const headers = new Headers();
  const token = sessionStorage.getItem('kyxos-token');
  if (backendConfig.supabaseAnonKey) headers.set('apikey', backendConfig.supabaseAnonKey);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

function versionNumber(card: HTMLElement): number | null {
  const text = card.querySelector('strong')?.textContent ?? '';
  const match = text.match(/^v(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function fetchVersionRows(projectId: string): Promise<PublishedVersionThumbnailRow[]> {
  if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) return [];
  const query = new URLSearchParams({
    select: 'id,version_number,thumbnail_asset_id',
    project_id: `eq.${projectId}`,
    order: 'version_number.desc',
  });
  const response = await fetch(
    `${backendConfig.supabaseUrl.replace(/\/$/, '')}/rest/v1/published_versions?${query}`,
    { headers: cloudHeaders() },
  );
  if (!response.ok) throw new Error(`Published thumbnail query failed (${response.status}).`);
  return await response.json() as PublishedVersionThumbnailRow[];
}

async function resolveThumbnailUrls(rows: PublishedVersionThumbnailRow[]): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  if (!client || !backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) return output;
  const assetIds = [...new Set(rows
    .map((row) => row.thumbnail_asset_id)
    .filter((value): value is string => Boolean(value)))];
  if (!assetIds.length) return output;

  const query = new URLSearchParams({
    select: 'id,content_hash',
    id: `in.(${assetIds.join(',')})`,
  });
  const response = await fetch(
    `${backendConfig.supabaseUrl.replace(/\/$/, '')}/rest/v1/assets?${query}`,
    { headers: cloudHeaders() },
  );
  if (!response.ok) throw new Error(`Release thumbnail asset query failed (${response.status}).`);
  const assets = await response.json() as ThumbnailAssetRow[];
  const hashById = new Map(assets.map((asset) => [asset.id, asset.content_hash]));
  const manifest = await client.assets.getManifest(assetIds);

  for (const row of rows) {
    if (!row.thumbnail_asset_id) continue;
    const hash = hashById.get(row.thumbnail_asset_id);
    const url = hash ? manifest.assets[`asset://${hash}`] : undefined;
    if (url) output.set(row.id, url);
  }
  return output;
}

function mountThumbnail(card: HTMLElement, url: string, version: number): void {
  let frame = card.querySelector<HTMLElement>(':scope > .kx-release-thumbnail');
  if (!frame) {
    frame = document.createElement('div');
    frame.className = 'kx-release-thumbnail';
    card.prepend(frame);
  }
  if (frame.dataset.url === url && frame.querySelector('img')) return;
  frame.dataset.url = url;
  frame.dataset.state = 'loading';
  const image = document.createElement('img');
  image.src = url;
  image.alt = `Published version ${version} thumbnail`;
  image.decoding = 'async';
  image.loading = 'lazy';
  image.addEventListener('load', () => {
    if (frame?.dataset.url !== url) return;
    frame.replaceChildren(image);
    frame.dataset.state = 'ready';
  }, { once: true });
  image.addEventListener('error', () => {
    if (frame?.dataset.url === url) frame.dataset.state = 'error';
  }, { once: true });
}

async function hydrate(dialog: HTMLElement): Promise<void> {
  if (
    backendConfig.provider !== 'supabase'
    || !client
    || dialog.dataset.kxReleaseThumbnails === 'loading'
  ) return;
  const projectId = document.querySelector<HTMLElement>('.kyxos-studio-shell')?.dataset.projectId;
  const cards = [...dialog.querySelectorAll<HTMLElement>('.release-card')];
  if (!projectId || !cards.length) return;

  dialog.dataset.kxReleaseThumbnails = 'loading';
  try {
    if (!(await client.auth.getSession())) {
      dialog.dataset.kxReleaseThumbnails = 'auth-required';
      return;
    }
    const rows = await fetchVersionRows(projectId);
    const urls = await resolveThumbnailUrls(rows);
    const byVersion = new Map(rows.map((row) => [row.version_number, row]));
    for (const card of cards) {
      const version = versionNumber(card);
      if (version == null) continue;
      const row = byVersion.get(version);
      if (!row) continue;
      card.dataset.releaseId = row.id;
      card.dataset.releaseVersion = String(version);
      const url = urls.get(row.id);
      card.dataset.hasReleaseThumbnail = String(Boolean(url));
      if (url) mountThumbnail(card, url, version);
    }
    dialog.dataset.kxReleaseThumbnails = 'ready';
  } catch (error) {
    console.warn('[Kyxos] Release thumbnail hydration failed.', error);
    dialog.dataset.kxReleaseThumbnails = 'unavailable';
  }
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.release-dialog').forEach((dialog) => {
    if (!dialog.querySelector('.release-card')) {
      delete dialog.dataset.kxReleaseThumbnails;
      return;
    }
    if (dialog.dataset.kxReleaseThumbnails !== 'ready') void hydrate(dialog);
  });
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();