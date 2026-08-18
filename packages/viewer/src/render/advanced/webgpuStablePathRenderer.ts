import {
  ADVANCED_STORAGE_BUFFERS_PER_STAGE,
  resolveAdvancedRendererCapabilities,
  type AdvancedRendererCapabilities,
} from './backendCapabilities';
import { readSharedWebGpuDevice } from './sharedWebGpuDeviceBridge';
import { WebGpuPackedRenderer } from './webgpuPackedRenderer';
import type { AdvancedGpuMetrics, AdvancedGpuRendererOptions } from './webgpuPackedRenderer';
import {
  advancedPathTracingComputeWGSL,
  advancedPathTracingDisplayWGSL,
} from './webgpuShadersPortable';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

const MIN_VISIBLE_SAMPLES = 8;
const MIN_STABLE_FRAMES = 2;
const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64 };
const TEXTURE_USAGE = (globalThis as any).GPUTextureUsage ?? { RENDER_ATTACHMENT: 16 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { COMPUTE: 4 };
const GLOBAL_VEC4_COUNT = 15;
const COMPUTE_BINDINGS_PER_GROUP = 9;

function cameraSignature(camera: any): string {
  camera.updateMatrixWorld?.(true);
  const world = camera.matrixWorld?.elements ?? [];
  const projection = camera.projectionMatrix?.elements ?? [];
  return [...world, ...projection]
    .map((value) => Number(value).toFixed(5))
    .join('|');
}

function diagnosticTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Instance dropped/i.test(message);
}

function compilationErrors(info: any): string | null {
  const messages = (info?.messages ?? []).filter((entry: any) => entry?.type === 'error');
  if (!messages.length) return null;
  return messages.slice(0, 8).map((entry: any) => {
    const location = entry?.lineNum ? `:${entry.lineNum}${entry?.linePos ? `:${entry.linePos}` : ''}` : '';
    return `${location} ${String(entry?.message ?? 'WGSL compilation error')}`.trim();
  }).join(' · ');
}

async function optionalCompilationErrors(module: any): Promise<string | null> {
  if (typeof module?.getCompilationInfo !== 'function') return null;
  try {
    return compilationErrors(await module.getCompilationInfo());
  } catch (error) {
    if (diagnosticTransportFailure(error)) return null;
    throw error;
  }
}

/**
 * Progressive PT is a reference/capture renderer, not the interactive viewport.
 * It reuses the WebGPUDevice already owned by the realtime Kyxos renderer,
 * avoiding a second adapter/device lifecycle and keeping GPU capability/resource
 * ownership aligned with the authoritative viewport.
 *
 * While the camera moves the realtime image stays visible. Once the camera is
 * stable, PT accumulates behind it and is revealed only after a small stable
 * sample floor so users never see the 1-spp flashing phase.
 */
