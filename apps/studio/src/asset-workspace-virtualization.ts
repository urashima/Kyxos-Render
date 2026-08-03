import './asset-workspace-virtualization.css';

const VIRTUALIZATION_THRESHOLD = 200;
const OVERSCAN_ROWS = 3;
const FALLBACK_GRID_CARD_HEIGHT = 112;
const FALLBACK_LIST_CARD_HEIGHT = 58;

interface AssetVirtualizationState {
  viewport: HTMLElement;
  grid: HTMLElement;
  items: HTMLElement[];
  topSpacer: HTMLElement;
  bottomSpacer: HTMLElement;
  frame: number | null;
  resizeObserver: ResizeObserver;
  onScroll: () => void;
  lastColumns: number;
  lastStart: number;
  lastEnd: number;
}

const states = new Set<AssetVirtualizationState>();
const initializedGrids = new WeakSet<HTMLElement>();

function numberStyle(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function gridColumns(grid: HTMLElement): number {
  if (grid.classList.contains('list')) return 1;
  const style = getComputedStyle(grid);
  const template = style.gridTemplateColumns.trim();
  if (template && template !== 'none') {
    const tracks = template.match(/(?:[^\s(]+|\([^)]*\))+/g);
    if (tracks?.length) return Math.max(1, tracks.length);
  }
  const gap = numberStyle(style.columnGap, 7);
  return Math.max(1, Math.floor((Math.max(grid.clientWidth, 176) + gap) / (176 + gap)));
}

function measuredCardHeight(state: AssetVirtualizationState): number {
  const fallback = state.grid.classList.contains('list')
    ? FALLBACK_LIST_CARD_HEIGHT
    : FALLBACK_GRID_CARD_HEIGHT;
  const heights = state.items
    .slice(0, 12)
    .map((item) => item.getBoundingClientRect().height || item.offsetHeight)
    .filter((height) => Number.isFinite(height) && height > 0);
  return heights.length ? Math.max(...heights) : fallback;
}

function spacer(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `asset-virtual-spacer ${className}`;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function setSpacerHeight(element: HTMLElement, height: number): void {
  const next = Math.max(0, Math.round(height));
  element.style.height = `${next}px`;
  element.hidden = next === 0;
}

function renderWindow(state: AssetVirtualizationState): void {
  state.frame = null;
  if (!state.grid.isConnected || !state.viewport.isConnected) return;

  const columns = gridColumns(state.grid);
  const style = getComputedStyle(state.grid);
  const rowGap = numberStyle(style.rowGap, 7);
  const rowHeight = measuredCardHeight(state);
  const rowPitch = Math.max(1, rowHeight + rowGap);
  const totalRows = Math.ceil(state.items.length / columns);
  const viewportRect = state.viewport.getBoundingClientRect();
  const gridRect = state.grid.getBoundingClientRect();
  const gridTop = gridRect.top - viewportRect.top + state.viewport.scrollTop;
  const localScrollTop = Math.max(0, state.viewport.scrollTop - gridTop);
  const visibleRows = Math.max(1, Math.ceil(state.viewport.clientHeight / rowPitch));
  const startRow = Math.max(0, Math.floor(localScrollTop / rowPitch) - OVERSCAN_ROWS);
  const endRow = Math.min(totalRows, startRow + visibleRows + OVERSCAN_ROWS * 2);
  const start = startRow * columns;
  const end = Math.min(state.items.length, endRow * columns);

  if (
    columns === state.lastColumns
    && start === state.lastStart
    && end === state.lastEnd
    && state.grid.firstElementChild === state.topSpacer
  ) {
    return;
  }

  state.lastColumns = columns;
  state.lastStart = start;
  state.lastEnd = end;
  setSpacerHeight(state.topSpacer, startRow * rowPitch);
  setSpacerHeight(state.bottomSpacer, (totalRows - endRow) * rowPitch);

  const fragment = document.createDocumentFragment();
  fragment.append(state.topSpacer);
  for (let index = start; index < end; index += 1) {
    const item = state.items[index];
    item.setAttribute('aria-posinset', String(index + 1));
    item.setAttribute('aria-setsize', String(state.items.length));
    fragment.append(item);
  }
  fragment.append(state.bottomSpacer);
  state.grid.replaceChildren(fragment);
  state.grid.dataset.virtualStart = String(start);
  state.grid.dataset.virtualEnd = String(end);
  state.grid.dataset.virtualColumns = String(columns);
  state.grid.dataset.virtualRendered = String(end - start);
}

function scheduleRender(state: AssetVirtualizationState): void {
  if (state.frame != null) return;
  state.frame = requestAnimationFrame(() => renderWindow(state));
}

function attach(grid: HTMLElement): void {
  if (initializedGrids.has(grid)) return;
  initializedGrids.add(grid);

  const items = Array.from(grid.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('asset-workspace-item'),
  );
  if (items.length <= VIRTUALIZATION_THRESHOLD) return;
  const viewport = grid.closest<HTMLElement>('.assets-content');
  if (!viewport) return;

  const state = {} as AssetVirtualizationState;
  state.viewport = viewport;
  state.grid = grid;
  state.items = items;
  state.topSpacer = spacer('asset-virtual-spacer-top');
  state.bottomSpacer = spacer('asset-virtual-spacer-bottom');
  state.frame = null;
  state.lastColumns = 0;
  state.lastStart = -1;
  state.lastEnd = -1;
  state.onScroll = () => scheduleRender(state);
  state.resizeObserver = new ResizeObserver(() => {
    state.lastColumns = 0;
    scheduleRender(state);
  });

  grid.dataset.virtualized = 'true';
  grid.dataset.virtualTotal = String(items.length);
  grid.setAttribute('aria-rowcount', String(items.length));
  viewport.addEventListener('scroll', state.onScroll, { passive: true });
  state.resizeObserver.observe(viewport);
  state.resizeObserver.observe(grid);
  states.add(state);
  scheduleRender(state);
}

function disposeState(state: AssetVirtualizationState): void {
  state.viewport.removeEventListener('scroll', state.onScroll);
  state.resizeObserver.disconnect();
  if (state.frame != null) cancelAnimationFrame(state.frame);
  states.delete(state);
}

function discover(): void {
  document.querySelectorAll<HTMLElement>('.asset-workspace-items').forEach(attach);
  for (const state of [...states]) {
    if (!state.grid.isConnected || !state.viewport.isConnected) disposeState(state);
  }
}

const documentObserver = new MutationObserver(discover);
documentObserver.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => {
  documentObserver.disconnect();
  for (const state of [...states]) disposeState(state);
}, { once: true });
discover();
