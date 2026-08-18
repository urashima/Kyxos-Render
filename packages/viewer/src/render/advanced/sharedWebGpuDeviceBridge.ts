const SHARED_DEVICE_KEY = Symbol.for('kyxos.viewer.shared-webgpu-device');

export interface SharedWebGpuDeviceRecord {
  device: any;
  limits: Record<string, unknown>;
}

export function attachSharedWebGpuDevice(canvas: HTMLCanvasElement, renderer: any): void {
  const backend = renderer?.backend;
  const device = backend?.device;
  if (!canvas || backend?.isWebGPUBackend !== true || !device) return;
  (canvas as any)[SHARED_DEVICE_KEY] = {
    device,
    limits: device.limits as Record<string, unknown>,
  } satisfies SharedWebGpuDeviceRecord;
}

export function readSharedWebGpuDevice(canvas: HTMLCanvasElement): SharedWebGpuDeviceRecord | null {
  return ((canvas as any)?.[SHARED_DEVICE_KEY] as SharedWebGpuDeviceRecord | undefined) ?? null;
}

export function installSharedWebGpuDeviceBridge(ViewerClass: any): void {
  const originalCreate = ViewerClass?.create;
  if (typeof originalCreate !== 'function' || originalCreate.__kyxosSharedDeviceBridge) return;

  const bridgedCreate = async function sharedWebGpuCreate(this: any, ...args: any[]) {
    const viewer = await originalCreate.apply(this, args);
    attachSharedWebGpuDevice(viewer.canvas, viewer.renderer);
    return viewer;
  };
  bridgedCreate.__kyxosSharedDeviceBridge = true;
  ViewerClass.create = bridgedCreate;
}
