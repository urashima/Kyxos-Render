import { createKyxosApiClient } from '@kyxos/api-client';
import { createDefaultSceneDocument, type CameraState } from '@kyxos/scene-contract';
import { KyxosViewer } from '@kyxos/viewer';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Public viewer root not found.');

const route = parseRoute(window.location.pathname);
const params = new URLSearchParams(window.location.search);
const hideUi = params.get('ui') === '0';
const autoplay = params.get('autoplay') === '1';

root.innerHTML = `
  <main class="public-shell ${hideUi ? 'embed-clean' : ''}">
    <canvas id="public-canvas" tabindex="0"></canvas>
    <section class="public-toolbar" ${hideUi ? 'hidden' : ''}>
      <strong id="scene-title">Kyxos Scene</strong>
      <span id="scene-state">Loading</span>
      <button id="autoplay-button" title="Auto rotate">Rotate</button>
      <button id="annotation-prev" title="Previous annotation">Prev</button>
      <button id="annotation-next" title="Next annotation">Next</button>
      <button id="screenshot-button" title="Screenshot">Shot</button>
      <button id="fullscreen-button" title="Fullscreen">Full</button>
    </section>
    <aside class="annotation-list" id="annotation-list" ${hideUi ? 'hidden' : ''}></aside>
  </main>
`;

const canvas = root.querySelector<HTMLCanvasElement>('#public-canvas');
if (!canvas) throw new Error('Public viewer canvas not found.');

const apiClient = createKyxosApiClient({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

const viewer = await KyxosViewer.create({
  canvas,
  backend: 'auto',
  quality: 'high',
  pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
});

const resolved = await apiClient.resolvePublicScene(route.slug);
const scene =
  resolved.ok && resolved.data
    ? resolved.data.scene
    : createDefaultSceneDocument({
        project: {
          id: `public-${route.slug}`,
          ownerId: 'public',
          title: 'Kyxos Acceptance Scene',
          slug: route.slug,
          visibility: 'public',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

await viewer.applySceneDocument(scene);
document.title = `${scene.project.title} - Kyxos`;
root.querySelector('#scene-title')!.textContent = scene.project.title;
root.querySelector('#scene-state')!.textContent = resolved.ok ? 'Published' : 'Local fallback';

const annotations = scene.annotations
  .filter((annotation) => annotation.visible)
  .sort((a, b) => a.sortOrder - b.sortOrder);
let annotationIndex = 0;
renderAnnotations();

if (autoplay) {
  const camera = viewer.getCameraState();
  viewer.setCameraState({ ...camera, autoRotate: true });
  viewer.playAnimation(scene.animation.activeClipId ?? scene.animation.defaultClipId ?? undefined);
}

root.querySelector('#autoplay-button')?.addEventListener('click', () => {
  const camera = viewer.getCameraState();
  viewer.setCameraState({ ...camera, autoRotate: !camera.autoRotate });
});
root.querySelector('#fullscreen-button')?.addEventListener('click', () => {
  void root.querySelector('.public-shell')?.requestFullscreen();
});
root.querySelector('#screenshot-button')?.addEventListener('click', async () => {
  const blob = await viewer.capture();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${scene.project.slug ?? 'kyxos-scene'}.png`;
  link.click();
  URL.revokeObjectURL(url);
});
root.querySelector('#annotation-prev')?.addEventListener('click', () => focusAnnotation(annotationIndex - 1));
root.querySelector('#annotation-next')?.addEventListener('click', () => focusAnnotation(annotationIndex + 1));

window.addEventListener('beforeunload', () => viewer.dispose());

function parseRoute(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  const marker = parts.includes('embed') ? 'embed' : 's';
  const slug = parts[parts.indexOf(marker) + 1] ?? 'kyxos-acceptance-scene';
  return { embed: marker === 'embed', slug };
}

function focusAnnotation(nextIndex: number) {
  if (annotations.length === 0) return;
  annotationIndex = (nextIndex + annotations.length) % annotations.length;
  const annotation = annotations[annotationIndex];
  const camera = viewer.getCameraState();
  const nextCamera: CameraState = {
    ...camera,
    position: annotation.cameraPosition,
    target: annotation.cameraTarget,
    defaultView: false,
  };
  viewer.setCameraState(nextCamera);
  renderAnnotations();
}

function renderAnnotations() {
  const host = root.querySelector('#annotation-list');
  if (!host) return;
  host.innerHTML = annotations
    .map(
      (annotation, index) => `
        <button class="${index === annotationIndex ? 'active' : ''}" data-annotation-index="${index}">
          <strong>${annotation.title}</strong>
          <span>${annotation.markdown.replace(/[#*_`]/g, '').slice(0, 120)}</span>
        </button>`,
    )
    .join('');
  host.querySelectorAll<HTMLButtonElement>('[data-annotation-index]').forEach((button) => {
    button.addEventListener('click', () => focusAnnotation(Number(button.dataset.annotationIndex)));
  });
}
