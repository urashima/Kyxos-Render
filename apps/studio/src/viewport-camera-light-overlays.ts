import './viewport-camera-light-overlays.css';

import {
  composeTransform,
  multiplyMatrix4,
  worldMatrixMap,
} from '@kyxos/editor-core/hierarchy-transform';
import type {
  KyxosSceneContract,
  SceneCamera,
  SceneLight,
  SceneNode,
  Vec3,
} from '@kyxos/scene-contract';

interface StudioApiLike {
  getScene(): KyxosSceneContract;
  getSelection(): string[];
  setSelection(ids: string[]): void;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

interface EditorCameraState {
  camera: SceneCamera;
  up: Vec3;
  preset?: string;
}

interface CameraResponse {
  requestId: string;
  state: EditorCameraState;
}

type OverlayKind = 'camera' | 'light';

interface OverlayEntity {
  node: SceneNode;
  kind: OverlayKind;
  component: SceneCamera | SceneLight;
  worldPosition: Vec3;
  label: string;
  detail: string;
}

const overlays = new Map<string, HTMLButtonElement>();
let shell: HTMLElement | null = null;
let viewport: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let layer: HTMLElement | null = null;
let api: StudioApiLike | null = null;
let editorCamera: EditorCameraState | null = null;
let requestPending = false;
let lastCaptureAt = 0;
let lastFrameAt = 0;
let frame = 0;

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function add(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(value: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  return magnitude > 1e-8 ? scale(value, 1 / magnitude) : fallback;
}

function componentWorldPosition(
  scene: KyxosSceneContract,
  node: SceneNode,
  component: SceneCamera | SceneLight,
  nodeWorld: ReturnType<typeof worldMatrixMap>,
): Vec3 {
  const parentWorld = node.parentId ? nodeWorld.get(node.parentId) : null;
  const world = parentWorld
    ? multiplyMatrix4(parentWorld, composeTransform(component.transform))
    : composeTransform(component.transform);
  return { x: world[12], y: world[13], z: world[14] };
}

function sceneOverlayEntities(scene: KyxosSceneContract): OverlayEntity[] {
  const cameras = new Map(scene.cameras.map((camera) => [camera.id, camera]));
  const lights = new Map((scene.lights ?? []).map((light) => [light.id, light]));
  const nodeWorld = worldMatrixMap(scene.nodes);
  const result: OverlayEntity[] = [];
  for (const node of scene.nodes) {
    const camera = node.cameraId ? cameras.get(node.cameraId) : undefined;
    if (camera) {
      result.push({
        node,
        kind: 'camera',
        component: camera,
        worldPosition: componentWorldPosition(scene, node, camera, nodeWorld),
        label: node.name,
        detail: `${camera.projection ?? 'perspective'} · ${camera.fov.toFixed(1)}°`,
      });
      continue;
    }
    const light = node.lightId ? lights.get(node.lightId) : undefined;
    if (light) {
      result.push({
        node,
        kind: 'light',
        component: light,
        worldPosition: componentWorldPosition(scene, node, light, nodeWorld),
        label: node.name,
        detail: `${light.type} · ${light.intensity.toFixed(2)}`,
      });
    }
  }
  return result;
}

function projectToViewport(
  world: Vec3,
  state: EditorCameraState,
  width: number,
  height: number,
): { x: number; y: number; depth: number; visible: boolean } {
  const position = state.camera.transform.position;
  const forward = normalize(subtract(state.camera.target, position), { x: 0, y: 0, z: -1 });
  const normalizedUp = normalize(state.up, { x: 0, y: 1, z: 0 });
  const right = normalize(cross(forward, normalizedUp), { x: 1, y: 0, z: 0 });
  const up = normalize(cross(right, forward), { x: 0, y: 1, z: 0 });
  const relative = subtract(world, position);
  const cameraX = dot(relative, right);
  const cameraY = dot(relative, up);
  const cameraZ = dot(relative, forward);
  const aspect = width / Math.max(1, height);
  let ndcX = 0;
  let ndcY = 0;
  if ((state.camera.projection ?? 'perspective') === 'orthographic') {
    const size = Math.max(0.001, state.camera.orthographicSize ?? 10);
    ndcX = cameraX / (size * aspect);
    ndcY = cameraY / size;
  } else {
    if (cameraZ <= Math.max(0.001, state.camera.near)) {
      return { x: 0, y: 0, depth: cameraZ, visible: false };
    }
    const focal = 1 / Math.tan((state.camera.fov * Math.PI) / 360);
    ndcX = (cameraX * focal) / (cameraZ * aspect);
    ndcY = (cameraY * focal) / cameraZ;
  }
  const margin = 1.15;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height,
    depth: cameraZ,
    visible: Math.abs(ndcX) <= margin && Math.abs(ndcY) <= margin,
  };
}

function setSelection(entity: OverlayEntity, event: MouseEvent): void {
  if (!api) return;
  const current = api.getSelection();
  if (event.ctrlKey || event.metaKey) {
    api.setSelection(current.includes(entity.node.id)
      ? current.filter((id) => id !== entity.node.id)
      : [...current, entity.node.id]);
  } else {
    api.setSelection([entity.node.id]);
  }
}

function lookThroughCamera(camera: SceneCamera): void {
  canvas?.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
    detail: {
      command: 'restore-bookmark',
      state: {
        camera: structuredClone(camera),
        up: { x: 0, y: 1, z: 0 },
        preset: 'scene-camera',
      },
    },
  }));
}

