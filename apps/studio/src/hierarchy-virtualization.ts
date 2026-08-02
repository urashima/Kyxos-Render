import { computeVirtualWindow } from '@kyxos/editor-core/experience';

const VIRTUALIZATION_THRESHOLD = 200;
const OVERSCAN_ROWS = 10;

interface HierarchyVirtualizationState {
  tree: HTMLElement;
  observer: MutationObserver;
  rows: HTMLElement[];
  surface: HTMLElement | null;
  frame: number | null;
  selectedId: string | null;
  onScroll: () => void;
}

const states = new Set<HierarchyVirtualizationState>();
const initializedTrees = new WeakSet<HTMLElement>();

function rowHeightFor(tree: HTMLElement): number {
  const shell = tree.closest<HTMLElement>('.kyxos-studio-shell') ?? tree;
  const configured = Number.parseFloat(
    getComputedStyle(shell).getPropertyValue('--kyxos-hierarchy-row-height'),
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 28;
}

function resetRowLayout(row: HTMLElement): void {
  row.style.removeProperty('position');
  row.style.removeProperty('inset-inline');
  row.style.removeProperty('top');
  row.style.removeProperty('height');
  row.style.removeProperty('min-height');
  row.removeAttribute('aria-posinset');
  row.removeAttribute('aria-setsize');
}

function renderWindow(state: HierarchyVirtualizationState): void {
  state.frame = null;
  if (!state.tree.isConnected || !state.surface || state.rows.length <= VIRTUALIZATION_THRESHOLD) {
    return;
  }

  const rowHeight = rowHeightFor(state.tree);
  const viewportHeight = Math.max(state.tree.clientHeight, 320);
  const window = computeVirtualWindow({
    total: state.rows.length,
    scrollTop: state.tree.scrollTop,
    viewportHeight,
    rowHeight,
    overscan: OVERSCAN_ROWS,
  });
  const fragment = document.createDocumentFragment();

  for (let index = window.start; index < window.end; index += 1) {
    const row = state.rows[index];
    Object.assign(row.style, {
      position: 'absolute',
      insetInline: '0',
      top: `${index * rowHeight}px`,
      height: `${rowHeight}px`,
      minHeight: `${rowHeight}px`,
    });
    row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(state.rows.length));
    fragment.append(row);
  }

  state.surface.style.height = `${window.totalHeight}px`;
  state.surface.style.minHeight = `${window.totalHeight}px`;
  state.surface.replaceChildren(fragment);
}

function scheduleRender(state: HierarchyVirtualizationState): void {
  if (state.frame != null) return;
  state.frame = requestAnimationFrame(() => renderWindow(state));
}

function revealSelection(
  state: HierarchyVirtualizationState,
  selectedId: string | null,
  rowHeight: number,
): void {
  if (!selectedId || selectedId === state.selectedId) return;
  const index = state.rows.findIndex((row) => row.dataset.node === selectedId);
  if (index < 0) return;
  const viewportHeight = Math.max(state.tree.clientHeight, 320);
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < state.tree.scrollTop || bottom > state.tree.scrollTop + viewportHeight) {
    state.tree.scrollTop = Math.max(0, top - (viewportHeight - rowHeight) / 2);
  }
}

function captureRows(state: HierarchyVirtualizationState): void {
  if (!state.tree.isConnected) return;
  if (state.surface && state.tree.childElementCount === 1 && state.tree.firstElementChild === state.surface) {
    return;
  }

  const rows = Array.from(state.tree.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('hierarchy-row'),
  );
  if (!rows.length) {
    state.rows = [];
    state.surface = null;
    state.selectedId = null;
    state.tree.removeAttribute('data-virtualized');
    state.tree.removeAttribute('aria-rowcount');
    return;
  }

  state.rows = rows;
  const selectedId = rows.find((row) => row.classList.contains('selected'))?.dataset.node ?? null;
  if (rows.length <= VIRTUALIZATION_THRESHOLD) {
    rows.forEach(resetRowLayout);
    state.surface = null;
    state.selectedId = selectedId;
    state.tree.removeAttribute('data-virtualized');
    state.tree.removeAttribute('aria-rowcount');
    return;
  }

  const rowHeight = rowHeightFor(state.tree);
  const surface = document.createElement('div');
  surface.className = 'hierarchy-virtual-surface';
  surface.setAttribute('role', 'presentation');
  Object.assign(surface.style, {
    position: 'relative',
    width: '100%',
    height: `${rows.length * rowHeight}px`,
    minHeight: `${rows.length * rowHeight}px`,
  });

  state.observer.disconnect();
  state.tree.replaceChildren(surface);
  state.observer.observe(state.tree, { childList: true });
  state.surface = surface;
  state.tree.dataset.virtualized = 'true';
  state.tree.setAttribute('aria-rowcount', String(rows.length));
  state.tree.style.overflowAnchor = 'none';
  revealSelection(state, selectedId, rowHeight);
  state.selectedId = selectedId;
  renderWindow(state);
}

function attach(tree: HTMLElement): void {
  if (initializedTrees.has(tree)) return;
  initializedTrees.add(tree);

  const state = {} as HierarchyVirtualizationState;
  state.tree = tree;
  state.rows = [];
  state.surface = null;
  state.frame = null;
  state.selectedId = null;
  state.onScroll = () => scheduleRender(state);
  state.observer = new MutationObserver(() => captureRows(state));
  state.observer.observe(tree, { childList: true });
  tree.addEventListener('scroll', state.onScroll, { passive: true });
  states.add(state);
  captureRows(state);
}

function discover(): void {
  document.querySelectorAll<HTMLElement>('.hierarchy-tree').forEach(attach);
  for (const state of states) {
    if (state.tree.isConnected) continue;
    state.observer.disconnect();
    state.tree.removeEventListener('scroll', state.onScroll);
    if (state.frame != null) cancelAnimationFrame(state.frame);
    states.delete(state);
  }
}

const documentObserver = new MutationObserver(discover);
documentObserver.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => {
  documentObserver.disconnect();
  for (const state of states) {
    state.observer.disconnect();
    state.tree.removeEventListener('scroll', state.onScroll);
    if (state.frame != null) cancelAnimationFrame(state.frame);
  }
  states.clear();
}, { once: true });
discover();
