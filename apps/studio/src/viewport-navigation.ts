import type { EditorViewPreset } from '@kyxos/viewer';

interface NavigationBinding {
  canvas: HTMLCanvasElement;
  controls: HTMLElement;
  select: HTMLSelectElement;
  onKeyDown: (event: KeyboardEvent) => void;
}

let binding: NavigationBinding | null = null;

function dispatch(canvas: HTMLCanvasElement, detail: unknown): void {
  canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', { detail }));
}

function viewFromKeyboard(event: KeyboardEvent): EditorViewPreset | null {
  if (event.code === 'Numpad1') return event.ctrlKey || event.metaKey ? 'back' : 'front';
  if (event.code === 'Numpad3') return event.ctrlKey || event.metaKey ? 'left' : 'right';
  if (event.code === 'Numpad7') return event.ctrlKey || event.metaKey ? 'bottom' : 'top';
  if (event.code === 'Numpad5') return 'perspective';
  return null;
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
  select.value = canvas.dataset.editorView ?? 'perspective';
  select.addEventListener('change', () => {
    const preset = select.value as EditorViewPreset;
    dispatch(canvas, { command: 'view', preset });
  });

  const frameAll = document.createElement('button');
  frameAll.type = 'button';
  frameAll.textContent = 'Frame All';
  frameAll.title = 'Frame all scene content · Home';
  frameAll.addEventListener('click', () => dispatch(canvas, { command: 'frame-all' }));

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select') || target?.closest('.monaco-editor')) return;
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

  controls.append(select, frameAll);
  topbar.append(controls);
  binding = { canvas, controls, select, onKeyDown };
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