function frameSelection(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'f',
    code: 'KeyF',
    bubbles: true,
    cancelable: true,
  }));
}

function createOverlay(entity: OverlayEntity): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `kx-viewport-entity-icon ${entity.kind}`;
  button.dataset.nodeId = entity.node.id;
  button.innerHTML = `
    <span class="kx-viewport-entity-glyph" aria-hidden="true">${entity.kind === 'camera' ? 'C' : 'L'}</span>
    <span class="kx-viewport-entity-label"><strong></strong><small></small></span>`;
  button.addEventListener('click', (event) => {
    const current = sceneOverlayEntities(api?.getScene() ?? ({ nodes: [], cameras: [], lights: [] } as unknown as KyxosSceneContract))
      .find((entry) => entry.node.id === button.dataset.nodeId);
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection(current, event);
  });
  button.addEventListener('dblclick', (event) => {
    const current = sceneOverlayEntities(api?.getScene() ?? ({ nodes: [], cameras: [], lights: [] } as unknown as KyxosSceneContract))
      .find((entry) => entry.node.id === button.dataset.nodeId);
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    api?.setSelection([current.node.id]);
    if (current.kind === 'camera') lookThroughCamera(current.component as SceneCamera);
    else frameSelection();
  });
  return button;
}

function syncOverlayContent(button: HTMLButtonElement, entity: OverlayEntity): void {
  const name = button.querySelector<HTMLElement>('strong');
  const detail = button.querySelector<HTMLElement>('small');
  if (name) name.textContent = entity.label;
  if (detail) detail.textContent = entity.detail;
  button.setAttribute('aria-label', `Select ${entity.kind} ${entity.label}`);
  button.title = `${entity.label}\n${entity.detail}\nClick to select · Ctrl/Cmd click to multi-select · Double click to ${entity.kind === 'camera' ? 'look through' : 'frame'}`;
}

function helperVisible(kind: OverlayKind): boolean {
  if (!canvas) return false;
  return kind === 'camera'
    ? canvas.dataset.editorCameraHelpersVisible !== 'false'
    : canvas.dataset.editorLightHelpersVisible !== 'false';
}

