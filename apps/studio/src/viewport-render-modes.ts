import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';
import type {
  EditorRenderMode,
  EditorViewportCommand,
} from '@kyxos/viewer-adapter';

export {};

interface StudioApiLike {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: ScenePatch): void;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

interface RenderModeBinding {
  canvas: HTMLCanvasElement;
  controls: HTMLElement;
  select: HTMLSelectElement;
  onModeChange: EventListener;
}

const modes = new Set<EditorRenderMode>([
  'shaded',
  'wireframe',
  'albedo',
  'normals',
  'ambientOcclusion',
  'emission',
  'depth',
  'metalness',
  'roughness',
  'velocity',
  'uv',
]);
let binding: RenderModeBinding | null = null;

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function normalizedMode(value: unknown): EditorRenderMode {
  return typeof value === 'string' && modes.has(value as EditorRenderMode)
    ? value as EditorRenderMode
    : 'shaded';
}

function sceneMode(): EditorRenderMode {
  const editorState = studioApi()?.getScene().editorState as
    | { viewportRenderMode?: unknown }
    | undefined;
  return normalizedMode(editorState?.viewportRenderMode);
}

function dispatchMode(canvas: HTMLCanvasElement, mode: EditorRenderMode): void {
  const detail: EditorViewportCommand = { command: 'render-mode', mode };
  canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', { detail }));
}

function persistMode(mode: EditorRenderMode): void {
  const api = studioApi();
  if (!api) return;
  const scene = api.getScene();
  const editorState = {
    ...(scene.editorState ?? {}),
    viewportRenderMode: mode,
  };
  api.applyPatch(`Viewport render mode: ${mode}`, [{
    op: scene.editorState ? 'replace' : 'add',
    path: '/editorState',
    value: editorState,
  }]);
}

function detach(): void {
  if (!binding) return;
  binding.canvas.removeEventListener(
    'kyxos:editor-render-mode-change',
    binding.onModeChange,
  );
  binding.controls.remove();
  binding = null;
}

function addOptions(select: HTMLSelectElement): void {
  const groups: Array<[
    string,
    Array<[string, EditorRenderMode]>,
  ]> = [
    ['Surface', [
      ['Shaded', 'shaded'],
      ['Wireframe', 'wireframe'],
    ]],
    ['Material Channels', [
      ['Albedo', 'albedo'],
      ['Normals', 'normals'],
      ['Ambient Occlusion', 'ambientOcclusion'],
      ['Emission', 'emission'],
      ['Metalness', 'metalness'],
      ['Roughness', 'roughness'],
      ['UV', 'uv'],
    ]],
    ['Buffers', [
      ['Depth', 'depth'],
      ['Velocity', 'velocity'],
    ]],
  ];
  for (const [label, options] of groups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const [name, value] of options) group.append(new Option(name, value));
    select.append(group);
  }
}

function attach(canvas: HTMLCanvasElement, topbar: HTMLElement): void {
  if (binding?.canvas === canvas && binding.controls.isConnected) return;
  detach();

  const controls = document.createElement('div');
  controls.className = 'tool-group viewport-render-mode-group';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Viewport rendering');

  const label = document.createElement('span');
  label.className = 'toolbar-label';
  label.textContent = 'Render';

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Viewport render mode');
  select.title = 'Shaded, wireframe, material channels and render buffers';
  addOptions(select);
  select.value = normalizedMode(canvas.dataset.editorRenderMode || sceneMode());
  select.addEventListener('change', () => {
    const mode = normalizedMode(select.value);
    dispatchMode(canvas, mode);
    persistMode(mode);
  });

  const onModeChange: EventListener = (event) => {
    const mode = normalizedMode(
      (event as CustomEvent<{ mode?: unknown }>).detail?.mode,
    );
    if (select.value !== mode) select.value = mode;
  };
  canvas.addEventListener('kyxos:editor-render-mode-change', onModeChange);

  controls.append(label, select);
  topbar.append(controls);
  binding = { canvas, controls, select, onModeChange };

  // The adapter also restores this value whenever a SceneDocument is loaded.
  // Dispatching here covers the initial attach before the first scene switch.
  dispatchMode(canvas, sceneMode());
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
