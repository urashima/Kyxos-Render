import type {
  BrowserKyxosViewportAdapter,
  TransformPivot,
} from '@kyxos/viewer-adapter';

let activeAdapter: BrowserKyxosViewportAdapter | null = null;
let activeCanvas: HTMLCanvasElement | null = null;

const select = document.createElement('select');
select.className = 'transform-pivot-select';
select.setAttribute('aria-label', 'Transform pivot');
select.title = 'Choose the pivot used when moving, rotating or scaling multiple entities.';
select.append(
  new Option('Active Pivot', 'active'),
  new Option('Center', 'center'),
);
select.addEventListener('change', () => {
  activeAdapter?.setTransformPivot(select.value as TransformPivot);
});

function attachControl(): void {
  if (!activeAdapter || !activeCanvas?.isConnected) {
    select.remove();
    return;
  }
  const shell = activeCanvas.closest('.kyxos-studio-shell');
  const coordinate = shell?.querySelector<HTMLSelectElement>(
    'select[aria-label="Coordinate space"]',
  );
  if (!coordinate) return;
  select.disabled = coordinate.disabled;
  select.value = activeAdapter.getTransformPivot();
  if (select.previousElementSibling !== coordinate) coordinate.after(select);
}

const observer = new MutationObserver(attachControl);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['disabled'],
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

document.addEventListener('kyxos:viewport-adapter-dispose', (event) => {
  const custom = event as CustomEvent<{ adapter?: BrowserKyxosViewportAdapter }>;
  if (custom.detail?.adapter !== activeAdapter) return;
  activeAdapter = null;
  activeCanvas = null;
  select.remove();
});

window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
