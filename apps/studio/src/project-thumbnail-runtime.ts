import { hashBlob } from '@kyxos/api-client';
import { createDurableApiClient } from '@kyxos/api-client/durable';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';
import type { ProjectSession } from '@kyxos/editor-core';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const LOCAL_KEY = 'kyxos-studio-local-v1';
const THUMBNAIL_WIDTH = 512;
const THUMBNAIL_HEIGHT = 288;
const CAPTURE_DEBOUNCE_MS = 2600;
const MIN_CAPTURE_INTERVAL_MS = 12_000;

const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);
const thumbnailClient = createDurableApiClient({
  url: backendConfig.supabaseUrl,
  anonKey: backendConfig.supabaseAnonKey,
  functionsUrl: backendConfig.functionsUrl,
});

function importTransactionActive(): boolean {
  const dataset = document.documentElement.dataset;
  return dataset.importWorkerBoundary === 'running' && dataset.importCoreComplete !== 'true';
}

async function ensureCloudSession(): Promise<void> {
  if (backendConfig.provider !== 'supabase') return;
  // This module is evaluated before the login screen completes, so its client
  // may have been constructed without the token. Refresh from sessionStorage at
  // the moment a cloud thumbnail is actually persisted.
  const session = await thumbnailClient.auth.getSession();
  if (!session) throw new Error('Authentication is required to persist a project thumbnail.');
}

async function normalizedThumbnail(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = THUMBNAIL_HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is unavailable for project thumbnail generation.');
    context.fillStyle = '#11151d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = Math.max(1, bitmap.width * scale);
    const height = Math.max(1, bitmap.height * scale);
    context.drawImage(
      bitmap,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (output) => output ? resolve(output) : reject(new Error('Project thumbnail encoding failed.')),
        'image/webp',
        0.8,
      );
    });
  } finally {
    bitmap.close();
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Thumbnail data URL conversion failed.'));
    reader.readAsDataURL(blob);
  });
}

function persistLocalThumbnail(projectId: string, thumbnail: string): void {
  try {
    const state = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as {
      projects?: Array<{ id: string; thumbnail?: string }>;
    };
    const project = state.projects?.find((entry) => entry.id === projectId);
    if (!project) return;
    // A generated cover is presentation metadata, not authoring activity. Draft
    // saves already own updatedAt; simply opening a project must not reorder it.
    project.thumbnail = thumbnail;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[Kyxos] Local project thumbnail persistence failed.', error);
  }
}

function cloudHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = sessionStorage.getItem('kyxos-token');
  if (backendConfig.supabaseAnonKey) headers.set('apikey', backendConfig.supabaseAnonKey);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function postgrest(path: string, init: RequestInit): Promise<void> {
  if (!backendConfig.supabaseUrl || !backendConfig.supabaseAnonKey) return;
  const response = await fetch(`${backendConfig.supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: cloudHeaders(init.headers),
  });
  if (!response.ok) {
    throw new Error(`Project thumbnail metadata update failed (${response.status}): ${await response.text()}`);
  }
}

async function persistCloudThumbnail(projectId: string, blob: Blob): Promise<string> {
  await ensureCloudSession();
  const hash = await hashBlob(blob);
  const ticket = await thumbnailClient.assets.createUpload({
    hash,
    name: `project-thumbnail-${projectId}.webp`,
    mimeType: 'image/webp',
    byteSize: blob.size,
  });
  if (!ticket.alreadyExists) {
    await thumbnailClient.assets.upload(ticket, blob);
    await thumbnailClient.assets.completeUpload(ticket.assetId, {
      kind: 'project-thumbnail',
      projectId,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      generatedBy: 'kyxos-studio',
    });
  }

  // Link the thumbnail asset into the project so editors/viewers can resolve it
  // through normal project-member RLS, then make it the current project cover.
  await postgrest('project_assets?on_conflict=project_id,asset_id', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ project_id: projectId, asset_id: ticket.assetId }),
  });
  await postgrest(`projects?id=eq.${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ thumbnail_asset_id: ticket.assetId }),
  });
  return ticket.assetId;
}

async function persistThumbnail(projectId: string, rawBlob: Blob): Promise<void> {
  const blob = await normalizedThumbnail(rawBlob);
  if (backendConfig.provider === 'supabase') {
    const assetId = await persistCloudThumbnail(projectId, blob);
    document.documentElement.dataset.projectThumbnailAssetId = assetId;
  } else {
    persistLocalThumbnail(projectId, await blobToDataUrl(blob));
  }
  document.documentElement.dataset.projectThumbnailState = 'saved';
  window.dispatchEvent(new CustomEvent('kx:project-thumbnail-updated', { detail: { projectId } }));
}

