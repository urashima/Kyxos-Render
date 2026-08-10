import './viewport-navigation.css';

import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';
import type {
  EditorCameraBookmarkResponse,
  EditorCameraBookmarkState,
  EditorViewportCommand,
} from '@kyxos/viewer-adapter';

export {};

type EditorViewPreset =
  | 'perspective'
  | 'front'
  | 'back'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

interface CameraBookmarkRecord {
  id: string;
  name: string;
  slot: number;
  state: EditorCameraBookmarkState;
  createdAt: string;
  updatedAt: string;
}

type BookmarkEditorState = NonNullable<KyxosSceneContract['editorState']> & {
  cameraBookmarks?: CameraBookmarkRecord[];
};

interface StudioApiLike {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: ScenePatch): void;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

interface NavigationBinding {
  canvas: HTMLCanvasElement;
  topbar: HTMLElement;
  controls: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  editorViews: HTMLElement;
  sceneViews: HTMLElement;
  bookmarkSelect: HTMLSelectElement;
  onKeyDown: (event: KeyboardEvent) => void;
}

const VIEW_OPTIONS: ReadonlyArray<readonly [string, EditorViewPreset]> = [
  ['Perspective', 'perspective'],
  ['Front', 'front'],
  ['Back', 'back'],
  ['Top', 'top'],
  ['Bottom', 'bottom'],
  ['Left', 'left'],
  ['Right', 'right'],
];

let binding: NavigationBinding | null = null;

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function dispatch(canvas: HTMLCanvasElement, detail: EditorViewportCommand): void {
  canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', { detail }));
}

function dispatchEditorKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function viewFromKeyboard(event: KeyboardEvent): EditorViewPreset | null {
  if (event.code === 'Numpad1') return event.ctrlKey || event.metaKey ? 'back' : 'front';
  if (event.code === 'Numpad3') return event.ctrlKey || event.metaKey ? 'left' : 'right';
  if (event.code === 'Numpad7') return event.ctrlKey || event.metaKey ? 'bottom' : 'top';
  if (event.code === 'Numpad5') return 'perspective';
  return null;
}

function bookmarkSlotFromKeyboard(event: KeyboardEvent): number | null {
  if (!event.altKey) return null;
  const match = event.code.match(/^(?:Digit|Numpad)([1-9])$/);
  return match ? Number(match[1]) : null;
}

function cameraBookmarks(): CameraBookmarkRecord[] {
  const scene = studioApi()?.getScene();
  const editorState = scene?.editorState as BookmarkEditorState | undefined;
  return [...(editorState?.cameraBookmarks ?? [])]
    .filter((bookmark) => bookmark.slot >= 1 && bookmark.slot <= 9)
    .sort((left, right) => left.slot - right.slot);
}

function writeBookmarks(
  label: string,
  bookmarks: CameraBookmarkRecord[],
): void {
  const api = studioApi();
  if (!api) return;
  const scene = api.getScene();
  const editorState: BookmarkEditorState = {
    ...(scene.editorState ?? {}),
    cameraBookmarks: bookmarks
      .slice()
      .sort((left, right) => left.slot - right.slot),
  };
  api.applyPatch(label, [{
    op: scene.editorState ? 'replace' : 'add',
    path: '/editorState',
    value: editorState,
  }]);
}

function requestCameraState(
  canvas: HTMLCanvasElement,
): Promise<EditorCameraBookmarkState> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
      reject(new Error('Editor camera state capture timed out.'));
    }, 2_000);
    const onState: EventListener = (event) => {
      const response = (event as CustomEvent<EditorCameraBookmarkResponse>).detail;
      if (response.requestId !== requestId) return;
      window.clearTimeout(timeout);
      canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
      resolve(response.state);
    };
    canvas.addEventListener('kyxos:editor-camera-bookmark-state', onState);
    dispatch(canvas, { command: 'capture-bookmark', requestId });
  });
}

