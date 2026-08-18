import {
  resolveAdvancedRendererCapabilities,
  type AdvancedRendererCapabilities,
} from './backendCapabilities';
import { readSharedWebGpuDevice } from './sharedWebGpuDeviceBridge';
import { WebGpuPackedRenderer } from './webgpuPackedRenderer';
import type { AdvancedGpuRendererOptions } from './webgpuPackedRenderer';
import type { ExtractedAdvancedScene } from './sceneExtraction';
import {
  advancedPathTracingComputeWGSL,
  advancedPathTracingDisplayWGSL,
} from './webgpuShadersPortable';

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const TEXTURE_USAGE = (globalThis as any).GPUTextureUsage ?? { RENDER_ATTACHMENT: 16 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const GLOBAL_VEC4_COUNT = 15;
const COMPUTE_BINDINGS_PER_GROUP = 9;

function align4(value: number): number {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

function destroyBuffer(buffer: any): void {
  try { buffer?.destroy?.(); } catch { /* shared device may already be lost */ }
}

function packFloatPools(arrays: readonly Float32Array[]): { data: Float32Array; offsets: number[] } {
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

function stageError(stage: string, error: unknown): Error {
  return new Error(`Shared PT ${stage} failed: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Packed progressive renderer that reuses the GPUDevice already created by the
 * realtime Kyxos WebGPURenderer. This keeps PT a reference presentation mode
 * without creating a second adapter/device or competing device lifecycle.
 *
 * The shared-device implementation deliberately keeps explicit JS references to
 * both bind-group layouts. Dawn/SwiftShader has shown external-handle lifetime
 * failures when async pipeline creation or getBindGroupLayout() is used on a
 * device already owned by Three.js.
 */
export class WebGpuSharedPackedRenderer extends WebGpuPackedRenderer {
  private sharedComputeLayout: any = null;
  private sharedDisplayLayout: any = null;

  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
    const runtime = this as any;
    runtime.uploadScene = (scene: ExtractedAdvancedScene) => this.uploadSharedScene(scene);
    runtime.destroySceneBuffers = () => this.destroySharedSceneBuffers();
    runtime.rebuildBindGroups = () => this.rebuildSharedBindGroups();
  }

  async initialize(): Promise<AdvancedRendererCapabilities> {
    const runtime = this as any;
    if (runtime.disposed) throw new Error('Advanced renderer has been disposed.');
    if (runtime.initialized && this.device) {
      return resolveAdvancedRendererCapabilities('webgpu', this.device.limits as Record<string, unknown>);
    }

    const shared = readSharedWebGpuDevice(this.baseCanvas);
    if (!shared?.device) throw new Error('Realtime WebGPU device bridge is unavailable.');

    this.device = shared.device;
    this.adapter = { limits: shared.limits };
    const capabilities = resolveAdvancedRendererCapabilities('webgpu', shared.limits);
    if (!capabilities.softwareRayQuery) {
      throw new Error(capabilities.reason ?? 'Shared WebGPU device does not expose the packed RT baseline.');
    }

    const maxBindings = Number((shared.limits as any)?.maxBindingsPerBindGroup ?? 0);
    if (maxBindings > 0 && maxBindings < COMPUTE_BINDINGS_PER_GROUP) {
      throw new Error(`Shared WebGPU device exposes ${maxBindings} bindings per bind group; packed PT requires ${COMPUTE_BINDINGS_PER_GROUP}.`);
    }

    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    let context: any;
    try {
      context = this.overlay.getContext('webgpu') as any;
      if (!context) throw new Error('Unable to create WebGPU path-tracing canvas context.');
      const format = gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
      context.configure({ device: this.device, format, alphaMode: 'opaque', usage: TEXTURE_USAGE.RENDER_ATTACHMENT });
      runtime.context = context;
      runtime.format = format;
    } catch (error) {
      throw stageError('canvas-context configuration', error);
    }

    try { this.globalsBuffer?.destroy?.(); } catch { /* ignored */ }
    try {
      this.globalsBuffer = this.device.createBuffer({
        label: 'Kyxos.Advanced.SharedPackedGlobals',
        size: GLOBAL_VEC4_COUNT * 16,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      });
    } catch (error) {
      throw stageError('globals-buffer creation', error);
    }

    let computeModule: any;
    let displayModule: any;
    try {
      computeModule = this.device.createShaderModule({ label: 'Kyxos.Advanced.SharedPackedPathCompute', code: advancedPathTracingComputeWGSL });
      displayModule = this.device.createShaderModule({ label: 'Kyxos.Advanced.SharedPackedDisplay', code: advancedPathTracingDisplayWGSL });
    } catch (error) {
      throw stageError('shader-module creation', error);
    }

    try {
      const readOnlyStorage = new Set([1, 2, 4, 6]);
      this.sharedComputeLayout = this.device.createBindGroupLayout({
        label: 'Kyxos.Advanced.SharedPackedPathBindGroupLayout',
        entries: Array.from({ length: COMPUTE_BINDINGS_PER_GROUP }, (_, binding) => ({
          binding,
          visibility: SHADER_STAGE.COMPUTE,
          buffer: binding === 0
            ? { type: 'uniform' }
            : { type: readOnlyStorage.has(binding) ? 'read-only-storage' : 'storage' },
        })),
      });
      this.sharedDisplayLayout = this.device.createBindGroupLayout({
        label: 'Kyxos.Advanced.SharedPackedDisplayBindGroupLayout',
        entries: [
          { binding: 0, visibility: SHADER_STAGE.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: SHADER_STAGE.FRAGMENT, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: SHADER_STAGE.FRAGMENT, buffer: { type: 'read-only-storage' } },
        ],
      });
    } catch (error) {
      throw stageError('bind-group-layout creation', error);
    }

    let computePipelineLayout: any;
    let displayPipelineLayout: any;
    try {
      computePipelineLayout = this.device.createPipelineLayout({
        label: 'Kyxos.Advanced.SharedPackedPathPipelineLayout',
        bindGroupLayouts: [this.sharedComputeLayout],
      });
      displayPipelineLayout = this.device.createPipelineLayout({
        label: 'Kyxos.Advanced.SharedPackedDisplayPipelineLayout',
        bindGroupLayouts: [this.sharedDisplayLayout],
      });
    } catch (error) {
      throw stageError('pipeline-layout creation', error);
    }

    try {
      runtime.computePipeline = this.device.createComputePipeline({
        label: 'Kyxos.Advanced.SharedPackedPathPipeline',
        layout: computePipelineLayout,
        compute: { module: computeModule, entryPoint: 'main' },
      });
      runtime.displayPipeline = this.device.createRenderPipeline({
        label: 'Kyxos.Advanced.SharedPackedDisplayPipeline',
        layout: displayPipelineLayout,
        vertex: { module: displayModule, entryPoint: 'vertexMain' },
        fragment: { module: displayModule, entryPoint: 'fragmentMain', targets: [{ format: runtime.format }] },
        primitive: { topology: 'triangle-list' },
      });
    } catch (error) {
      throw stageError('pipeline creation', error);
    }

    // WebGpuPackedRenderer normally validates its first frame with the shared
    // device error-scope stack. Three.js already owns that stack, and Dawn's
    // SwiftShader transport reports "Instance dropped" from popErrorScope().
    // Explicit pipeline/layout creation above is the validation boundary here.
    runtime.firstFrameValidated = true;
    runtime.validationPending = false;
    runtime.validationFailure = null;
    runtime.initialized = true;
    return capabilities;
  }

  private createSharedStorage(data: Float32Array, label: string): any {
    const size = align4(data.byteLength);
    const maxBindingSize = Number(this.device?.limits?.maxStorageBufferBindingSize ?? Number.MAX_SAFE_INTEGER);
    if (size > maxBindingSize) {
      throw new Error(`${label} exceeds the shared device storage-buffer binding limit.`);
    }
    const buffer = this.device.createBuffer({ label, size, usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
    if (data.byteLength) this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  private createSharedEmptyStorage(size: number, label: string): any {
    return this.device.createBuffer({ label, size: align4(size), usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
  }

  private uploadSharedScene(scene: ExtractedAdvancedScene): void {
    this.destroySharedSceneBuffers();
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
    const runtime = this as any;
    runtime.packedLayout = {
      static0: [staticPool.offsets[0], staticPool.offsets[1], staticPool.offsets[2], staticPool.offsets[3]],
      static1: [staticPool.offsets[4], staticPool.offsets[5], staticPool.offsets[6], 0],
      dynamic: [dynamicPool.offsets[0], dynamicPool.offsets[1], scene.tlasNodeCount, 0],
    };
    const settings = runtime.settings;
    const cacheCapacity = Math.max(1024, Math.min(1048576, Number(settings?.radianceCache?.capacity ?? 65536)));
    const cacheBytes = cacheCapacity * 20;
    runtime.sceneBuffers = {
      staticScene: this.createSharedStorage(staticPool.data, 'Kyxos.Advanced.SharedStaticScenePool'),
      dynamicScene: this.createSharedStorage(dynamicPool.data, 'Kyxos.Advanced.SharedDynamicAccelPool'),
      cache: this.createSharedEmptyStorage(cacheBytes, 'Kyxos.Advanced.SharedRadianceCache'),
      cacheCapacity,
      bytes: staticPool.data.byteLength + dynamicPool.data.byteLength + cacheBytes,
    };
    const encoder = this.device.createCommandEncoder({ label: 'Kyxos.Advanced.ClearSharedPackedCache' });
    encoder.clearBuffer(runtime.sceneBuffers.cache);
    this.device.queue.submit([encoder.finish()]);
    this.rebuildSharedBindGroups();
    this.resetAccumulation();
  }

  private destroySharedSceneBuffers(): void {
    const runtime = this as any;
    const buffers = runtime.sceneBuffers;
    if (!buffers) return;
    destroyBuffer(buffers.staticScene);
    destroyBuffer(buffers.dynamicScene);
    destroyBuffer(buffers.cache);
    runtime.sceneBuffers = null;
  }

  private rebuildSharedBindGroups(): void {
    const runtime = this as any;
    const s = runtime.sceneBuffers;
    const p = runtime.pixelBuffers;
    if (!this.device || !this.sharedComputeLayout || !this.sharedDisplayLayout || !s || !p) return;

    const makeCompute = (previousReservoir: any, nextReservoir: any, previousSurface: any, nextSurface: any) =>
      this.device.createBindGroup({
        layout: this.sharedComputeLayout,
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
      layout: this.sharedDisplayLayout,
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