const originalBindSession = BrowserKyxosViewportAdapter.prototype.bindSession;
BrowserKyxosViewportAdapter.prototype.bindSession = function bindSessionWithProjectThumbnail(
  session: ProjectSession,
): () => void {
  const adapter = this;
  const disposeOriginal = originalBindSession.call(adapter, session);
  const root = document.querySelector<HTMLElement>('.kyxos-studio-shell');
  if (root) root.dataset.projectId = session.projectId;
  document.documentElement.dataset.kxActiveProjectId = session.projectId;

  let timer = 0;
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let lastCaptureAt = 0;
  let lastCapturedVersion = -1;
  let publishGate = false;
  let replayingPublish = false;
  let deferredByImport = false;

  const capture = async (force = false): Promise<void> => {
    if (disposed) return;
    if (force) window.clearTimeout(timer);

    // Project covers are derived presentation data. They must never compete with
    // the authoritative upload / parse / activate / autosave import transaction.
    // Resume only after Studio marks the core import as complete.
    if (importTransactionActive()) {
      deferredByImport = true;
      document.documentElement.dataset.projectThumbnailState = 'deferred-import';
      window.clearTimeout(timer);
      return;
    }

    const version = session.document.version;
    const now = Date.now();
    if (!force && version === lastCapturedVersion) return;
    if (!force && now - lastCaptureAt < MIN_CAPTURE_INTERVAL_MS) {
      schedule(MIN_CAPTURE_INTERVAL_MS - (now - lastCaptureAt));
      return;
    }
    if (inFlight) {
      await inFlight;
      if (force && !disposed && !importTransactionActive()) await capture(true);
      return;
    }
    document.documentElement.dataset.projectThumbnailState = 'capturing';
    inFlight = (async () => {
      try {
        const blob = await adapter.captureThumbnail();
        // Import can begin while a scheduled capture is waiting on the GPU.
        // Do not persist that stale frame into project metadata in that case.
        if (importTransactionActive()) {
          deferredByImport = true;
          document.documentElement.dataset.projectThumbnailState = 'deferred-import';
          return;
        }
        await persistThumbnail(session.projectId, blob);
        lastCapturedVersion = version;
        lastCaptureAt = Date.now();
        deferredByImport = false;
      } catch (error) {
        document.documentElement.dataset.projectThumbnailState = 'error';
        console.warn('[Kyxos] Project thumbnail capture failed.', error);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  };

  function schedule(delay = CAPTURE_DEBOUNCE_MS): void {
    if (disposed) return;
    window.clearTimeout(timer);
    if (importTransactionActive()) {
      deferredByImport = true;
      document.documentElement.dataset.projectThumbnailState = 'deferred-import';
      return;
    }
    timer = window.setTimeout(() => void capture(), delay);
  }

  const onDocumentChange = () => {
    if (importTransactionActive()) {
      deferredByImport = true;
      window.clearTimeout(timer);
      document.documentElement.dataset.projectThumbnailState = 'deferred-import';
      return;
    }
    schedule();
  };
  session.document.addEventListener('change', onDocumentChange);

  const onImportStep = () => {
    if (importTransactionActive()) {
      deferredByImport = true;
      window.clearTimeout(timer);
      document.documentElement.dataset.projectThumbnailState = 'deferred-import';
      return;
    }
    if (deferredByImport || document.documentElement.dataset.importCoreComplete === 'true') {
      deferredByImport = false;
      schedule(900);
    }
  };
  document.addEventListener('kyxos:studio-import-step', onImportStep);

  const onTopbarAction = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const label = (button?.getAttribute('aria-label') ?? button?.textContent ?? '').trim();
    if (!button) return;

    if (label === 'Publish') {
      if (replayingPublish) {
        replayingPublish = false;
        return;
      }

      // The publish_scene transaction snapshots projects.thumbnail_asset_id.
      // Stop the first click before the original target listener runs, persist
      // the exact current viewport cover, then replay the same existing button.
      // If import is still running, leave the existing Publish behavior alone;
      // import validation owns that transitional state and thumbnail work must
      // not extend the critical path.
      if (importTransactionActive()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (publishGate) return;
      publishGate = true;
      document.documentElement.dataset.projectThumbnailPublishGate = 'capturing';
      void (async () => {
        await capture(true);
        if (disposed || !button.isConnected) {
          publishGate = false;
          return;
        }
        document.documentElement.dataset.projectThumbnailPublishGate = 'ready';
        replayingPublish = true;
        button.click();
        publishGate = false;
      })();
      return;
    }

    if (/Projects/i.test(label) && !importTransactionActive()) void capture(true);
  };
  root?.addEventListener('click', onTopbarAction, { capture: true });

  // Produce a cover for newly created projects once no authoritative import is
  // in flight. If the first import starts immediately, the capture is deferred.
  schedule(1800);

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    session.document.removeEventListener('change', onDocumentChange);
    document.removeEventListener('kyxos:studio-import-step', onImportStep);
    root?.removeEventListener('click', onTopbarAction, { capture: true });
    if (document.documentElement.dataset.kxActiveProjectId === session.projectId) {
      delete document.documentElement.dataset.kxActiveProjectId;
    }
    delete document.documentElement.dataset.projectThumbnailPublishGate;
    disposeOriginal();
  };
};