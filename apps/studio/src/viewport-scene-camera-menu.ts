import type { KyxosSceneContract, SceneCamera, Vec3 } from '@kyxos/scene-contract';

interface StudioApiLike {
  getScene(): KyxosSceneContract;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

const SCENE_PREFIX = 'scene-camera:';
let boundSelect: HTMLSelectElement | null = null;
let boundCanvas: HTMLCanvasElement | null = null;
let sceneSignature = '';

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function cameraState(camera: SceneCamera): {
  camera: SceneCamera;
  up: Vec3;
  preset: 'scene-camera';
} {
  return {
    camera: structuredClone(camera),
    up: { x: 0, y: 1, z: 0 },
    preset: 'scene-camera',
  };
}

function sceneCameras(): SceneCamera[] {
  return [...(studioApi()?.getScene().cameras ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function signature(cameras: SceneCamera[]): string {
  return cameras.map((camera) => `${camera.id}\u0000${camera.name}`).join('\u0001');
}

function removeSceneOptions(select: HTMLSelectElement): void {
  select.querySelectorAll('optgroup[data-kx-scene-cameras], option[data-kx-scene-camera]')
    .forEach((element) => element.remove());
}

function syncOptions(select: HTMLSelectElement): void {
  const cameras = sceneCameras();
  const nextSignature = signature(cameras);
  if (nextSignature === sceneSignature && select.querySelector('[data-kx-scene-cameras]')) return;
  const previous = select.value;
  removeSceneOptions(select);
  const group = document.createElement('optgroup');
  group.label = 'Scene Cameras';
  group.dataset.kxSceneCameras = '';
  if (!cameras.length) {
    const option = new Option('No scene cameras', '');
    option.disabled = true;
    option.dataset.kxSceneCamera = '';
    group.append(option);
  } else {
    const activeId = studioApi()?.getScene().activeCameraId;
    for (const camera of cameras) {
      const option = new Option(
        `${camera.id === activeId ? '● ' : ''}${camera.name}`,
        `${SCENE_PREFIX}${camera.id}`,
      );
      option.dataset.kxSceneCamera = camera.id;
      group.append(option);
    }
  }
  select.append(group);
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  sceneSignature = nextSignature;
}

function onChange(event: Event): void {
  const select = event.currentTarget as HTMLSelectElement;
  if (!select.value.startsWith(SCENE_PREFIX) || !boundCanvas) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const cameraId = select.value.slice(SCENE_PREFIX.length);
  const camera = sceneCameras().find((entry) => entry.id === cameraId);
  if (!camera) return;
  boundCanvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
    detail: {
      command: 'restore-bookmark',
      state: cameraState(camera),
    },
  }));
  boundCanvas.dataset.editorView = 'scene-camera';
  boundCanvas.dataset.sceneCameraId = camera.id;
}

function detach(): void {
  if (boundSelect) boundSelect.removeEventListener('change', onChange, true);
  boundSelect = null;
  boundCanvas = null;
  sceneSignature = '';
}

function discover(): void {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Viewport view"]');
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  if (!select || !canvas) {
    if (boundSelect && !boundSelect.isConnected) detach();
    return;
  }
  if (boundSelect !== select) {
    detach();
    boundSelect = select;
    boundCanvas = canvas;
    select.addEventListener('change', onChange, true);
    select.addEventListener('pointerdown', () => syncOptions(select));
    select.addEventListener('focus', () => syncOptions(select));
  }
  boundCanvas = canvas;
  syncOptions(select);
}

const observer = new MutationObserver(discover);
observer.observe(document.documentElement, { childList: true, subtree: true });
const poll = window.setInterval(discover, 500);
window.addEventListener('pagehide', () => {
  observer.disconnect();
  window.clearInterval(poll);
  detach();
}, { once: true });
discover();
