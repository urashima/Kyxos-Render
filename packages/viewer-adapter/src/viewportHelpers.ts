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

export function getAdapterViewportHelpers(
  adapter: BrowserKyxosViewportAdapter,
): ViewportHelperSettings {
  return structuredClone(
    helperSettings.get(adapter) ?? DEFAULT_EDITOR_VIEWPORT_HELPERS,
  );
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
    viewer(this)?.setEditorViewportHelperSettings(next);
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