export class WebGpuStablePathRenderer extends WebGpuPackedRenderer {
  private stableCameraSignature = '';
  private stableFrames = 0;

  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
  }

  async initialize(): Promise<AdvancedRendererCapabilities> {
    const shared = readSharedWebGpuDevice(this.baseCanvas);
    if (!shared?.device) return super.initialize();

    const runtime = this as any;
    if (runtime.disposed) throw new Error('Advanced renderer has been disposed.');
    if (runtime.initialized && this.device) {
      return resolveAdvancedRendererCapabilities('webgpu', shared.limits);
    }

    const capabilities = resolveAdvancedRendererCapabilities('webgpu', shared.limits);
    if (!capabilities.softwareRayQuery) {
      throw new Error(capabilities.reason ?? 'WebGPU RT Enhanced limits are unavailable.');
    }
    if (Number(shared.limits.maxStorageBuffersPerShaderStage ?? 0) < ADVANCED_STORAGE_BUFFERS_PER_STAGE) {
      throw new Error(capabilities.reason ?? 'The realtime WebGPU device does not expose the packed RT storage-buffer budget.');
    }
    const maxBindings = Number(shared.limits.maxBindingsPerBindGroup ?? 0);
    if (maxBindings > 0 && maxBindings < COMPUTE_BINDINGS_PER_GROUP) {
      throw new Error(
        `Realtime WebGPU device exposes ${maxBindings} bindings per bind group; Kyxos PT requires ${COMPUTE_BINDINGS_PER_GROUP}.`,
      );
    }

    this.adapter = { limits: shared.limits };
    this.device = shared.device;

    // Dawn/SwiftShader can expose WebGPU successfully while its diagnostic
    // plumbing rejects popErrorScope() with "Instance dropped". That is not a
    // GPU validation result. Normalize only this transport failure globally on
    // the shared device; real GPUValidationError objects still propagate.
    const originalPopErrorScope = this.device?.popErrorScope?.bind(this.device);
    if (originalPopErrorScope && !(this.device as any).__kyxosSafeErrorScope) {
      try {
        this.device.popErrorScope = () => originalPopErrorScope().catch((error: unknown) => {
          if (diagnosticTransportFailure(error)) return null;
          throw error;
        });
        (this.device as any).__kyxosSafeErrorScope = true;
      } catch {
        // Some implementations expose non-writable host methods. Local callers
        // still handle the same transport failure below.
      }
    }

    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    const context = this.overlay.getContext('webgpu') as any;
    if (!context) throw new Error('Unable to create WebGPU canvas context.');
    const format = gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    context.configure({
      device: this.device,
      format,
      alphaMode: 'opaque',
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
    runtime.context = context;
    runtime.format = format;

    try { this.globalsBuffer?.destroy?.(); } catch { /* shared device may already be lost */ }
    this.globalsBuffer = this.device.createBuffer({
      label: 'Kyxos.Advanced.SharedPackedGlobals',
      size: GLOBAL_VEC4_COUNT * 16,
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });

    const computeModule = this.device.createShaderModule({
      label: 'Kyxos.Advanced.SharedPathCompute',
      code: advancedPathTracingComputeWGSL,
    });
    const displayModule = this.device.createShaderModule({
      label: 'Kyxos.Advanced.SharedDisplay',
      code: advancedPathTracingDisplayWGSL,
    });
    const computeErrors = await optionalCompilationErrors(computeModule);
    if (computeErrors) throw new Error(`Advanced WGSL compilation failed: ${computeErrors}`);
    const displayErrors = await optionalCompilationErrors(displayModule);
    if (displayErrors) throw new Error(`Advanced display WGSL compilation failed: ${displayErrors}`);

    const readOnlyStorage = new Set([1, 2, 4, 6]);
    const bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Kyxos.Advanced.SharedPathBindGroupLayout',
      entries: Array.from({ length: COMPUTE_BINDINGS_PER_GROUP }, (_, binding) => ({
        binding,
        visibility: SHADER_STAGE.COMPUTE,
        buffer: binding === 0
          ? { type: 'uniform' }
          : { type: readOnlyStorage.has(binding) ? 'read-only-storage' : 'storage' },
      })),
    });
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Kyxos.Advanced.SharedPathPipelineLayout',
      bindGroupLayouts: [bindGroupLayout],
    });

    let thrown: unknown = null;
    let validationError: any = null;
    this.device.pushErrorScope?.('validation');
    try {
      runtime.computePipeline = typeof this.device.createComputePipelineAsync === 'function'
        ? await this.device.createComputePipelineAsync({
            label: 'Kyxos.Advanced.SharedPathPipeline',
            layout: pipelineLayout,
            compute: { module: computeModule, entryPoint: 'main' },
          })
        : this.device.createComputePipeline({
            label: 'Kyxos.Advanced.SharedPathPipeline',
            layout: pipelineLayout,
            compute: { module: computeModule, entryPoint: 'main' },
          });
      runtime.computePipeline.getBindGroupLayout(0);
      runtime.displayPipeline = this.device.createRenderPipeline({
        label: 'Kyxos.Advanced.SharedDisplayPipeline',
        layout: 'auto',
        vertex: { module: displayModule, entryPoint: 'vertexMain' },
        fragment: { module: displayModule, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      runtime.displayPipeline.getBindGroupLayout(0);
    } catch (error) {
      thrown = error;
    }
    try {
      validationError = await this.device.popErrorScope?.();
    } catch (error) {
      if (!diagnosticTransportFailure(error)) validationError = error;
    }
    if (thrown || validationError) {
      const detail = [thrown, validationError]
        .filter(Boolean)
        .map((error) => error instanceof Error ? error.message : String((error as any)?.message ?? error))
        .join(' · ');
      throw new Error(`Advanced shared-device pipeline validation failed: ${detail || 'unknown validation error'}`);
    }

    runtime.initialized = true;
    return capabilities;
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
