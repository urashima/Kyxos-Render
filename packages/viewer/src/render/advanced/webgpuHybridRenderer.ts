import type { SceneAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import {
  WebGpuHybridRenderer as BaseWebGpuHybridRenderer,
  type AdvancedGpuMetrics,
  type AdvancedGpuRendererOptions,
} from './webgpuHybridRendererBase';
import type { AdvancedRendererCapabilities } from './backendCapabilities';
import { ADVANCED_STORAGE_BUFFERS_PER_STAGE } from './backendCapabilities';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64 };
const EXTENDED_GLOBAL_VEC4_COUNT = 12;

/**
 * Safety and control wrapper for the experimental advanced path.
 *
 * The normal Kyxos raster canvas is the authoritative visible fallback. The
 * WebGPU overlay is only revealed after the first frame passes a GPU validation
 * error scope. User-facing advanced controls are appended to the base renderer's
 * uniform block here so the Scene Contract stays backend independent.
 */
export class WebGpuHybridRenderer extends BaseWebGpuHybridRenderer {
  private firstFrameValidated = false;
  private validationPending = false;
  private validationFailure: Error | null = null;
  private extendedGlobalsReady = false;

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

    // BaseWebGpuHybridRenderer owns the common nine vec4 values. The unified
    // render-control surface adds three vec4s for light sampling, hybrid RT and
    // display/denoise controls. Replace the buffer before any scene bind groups
    // are built so the auto-layout sees a correctly sized uniform resource.
    if (!this.extendedGlobalsReady && this.device) {
      try { this.globalsBuffer?.destroy?.(); } catch { /* device may already be lost */ }
      this.globalsBuffer = this.device.createBuffer({
        label: 'Kyxos.Advanced.Globals',
        size: EXTENDED_GLOBAL_VEC4_COUNT * 16,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      });
      this.extendedGlobalsReady = true;
    }
    return capabilities;
  }

  setSettings(value: SceneAdvancedRenderSettings): void {
    const previous = this.controlSignature();
    super.setSettings(value);
    if (previous !== this.controlSignature()) this.resetAccumulation();
  }

  protected cameraData(camera: any): { data: Float32Array; signature: string } {
    const base = super.cameraData(camera);
    const data = new Float32Array(EXTENDED_GLOBAL_VEC4_COUNT * 4);
    data.set(base.data, 0);

    const lightSampling = this.settings.lightSampling;
    const rayTracing = this.settings.rayTracing;
    const pathTracing = this.settings.pathTracing;

    // features: environment importance, emissive triangle NEE, ray shadows, ray AO
    data.set([
      lightSampling.environmentImportance ? 1 : 0,
      lightSampling.emissiveTriangles ? 1 : 0,
      rayTracing.shadows ? 1 : 0,
      rayTracing.ambientOcclusion ? 1 : 0,
    ], 36);
    // rayInfo: reflections, shadow bias, AO radius, AO strength
    data.set([
      rayTracing.reflections ? 1 : 0,
      rayTracing.shadowBias,
      rayTracing.aoRadius,
      rayTracing.aoStrength,
    ], 40);
    // displayInfo: reflection roughness cutoff, denoise radius, denoise strength, reserved
    data.set([
      rayTracing.reflectionMaxRoughness,
      pathTracing.denoiseRadius,
      pathTracing.denoiseStrength,
      0,
    ], 44);

    return { data, signature: `${base.signature}|${this.controlSignature()}` };
  }

  private controlSignature(): string {
    const value = this.settings;
    return [
      value.lightSampling.environmentImportance ? 1 : 0,
      value.lightSampling.emissiveTriangles ? 1 : 0,
      value.rayTracing.shadows ? 1 : 0,
      value.rayTracing.shadowBias,
      value.rayTracing.ambientOcclusion ? 1 : 0,
      value.rayTracing.aoRadius,
      value.rayTracing.aoStrength,
      value.rayTracing.reflections ? 1 : 0,
      value.rayTracing.reflectionMaxRoughness,
      value.pathTracing.denoiseRadius,
      value.pathTracing.denoiseStrength,
    ].join('|');
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
