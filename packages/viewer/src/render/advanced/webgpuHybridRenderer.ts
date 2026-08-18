import {
  WebGpuHybridRenderer as BaseWebGpuHybridRenderer,
  type AdvancedGpuMetrics,
  type AdvancedGpuRendererOptions,
} from './webgpuHybridRendererBase';
import type { AdvancedRendererCapabilities } from './backendCapabilities';
import { ADVANCED_STORAGE_BUFFERS_PER_STAGE } from './backendCapabilities';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

/**
 * Safety wrapper for the experimental advanced path.
 *
 * The normal Kyxos raster canvas is the authoritative visible fallback. The
 * WebGPU overlay is only revealed after the first frame passes a GPU validation
 * error scope. This prevents an invalid compute pipeline from covering a healthy
 * raster frame with an opaque black canvas.
 */
export class WebGpuHybridRenderer extends BaseWebGpuHybridRenderer {
  private firstFrameValidated = false;
  private validationPending = false;
  private validationFailure: Error | null = null;

  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
    this.overlay.style.visibility = 'hidden';
  }

  async initialize(): Promise<AdvancedRendererCapabilities> {
    const capabilities = await super.initialize();
    const actualStorageBudget = Number(this.device?.limits?.maxStorageBuffersPerShaderStage ?? 0);
    if (actualStorageBudget < ADVANCED_STORAGE_BUFFERS_PER_STAGE) {
      this.hide();
      throw new Error(
        `Advanced WebGPU device exposes ${actualStorageBudget} storage buffers per shader stage; ` +
        `the current Kyxos RT pipeline requires ${ADVANCED_STORAGE_BUFFERS_PER_STAGE}. High raster fallback remains active.`,
      );
    }
    return capabilities;
  }

  render(camera: any, mode: 'cinematic' | 'pathTracing'): AdvancedGpuMetrics | null {
    if (this.validationFailure) {
      this.hide();
      throw this.validationFailure;
    }

    if (this.firstFrameValidated) {
      this.overlay.style.visibility = 'visible';
      return super.render(camera, mode);
    }

    if (this.validationPending) return null;
    this.validationPending = true;
    this.overlay.style.visibility = 'hidden';
    this.device?.pushErrorScope?.('validation');

    let metrics: AdvancedGpuMetrics | null = null;
    try {
      metrics = super.render(camera, mode);
    } catch (error) {
      this.validationPending = false;
      this.hide();
      throw error;
    }

    const scope = this.device?.popErrorScope?.();
    if (!scope || typeof scope.then !== 'function') {
      this.validationPending = false;
      this.firstFrameValidated = true;
      this.overlay.style.visibility = 'visible';
      return metrics;
    }

    void scope.then((gpuError: { message?: string } | null) => {
      this.validationPending = false;
      if (gpuError) {
        this.validationFailure = new Error(`Advanced WebGPU validation failed: ${gpuError.message ?? 'unknown validation error'}`);
        this.hide();
        return;
      }
      this.firstFrameValidated = true;
      this.overlay.style.visibility = 'visible';
    }).catch((error: unknown) => {
      this.validationPending = false;
      this.validationFailure = error instanceof Error ? error : new Error(String(error));
      this.hide();
    });

    return metrics;
  }

  hide(): void {
    this.overlay.style.visibility = 'hidden';
    super.hide();
  }
}
