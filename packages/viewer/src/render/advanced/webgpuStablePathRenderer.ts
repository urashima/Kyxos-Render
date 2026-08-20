import { WebGpuSharedPackedRenderer } from './webgpuSharedPackedRenderer';
import type { AdvancedGpuMetrics, AdvancedGpuRendererOptions } from './webgpuPackedRenderer';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

const MIN_VISIBLE_SAMPLES = 8;
const MIN_STABLE_FRAMES = 2;

function cameraSignature(camera: any): string {
  camera.updateMatrixWorld?.(true);
  const world = camera.matrixWorld?.elements ?? [];
  const projection = camera.projectionMatrix?.elements ?? [];
  return [...world, ...projection]
    .map((value) => Number(value).toFixed(5))
    .join('|');
}

/**
 * Progressive PT is a reference/capture renderer, not the interactive viewport.
 * It reuses the WebGPUDevice already owned by realtime through
 * WebGpuSharedPackedRenderer. No adapter/device is created here and no shared
 * GPU error-scope methods are patched.
 *
 * During camera motion the realtime image remains authoritative. PT is hidden,
 * resets accumulation, then only becomes visible after the camera has settled
 * and a minimum stable sample floor has been accumulated.
 */
export class WebGpuStablePathRenderer extends WebGpuSharedPackedRenderer {
  private stableCameraSignature = '';
  private stableFrames = 0;

  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
  }

  render(camera: any, mode: 'cinematic' | 'pathTracing'): AdvancedGpuMetrics | null {
    if (mode !== 'pathTracing') return super.render(camera, mode);

    const signature = cameraSignature(camera);
    if (!this.stableCameraSignature || signature !== this.stableCameraSignature) {
      this.stableCameraSignature = signature;
      this.stableFrames = 0;
      this.resetAccumulation();
      this.hide();
      return null;
    }

    this.stableFrames += 1;
    const metrics = super.render(camera, mode);
    if (!metrics || this.stableFrames < MIN_STABLE_FRAMES || metrics.samples < MIN_VISIBLE_SAMPLES) {
      this.hide();
      return metrics;
    }
    return metrics;
  }

  resetAccumulation(): void {
    super.resetAccumulation();
    this.stableFrames = 0;
  }
}
