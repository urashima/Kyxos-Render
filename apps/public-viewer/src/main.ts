import './styles.css';
import {
  assetResolverFromManifest,
  createApiClient,
  type AssetManifest,
  type ReleaseRecord,
} from '@kyxos/api-client';
import { migrateSceneContract } from '@kyxos/scene-migrations';
import { KyxosViewer } from '@kyxos/viewer';

const app = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const embed = location.pathname.includes('/embed') || params.get('ui') === '0';
const publicFunctionUrl = import.meta.env.VITE_KYXOS_PUBLIC_FUNCTION_URL as string | undefined;
const client = createApiClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  functionsUrl: import.meta.env.VITE_KYXOS_FUNCTIONS_URL,
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

function control(label: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', action);
  return node;
}

async function resolvePublishedScene(): Promise<{
  release: ReleaseRecord;
  manifest: AssetManifest;
  allowedEmbedOrigins: string[];
}> {
  const versionId = params.get('release');
  const slug = params.get('slug');
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
  const manifest = await client.assets.getManifest(Object.keys(release.sceneSnapshot.assets));
  return { release, manifest, allowedEmbedOrigins: [] };
}

async function load(): Promise<void> {
  try {
    const resolved = await resolvePublishedScene();
    for (const origin of resolved.allowedEmbedOrigins) {
      try {
        allowedOrigins.add(new URL(origin).origin);
      } catch {
        // Invalid stored origins are ignored.
      }
    }

    const contract = migrateSceneContract(resolved.release.sceneSnapshot);
    viewer = await KyxosViewer.create({
      canvas,
      backend: (params.get('backend') as any) ?? contract.renderSettings.backend ?? 'auto',
      quality: (params.get('quality') as any) ?? contract.renderSettings.qualityPreset,
    });
    viewer.addEventListener('warning', (event) =>
      console.warn('Kyxos Viewer warning', (event as CustomEvent).detail),
    );
    viewer.addEventListener('error', (event) =>
      showError((event as CustomEvent).detail?.error ?? 'Renderer error'),
    );
    await viewer.loadScene(contract, assetResolverFromManifest(resolved.manifest));

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
  const message = error instanceof Error ? error.message : String(error);
  loading.className = 'error';
  loading.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = 'Scene unavailable';
  const description = document.createElement('span');
  description.textContent = publicError(message);
  const retry = control('Retry', () => location.reload());
  loading.append(title, description, retry);
}

function publicError(message: string): string {
  if (/webgl 2 context|webgpu/i.test(message)) {
    return 'This device cannot create a compatible WebGPU or WebGL 2 renderer.';
  }
  if (/asset/i.test(message)) return 'One or more published assets are missing or unavailable.';
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

window.addEventListener('resize', () => viewer?.resize(root.clientWidth, root.clientHeight));
void load();
