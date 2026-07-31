import { BrowserKyxosViewportAdapter } from './index';

interface BoxSelectionState {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  startX: number;
  startY: number;
  pointerId: number;
  moved: boolean;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
}

const selectionStates = new WeakMap<BrowserKyxosViewportAdapter, BoxSelectionState>();

function internals(adapter: BrowserKyxosViewportAdapter): Record<string, any> {
  return adapter as unknown as Record<string, any>;
}

function positionOverlay(
  state: BoxSelectionState,
  clientX: number,
  clientY: number,
): void {
  const rect = state.canvas.getBoundingClientRect();
  const x0 = Math.max(rect.left, Math.min(rect.right, state.startX));
  const y0 = Math.max(rect.top, Math.min(rect.bottom, state.startY));
  const x1 = Math.max(rect.left, Math.min(rect.right, clientX));
  const y1 = Math.max(rect.top, Math.min(rect.bottom, clientY));
  state.overlay.style.left = `${Math.min(x0, x1) - rect.left}px`;
  state.overlay.style.top = `${Math.min(y0, y1) - rect.top}px`;
  state.overlay.style.width = `${Math.abs(x1 - x0)}px`;
  state.overlay.style.height = `${Math.abs(y1 - y0)}px`;
}

function sampleSelection(
  adapter: BrowserKyxosViewportAdapter,
  state: BoxSelectionState,
  endX: number,
  endY: number,
): string[] {
  const viewer = internals(adapter).viewer;
  if (!viewer) return [];
  const canvasRect = state.canvas.getBoundingClientRect();
  const left = Math.max(canvasRect.left, Math.min(state.startX, endX));
  const top = Math.max(canvasRect.top, Math.min(state.startY, endY));
  const right = Math.min(canvasRect.right, Math.max(state.startX, endX));
  const bottom = Math.min(canvasRect.bottom, Math.max(state.startY, endY));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const step = Math.max(12, Math.min(36, Math.min(width, height) / 5));
  const ids = new Set<string>();

  for (let y = top; y <= bottom; y += step) {
    for (let x = left; x <= right; x += step) {
      const hit = viewer.pick(x, y);
      if (hit?.nodeId) ids.add(hit.nodeId);
    }
  }
  for (const [x, y] of [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
    [(left + right) / 2, (top + bottom) / 2],
  ]) {
    const hit = viewer.pick(x, y);
    if (hit?.nodeId) ids.add(hit.nodeId);
  }
  return [...ids];
}

const originalMount = BrowserKyxosViewportAdapter.prototype.mount;
BrowserKyxosViewportAdapter.prototype.mount = async function mountWithBoxSelection(
  canvas: HTMLCanvasElement,
): Promise<void> {
  await originalMount.call(this, canvas);
  const parent = canvas.parentElement;
  if (!parent) return;

  const overlay = document.createElement('div');
  overlay.className = 'kyxos-box-selection';
  Object.assign(overlay.style, {
    position: 'absolute',
    display: 'none',
    border: '1px solid #7b9cff',
    background: 'rgba(92, 124, 255, .14)',
    boxShadow: '0 0 0 1px rgba(255,255,255,.18) inset',
    pointerEvents: 'none',
    zIndex: '3',
  });
  parent.append(overlay);

  const state = {} as BoxSelectionState;
  state.canvas = canvas;
  state.overlay = overlay;
  state.startX = 0;
  state.startY = 0;
  state.pointerId = -1;
  state.moved = false;

  state.onPointerMove = (event) => {
    if (event.pointerId !== state.pointerId) return;
    const distance = Math.hypot(
      event.clientX - state.startX,
      event.clientY - state.startY,
    );
    if (distance > 6) state.moved = true;
    if (!state.moved) return;
    state.overlay.style.display = 'block';
    positionOverlay(state, event.clientX, event.clientY);
  };

  state.onPointerUp = (event) => {
    if (event.pointerId !== state.pointerId) return;
    canvas.releasePointerCapture?.(event.pointerId);
    window.removeEventListener('pointermove', state.onPointerMove, true);
    window.removeEventListener('pointerup', state.onPointerUp, true);
    state.overlay.style.display = 'none';

    const adapterInternals = internals(this);
    const viewer = adapterInternals.viewer;
    const nodeIds = state.moved
      ? sampleSelection(this, state, event.clientX, event.clientY)
      : (() => {
          const hit = viewer?.pick(event.clientX, event.clientY);
          return hit?.nodeId ? [hit.nodeId] : [];
        })();
    adapterInternals.selected = nodeIds;
    adapterInternals.updateGizmo?.();
    this.dispatchEvent(
      new CustomEvent('selection', {
        detail: {
          nodeIds,
          box: state.moved
            ? {
                x0: state.startX,
                y0: state.startY,
                x1: event.clientX,
                y1: event.clientY,
              }
            : undefined,
        },
      }),
    );
    state.pointerId = -1;
  };

  state.onPointerDown = (event) => {
    if (
      event.button !== 0 ||
      internals(this).tool !== 'select' ||
      state.pointerId !== -1
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.pointerId = event.pointerId;
    state.moved = false;
    canvas.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', state.onPointerMove, true);
    window.addEventListener('pointerup', state.onPointerUp, true);
  };

  canvas.addEventListener('pointerdown', state.onPointerDown, true);
  selectionStates.set(this, state);
};

const originalDispose = BrowserKyxosViewportAdapter.prototype.dispose;
BrowserKyxosViewportAdapter.prototype.dispose = function disposeBoxSelection(): void {
  const state = selectionStates.get(this);
  if (state) {
    state.canvas.removeEventListener('pointerdown', state.onPointerDown, true);
    window.removeEventListener('pointermove', state.onPointerMove, true);
    window.removeEventListener('pointerup', state.onPointerUp, true);
    state.overlay.remove();
    selectionStates.delete(this);
  }
  originalDispose.call(this);
};
