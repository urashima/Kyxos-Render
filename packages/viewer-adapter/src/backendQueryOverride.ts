import type { ViewerCapabilityDescription } from '@kyxos/scene-contract';

import { BrowserKyxosViewportAdapter } from './index';

type BackendPreference = 'auto' | 'webgpu' | 'webgl2';

interface AdapterInternals {
  createOptions: {
    backend?: BackendPreference;
    quality?: string;
  };
  viewer: {
    getCapabilities(): ViewerCapabilityDescription;
  } | null;
}

const installed = Symbol.for('kyxos.viewerAdapter.backendQueryOverride');

function requestedBackend(canvas: HTMLCanvasElement): BackendPreference | null {
  const location = canvas.ownerDocument.defaultView?.location;
  if (!location) return null;
  const value = new URL(location.href).searchParams.get('backend');
  return value === 'auto' || value === 'webgpu' || value === 'webgl2'
    ? value
    : null;
}

export function installBackendQueryOverride(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as {
    mount: BrowserKyxosViewportAdapter['mount'];
    [installed]?: boolean;
  };
  if (prototype[installed]) return;

  const originalMount = prototype.mount;
  prototype.mount = async function mountWithBackendQueryOverride(
    this: BrowserKyxosViewportAdapter,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    const internal = this as unknown as AdapterInternals;
    const override = requestedBackend(canvas);
    if (override) {
      internal.createOptions = {
        ...internal.createOptions,
        backend: override,
      };
    }
    const requested = override ?? internal.createOptions.backend ?? 'auto';
    canvas.dataset.requestedBackend = requested;

    try {
      await originalMount.call(this, canvas);
      const actual = internal.viewer?.getCapabilities().backend;
      if (actual) canvas.dataset.renderBackend = actual;
      canvas.dataset.backendAcceptance = actual === requested || requested === 'auto'
        ? 'matched'
        : 'mismatch';
      canvas.dispatchEvent(new CustomEvent('kyxos:backend-ready', {
        detail: { requested, actual },
      }));
    } catch (error) {
      canvas.dataset.backendAcceptance = 'failed';
      canvas.dataset.backendError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };

  prototype[installed] = true;
}