function refreshBookmarkSelect(select: HTMLSelectElement): void {
  const selected = Math.max(1, Math.min(9, Number(select.value) || 1));
  const bySlot = new Map(cameraBookmarks().map((bookmark) => [bookmark.slot, bookmark]));
  select.replaceChildren();
  for (let slot = 1; slot <= 9; slot += 1) {
    const bookmark = bySlot.get(slot);
    select.append(new Option(`${slot} · ${bookmark?.name ?? 'Empty'}`, String(slot)));
  }
  select.value = String(selected);
}

async function saveBookmark(
  canvas: HTMLCanvasElement,
  select: HTMLSelectElement,
  slot = Number(select.value),
): Promise<void> {
  const normalizedSlot = Math.max(1, Math.min(9, slot || 1));
  const existing = cameraBookmarks();
  const previous = existing.find((bookmark) => bookmark.slot === normalizedSlot);
  const state = await requestCameraState(canvas);
  const now = new Date().toISOString();
  const name = previous?.name ?? `View ${normalizedSlot}`;
  const record: CameraBookmarkRecord = {
    id: previous?.id ?? crypto.randomUUID(),
    name,
    slot: normalizedSlot,
    state: {
      ...structuredClone(state),
      camera: {
        ...structuredClone(state.camera),
        id: `editor-bookmark-${normalizedSlot}`,
        name,
      },
    },
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  writeBookmarks(
    previous ? `Overwrite camera bookmark ${normalizedSlot}` : `Save camera bookmark ${normalizedSlot}`,
    [...existing.filter((bookmark) => bookmark.slot !== normalizedSlot), record],
  );
  select.value = String(normalizedSlot);
  refreshBookmarkSelect(select);
  canvas.dataset.editorBookmarkSaved = String(normalizedSlot);
  canvas.dataset.editorBookmarkSavedAt = String(performance.now());
}

function recallBookmark(
  canvas: HTMLCanvasElement,
  select: HTMLSelectElement,
  slot = Number(select.value),
): void {
  const normalizedSlot = Math.max(1, Math.min(9, slot || 1));
  const bookmark = cameraBookmarks().find((entry) => entry.slot === normalizedSlot);
  if (!bookmark) return;
  select.value = String(normalizedSlot);
  dispatch(canvas, {
    command: 'restore-bookmark',
    state: structuredClone(bookmark.state),
    slot: normalizedSlot,
  });
  canvas.dataset.editorBookmarkName = bookmark.name;
}

function renameBookmark(select: HTMLSelectElement): void {
  const slot = Number(select.value);
  const bookmarks = cameraBookmarks();
  const bookmark = bookmarks.find((entry) => entry.slot === slot);
  if (!bookmark) return;
  const name = prompt('Camera bookmark name', bookmark.name)?.trim();
  if (!name || name === bookmark.name) return;
  const now = new Date().toISOString();
  writeBookmarks(
    `Rename camera bookmark ${slot}`,
    bookmarks.map((entry) => entry.slot === slot
      ? {
          ...entry,
          name,
          updatedAt: now,
          state: {
            ...entry.state,
            camera: { ...entry.state.camera, name },
          },
        }
      : entry),
  );
  refreshBookmarkSelect(select);
}

function deleteBookmark(select: HTMLSelectElement): void {
  const slot = Number(select.value);
  const bookmarks = cameraBookmarks();
  if (!bookmarks.some((entry) => entry.slot === slot)) return;
  writeBookmarks(
    `Delete camera bookmark ${slot}`,
    bookmarks.filter((entry) => entry.slot !== slot),
  );
  refreshBookmarkSelect(select);
}

function section(label: string, name: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'kx-viewport-menu-section';
  wrapper.dataset.section = name;
  const heading = document.createElement('div');
  heading.className = 'kx-viewport-menu-label';
  heading.textContent = label;
  wrapper.append(heading);
  return wrapper;
}

function menuButton(label: string, action: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.setAttribute('role', 'menuitem');
  control.addEventListener('click', action);
  return control;
}

function currentEditorView(canvas: HTMLCanvasElement): string {
  if (canvas.dataset.editorSceneCameraView) return `scene:${canvas.dataset.editorSceneCameraView}`;
  return canvas.dataset.editorView || 'perspective';
}

function refreshViewItems(current: NavigationBinding): void {
  const scene = studioApi()?.getScene();
  const active = currentEditorView(current.canvas);
  current.editorViews.replaceChildren();
  for (const [label, preset] of VIEW_OPTIONS) {
    const control = menuButton(label, () => {
      dispatch(current.canvas, { command: 'view', preset });
      closeMenu(current);
    });
    control.dataset.viewPreset = preset;
    control.setAttribute('aria-current', String(active === preset));
    current.editorViews.append(control);
  }

  current.sceneViews.replaceChildren();
  for (const camera of scene?.cameras ?? []) {
    const label = `${camera.name}${camera.id === scene?.activeCameraId ? ' · Active' : ''}`;
    const control = menuButton(label, () => {
      dispatch(current.canvas, { command: 'scene-camera', cameraId: camera.id });
      closeMenu(current);
    });
    control.dataset.sceneCameraId = camera.id;
    control.setAttribute('aria-current', String(active === `scene:${camera.id}`));
    current.sceneViews.append(control);
  }
  current.sceneViews.closest<HTMLElement>('.kx-viewport-menu-section')!.hidden = !current.sceneViews.childElementCount;
  refreshBookmarkSelect(current.bookmarkSelect);
}

function positionMenu(current: NavigationBinding): void {
  const rect = current.trigger.getBoundingClientRect();
  const width = Math.min(260, window.innerWidth - 16);
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  current.menu.style.width = `${width}px`;
  current.menu.style.left = `${Math.round(left)}px`;
  current.menu.style.top = `${Math.round(rect.bottom + 8)}px`;
}

function openMenu(current: NavigationBinding): void {
  refreshViewItems(current);
  positionMenu(current);
  current.menu.hidden = false;
  current.trigger.setAttribute('aria-expanded', 'true');
}

function closeMenu(current: NavigationBinding, restoreFocus = false): void {
  current.menu.hidden = true;
  current.trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) current.trigger.focus({ preventScroll: true });
}

