import {
  resolveAdvancedRendererCapabilities,
  type AdvancedRendererCapabilities,
} from './backendCapabilities';
import { readSharedWebGpuDevice } from './sharedWebGpuDeviceBridge';
import { WebGpuPackedRenderer } from './webgpuPackedRenderer';
import type { AdvancedGpuRendererOptions } from './webgpuPackedRenderer';
import {
  advancedPathTracingComputeWGSL,
  advancedPathTracingDisplayWGSL,
} from './webgpuShadersPortable';

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const TEXTURE_USAGE = (globalThis as any).GPUTextureUsage ?? { RENDER_ATTACHMENT: 16 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { COMPUTE: 4 };
const GLOBAL_VEC4_COUNT = 15;
const COMPUTE_BINDINGS_PER_GROUP = 9;

/**
 * Packed progressive renderer that reuses the GPUDevice already created by the
 * realtime Kyxos WebGPURenderer. This keeps PT a reference presentation mode
 * without creating a second adapter/device or competing device lifecycle.
 */
export class WebGpuSharedPackedRenderer extends WebGpuPackedRenderer {
  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
  }

  async initialize(): Promise<AdvancedRendererCapabilities> {
    const runtime = this as any;
    if (runtime.disposed) throw new Error('Advanced renderer has been disposed.');
    if (runtime.initialized && this.device) {
      return resolveAdvancedRendererCapabilities('webgpu', this.device.limits as Record<string, unknown>);
    }

    const shared = readSharedWebGpuDevice(this.baseCanvas);
    if (!shared?.device) {
      throw new Error('Realtime WebGPU device bridge is unavailable.');
    }

    this.device = shared.device;
    this.adapter = { limits: shared.limits };
    const capabilities = resolveAdvancedRendererCapabilities('webgpu', shared.limits);
    if (!capabilities.softwareRayQuery) {
      throw new Error(capabilities.reason ?? 'Shared WebGPU device does not expose the packed RT baseline.');
    }

    const maxBindings = Number((shared.limits as any)?.maxBindingsPerBindGroup ?? 0);
    if (maxBindings > 0 && maxBindings < COMPUTE_BINDINGS_PER_GROUP) {
      throw new Error(
        `Shared WebGPU device exposes ${maxBindings} bindings per bind group; packed PT requires ${COMPUTE_BINDINGS_PER_GROUP}.`,
      );
    }

    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    const context = this.overlay.getContext('webgpu') as any;
    if (!context) throw new Error('Unable to create WebGPU path-tracing canvas context.');
    const format = gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    context.configure({
      device: this.device,
      format,
      alphaMode: 'opaque',
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
    runtime.context = context;
    runtime.format = format;

    try { this.globalsBuffer?.destroy?.(); } catch { /* ignored */ }
    this.globalsBuffer = this.device.createBuffer({
      label: 'Kyxos.Advanced.SharedPackedGlobals',
      size: GLOBAL_VEC4_COUNT * 16,
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });

    const computeModule = this.device.createShaderModule({
      label: 'Kyxos.Advanced.SharedPackedPathCompute',
      code: advancedPathTracingComputeWGSL,
    });
    const displayModule = this.device.createShaderModule({
      label: 'Kyxos.Advanced.SharedPackedDisplay',
      code: advancedPathTracingDisplayWGSL,
    });

    const readOnlyStorage = new Set([1, 2, 4, 6]);
    const bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Kyxos.Advanced.SharedPackedPathBindGroupLayout',
      entries: Array.from({ length: COMPUTE_BINDINGS_PER_GROUP }, (_, binding) => ({
        binding,
        visibility: SHADER_STAGE.COMPUTE,
        buffer: binding === 0
          ? { type: 'uniform' }
          : { type: readOnlyStorage.has(binding) ? 'read-only-storage' : 'storage' },
      })),
    });
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Kyxos.Advanced.SharedPackedPathPipelineLayout',
      bindGroupLayouts: [bindGroupLayout],
    });

    // Shared devices must not manipulate Three.js' GPU error-scope stack.
    // Async pipeline creation itself rejects on shader/pipeline validation errors.
    runtime.computePipeline = typeof this.device.createComputePipelineAsync === 'function'
      ? await this.device.createComputePipelineAsync({
          label: 'Kyxos.Advanced.SharedPackedPathPipeline',
          layout: pipelineLayout,
          compute: { module: computeModule, entryPoint: 'main' },
        })
      : this.device.createComputePipeline({
          label: 'Kyxos.Advanced.SharedPackedPathPipeline',
          layout: pipelineLayout,
          compute: { module: computeModule, entryPoint: 'main' },
        });
    runtime.computePipeline.getBindGroupLayout(0);

    runtime.displayPipeline = this.device.createRenderPipeline({
      label: 'Kyxos.Advanced.SharedPackedDisplayPipeline',
      layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vertexMain' },
      fragment: { module: displayModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    runtime.displayPipeline.getBindGroupLayout(0);

    runtime.initialized = true;
    return capabilities;
  }
}
