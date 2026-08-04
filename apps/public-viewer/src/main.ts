import './styles.css';
import {
  assetResolverFromManifest,
  type AssetManifest,
  type ReleaseRecord,
} from '@kyxos/api-client';
import { createDurableApiClient } from '@kyxos/api-client/durable';
import { resolveKyxosRuntimeBackendConfig } from '@kyxos/api-client/runtime-config';
import { createEmptySceneContract, type KyxosSceneContract } from '@kyxos/scene-contract';
import { migrateSceneContract } from '@kyxos/scene-migrations';
import { KyxosViewer } from '@kyxos/viewer';

const app = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const routeSlug = (() => {
  const match = location.pathname.match(/\/view\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
})();
const embed = location.pathname.includes('/embed') || params.get('ui') === '0';
const backendConfig = resolveKyxosRuntimeBackendConfig(import.meta.env);
document.documentElement.dataset.apiProvider = backendConfig.provider;
const publicFunctionUrl = backendConfig.publicFunctionUrl;
const client = createDurableApiClient({
  url: backendConfig.supabaseUrl,
  anonKey: backendConfig.supabaseAnonKey,
  functionsUrl: backendConfig.functionsUrl,
});

const root = document.createElement('main');
root.className = `public-shell${embed ? ' embed' : ''}`;
const canvas = document.createElement('canvas');
canvas.id = 'viewer';
const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Loading scene…';
const controls = document.createElement('nav');
controls.className = 'controls';
root.append(canvas, loading, controls);
app.append(root);

let viewer: KyxosViewer | null = null;
let ready = false;
const allowedOrigins = new Set<string>([location.origin]);
try {
  if (document.referrer) allowedOrigins.add(new URL(document.referrer).origin);
} catch {
  // A malformed referrer is ignored.
}
for (const origin of (params.get('origin') ?? '').split(',').filter(Boolean)) {
  try {
    allowedOrigins.add(new URL(origin).origin);
  } catch {
    // Invalid explicit origins are ignored.
  }
}

function setStage(stage: string, message: string): void {
  document.documentElement.dataset.publicViewerStage = stage;
  document.documentElement.dataset.publicViewerMessage = message;
  if (loading.isConnected && loading.className !== 'error') loading.textContent = message;
}

function withTimeout<T>(label: string, promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(milliseconds / 1000)} seconds.`)),
      milliseconds,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function control(label: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', action);
  return node;
}

function createPublicUiFixture(): { release: ReleaseRecord; manifest: AssetManifest } {
  const scene = createEmptySceneContract('Kyxos Public Viewer UI Fixture');
  const timestamp = '2026-08-01T00:00:00.000Z';
  scene.id = 'kyxos-public-ui-fixture';
  scene.metadata.createdAt = timestamp;
  scene.metadata.updatedAt = timestamp;
  scene.environment.backgroundColor = '#596153';
  scene.environment.backgroundIntensity = 0.85;
  scene.renderSettings.backend = 'auto';
  scene.renderSettings.qualityPreset = 'high';
  return {
    release: {
      id: 'ui-fixture-v1',
      projectId: 'ui-fixture',
      versionNumber: 1,
      sceneSnapshot: scene,
      sceneDigest: 'ui-fixture-v1',
      slug: 'ui-fixture',
      createdAt: timestamp,
      isCurrent: true,
    },
    manifest: { assets: {} },
  };
}

function requiresPublishedAsset(asset: any): boolean {
  const metadata = asset?.metadata ?? {};
  const id = String(asset?.id ?? '');
  return (
    metadata.embedded !== true &&
    !metadata.embeddedInAssetId &&
    asset?.storageType !== 'virtual' &&
    asset?.runtimeOnly !== true &&
    !id.startsWith('embedded-gltf-')
  );
}

async function resolvePublishedScene(): Promise<{
  release: ReleaseRecord;
  manifest: AssetManifest;
  allowedEmbedOrigins: string[];
}> {
  if (backendConfig.error) throw new Error(backendConfig.error);
  const versionId = params.get('release');
  const slug = params.get('slug') ?? routeSlug;
  if (slug === 'ui-fixture') {
    return { ...createPublicUiFixture(), allowedEmbedOrigins: [] };
  }
  if (!versionId && !slug) throw new Error('A published release or public slug is required.');

  if (publicFunctionUrl) {
    const url = new URL(publicFunctionUrl);
    if (versionId) url.searchParams.set('version', versionId);
    if (slug) url.searchParams.set('slug', slug);
    const response = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    const payload = (await response.json()) as {
      release: ReleaseRecord;
      manifest: AssetManifest;
      embed?: { allowedOrigins?: string[] };
    };
    return {
      release: payload.release,
      manifest: payload.manifest,
      allowedEmbedOrigins: payload.embed?.allowedOrigins ?? [],
    };
  }

  const release = versionId
    ? await client.publicScenes.getVersion(versionId)
    : await client.publicScenes.resolveSlug(slug!);
  const manifest = await client.assets.getManifest(
    Object.values(release.sceneSnapshot.assets)
      .filter(requiresPublishedAsset)
      .map((asset) => asset.id),
  );
  return { release, manifest, allowedEmbedOrigins: [] };
}

function verifyManifest(contract: KyxosSceneContract, manifest: AssetManifest): void {
  const missing = Object.values(contract.assets)
    .filter(requiresPublishedAsset)
    .filter((asset) => !manifest.assets[asset.uri])
    .map((asset) => `${asset.name ?? asset.id} (${asset.uri})`);
  if (missing.length) {
    throw new Error(`Published asset manifest is incomplete: ${missing.slice(0, 8).join(', ')}`);
  }
}

async function load(): Promise<void> {
  try {
    setStage('resolve-release', 'Resolving published version…');
    const resolved = await withTimeout(
      'Published version lookup',
      resolvePublishedScene(),
      20_000,
    );
    document.documentElement.dataset.publicReleaseId = resolved.release.id;
    document.documentElement.dataset.publicReleaseVersion = String(resolved.release.versionNumber);
    for (const origin of resolved.allowedEmbedOrigins) {
      try {
        allowedOrigins.add(new URL(origin).origin);
      } catch {
        // Invalid stored origins are ignored.
      }
    }

    setStage('migrate-contract', 'Preparing scene data…');
    const contract = migrateSceneContract(resolved.release.sceneSnapshot);
    verifyManifest(contract, resolved.manifest);

    setStage('create-renderer', 'Starting renderer…');
    viewer = await withTimeout(
      'Renderer initialization',
      KyxosViewer.create({
        canvas,
        backend: (params.get('backend') as any) ?? contract.renderSettings.backend ?? 'auto',
        quality: (params.get('quality') as any) ?? contract.renderSettings.qualityPreset,
      }),
      30_000,
    );
    viewer.addEventListener('warning', (event) =>
      console.warn('Kyxos Viewer warning', (event as CustomEvent).detail),
    );
    viewer.addEventListener('error', (event) =>
      showError((event as CustomEvent).detail?.error ?? 'Renderer error'),
    );

    setStage('load-assets', 'Loading published assets…');
    await withTimeout(
      'Published scene asset loading',
      viewer.loadScene(contract, assetResolverFromManifest(resolved.manifest)),
      60_000,
    );

    if (params.has('camera')) {
      const camera = contract.cameras.find((entry) => entry.id === params.get('camera'));
      if (camera) viewer.setCameraState(camera);
    }
    if (params.get('autorotate') === '1') {
      const camera = contract.cameras.find((entry) => entry.id === contract.activeCameraId);
      if (camera) viewer.setCameraState({ ...camera, autoRotate: true });
    }
    if (params.get('animation')) {
      viewer.setAnimationState({
        clipId: params.get('animation')!,
        playing: params.get('autoplay') !== '0',
        loop: true,
        speed: Number(params.get('speed') ?? 1),
      });
    }
    if (params.get('transparent') === '1') {
      viewer.setEnvironment({ ...contract.environment, transparentBackground: true });
    }

    loading.remove();
    ready = true;
    document.documentElement.dataset.publicViewerReady = 'true';
    setStage('ready', `Published v${resolved.release.versionNumber} ready`);
    buildControls(contract.animations.map((entry) => ({ id: entry.id, name: entry.name })));
    postReady();
  } catch (error) {
    showError(error);
  }
}

function buildControls(animations: Array<{ id: string; name: string }>): void {
  if (embed) {
    controls.remove();
    return;
  }
  controls.append(
    control('Reset', () => viewer?.resetCamera()),
    control('Fullscreen', () => void root.requestFullscreen()),
    control('Share', () => void navigator.clipboard.writeText(location.href)),
  );
  if (animations.length) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Animation');
    select.append(new Option('Animation', ''));
    for (const animation of animations) select.append(new Option(animation.name, animation.id));
    select.addEventListener('change', () =>
      viewer?.setAnimationState({
        clipId: select.value,
        playing: Boolean(select.value),
        loop: true,
        speed: 1,
      }),
    );
    controls.append(
      select,
      control('Play / Pause', () =>
        viewer?.setAnimationEnabled(!viewer.getAnimationEnabled()),
      ),
    );
  }
}

function showError(error: unknown): void {
  ready = false;
  delete document.documentElement.dataset.publicViewerReady;
  const message = error instanceof Error ? error.message : String(error);
  console.error('Kyxos Public Viewer load failed', error);
  document.documentElement.dataset.publicViewerStage = 'error';
  document.documentElement.dataset.publicViewerError = message;
  loading.className = 'error';
  loading.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = 'Scene unavailable';
  const description = document.createElement('span');
  description.textContent = publicError(message);
  description.title = message;
  const retry = control('Retry', () => location.reload());
  loading.append(title, description, retry);
}

function publicError(message: string): string {
  if (/timed out/i.test(message)) {
    return 'Loading took too long. Retry the scene or verify that all published assets are available.';
  }
  if (/webgl 2 context|webgpu/i.test(message)) {
    return 'This device cannot create a compatible WebGPU or WebGL 2 renderer.';
  }
  if (/asset|manifest/i.test(message)) return 'One or more published assets are missing or unavailable.';
  if (/snapshot/i.test(message)) return 'The published scene snapshot is missing or incomplete.';
  if (/contract|migration|compatible/i.test(message)) {
    return 'This scene version is not compatible with the current viewer.';
  }
  if (/disabled|not exist|not found|404/i.test(message)) {
    return 'The published link is disabled or does not exist.';
  }
  if (/memory|allocation/i.test(message)) {
    return 'The scene exceeds the graphics memory available on this device.';
  }
  return 'The scene could not be loaded. Please retry.';
}

function postToHost(event: MessageEvent, payload: unknown, transfer?: Transferable[]): void {
  const source = event.source as WindowProxy | null;
  if (!source) return;
  source.postMessage(payload, event.origin, transfer ?? []);
}

function postReady(): void {
  if (window.parent === window) return;
  const targetOrigin = document.referrer ? new URL(document.referrer).origin : '*';
  window.parent.postMessage(
    { source: 'kyxos-viewer', type: 'ready', state: viewer?.getCapabilities() },
    targetOrigin,
  );
}

window.addEventListener('message', async (event) => {
  if (
    !allowedOrigins.has(event.origin) ||
    !viewer ||
    !event.data ||
    event.data.source !== 'kyxos-host'
  ) {
    return;
  }
  const command = event.data.command;
  const payload = event.data.payload ?? {};
  try {
    if (command === 'playAnimation') {
      viewer.setAnimationState({
        clipId: payload.clipId,
        playing: true,
        loop: payload.loop ?? true,
        speed: payload.speed ?? 1,
      });
    } else if (command === 'pauseAnimation') {
      viewer.setAnimationEnabled(false);
    } else if (command === 'setCamera') {
      viewer.setCameraState(payload);
    } else if (command === 'resetCamera') {
      viewer.resetCamera();
    } else if (command === 'setQuality') {
      viewer.setQualityPreset(payload.quality);
    } else if (command === 'capture') {
      const blob = await viewer.capture();
      const buffer = await blob.arrayBuffer();
      postToHost(
        event,
        {
          source: 'kyxos-viewer',
          type: 'capture',
          requestId: event.data.requestId,
          mimeType: blob.type,
          buffer,
        },
        [buffer],
      );
    } else if (command === 'getReadyState') {
      postToHost(event, {
        source: 'kyxos-viewer',
        type: 'readyState',
        requestId: event.data.requestId,
        ready,
      });
    }
  } catch (error) {
    postToHost(event, {
      source: 'kyxos-viewer',
      type: 'error',
      requestId: event.data.requestId,
      message: publicError(error instanceof Error ? error.message : String(error)),
    });
  }
});

window.addEventListener('error', (event) => {
  if (!ready) showError(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  if (!ready) showError(event.reason);
});
window.addEventListener('resize', () => viewer?.resize(root.clientWidth, root.clientHeight));
void load();
