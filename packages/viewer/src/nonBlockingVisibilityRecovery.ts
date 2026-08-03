import { KyxosViewer } from './KyxosViewer';

type VisibilityRecoveryPrototype = {
  scheduleWebGPUVisibilityRecovery(
    generation: number,
    reason: string,
    useSSAA: boolean,
  ): void;
  __kyxosNonBlockingVisibilityRecovery?: boolean;
};

type ViewerInternals = {
  backend?: string;
  disposed?: boolean;
  pipelineGeneration?: number;
  renderer?: {
    backend?: {
      device?: {
        lost?: Promise<{ message?: string; reason?: string }>;
      };
    };
  };
  activateWebGPURecovery?(reason: string): void;
};

const watchedDevices = new WeakSet<object>();

/**
 * The legacy visibility recovery copied the WebGPU canvas into a 2D canvas and
 * synchronously called getImageData four seconds after every pipeline rebuild.
 * GPU-to-CPU canvas readback can permanently block Chromium/SwiftShader and
 * low-end drivers immediately after a successful GLB import.
 *
 * Runtime render exceptions already activate the Beauty-pass fallback. Keep
 * that deterministic path and observe WebGPU device loss without reading
 * pixels back from the presentation canvas.
 */
export function installNonBlockingVisibilityRecovery(
  ViewerClass: typeof KyxosViewer = KyxosViewer,
): void {
  const prototype = ViewerClass.prototype as unknown as VisibilityRecoveryPrototype;
  if (prototype.__kyxosNonBlockingVisibilityRecovery) return;

  prototype.scheduleWebGPUVisibilityRecovery = function nonBlockingVisibilityRecovery(
    generation,
    reason,
    useSSAA,
  ): void {
    const viewer = this as unknown as ViewerInternals;
    if (
      viewer.backend !== 'webgpu'
      || useSSAA
      || viewer.disposed
      || generation !== viewer.pipelineGeneration
    ) {
      return;
    }

    const device = viewer.renderer?.backend?.device;
    if (!device || typeof device !== 'object' || watchedDevices.has(device)) return;
    watchedDevices.add(device);

    const lost = device.lost;
    if (!lost || typeof lost.then !== 'function') return;
    void lost.then((info) => {
      if (viewer.disposed) return;
      const detail = info?.message || info?.reason || reason || 'unknown';
      viewer.activateWebGPURecovery?.(`device-lost:${detail}`);
    });
  };

  prototype.__kyxosNonBlockingVisibilityRecovery = true;
}
