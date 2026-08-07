import './playcanvas-interaction-parity.css';

import type { KyxosSceneContract, SceneCamera, ScenePatch, Vec3 } from '@kyxos/scene-contract';

interface StudioApiLike {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: ScenePatch): void;
  getSelection(): string[];
  setSelection(ids: string[]): void;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

interface CameraState {
  camera: SceneCamera;
  up: Vec3;
  preset?: string;
}

interface CameraResponse {
  requestId: string;
  state: CameraState;
}

interface PointerNavigation {
  pointerId: number;
  mode: 'look' | 'pan';
  startX: number;
  startY: number;
  state: CameraState;
}

const CAMERA_TIMEOUT_MS = 1_200;
const activeKeys = new Set<string>();
const selectionHistory: string[][] = [];
let canvas: HTMLCanvasElement | null = null;
let shell: HTMLElement | null = null;
let api: StudioApiLike | null = null;
let pointerNavigation: PointerNavigation | null = null;
let lastFrame = performance.now();
let cameraRequestInFlight = false;
let temporarySnap = false;
let previousSelectionKey = '';
let cameraInfoVisible = false;
let cameraInfo: HTMLElement | null = null;

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(value: Vec3, amount: number): Vec3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function length(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: Vec3, fallback: Vec3 = { x: 0, y: 0, z: -1 }): Vec3 {
  const magnitude = length(value);
  return magnitude > 1e-8 ? scale(value, 1 / magnitude) : fallback;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dispatchCameraState(target: HTMLCanvasElement, state: CameraState): void {
  target.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
    detail: { command: 'restore-bookmark', state },
  }));
}

function requestCameraState(target: HTMLCanvasElement): Promise<CameraState> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      target.removeEventListener('kyxos:editor-camera-bookmark-state', onResponse);
      reject(new Error('Editor camera state request timed out.'));
    }, CAMERA_TIMEOUT_MS);
    const onResponse: EventListener = (event) => {
      const response = (event as CustomEvent<CameraResponse>).detail;
      if (response.requestId !== requestId) return;
      window.clearTimeout(timeout);
      target.removeEventListener('kyxos:editor-camera-bookmark-state', onResponse);
      resolve(structuredClone(response.state));
    };
    target.addEventListener('kyxos:editor-camera-bookmark-state', onResponse);
    target.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
      detail: { command: 'capture-bookmark', requestId },
    }));
  });
}

function editorIsTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input,textarea,select,[contenteditable="true"],.monaco-editor,dialog[open]',
  ));
}

function viewportEngaged(): boolean {
  return Boolean(canvas?.isConnected && (
    document.activeElement === canvas ||
    canvas.matches(':hover') ||
    canvas.dataset.kxViewportEngaged === 'true'
  ));
}

function moveCamera(state: CameraState, delta: Vec3): CameraState {
  return {
    ...state,
    camera: {
      ...state.camera,
      transform: {
        ...state.camera.transform,
        position: add(state.camera.transform.position, delta),
      },
      target: add(state.camera.target, delta),
    },
  };
}

function flyDelta(state: CameraState, deltaTime: number): Vec3 | null {
  const forward = normalize(subtract(state.camera.target, state.camera.transform.position));
  const up = normalize(state.up, { x: 0, y: 1, z: 0 });
  const right = normalize(cross(forward, up), { x: 1, y: 0, z: 0 });
  const distance = Math.max(0.5, length(subtract(state.camera.target, state.camera.transform.position)));
  const fast = activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight');
  const speed = distance * (fast ? 3.5 : 0.72) * deltaTime;
  let direction = { x: 0, y: 0, z: 0 };
  if (activeKeys.has('KeyW')) direction = add(direction, forward);
  if (activeKeys.has('KeyS')) direction = add(direction, scale(forward, -1));
  if (activeKeys.has('KeyD')) direction = add(direction, right);
  if (activeKeys.has('KeyA')) direction = add(direction, scale(right, -1));
  return length(direction) > 1e-8 ? scale(normalize(direction), speed) : null;
}