function preferredHost(topbar: HTMLElement): HTMLElement {
  return topbar.querySelector<HTMLElement>('.kx-topbar-view-cluster') ?? topbar;
}

function detach(): void {
  if (!binding) return;
  window.removeEventListener('keydown', binding.onKeyDown);
  binding.controls.remove();
  binding.menu.remove();
  binding = null;
}

function attach(canvas: HTMLCanvasElement, topbar: HTMLElement): void {
  if (binding?.canvas === canvas && binding.controls.isConnected) {
    const host = preferredHost(topbar);
    if (binding.controls.parentElement !== host) host.prepend(binding.controls);
    return;
  }
  detach();

  const controls = document.createElement('div');
  controls.className = 'viewport-navigation-group';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Viewport camera');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'viewport-view-trigger';
  trigger.textContent = 'View';
  trigger.title = 'Editor view, scene cameras, zoom and camera bookmarks';
  trigger.setAttribute('aria-label', 'View');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  controls.append(trigger);

  const menu = document.createElement('div');
  menu.className = 'kx-viewport-view-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.append(menu);

  const editorSection = section('View', 'editor-views');
  const editorViews = document.createElement('div');
  editorViews.className = 'kx-viewport-editor-views';
  editorSection.append(editorViews);

  const sceneSection = section('Scene Cameras', 'scene-cameras');
  const sceneViews = document.createElement('div');
  sceneViews.className = 'kx-viewport-scene-views';
  sceneSection.append(sceneViews);

  const zoomSection = section('Zoom', 'zoom');
  const frameSelection = menuButton('Zoom to Selection', () => {
    dispatchEditorKey('f');
    if (binding) closeMenu(binding);
  });
  frameSelection.title = 'Frame current selection · F';
  const frameAll = menuButton('Frame All', () => {
    dispatch(canvas, { command: 'frame-all' });
    if (binding) closeMenu(binding);
  });
  frameAll.title = 'Frame all scene content · Home';
  zoomSection.append(frameSelection, frameAll);

  const bookmarkSection = section('Camera Bookmarks', 'bookmarks');
  const bookmarkRow = document.createElement('div');
  bookmarkRow.className = 'kx-viewport-bookmark-row';
  const bookmarkSelect = document.createElement('select');
  bookmarkSelect.setAttribute('aria-label', 'Camera bookmark');
  bookmarkSelect.title = 'Camera bookmark slots · Alt+1–9 recall · Alt+Shift+1–9 save';
  refreshBookmarkSelect(bookmarkSelect);
  const recallView = document.createElement('button');
  recallView.type = 'button';
  recallView.textContent = 'Recall';
  recallView.addEventListener('click', () => recallBookmark(canvas, bookmarkSelect));
  bookmarkRow.append(bookmarkSelect, recallView);

  const bookmarkActions = document.createElement('div');
  bookmarkActions.className = 'kx-viewport-bookmark-actions';
  const saveView = document.createElement('button');
  saveView.type = 'button';
  saveView.textContent = 'Save';
  saveView.title = 'Save or overwrite selected camera bookmark';
  saveView.addEventListener('click', () => void saveBookmark(canvas, bookmarkSelect));
  const renameView = document.createElement('button');
  renameView.type = 'button';
  renameView.textContent = 'Rename';
  renameView.addEventListener('click', () => renameBookmark(bookmarkSelect));
  const deleteView = document.createElement('button');
  deleteView.type = 'button';
  deleteView.textContent = 'Delete';
  deleteView.addEventListener('click', () => deleteBookmark(bookmarkSelect));
  bookmarkActions.append(saveView, renameView, deleteView);
  bookmarkSection.append(bookmarkRow, bookmarkActions);

  menu.append(editorSection, sceneSection, zoomSection, bookmarkSection);

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select') || target?.closest('.monaco-editor')) return;
    if (event.key === 'Escape' && binding && !binding.menu.hidden) {
      event.preventDefault();
      closeMenu(binding, true);
      return;
    }
    const bookmarkSlot = bookmarkSlotFromKeyboard(event);
    if (bookmarkSlot != null) {
      event.preventDefault();
      bookmarkSelect.value = String(bookmarkSlot);
      if (event.shiftKey) void saveBookmark(canvas, bookmarkSelect, bookmarkSlot);
      else recallBookmark(canvas, bookmarkSelect, bookmarkSlot);
      return;
    }
    if (event.code === 'Home') {
      event.preventDefault();
      dispatch(canvas, { command: 'frame-all' });
      return;
    }
    const preset = viewFromKeyboard(event);
    if (!preset) return;
    event.preventDefault();
    dispatch(canvas, { command: 'view', preset });
  };
  window.addEventListener('keydown', onKeyDown);

  const current: NavigationBinding = {
    canvas,
    topbar,
    controls,
    trigger,
    menu,
    editorViews,
    sceneViews,
    bookmarkSelect,
    onKeyDown,
  };
  binding = current;

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) openMenu(current);
    else closeMenu(current);
  });
  menu.addEventListener('pointerdown', (event) => event.stopPropagation());
  document.addEventListener('pointerdown', (event) => {
    if (binding !== current || menu.hidden) return;
    const target = event.target as Node;
    if (controls.contains(target) || menu.contains(target)) return;
    closeMenu(current);
  });
  window.addEventListener('resize', () => {
    if (binding === current && !menu.hidden) positionMenu(current);
  });
  window.addEventListener('scroll', () => {
    if (binding === current && !menu.hidden) positionMenu(current);
  }, true);

  preferredHost(topbar).prepend(controls);
  refreshViewItems(current);
}

function discover(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  const topbar = document.querySelector<HTMLElement>('.studio-topbar-slot');
  if (!canvas || !topbar) {
    if (binding && !binding.canvas.isConnected) detach();
    return;
  }
  attach(canvas, topbar);
}

const observer = new MutationObserver(discover);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => {
  observer.disconnect();
  detach();
}, { once: true });
discover();
