import { WebGpuPackedRenderer } from './webgpuPackedRenderer';
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
 * While the camera moves the authoritative realtime image stays visible. Once
 * the camera is stable, PT accumulates behind it and is revealed only after a
 * small stable sample floor so users never see the 1-spp flashing phase.
 */
export class WebGpuStablePathRenderer extends WebGpuPackedRenderer {
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
