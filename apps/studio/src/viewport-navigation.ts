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
  controls: HTMLElement;
  select: HTMLSelectElement;
  bookmarkSelect: HTMLSelectElement;
  onKeyDown: (event: KeyboardEvent) => void;
}

let binding: NavigationBinding | null = null;

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function dispatch(canvas: HTMLCanvasElement, detail: EditorViewportCommand): void {
  canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', { detail }));
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
    select.append(new Option(
      `${slot} · ${bookmark?.name ?? 'Empty'}`,
      String(slot),
    ));
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

function detach(): void {
  if (!binding) return;
  window.removeEventListener('keydown', binding.onKeyDown);
  binding.controls.remove();
  binding = null;
}

function attach(canvas: HTMLCanvasElement, topbar: HTMLElement): void {
  if (binding?.canvas === canvas && binding.controls.isConnected) return;
  detach();

  const controls = document.createElement('div');
  controls.className = 'tool-group viewport-navigation-group';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Viewport camera');

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Viewport view');
  for (const [label, value] of [
    ['Perspective', 'perspective'],
    ['Front', 'front'],
    ['Back', 'back'],
    ['Top', 'top'],
    ['Bottom', 'bottom'],
    ['Left', 'left'],
    ['Right', 'right'],
  ] as const) {
    select.append(new Option(label, value));
  }
  const initialView = canvas.dataset.editorView;
  select.value = initialView && initialView !== 'bookmark' ? initialView : 'perspective';
  select.addEventListener('change', () => {
    const preset = select.value as EditorViewPreset;
    dispatch(canvas, { command: 'view', preset });
  });

  const frameAll = document.createElement('button');
  frameAll.type = 'button';
  frameAll.textContent = 'Frame All';
  frameAll.title = 'Frame all scene content · Home';
  frameAll.addEventListener('click', () => dispatch(canvas, { command: 'frame-all' }));

  const bookmarkSelect = document.createElement('select');
  bookmarkSelect.setAttribute('aria-label', 'Camera bookmark');
  bookmarkSelect.title = 'Camera bookmark slots · Alt+1–9 recall · Alt+Shift+1–9 save';
  bookmarkSelect.addEventListener('pointerdown', () => refreshBookmarkSelect(bookmarkSelect));
  bookmarkSelect.addEventListener('focus', () => refreshBookmarkSelect(bookmarkSelect));
  refreshBookmarkSelect(bookmarkSelect);

  const saveView = document.createElement('button');
  saveView.type = 'button';
  saveView.textContent = 'Save View';
  saveView.title = 'Save or overwrite selected camera bookmark';
  saveView.addEventListener('click', () => void saveBookmark(canvas, bookmarkSelect));

  const recallView = document.createElement('button');
  recallView.type = 'button';
  recallView.textContent = 'Recall';
  recallView.title = 'Restore selected camera bookmark';
  recallView.addEventListener('click', () => recallBookmark(canvas, bookmarkSelect));

  const renameView = document.createElement('button');
  renameView.type = 'button';
  renameView.textContent = 'Rename';
  renameView.title = 'Rename selected camera bookmark';
  renameView.addEventListener('click', () => renameBookmark(bookmarkSelect));

  const deleteView = document.createElement('button');
  deleteView.type = 'button';
  deleteView.textContent = 'Delete';
  deleteView.title = 'Delete selected camera bookmark';
  deleteView.addEventListener('click', () => deleteBookmark(bookmarkSelect));

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select') || target?.closest('.monaco-editor')) return;
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
    select.value = preset;
    dispatch(canvas, { command: 'view', preset });
  };
  window.addEventListener('keydown', onKeyDown);

  controls.append(
    select,
    frameAll,
    bookmarkSelect,
    saveView,
    recallView,
    renameView,
    deleteView,
  );
  topbar.append(controls);
  binding = { canvas, controls, select, bookmarkSelect, onKeyDown };
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
