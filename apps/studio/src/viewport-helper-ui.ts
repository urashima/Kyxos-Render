import './viewport-helper-ui.css';

import type {
  BrowserKyxosViewportAdapter,
  ViewportHelperSettings,
} from '@kyxos/viewer-adapter';

let activeAdapter: BrowserKyxosViewportAdapter | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let open = false;

const menu = document.createElement('div');
menu.className = 'viewport-helper-menu';
const trigger = document.createElement('button');
trigger.type = 'button';
trigger.className = 'viewport-helper-trigger';
trigger.textContent = 'Helpers';
trigger.title = 'Toggle editor-only viewport helpers';
trigger.setAttribute('aria-label', 'Helpers');
trigger.setAttribute('aria-haspopup', 'menu');
trigger.setAttribute('aria-expanded', 'false');
const popover = document.createElement('div');
popover.className = 'viewport-helper-popover';
popover.hidden = true;
popover.setAttribute('role', 'menu');
menu.append(trigger);
document.body.append(popover);

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
  label.setAttribute('role', 'menuitemcheckbox');
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
    label.setAttribute('aria-checked', String(actual[option.key]));
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
    input.closest<HTMLElement>('.viewport-helper-option')?.setAttribute('aria-checked', String(current[key]));
  }
}

function positionPopover(): void {
  if (!menu.isConnected) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(210, window.innerWidth - 16);
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  popover.style.width = `${width}px`;
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(rect.bottom + 8)}px`;
}

function setOpen(next: boolean, restoreFocus = false): void {
  open = next;
  popover.hidden = !next;
  trigger.setAttribute('aria-expanded', String(next));
  menu.classList.toggle('is-open', next);
  if (next) {
    syncInputs();
    positionPopover();
    requestAnimationFrame(() => popover.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus());
  } else if (restoreFocus) {
    trigger.focus({ preventScroll: true });
  }
}

function attachControl(): void {
  if (!activeAdapter || !activeCanvas?.isConnected) {
    menu.remove();
    setOpen(false);
    return;
  }
  const shell = activeCanvas.closest('.kyxos-studio-shell');
  const topbar = shell?.querySelector<HTMLElement>('.studio-topbar-slot');
  if (!topbar) return;
  const preferredHost = topbar.querySelector<HTMLElement>('.kx-topbar-view-cluster') ?? topbar;
  if (menu.parentElement !== preferredHost) preferredHost.append(menu);
  // Helpers are editor-local visualization state. They remain adjustable for
  // viewer/read-only project roles because toggling them never changes the Scene Contract.
  syncInputs();
}

trigger.addEventListener('click', (event) => {
  event.stopPropagation();
  setOpen(!open);
});
popover.addEventListener('pointerdown', (event) => event.stopPropagation());

document.addEventListener('pointerdown', (event) => {
  if (!open) return;
  const target = event.target as Node;
  if (menu.contains(target) || popover.contains(target)) return;
  setOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (!open || event.key !== 'Escape') return;
  event.preventDefault();
  setOpen(false, true);
});
window.addEventListener('resize', positionPopover);
window.addEventListener('scroll', positionPopover, true);

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
  setOpen(false);
});

window.addEventListener('pagehide', () => {
  observer.disconnect();
  popover.remove();
}, { once: true });
