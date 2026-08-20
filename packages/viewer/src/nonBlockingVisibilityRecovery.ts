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
 * that deterministic path and observe WebGPU device loss without reading
 * pixels back from the presentation canvas.
 *
 * A WebGPU renderer may replace its device while an older device.lost Promise
 * is still pending. A normal destroy of that retired device must not recover a
 * newer healthy renderer to Beauty. Only the device that is still installed on
 * the active renderer is allowed to trigger the fallback.
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

      // Three/WebGPU can retire and destroy a previous GPUDevice during a
      // renderer/backend rebuild. device.lost resolves asynchronously, so
      // reject that stale notification if the Viewer has already installed a
      // different live device. Without this identity check a healthy realtime
      // RT renderer can be silently replaced by the Beauty fallback.
      if (viewer.renderer?.backend?.device !== device) {
        if (viewer.canvas) viewer.canvas.dataset.webgpuIgnoredRetiredDeviceLoss = 'true';
        return;
      }

      const detail = info?.message || info?.reason || reason || 'unknown';
      if (viewer.canvas) viewer.canvas.dataset.webgpuCurrentDeviceLoss = String(detail);
      viewer.activateWebGPURecovery?.(`device-lost:${detail}`);
    });
  };

  prototype.__kyxosNonBlockingVisibilityRecovery = true;
}