async function updateFlyCamera(deltaTime: number): Promise<void> {
  if (!canvas || cameraRequestInFlight || !viewportEngaged()) return;
  if (![...activeKeys].some((code) => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code))) return;
  cameraRequestInFlight = true;
  try {
    const state = await requestCameraState(canvas);
    const delta = flyDelta(state, deltaTime);
    if (delta) dispatchCameraState(canvas, moveCamera(state, delta));
  } catch {
    activeKeys.clear();
  } finally {
    cameraRequestInFlight = false;
  }
}

function animationFrame(now: number): void {
  const deltaTime = Math.min(0.05, Math.max(0, (now - lastFrame) / 1_000));
  lastFrame = now;
  void updateFlyCamera(deltaTime);
  requestAnimationFrame(animationFrame);
}

function yawPitch(state: CameraState, deltaX: number, deltaY: number): CameraState {
  const position = state.camera.transform.position;
  const offset = subtract(state.camera.target, position);
  const distance = Math.max(0.001, length(offset));
  const direction = normalize(offset);
  let yaw = Math.atan2(direction.x, direction.z);
  let pitch = Math.asin(Math.max(-0.999, Math.min(0.999, direction.y)));
  yaw -= deltaX * 0.0045;
  pitch = Math.max(-Math.PI * 0.495, Math.min(Math.PI * 0.495, pitch - deltaY * 0.0045));
  const cosine = Math.cos(pitch);
  const nextDirection = {
    x: Math.sin(yaw) * cosine,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosine,
  };
  return {
    ...state,
    camera: {
      ...state.camera,
      target: add(position, scale(nextDirection, distance)),
    },
  };
}

function panCamera(state: CameraState, deltaX: number, deltaY: number): CameraState {
  const position = state.camera.transform.position;
  const forward = normalize(subtract(state.camera.target, position));
  const up = normalize(state.up, { x: 0, y: 1, z: 0 });
  const right = normalize(cross(forward, up), { x: 1, y: 0, z: 0 });
  const distance = Math.max(0.5, length(subtract(state.camera.target, position)));
  const sensitivity = distance * 0.0017;
  const delta = add(scale(right, -deltaX * sensitivity), scale(up, deltaY * sensitivity));
  return moveCamera(state, delta);
}

async function beginPointerNavigation(event: PointerEvent): Promise<void> {
  if (!canvas || editorIsTyping(event.target)) return;
  const mode = event.button === 2 ? 'look' : event.button === 0 && event.shiftKey ? 'pan' : null;
  if (!mode) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    const state = await requestCameraState(canvas);
    pointerNavigation = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      state,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('kx-camera-dragging');
  } catch {
    pointerNavigation = null;
  }
}

