import type { SceneAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import type { ExtractedAdvancedScene } from './sceneExtraction';
import {
  ADVANCED_STORAGE_BUFFERS_PER_STAGE,
  resolveAdvancedRendererCapabilities,
  type AdvancedRendererCapabilities,
} from './backendCapabilities';
import {
  WebGpuHybridRenderer as BaseWebGpuHybridRenderer,
  type AdvancedGpuMetrics,
  type AdvancedGpuRendererOptions,
} from './webgpuHybridRendererBase';
import {
  advancedPathTracingComputeWGSL,
  advancedPathTracingDisplayWGSL,
} from './webgpuShadersPortable';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const TEXTURE_USAGE = (globalThis as any).GPUTextureUsage ?? { RENDER_ATTACHMENT: 16 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { COMPUTE: 4 };
const GLOBAL_VEC4_COUNT = 15;
const COMPUTE_BINDINGS_PER_GROUP = 9;

interface PackedLayout {
  static0: [number, number, number, number];
  static1: [number, number, number, number];
  dynamic: [number, number, number, number];
}

interface PackedPool {
  data: Float32Array;
  offsets: number[];
}

function align4(value: number): number {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

function destroyBuffer(buffer: any): void {
  try { buffer?.destroy?.(); } catch { /* device may already be lost */ }
}

function packFloatPools(arrays: readonly Float32Array[]): PackedPool {
  const offsets: number[] = [];
  let totalFloats = 0;
  for (const array of arrays) {
    offsets.push(totalFloats / 4);
    totalFloats += align4(array.length);
  }
  const data = new Float32Array(Math.max(4, totalFloats));
  let cursor = 0;
  for (const array of arrays) {
    data.set(array, cursor);
    cursor += align4(array.length);
  }
  return { data, offsets };
}

function compilationErrors(info: any): string | null {
  const messages = (info?.messages ?? []).filter((entry: any) => entry?.type === 'error');
  if (!messages.length) return null;
  return messages.slice(0, 8).map((entry: any) => {
    const location = entry?.lineNum ? `:${entry.lineNum}${entry?.linePos ? `:${entry.linePos}` : ''}` : '';
    return `${location} ${String(entry?.message ?? 'WGSL compilation error')}`.trim();
  }).join(' · ');
}

/**
 * Advanced renderer using the WebGPU baseline of eight storage buffers per
 * shader stage. Static records are packed into one vec4 pool and instance/TLAS
 * records into a second pool; temporal histories remain separate so ReSTIR and
 * accumulation can ping-pong without copying the full scene.
 */
export class WebGpuPackedRenderer extends BaseWebGpuHybridRenderer {
  private firstFrameValidated = false;
  private validationPending = false;
  private validationFailure: Error | null = null;
  private packedLayout: PackedLayout = {
    static0: [0, 0, 0, 0],
    static1: [0, 0, 0, 0],
    dynamic: [0, 0, 0, 0],
  };

  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
    this.overlay.style.visibility = 'hidden';

    // Base helpers are TypeScript-private, not ECMAScript #private. Installing
    // these packed implementations keeps setScene(), resize and dispose on the
    // same public renderer API while replacing only the GPU resource layout.
    const runtime = this as any;
    runtime.uploadScene = (scene: ExtractedAdvancedScene) => this.uploadPackedScene(scene);
    runtime.destroySceneBuffers = () => this.destroyPackedSceneBuffers();
    runtime.rebuildBindGroups = () => this.rebuildPackedBindGroups();
  }

  async initialize(): Promise<AdvancedRendererCapabilities> {
    const runtime = this as any;
    if (runtime.disposed) throw new Error('Advanced renderer has been disposed.');
    if (runtime.initialized && this.adapter) {
      return resolveAdvancedRendererCapabilities('webgpu', this.adapter.limits as Record<string, unknown>);
    }

    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    if (!gpu?.requestAdapter) throw new Error('WebGPU is unavailable.');
    this.adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!this.adapter) throw new Error('No WebGPU adapter is available.');

    const capabilities = resolveAdvancedRendererCapabilities(
      'webgpu',
      this.adapter.limits as Record<string, unknown>,
    );
    if (!capabilities.softwareRayQuery) {
      throw new Error(capabilities.reason ?? 'WebGPU RT Enhanced limits are unavailable.');
    }

    const maxBindings = Number(this.adapter.limits?.maxBindingsPerBindGroup ?? 0);
    if (maxBindings > 0 && maxBindings < COMPUTE_BINDINGS_PER_GROUP) {
      throw new Error(
        `WebGPU adapter exposes ${maxBindings} bindings per bind group; Kyxos packed RT requires ${COMPUTE_BINDINGS_PER_GROUP}.`,
      );
    }

    this.device = await this.adapter.requestDevice({
      requiredLimits: {
        maxStorageBuffersPerShaderStage: ADVANCED_STORAGE_BUFFERS_PER_STAGE,
      },
    });
    this.device.lost?.then?.((info: any) => {
      if (runtime.disposed) return;
      runtime.initialized = false;
      this.overlay.style.display = 'none';
      runtime.options?.onDeviceLost?.(
        `Advanced WebGPU device lost: ${String(info?.message ?? info?.reason ?? 'unknown reason')}`,
      );
    });

    const context = this.overlay.getContext('webgpu') as any;
    if (!context) throw new Error('Unable to create WebGPU canvas context.');
    const format = gpu.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    context.configure({
      device: this.device,
      format,
      alphaMode: 'opaque',
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
    runtime.context = context;
    runtime.format = format;

    destroyBuffer(this.globalsBuffer);
    this.globalsBuffer = this.device.createBuffer({
      label: 'Kyxos.Advanced.PackedGlobals',
      size: GLOBAL_VEC4_COUNT * 16,
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });

    const computeModule = this.device.createShaderModule({
      label: 'Kyxos.Advanced.PackedPathCompute',
      code: advancedPathTracingComputeWGSL,
    });
    const displayModule = this.device.createShaderModule({
      label: 'Kyxos.Advanced.PackedDisplay',
      code: advancedPathTracingDisplayWGSL,
    });
    if (typeof computeModule.getCompilationInfo === 'function') {
      const text = compilationErrors(await computeModule.getCompilationInfo());
      if (text) throw new Error(`Advanced WGSL compilation failed: ${text}`);
    }
    if (typeof displayModule.getCompilationInfo === 'function') {
      const text = compilationErrors(await displayModule.getCompilationInfo());
      if (text) throw new Error(`Advanced display WGSL compilation failed: ${text}`);
    }

    const readOnlyStorage = new Set([1, 2, 4, 6]);
    const bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Kyxos.Advanced.PackedPathBindGroupLayout',
      entries: Array.from({ length: COMPUTE_BINDINGS_PER_GROUP }, (_, binding) => ({
        binding,
        visibility: SHADER_STAGE.COMPUTE,
        buffer: binding === 0
          ? { type: 'uniform' }
          : { type: readOnlyStorage.has(binding) ? 'read-only-storage' : 'storage' },
      })),
    });
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Kyxos.Advanced.PackedPathPipelineLayout',
      bindGroupLayouts: [bindGroupLayout],
    });

    let validationError: any = null;
    let thrown: unknown = null;
    this.device.pushErrorScope?.('validation');
    try {
      runtime.computePipeline = typeof this.device.createComputePipelineAsync === 'function'
        ? await this.device.createComputePipelineAsync({
            label: 'Kyxos.Advanced.PackedPathPipeline',
            layout: pipelineLayout,
            compute: { module: computeModule, entryPoint: 'main' },
          })
        : this.device.createComputePipeline({
            label: 'Kyxos.Advanced.PackedPathPipeline',
            layout: pipelineLayout,
            compute: { module: computeModule, entryPoint: 'main' },
          });
      runtime.computePipeline.getBindGroupLayout(0);
      runtime.displayPipeline = this.device.createRenderPipeline({
        label: 'Kyxos.Advanced.PackedDisplayPipeline',
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
      validationError = validationError ?? error;
    }
    if (thrown || validationError) {
      const detail = [thrown, validationError]
        .filter(Boolean)
        .map((error) => error instanceof Error ? error.message : String((error as any)?.message ?? error))
        .join(' · ');
      throw new Error(`Advanced WebGPU packed pipeline validation failed: ${detail || 'unknown validation error'}`);
    }

    runtime.initialized = true;
    return capabilities;
  }

  setSettings(value: SceneAdvancedRenderSettings): void {
    const previous = this.controlSignature();
    super.setSettings(value);
    if (previous !== this.controlSignature()) this.resetAccumulation();
  }

  protected cameraData(camera: any): { data: Float32Array; signature: string } {
    const base = super.cameraData(camera);
    const data = new Float32Array(GLOBAL_VEC4_COUNT * 4);
    data.set(base.data, 0);

    const lightSampling = this.settings.lightSampling;
    const rayTracing = this.settings.rayTracing;
    const pathTracing = this.settings.pathTracing;
    data.set([
      lightSampling.environmentImportance ? 1 : 0,
      lightSampling.emissiveTriangles ? 1 : 0,
      rayTracing.shadows ? 1 : 0,
      rayTracing.ambientOcclusion ? 1 : 0,
    ], 36);
    data.set([
      rayTracing.reflections ? 1 : 0,
      rayTracing.shadowBias,
      rayTracing.aoRadius,
      rayTracing.aoStrength,
    ], 40);
    data.set([
      rayTracing.reflectionMaxRoughness,
      pathTracing.denoiseRadius,
      pathTracing.denoiseStrength,
      0,
    ], 44);
    data.set(this.packedLayout.static0, 48);
    data.set(this.packedLayout.static1, 52);
    data.set(this.packedLayout.dynamic, 56);

    const layoutSignature = [
      ...this.packedLayout.static0,
      ...this.packedLayout.static1,
      ...this.packedLayout.dynamic,
    ].join(',');
    return {
      data,
      signature: `${base.signature}|${this.controlSignature()}|packed:${layoutSignature}`,
    };
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

  private createPackedStorage(data: Float32Array, label: string): any {
    if (!this.device) throw new Error('Advanced WebGPU device is unavailable.');
    const size = align4(data.byteLength);
    const maxBindingSize = Number(this.device.limits?.maxStorageBufferBindingSize ?? Number.MAX_SAFE_INTEGER);
    if (size > maxBindingSize) {
      throw new Error(
        `${label} requires ${(size / 1048576).toFixed(1)} MiB, exceeding this adapter's ` +
        `${(maxBindingSize / 1048576).toFixed(1)} MiB storage-buffer binding limit.`,
      );
    }
    const buffer = this.device.createBuffer({
      label,
      size,
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
    });
    if (data.byteLength) {
      this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    }
    return buffer;
  }

  private createEmptyStorage(size: number, label: string): any {
    if (!this.device) throw new Error('Advanced WebGPU device is unavailable.');
    return this.device.createBuffer({
      label,
      size: align4(size),
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
    });
  }

  private uploadPackedScene(scene: ExtractedAdvancedScene): void {
    if (!this.device) return;
    this.destroyPackedSceneBuffers();

    const staticPool = packFloatPools([
      scene.triangles,
      scene.nodes,
      scene.materials,
      scene.lights,
      scene.lightAlias,
      scene.environmentPixels,
      scene.environmentAlias,
    ]);
    const dynamicPool = packFloatPools([scene.instances, scene.tlasNodes]);
    this.packedLayout = {
      static0: [
        staticPool.offsets[0],
        staticPool.offsets[1],
        staticPool.offsets[2],
        staticPool.offsets[3],
      ],
      static1: [
        staticPool.offsets[4],
        staticPool.offsets[5],
        staticPool.offsets[6],
        0,
      ],
      dynamic: [dynamicPool.offsets[0], dynamicPool.offsets[1], scene.tlasNodeCount, 0],
    };

    const cacheCapacity = Math.max(1024, Math.min(1048576, this.settings.radianceCache.capacity));
    const cacheBytes = cacheCapacity * 20;
    const staticScene = this.createPackedStorage(staticPool.data, 'Kyxos.Advanced.StaticScenePool');
    const dynamicScene = this.createPackedStorage(dynamicPool.data, 'Kyxos.Advanced.DynamicAccelPool');
    const cache = this.createEmptyStorage(cacheBytes, 'Kyxos.Advanced.RadianceCache');

    const runtime = this as any;
    runtime.sceneBuffers = {
      staticScene,
      dynamicScene,
      cache,
      cacheCapacity,
      bytes: staticPool.data.byteLength + dynamicPool.data.byteLength + cacheBytes,
    };

    const encoder = this.device.createCommandEncoder({ label: 'Kyxos.Advanced.ClearPackedCache' });
    encoder.clearBuffer(cache);
    this.device.queue.submit([encoder.finish()]);
    this.rebuildPackedBindGroups();
    this.resetAccumulation();
  }

  private destroyPackedSceneBuffers(): void {
    const runtime = this as any;
    const buffers = runtime.sceneBuffers;
    if (!buffers) return;
    destroyBuffer(buffers.staticScene);
    destroyBuffer(buffers.dynamicScene);
    destroyBuffer(buffers.cache);
    runtime.sceneBuffers = null;
  }

  private rebuildPackedBindGroups(): void {
    const runtime = this as any;
    const s = runtime.sceneBuffers;
    const p = runtime.pixelBuffers;
    const computePipeline = runtime.computePipeline;
    const displayPipeline = runtime.displayPipeline;
    if (!this.device || !computePipeline || !displayPipeline || !s || !p) return;

    const makeCompute = (
      previousReservoir: any,
      nextReservoir: any,
      previousSurface: any,
      nextSurface: any,
    ) => this.device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: s.staticScene } },
        { binding: 2, resource: { buffer: s.dynamicScene } },
        { binding: 3, resource: { buffer: p.accumulation } },
        { binding: 4, resource: { buffer: previousReservoir } },
        { binding: 5, resource: { buffer: nextReservoir } },
        { binding: 6, resource: { buffer: previousSurface } },
        { binding: 7, resource: { buffer: nextSurface } },
        { binding: 8, resource: { buffer: s.cache } },
      ],
    });
    const makeDisplay = (surface: any) => this.device.createBindGroup({
      layout: displayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: p.accumulation } },
        { binding: 2, resource: { buffer: surface } },
      ],
    });

    runtime.computeBindGroups = [
      makeCompute(p.reservoirA, p.reservoirB, p.surfaceA, p.surfaceB),
      makeCompute(p.reservoirB, p.reservoirA, p.surfaceB, p.surfaceA),
    ];
    runtime.displayBindGroups = [makeDisplay(p.surfaceB), makeDisplay(p.surfaceA)];
  }
}
