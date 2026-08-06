import type { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

let adapter: BrowserKyxosViewportAdapter | null = null;
let canvas: HTMLCanvasElement | null = null;
let transforming = false;
let shiftHeld = false;

const syntheticShift = (type: 'keydown' | 'keyup'): void => {
  window.dispatchEvent(new KeyboardEvent(type, {
    key: 'Shift',
    code: 'ShiftLeft',
    bubbles: true,
    cancelable: true,
  }));
};

const onTransformStart = (): void => {
  transforming = true;
  if (canvas) canvas.dataset.editorTransformDragging = 'true';
  if (shiftHeld) syntheticShift('keydown');
};

const onTransformEnd = (): void => {
  if (shiftHeld) syntheticShift('keyup');
  transforming = false;
  if (canvas) delete canvas.dataset.editorTransformDragging;
};

const detach = (): void => {
  adapter?.removeEventListener('transform-start', onTransformStart);
  adapter?.removeEventListener('transform-end', onTransformEnd);
  adapter = null;
  canvas = null;
  transforming = false;
};

const onAdapterReady = (event: Event): void => {
  const custom = event as CustomEvent<{ adapter?: BrowserKyxosViewportAdapter }>;
  const nextCanvas = event.target instanceof HTMLCanvasElement ? event.target : null;
  if (!custom.detail?.adapter || !nextCanvas) return;
  detach();
  adapter = custom.detail.adapter;
  canvas = nextCanvas;
  adapter.addEventListener('transform-start', onTransformStart);
  adapter.addEventListener('transform-end', onTransformEnd);
};

const guardShift = (event: KeyboardEvent): void => {
  if (event.key !== 'Shift' || !event.isTrusted) return;
  shiftHeld = event.type === 'keydown';
  if (transforming) return;
  // Shift remains available through click/pointer modifier state for hierarchy
  // range selection. Only the unrelated global key event is suppressed so the
  // temporary-snap layer cannot change editor settings outside a gizmo drag.
  event.stopImmediatePropagation();
};

const onWindowBlur = (): void => {
  shiftHeld = false;
  if (transforming) syntheticShift('keyup');
};

document.addEventListener('kyxos:viewport-adapter-ready', onAdapterReady, true);
window.addEventListener('keydown', guardShift, true);
window.addEventListener('keyup', guardShift, true);
window.addEventListener('blur', onWindowBlur);
window.addEventListener('pagehide', () => {
  detach();
  document.removeEventListener('kyxos:viewport-adapter-ready', onAdapterReady, true);
  window.removeEventListener('keydown', guardShift, true);
  window.removeEventListener('keyup', guardShift, true);
  window.removeEventListener('blur', onWindowBlur);
}, { once: true });