function updatePointerNavigation(event: PointerEvent): void {
  if (!canvas || !pointerNavigation || pointerNavigation.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const deltaX = event.clientX - pointerNavigation.startX;
  const deltaY = event.clientY - pointerNavigation.startY;
  const state = pointerNavigation.mode === 'look'
    ? yawPitch(pointerNavigation.state, deltaX, deltaY)
    : panCamera(pointerNavigation.state, deltaX, deltaY);
  dispatchCameraState(canvas, state);
}

function endPointerNavigation(event: PointerEvent): void {
  if (!canvas || !pointerNavigation || pointerNavigation.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove('kx-camera-dragging');
  pointerNavigation = null;
}

function findButton(text: string, root: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim().toLocaleLowerCase() === text.toLocaleLowerCase(),
  );
}

function setTool(tool: 'Move' | 'Rotate' | 'Scale'): void {
  if (!shell) return;
  findButton(tool, shell)?.click();
}

function toggleCoordinateSpace(): void {
  const select = shell?.querySelector<HTMLSelectElement>('select[aria-label="Coordinate space"]');
  if (!select) return;
  select.value = select.value === 'local' ? 'world' : 'local';
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function togglePanels(): void {
  if (!shell) return;
  const hidden = shell.classList.toggle('kx-panels-hidden');
  shell.dataset.kxPanelsHidden = String(hidden);
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function addEmptyEntity(): void {
  if (!shell) return;
  const add = shell.querySelector<HTMLButtonElement>('.studio-hierarchy .panel-toolbar button');
  add?.click();
  queueMicrotask(() => findButton('Add Empty', shell)?.click());
}

function duplicateSelection(): void {
  if (!shell) return;
  findButton('Duplicate', shell.querySelector('.studio-hierarchy') ?? shell)?.click();
}

function previewScene(): void {
  findButton('Preview', shell ?? document)?.click();
}

function previousSelection(): void {
  if (!api) return;
  const previous = selectionHistory.pop();
  if (previous) api.setSelection(previous);
}

function updateSelectionHistory(): void {
  if (!api) return;
  const current = api.getSelection();
  const key = current.join('\u0000');
  if (key === previousSelectionKey) return;
  if (previousSelectionKey) selectionHistory.push(previousSelectionKey.split('\u0000').filter(Boolean));
  if (selectionHistory.length > 40) selectionHistory.shift();
  previousSelectionKey = key;
}

function toggleTemporarySnap(enabled: boolean): void {
  if (!shell) return;
  const snap = Array.from(shell.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.trim().toLocaleLowerCase().startsWith('snap '),
  );
  if (!snap) return;
  if (enabled && snap.textContent?.trim().toLocaleLowerCase() === 'snap off') {
    temporarySnap = true;
    snap.click();
  } else if (!enabled && temporarySnap && snap.textContent?.trim().toLocaleLowerCase() === 'snap on') {
    temporarySnap = false;
    snap.click();
  }
}

function parseVector(value: string): Vec3 | null {
  const numbers = value.trim().split(/[\s,]+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite)
    ? { x: numbers[0], y: numbers[1], z: numbers[2] }
    : null;
}

function formatVector(value: Vec3): string {
  return `${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)}`;
}

function createEditableVector(label: string, getState: () => CameraState | null, property: 'position' | 'target'): HTMLElement {
  const row = document.createElement('label');
  const key = document.createElement('b');
  key.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('aria-label', property === 'position' ? 'Editor camera position' : 'Editor camera target');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const state = getState();
      if (state) input.value = formatVector(property === 'position' ? state.camera.transform.position : state.camera.target);
      input.blur();
    } else if (event.key === 'Enter') {
      const state = getState();
      const vector = parseVector(input.value);
      if (!state || !vector || !canvas) {
        input.classList.add('invalid');
        window.setTimeout(() => input.classList.remove('invalid'), 450);
        return;
      }
      const next = structuredClone(state);
      if (property === 'position') next.camera.transform.position = vector;
      else next.camera.target = vector;
      dispatchCameraState(canvas, next);
      input.classList.add('valid');
      window.setTimeout(() => input.classList.remove('valid'), 450);
      input.blur();
    }
  });
  row.append(key, input);
  return row;
}

function ensureCameraInfo(): HTMLElement | null {
  if (!shell || !canvas) return null;
  if (cameraInfo?.isConnected) return cameraInfo;
  const panel = document.createElement('aside');
  panel.className = 'kx-camera-info';
  panel.setAttribute('aria-label', 'Editor camera information');
  let state: CameraState | null = null;
  const position = createEditableVector('P', () => state, 'position');
  const target = createEditableVector('T', () => state, 'target');
  const projection = document.createElement('span');
  projection.className = 'kx-camera-info-projection';
  panel.append(position, target, projection);
  shell.querySelector<HTMLElement>('.studio-viewport')?.append(panel);
  const refresh = async () => {
    if (!canvas || !panel.isConnected || !cameraInfoVisible || cameraRequestInFlight) return;
    try {
      state = await requestCameraState(canvas);
      const inputs = panel.querySelectorAll<HTMLInputElement>('input');
      if (document.activeElement !== inputs[0]) inputs[0].value = formatVector(state.camera.transform.position);
      if (document.activeElement !== inputs[1]) inputs[1].value = formatVector(state.camera.target);
      projection.textContent = `${state.camera.projection ?? 'perspective'} · FOV ${state.camera.fov.toFixed(1)}°`;
    } catch {
      // Camera may be rebuilding while projection changes.
    }
  };
  window.setInterval(() => void refresh(), 220);
  cameraInfo = panel;
  return panel;
}

function toggleCameraInfo(): void {
  cameraInfoVisible = !cameraInfoVisible;
  const panel = ensureCameraInfo();
  panel?.classList.toggle('visible', cameraInfoVisible);
}

