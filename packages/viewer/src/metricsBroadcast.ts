import type { ViewerMetrics } from './types';

const INSTALL_MARK = Symbol.for('kyxos.viewer.metrics-broadcast');

type ViewerConstructor = {
  prototype: EventTarget & { [INSTALL_MARK]?: boolean };
};

/**
 * Forwards the Viewer metrics event to the browser shell without exposing the
 * Viewer instance or Three.js internals. KyxosViewer already throttles metrics
 * to four updates per second, so this does not add a per-frame UI allocation.
 */
export function installViewerMetricsBroadcast(Viewer: ViewerConstructor): void {
  if (Viewer.prototype[INSTALL_MARK]) return;
  Viewer.prototype[INSTALL_MARK] = true;

  const dispatch = Viewer.prototype.dispatchEvent;
  Viewer.prototype.dispatchEvent = function dispatchWithMetrics(event: Event): boolean {
    const result = dispatch.call(this, event);
    if (event.type === 'metrics' && typeof window !== 'undefined') {
      const detail = (event as CustomEvent<ViewerMetrics>).detail;
      window.dispatchEvent(new CustomEvent<ViewerMetrics>('kyxos:viewer-metrics', { detail }));
    }
    return result;
  };
}
