import type { SceneAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import {
  WebGpuHybridRenderer as BaseWebGpuHybridRenderer,
  type AdvancedGpuMetrics,
  type AdvancedGpuRendererOptions,
} from './webgpuHybridRendererBase';
import type { AdvancedRendererCapabilities } from './backendCapabilities';
import { ADVANCED_STORAGE_BUFFERS_PER_STAGE } from './backendCapabilities';
import { advancedPathTracingComputeWGSL } from './webgpuShadersPortable';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { COMPUTE: 4 };
const EXTENDED_GLOBAL_VEC4_COUNT = 12;
const ADVANCED_BINDINGS_PER_GROUP = 16;

interface CompilationMessageLike {
  type?: string;
  message?: string;
  lineNum?: number;
  linePos?: number;
}

function compilationErrorText(messages: readonly CompilationMessageLike[] | undefined): string | null {
  const errors = (messages ?? []).filter((entry) => entry.type === 'error');
  if (!errors.length) return null;
  return errors
    .slice(0, 6)
    .map((entry) => {
      const location = entry.lineNum ? `:${entry.lineNum}${entry.linePos ? `:${entry.linePos}` : ''}` : '';
      return `${location} ${entry.message ?? 'WGSL compilation error'}`.trim();
    })
    .join(' · ');
}

/**
 * Safety and control wrapper for the experimental advanced path.
 *
 * The normal Kyxos raster canvas is the authoritative visible fallback. The
 * WebGPU overlay is only revealed after initialization and first-frame GPU
 * validation succeed. Complex mobile WebGPU implementations are preflighted
 * with an explicit compute layout instead of relying on auto-layout inference.
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
    const actualBindingBudget = Number(this.device?.limits?.maxBindingsPerBindGroup ?? 0);
    if (actualBindingBudget > 0 && actualBindingBudget < ADVANCED_BINDINGS_PER_GROUP) {
      this.hide();
      throw new Error(
        `Advanced WebGPU device exposes ${actualBindingBudget} bindings per bind group; ` +
        `the current Kyxos RT pipeline requires ${ADVANCED_BINDINGS_PER_GROUP}. High raster fallback remains active.`,
      );
    }

    // BaseWebGpuHybridRenderer owns the common nine vec4 values. The unified
    // render-control surface adds three vec4s for light sampling, hybrid RT and
    // display/denoise controls. Replace the buffer before any scene bind groups
    // are built so the shader receives the complete uniform block.
    if (!this.extendedGlobalsReady && this.device) {
      try { this.globalsBuffer?.destroy?.(); } catch { /* device may already be lost */ }
      this.globalsBuffer = this.device.createBuffer({
        label: 'Kyxos.Advanced.Globals',
        size: EXTENDED_GLOBAL_VEC4_COUNT * 16,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      });
      this.extendedGlobalsReady = true;
    }

    // WebKit/mobile Metal drivers have proven less forgiving of a large
    // auto-derived compute bind-group layout. Rebuild the compute pipeline with
    // the exact contract used by rebuildBindGroups(), then force layout
    // realization while an error scope is active. If this fails, initialization
    // fails cleanly and the normal realtime canvas stays authoritative.
    await this.installPortableComputePipeline();
    await this.preflightPipelineLayouts();
    return capabilities;
  }

  private async installPortableComputePipeline(): Promise<void> {
    if (!this.device) throw new Error('Advanced WebGPU device is unavailable.');
    const device = this.device;
    const module = device.createShaderModule({
      label: 'Kyxos.Advanced.PathCompute.Portable',
      code: advancedPathTracingComputeWGSL,
    });

    if (typeof module.getCompilationInfo === 'function') {
      const info = await module.getCompilationInfo();
      const text = compilationErrorText(info?.messages);
      if (text) {
        throw new Error(`Advanced WGSL compilation failed: ${text}`);
      }
    }

    const readOnlyStorage = new Set([1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 14]);
    const entries = Array.from({ length: ADVANCED_BINDINGS_PER_GROUP }, (_, binding) => ({
      binding,
      visibility: SHADER_STAGE.COMPUTE,
      buffer: binding === 0
        ? { type: 'uniform' }
        : { type: readOnlyStorage.has(binding) ? 'read-only-storage' : 'storage' },
    }));

    let validationError: unknown = null;
    let thrown: unknown = null;
    device.pushErrorScope?.('validation');
    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: 'Kyxos.Advanced.PathBindGroupLayout',
        entries,
      });
      const pipelineLayout = device.createPipelineLayout({
        label: 'Kyxos.Advanced.PathPipelineLayout',
        bindGroupLayouts: [bindGroupLayout],
      });
      const descriptor = {
        label: 'Kyxos.Advanced.PathPipeline.Portable',
        layout: pipelineLayout,
        compute: { module, entryPoint: 'main' },
      };
      const pipeline = typeof device.createComputePipelineAsync === 'function'
        ? await device.createComputePipelineAsync(descriptor)
        : device.createComputePipeline(descriptor);
      pipeline.getBindGroupLayout(0);
      (this as unknown as { computePipeline: unknown }).computePipeline = pipeline;
    } catch (error) {
      thrown = error;
    }
    try {
      validationError = await device.popErrorScope?.();
    } catch (error) {
      validationError = validationError ?? error;
    }

    if (thrown || validationError) {
      const detail = [thrown, validationError]
        .filter(Boolean)
        .map((error) => error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error))
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .join(' · ');
      throw new Error(`Advanced WebGPU compute pipeline validation failed: ${detail || 'unknown validation error'}`);
    }
  }

  private async preflightPipelineLayouts(): Promise<void> {
    if (!this.device) throw new Error('Advanced WebGPU device is unavailable.');
    const device = this.device;
    const runtime = this as unknown as {
      computePipeline?: { getBindGroupLayout(index: number): unknown };
      displayPipeline?: { getBindGroupLayout(index: number): unknown };
    };
    let thrown: unknown = null;
    let gpuError: unknown = null;
    device.pushErrorScope?.('validation');
    try {
      runtime.computePipeline?.getBindGroupLayout(0);
      runtime.displayPipeline?.getBindGroupLayout(0);
    } catch (error) {
      thrown = error;
    }
    try {
      gpuError = await device.popErrorScope?.();
    } catch (error) {
      gpuError = gpuError ?? error;
    }
    if (thrown || gpuError) {
      const detail = [thrown, gpuError]
        .filter(Boolean)
        .map((error) => error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error))
        .join(' · ');
      throw new Error(`Advanced WebGPU pipeline preflight failed: ${detail || 'invalid pipeline layout'}`);
    }
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