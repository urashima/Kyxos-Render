import { KyxosViewer } from './KyxosViewer';

type VisibilityRecoveryPrototype = {
  scheduleWebGPUVisibilityRecovery(
    generation: number,
    reason: string,
    useSSAA: boolean,
  ): void;
  __kyxosNonBlockingVisibilityRecovery?: boolean;
};

type DeviceLostInfo = { message?: string; reason?: string };
type WatchedDevice = {
  lost?: Promise<DeviceLostInfo>;
};

type ViewerInternals = {
  backend?: string;
  disposed?: boolean;
  pipelineGeneration?: number;
  renderer?: {
    backend?: {
      device?: WatchedDevice;
    };
  };
  canvas?: HTMLCanvasElement;
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
 * that deterministic path and observe unexpected WebGPU device loss without
 * reading pixels back from the presentation canvas.
 *
 * WebGPU resolves device.lost both for unexpected loss and for an explicit
 * GPUDevice.destroy(). Three.js / Dawn can explicitly destroy a device wrapper
 * during backend lifecycle work while the active renderer continues to submit
 * frames through its valid presentation path. Treating that intentional
 * "destroyed" notification as a rendering failure silently replaces a healthy
 * realtime RT graph with the Beauty fallback. Therefore:
 *   - retired-device notifications are ignored by identity;
 *   - explicit/destroyed loss is diagnostic-only;
 *   - unknown/unexpected loss still activates recovery;
 *   - actual RenderPipeline exceptions remain the deterministic fallback path.
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

      if (viewer.renderer?.backend?.device !== device) {
        if (viewer.canvas) viewer.canvas.dataset.webgpuIgnoredRetiredDeviceLoss = 'true';
        return;
      }

      const reasonCode = String(info?.reason ?? '').trim().toLowerCase();
      const message = String(info?.message ?? '').trim();
      const explicitlyDestroyed =
        reasonCode === 'destroyed'
        || /^device was destroyed\.?$/i.test(message);

      if (explicitlyDestroyed) {
        if (viewer.canvas) {
          viewer.canvas.dataset.webgpuIgnoredDestroyedDeviceLoss = message || reasonCode || 'destroyed';
          delete viewer.canvas.dataset.webgpuCurrentDeviceLoss;
        }
        return;
      }

      const detail = message || reasonCode || reason || 'unknown';
      if (viewer.canvas) viewer.canvas.dataset.webgpuCurrentDeviceLoss = String(detail);
      viewer.activateWebGPURecovery?.(`device-lost:${detail}`);
    });
  };

  prototype.__kyxosNonBlockingVisibilityRecovery = true;
}
