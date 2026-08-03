import type { EditorTransformPivot, KyxosViewer } from '@kyxos/viewer';

import { BrowserKyxosViewportAdapter } from './index';

export type TransformPivot = EditorTransformPivot;

const pivotModes = new WeakMap<BrowserKyxosViewportAdapter, TransformPivot>();
const installed = Symbol('kyxos.transformPivot.installed');

function viewer(adapter: BrowserKyxosViewportAdapter): KyxosViewer | null {
  return (adapter as unknown as { viewer: KyxosViewer | null }).viewer;
}

export function getAdapterTransformPivot(
  adapter: BrowserKyxosViewportAdapter,
): TransformPivot {
  return pivotModes.get(adapter) ?? 'active';
}

const prototype = BrowserKyxosViewportAdapter.prototype as BrowserKyxosViewportAdapter & {
  [installed]?: boolean;
};

if (!prototype[installed]) {
  const originalMount = prototype.mount;
  const originalDispose = prototype.dispose;

  prototype.mount = async function mountWithTransformPivot(
    this: BrowserKyxosViewportAdapter,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    await originalMount.call(this, canvas);
    canvas.dispatchEvent(new CustomEvent('kyxos:viewport-adapter-ready', {
      bubbles: true,
      composed: true,
      detail: { adapter: this },
    }));
  };

  prototype.setTransformPivot = function setTransformPivot(
    this: BrowserKyxosViewportAdapter,
    pivot: TransformPivot,
  ): void {
    pivotModes.set(this, pivot);
    viewer(this)?.setEditorTransformPivot(pivot);
    this.dispatchEvent(new CustomEvent('tool', { detail: { transformPivot: pivot } }));
  };

  prototype.getTransformPivot = function getTransformPivot(
    this: BrowserKyxosViewportAdapter,
  ): TransformPivot {
    return getAdapterTransformPivot(this);
  };

  prototype.dispose = function disposeTransformPivot(
    this: BrowserKyxosViewportAdapter,
  ): void {
    const canvas = (this as unknown as { canvas: HTMLCanvasElement | null }).canvas;
    canvas?.dispatchEvent(new CustomEvent('kyxos:viewport-adapter-dispose', {
      bubbles: true,
      composed: true,
      detail: { adapter: this },
    }));
    pivotModes.delete(this);
    originalDispose.call(this);
  };

  prototype[installed] = true;
}

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