function renderOverlays(): void {
  if (!layer || !viewport || !canvas || !api || !editorCamera) return;
  const rect = canvas.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const entities = sceneOverlayEntities(api.getScene());
  const present = new Set(entities.map((entity) => entity.node.id));
  for (const [id, button] of overlays) {
    if (present.has(id)) continue;
    button.remove();
    overlays.delete(id);
  }
  const selected = new Set(api.getSelection());
  for (const entity of entities) {
    let button = overlays.get(entity.node.id);
    if (!button) {
      button = createOverlay(entity);
      overlays.set(entity.node.id, button);
      layer.append(button);
    }
    syncOverlayContent(button, entity);
    button.classList.toggle('selected', selected.has(entity.node.id));
    button.setAttribute('aria-pressed', String(selected.has(entity.node.id)));
    const projected = projectToViewport(entity.worldPosition, editorCamera, rect.width, rect.height);
    const visible = projected.visible && helperVisible(entity.kind);
    button.hidden = !visible;
    if (!visible) continue;
    button.style.left = `${rect.left - viewportRect.left + projected.x}px`;
    button.style.top = `${rect.top - viewportRect.top + projected.y}px`;
    button.style.setProperty('--kx-entity-depth', String(Math.max(0, projected.depth)));
  }
  layer.dataset.cameraCount = String(entities.filter((entity) => entity.kind === 'camera').length);
  layer.dataset.lightCount = String(entities.filter((entity) => entity.kind === 'light').length);
}

function acceptCameraCommand(event: Event): void {
  const detail = (event as CustomEvent<{
    command?: string;
    state?: EditorCameraState;
  }>).detail;
  if (detail?.command !== 'restore-bookmark' || !detail.state) return;
  editorCamera = structuredClone(detail.state);
}

function requestCameraState(now: number): void {
  if (!canvas || requestPending || now - lastCaptureAt < 120) return;
  lastCaptureAt = now;
  requestPending = true;
  const requestId = crypto.randomUUID();
  const timeout = window.setTimeout(() => {
    canvas?.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
    requestPending = false;
  }, 900);
  const onState: EventListener = (event) => {
    const response = (event as CustomEvent<CameraResponse>).detail;
    if (response.requestId !== requestId) return;
    window.clearTimeout(timeout);
    canvas?.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
    editorCamera = structuredClone(response.state);
    requestPending = false;
  };
  canvas.addEventListener('kyxos:editor-camera-bookmark-state', onState);
  canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
    detail: { command: 'capture-bookmark', requestId },
  }));
}

function animate(now: number): void {
  requestCameraState(now);
  if (now - lastFrameAt >= 33) {
    lastFrameAt = now;
    renderOverlays();
  }
  frame = requestAnimationFrame(animate);
}

function detach(): void {
  canvas?.removeEventListener('kyxos:editor-viewport-command', acceptCameraCommand, true);
  layer?.remove();
  overlays.clear();
  shell = null;
  viewport = null;
  canvas = null;
  layer = null;
  api = null;
  editorCamera = null;
  requestPending = false;
}

function attach(nextCanvas: HTMLCanvasElement, nextApi: StudioApiLike): void {
  const nextViewport = nextCanvas.closest<HTMLElement>('.studio-viewport');
  const nextShell = nextCanvas.closest<HTMLElement>('.kyxos-studio-shell');
  if (!nextViewport || !nextShell) return;
  if (canvas === nextCanvas && api === nextApi) return;
  detach();
  canvas = nextCanvas;
  api = nextApi;
  viewport = nextViewport;
  shell = nextShell;
  layer = document.createElement('div');
  layer.className = 'kx-viewport-entity-overlay-layer';
  layer.setAttribute('aria-label', 'Camera and light viewport icons');
  viewport.append(layer);
  canvas.addEventListener('kyxos:editor-viewport-command', acceptCameraCommand, true);
}

function discover(): void {
  const nextCanvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  const nextApi = studioApi();
  if (nextCanvas && nextApi) attach(nextCanvas, nextApi);
  else if (canvas && !canvas.isConnected) detach();
}

const observer = new MutationObserver(discover);
observer.observe(document.documentElement, { childList: true, subtree: true });
frame = requestAnimationFrame(animate);
window.addEventListener('pagehide', () => {
  observer.disconnect();
  cancelAnimationFrame(frame);
  detach();
}, { once: true });
discover();
