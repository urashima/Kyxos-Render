import './viewport-helper-ui.css';

import type {
  BrowserKyxosViewportAdapter,
  ViewportHelperSettings,
} from '@kyxos/viewer-adapter';

let activeAdapter: BrowserKyxosViewportAdapter | null = null;
let activeCanvas: HTMLCanvasElement | null = null;

const menu = document.createElement('details');
menu.className = 'viewport-helper-menu';
const summary = document.createElement('summary');
summary.textContent = 'Helpers';
summary.title = 'Toggle editor-only viewport helpers';
const popover = document.createElement('div');
popover.className = 'viewport-helper-popover';
menu.append(summary, popover);

const options: Array<{
  key: keyof ViewportHelperSettings;
  label: string;
}> = [
  { key: 'grid', label: 'Ground grid' },
  { key: 'axes', label: 'World axes' },
  { key: 'bounds', label: 'Selection bounds' },
  { key: 'hover', label: 'Hover highlight' },
  { key: 'skeletons', label: 'Skeletons' },
  { key: 'lights', label: 'Light helpers' },
  { key: 'cameras', label: 'Camera helpers' },
];

const inputs = new Map<keyof ViewportHelperSettings, HTMLInputElement>();
for (const option of options) {
  const label = document.createElement('label');
  label.className = 'viewport-helper-option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.helper = option.key;
  input.setAttribute('aria-label', option.label);
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('change', () => {
    if (!activeAdapter) return;
    activeAdapter.setViewportHelpers({ [option.key]: input.checked });
    const actual = activeAdapter.getViewportHelpers();
    input.checked = actual[option.key];
    activeCanvas?.setAttribute('data-editor-helper-ui-change', option.key);
    activeCanvas?.setAttribute('data-editor-helper-ui-value', String(actual[option.key]));
  });
  label.append(input, document.createTextNode(option.label));
  popover.append(label);
  inputs.set(option.key, input);
}

function syncInputs(settings?: ViewportHelperSettings): void {
  if (!activeAdapter) return;
  const current = settings ?? activeAdapter.getViewportHelpers();
  for (const [key, input] of inputs) {
    input.checked = current[key];
    input.disabled = false;
  }
}

function attachControl(): void {
  if (!activeAdapter || !activeCanvas?.isConnected) {
    menu.remove();
    return;
  }
  const shell = activeCanvas.closest('.kyxos-studio-shell');
  const topbar = shell?.querySelector<HTMLElement>('.studio-topbar-slot');
  if (!topbar) return;
  if (!menu.isConnected) topbar.append(menu);
  // Helpers are editor-local visualization state. They remain adjustable for
  // viewer/read-only project roles because toggling them never changes the Scene Contract.
  syncInputs();
}

const observer = new MutationObserver(attachControl);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class'],
});

document.addEventListener('kyxos:viewport-adapter-ready', (event) => {
  const custom = event as CustomEvent<{ adapter?: BrowserKyxosViewportAdapter }>;
  const canvas = event.target instanceof HTMLCanvasElement ? event.target : null;
  if (!custom.detail?.adapter || !canvas) return;
  activeAdapter = custom.detail.adapter;
  activeCanvas = canvas;
  attachControl();
  requestAnimationFrame(attachControl);
});

document.addEventListener('kyxos:editor-viewport-helper-change', (event) => {
  if (event.target !== activeCanvas) return;
  const detail = (event as CustomEvent<{ settings?: ViewportHelperSettings }>).detail;
  if (detail?.settings) syncInputs(detail.settings);
});

document.addEventListener('kyxos:viewport-adapter-dispose', (event) => {
  const custom = event as CustomEvent<{ adapter?: BrowserKyxosViewportAdapter }>;
  if (custom.detail?.adapter !== activeAdapter) return;
  activeAdapter = null;
  activeCanvas = null;
  menu.remove();
});

document.addEventListener('pointerdown', (event) => {
  if (!menu.open || menu.contains(event.target as Node)) return;
  menu.open = false;
});

window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
