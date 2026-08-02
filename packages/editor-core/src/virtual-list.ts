export interface VirtualWindowInput {
  total: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
}

export interface VirtualWindow {
  start: number;
  end: number;
  offsetTop: number;
  totalHeight: number;
  scrollTop: number;
}

/**
 * Returns the half-open row range that should be mounted for a fixed-height list.
 * Inputs are normalized so stale persisted scroll positions cannot address rows
 * beyond the current collection after filtering, deleting, or collapsing nodes.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const total = Math.max(0, Math.trunc(Number(input.total) || 0));
  const rowHeight = Number(input.rowHeight);
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    throw new Error('Virtual-list rowHeight must be a positive finite number.');
  }

  const viewportHeight = Math.max(0, Number(input.viewportHeight) || 0);
  const overscan = Math.max(0, Math.trunc(Number(input.overscan) || 0));
  const totalHeight = total * rowHeight;
  const maximumScrollTop = Math.max(0, totalHeight - viewportHeight);
  const scrollTop = Math.max(
    0,
    Math.min(maximumScrollTop, Number(input.scrollTop) || 0),
  );
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const start = Math.max(0, Math.min(total, firstVisible - overscan));
  const end = Math.max(start, Math.min(total, lastVisible + overscan));

  return {
    start,
    end,
    offsetTop: start * rowHeight,
    totalHeight,
    scrollTop,
  };
}
