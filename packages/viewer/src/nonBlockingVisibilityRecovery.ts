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
 * GPUDevice.lost also resolves when an application intentionally calls
 * GPUDevice.destroy(), with the standardized reason "destroyed". That lifecycle
 * event is not an unexpected adapter/driver loss and must not silently replace
 * an otherwise healthy realtime RT graph with the Beauty fallback. We use the
 * standardized reason field only; the implementation-defined message remains
 * diagnostic text and is never parsed for control flow.
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

      if (reasonCode === 'destroyed') {
        if (viewer.canvas) {
          viewer.canvas.dataset.webgpuIgnoredDestroyedDeviceLoss = reasonCode;
          viewer.canvas.dataset.webgpuDestroyedDeviceMessage = message;
          delete viewer.canvas.dataset.webgpuCurrentDeviceLoss;
        }
        return;
      }

      const detail = message || reasonCode || reason || 'unknown';
      if (viewer.canvas) {
        viewer.canvas.dataset.webgpuCurrentDeviceLoss = String(detail);
        viewer.canvas.dataset.webgpuCurrentDeviceLossReason = reasonCode || 'unknown';
      }
      viewer.activateWebGPURecovery?.(`device-lost:${detail}`);
    });
  };

  prototype.__kyxosNonBlockingVisibilityRecovery = true;
}
