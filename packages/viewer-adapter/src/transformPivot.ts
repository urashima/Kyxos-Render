import type { EditorTransformPivot, KyxosViewer } from '@kyxos/viewer';

import { BrowserKyxosViewportAdapter } from './index';

export type TransformPivot = EditorTransformPivot;

const pivotModes = new WeakMap<BrowserKyxosViewportAdapter, TransformPivot>();

function viewer(adapter: BrowserKyxosViewportAdapter): KyxosViewer | null {
  return (adapter as unknown as { viewer: KyxosViewer | null }).viewer;
}

export function getAdapterTransformPivot(
  adapter: BrowserKyxosViewportAdapter,
): TransformPivot {
  return pivotModes.get(adapter) ?? 'active';
}

BrowserKyxosViewportAdapter.prototype.setTransformPivot = function setTransformPivot(
  pivot: TransformPivot,
): void {
  pivotModes.set(this, pivot);
  viewer(this)?.setEditorTransformPivot(pivot);
  this.dispatchEvent(new CustomEvent('tool', { detail: { transformPivot: pivot } }));
};

BrowserKyxosViewportAdapter.prototype.getTransformPivot = function getTransformPivot(): TransformPivot {
  return getAdapterTransformPivot(this);
};

declare module './index' {
  interface KyxosViewportAdapter {
    setTransformPivot(pivot: TransformPivot): void;
    getTransformPivot(): TransformPivot;
  }

  interface BrowserKyxosViewportAdapter {
    setTransformPivot(pivot: TransformPivot): void;
    getTransformPivot(): TransformPivot;
  }
}
