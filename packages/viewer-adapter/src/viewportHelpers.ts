import {
  DEFAULT_EDITOR_VIEWPORT_HELPERS,
  type EditorViewportHelperSettings,
  type KyxosViewer,
} from '@kyxos/viewer';

import { BrowserKyxosViewportAdapter } from './index';

export type ViewportHelperSettings = EditorViewportHelperSettings;

const helperSettings = new WeakMap<
  BrowserKyxosViewportAdapter,
  ViewportHelperSettings
>();
const installed = Symbol('kyxos.viewportHelpers.installed');

function viewer(adapter: BrowserKyxosViewportAdapter): KyxosViewer | null {
  return (adapter as unknown as { viewer: KyxosViewer | null }).viewer;
}

function canvas(adapter: BrowserKyxosViewportAdapter): HTMLCanvasElement | null {
  return (adapter as unknown as { canvas: HTMLCanvasElement | null }).canvas;
}

function syncCanvasDiagnostics(
  adapter: BrowserKyxosViewportAdapter,
  settings: ViewportHelperSettings,
): void {
  const target = canvas(adapter);
  if (!target) return;
  target.dataset.editorGridVisible = String(settings.grid);
  target.dataset.editorAxesVisible = String(settings.axes);
  target.dataset.editorBoundsVisible = String(settings.bounds);
  target.dataset.editorHoverVisible = String(settings.hover);
  target.dataset.editorSkeletonsVisible = String(settings.skeletons);
  target.dataset.editorLightHelpersVisible = String(settings.lights);
  target.dataset.editorCameraHelpersVisible = String(settings.cameras);
  target.dispatchEvent(new CustomEvent('kyxos:editor-viewport-helper-change', {
    bubbles: true,
    composed: true,
    detail: { settings: structuredClone(settings) },
  }));
}

export function getAdapterViewportHelpers(
  adapter: BrowserKyxosViewportAdapter,
): ViewportHelperSettings {
  const runtime = viewer(adapter)?.getEditorViewportHelperSettings();
  const settings = structuredClone(
    runtime ?? helperSettings.get(adapter) ?? DEFAULT_EDITOR_VIEWPORT_HELPERS,
  );
  helperSettings.set(adapter, settings);
  syncCanvasDiagnostics(adapter, settings);
  return settings;
}

const prototype = BrowserKyxosViewportAdapter.prototype as BrowserKyxosViewportAdapter & {
  [installed]?: boolean;
};

if (!prototype[installed]) {
  const originalDispose = prototype.dispose;

  prototype.setViewportHelpers = function setViewportHelpers(
    this: BrowserKyxosViewportAdapter,
    settings: Partial<ViewportHelperSettings>,
  ): void {
    const next = {
      ...getAdapterViewportHelpers(this),
      ...settings,
    };
    helperSettings.set(this, next);
    const runtime = viewer(this);
    runtime?.setEditorViewportHelperSettings(next);
    runtime?.refreshEditorViewportHelpers();
    syncCanvasDiagnostics(this, next);
    this.dispatchEvent(new CustomEvent('tool', {
      detail: { viewportHelpers: structuredClone(next) },
    }));
  };

  prototype.getViewportHelpers = function getViewportHelpers(
    this: BrowserKyxosViewportAdapter,
  ): ViewportHelperSettings {
    return getAdapterViewportHelpers(this);
  };

  prototype.dispose = function disposeViewportHelpers(
    this: BrowserKyxosViewportAdapter,
  ): void {
    helperSettings.delete(this);
    originalDispose.call(this);
  };

  prototype[installed] = true;
}

declare module './index' {
  interface KyxosViewportAdapter {
    setViewportHelpers(settings: Partial<ViewportHelperSettings>): void;
    getViewportHelpers(): ViewportHelperSettings;
  }

  interface BrowserKyxosViewportAdapter {
    setViewportHelpers(settings: Partial<ViewportHelperSettings>): void;
    getViewportHelpers(): ViewportHelperSettings;
  }
}