function onKeyDown(event: KeyboardEvent): void {
  if (editorIsTyping(event.target)) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (event.key === 'Shift') toggleTemporarySnap(true);
  if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD') {
    if (!modifier && viewportEngaged()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeKeys.add(event.code);
    }
    return;
  }
  if (event.code === 'Digit1' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setTool('Move');
  } else if (event.code === 'Digit2' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setTool('Rotate');
  } else if (event.code === 'Digit3' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setTool('Scale');
  } else if (event.key.toLocaleLowerCase() === 'l' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleCoordinateSpace();
  } else if (event.code === 'Space' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    togglePanels();
  } else if (modifier && event.key.toLocaleLowerCase() === 'e') {
    event.preventDefault();
    event.stopImmediatePropagation();
    addEmptyEntity();
  } else if (modifier && event.key.toLocaleLowerCase() === 'd') {
    event.preventDefault();
    event.stopImmediatePropagation();
    duplicateSelection();
  } else if (modifier && event.key === 'Enter') {
    event.preventDefault();
    event.stopImmediatePropagation();
    previewScene();
  } else if (event.shiftKey && event.key.toLocaleLowerCase() === 'z' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    previousSelection();
  } else if (event.key.toLocaleLowerCase() === 'i' && !modifier) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleCameraInfo();
  }
}

function onKeyUp(event: KeyboardEvent): void {
  activeKeys.delete(event.code);
  if (event.key === 'Shift') toggleTemporarySnap(false);
}

function attach(nextCanvas: HTMLCanvasElement, nextShell: HTMLElement, nextApi: StudioApiLike): void {
  if (canvas === nextCanvas) return;
  if (canvas) {
    canvas.removeEventListener('pointerdown', beginPointerNavigation, true);
    canvas.removeEventListener('pointermove', updatePointerNavigation, true);
    canvas.removeEventListener('pointerup', endPointerNavigation, true);
    canvas.removeEventListener('pointercancel', endPointerNavigation, true);
  }
  canvas = nextCanvas;
  shell = nextShell;
  api = nextApi;
  canvas.tabIndex = 0;
  canvas.addEventListener('pointerenter', () => { if (canvas) canvas.dataset.kxViewportEngaged = 'true'; });
  canvas.addEventListener('pointerleave', () => { if (canvas && !pointerNavigation) delete canvas.dataset.kxViewportEngaged; });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && !event.shiftKey) canvas?.focus({ preventScroll: true });
  }, true);
  canvas.addEventListener('pointerdown', beginPointerNavigation, true);
  canvas.addEventListener('pointermove', updatePointerNavigation, true);
  canvas.addEventListener('pointerup', endPointerNavigation, true);
  canvas.addEventListener('pointercancel', endPointerNavigation, true);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  ensureCameraInfo();

  const shortcuts = document.querySelector<HTMLElement>('.kx-entity-shortcuts');
  if (shortcuts) shortcuts.innerHTML = [
    '<span><b>LMB</b> Orbit / select</span>',
    '<span><b>MMB / Shift+LMB</b> Pan</span>',
    '<span><b>RMB</b> Look</span>',
    '<span><b>Wheel</b> Dolly</span>',
    '<span><b>WASD</b> Fly</span>',
    '<span><b>1 / 2 / 3</b> Transform</span>',
    '<span><b>L</b> Local / world</span>',
    '<span><b>Space</b> Panels</span>',
  ].join('');
}

function discover(): void {
  const nextCanvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  const nextShell = nextCanvas?.closest<HTMLElement>('.kyxos-studio-shell');
  const nextApi = studioApi();
  if (nextCanvas && nextShell && nextApi) attach(nextCanvas, nextShell, nextApi);
  updateSelectionHistory();
}

window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('keyup', onKeyUp, true);
window.addEventListener('blur', () => {
  activeKeys.clear();
  toggleTemporarySnap(false);
});
const observer = new MutationObserver(discover);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.setInterval(discover, 180);
requestAnimationFrame(animationFrame);
window.addEventListener('pagehide', () => {
  observer.disconnect();
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
}, { once: true });
discover();
