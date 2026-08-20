import * as THREE from 'three/webgpu';
import type { SceneAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import type { ExtractedAdvancedScene } from './sceneExtraction';
import { realtimeHybridRtWGSL } from './realtimeHybridRtShaderV2';

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { COMPUTE: 4 };
const GLOBAL_FLOAT_COUNT = 64;
const READY_PHASE_COUNT = 4;

interface PackedPool {
  data: Float32Array;
  offsets: number[];
}

export interface HybridRtFrameInputs {
  depth: any;
  normal: any;
  metalRough: any;
  width: number;
  height: number;
}

export interface HybridRtFrameState {
  ready: boolean;
  frameIndex: number;
  cpuFrameTimeMs: number;
  submitted: boolean;
}

function align4(value: number): number {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

function destroyBuffer(buffer: any): void {
  try { buffer?.destroy?.(); } catch { /* shared device may already be lost */ }
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

/**
 * Interaction-safe Hybrid RT pass.
 *
 * The pass owns no adapter/device/canvas. It uses the GPUDevice already owned by
 * the realtime WebGPURenderer and deliberately avoids GPU error-scope calls so it
 * cannot disturb Three.js' internal asynchronous validation stack. The caller
 * only submits this pass while the camera is stable. A 2x2 four-phase checkerboard
 * keeps secondary-ray cost bounded and one in-flight submission prevents queue
 * backlog from freezing the realtime viewport.
 */
export class RealtimeHybridRtFeaturePassV2 {
  readonly visibilityTexture: any;
  readonly reflectionTexture: any;

  private readonly viewer: any;
  private readonly renderer: any;
  private readonly backend: any;
  private readonly device: any;
  private settings: SceneAdvancedRenderSettings;
  private pipeline: any = null;
  private globalsBuffer: any = null;
  private staticSceneBuffer: any = null;
  private dynamicSceneBuffer: any = null;
  private bindGroup: any = null;
  private boundInputs: [any, any, any] | null = null;
  private scene: ExtractedAdvancedScene | null = null;
  private staticOffsets = [0, 0, 0, 0, 0, 0, 0];
  private dynamicOffsets = [0, 0];
  private frameIndex = 0;
  private cpuFrameTimeMs = 0;
  private width = 1;
  private height = 1;
  private initialized = false;
  private disposed = false;
  private gpuBusy = false;

  constructor(viewer: any, settings: SceneAdvancedRenderSettings) {
    this.viewer = viewer;
    this.renderer = viewer.renderer;
    this.backend = this.renderer?.backend;
    this.device = this.backend?.device;
    this.settings = settings;
    if (!this.device || this.backend?.isWebGPUBackend !== true) {
      throw new Error('Realtime Hybrid RT requires the active Kyxos WebGPU renderer device.');
    }

    this.visibilityTexture = new (THREE as any).StorageTexture(1, 1);
    this.visibilityTexture.name = 'Kyxos.HybridRT.Visibility.V2';
    this.visibilityTexture.type = THREE.HalfFloatType;
    this.visibilityTexture.format = THREE.RGBAFormat;
    this.visibilityTexture.internalFormat = 'rgba16float';
    this.visibilityTexture.generateMipmaps = false;
    this.visibilityTexture.colorSpace = THREE.NoColorSpace;

    this.reflectionTexture = new (THREE as any).StorageTexture(1, 1);
    this.reflectionTexture.name = 'Kyxos.HybridRT.Reflection.V2';
    this.reflectionTexture.type = THREE.HalfFloatType;
    this.reflectionTexture.format = THREE.RGBAFormat;
    this.reflectionTexture.internalFormat = 'rgba16float';
    this.reflectionTexture.generateMipmaps = false;
    this.reflectionTexture.colorSpace = THREE.NoColorSpace;
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.disposed) return;
    const module = this.device.createShaderModule({
      label: 'Kyxos.HybridRT.FeatureCompute.V2',
      code: realtimeHybridRtWGSL,
    });
    const layout = this.device.createBindGroupLayout({
      label: 'Kyxos.HybridRT.FeatureLayout.V2',
      entries: [
        { binding: 0, visibility: SHADER_STAGE.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: SHADER_STAGE.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: SHADER_STAGE.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false } },
        { binding: 4, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
        { binding: 5, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
        { binding: 6, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
        { binding: 7, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
      ],
    });
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Kyxos.HybridRT.FeaturePipelineLayout.V2',
      bindGroupLayouts: [layout],
    });

    // On a shared device, createComputePipelineAsync is the authoritative
    // validation boundary. Do not call getCompilationInfo()/pushErrorScope():
    // Chromium/SwiftShader and Three.js both use asynchronous device scopes and
    // cross-owner scope manipulation can stall or drop the shared GPU instance.
    this.pipeline = typeof this.device.createComputePipelineAsync === 'function'
      ? await this.device.createComputePipelineAsync({
          label: 'Kyxos.HybridRT.FeaturePipeline.V2',
          layout: pipelineLayout,
          compute: { module, entryPoint: 'main' },
        })
      : this.device.createComputePipeline({
          label: 'Kyxos.HybridRT.FeaturePipeline.V2',
          layout: pipelineLayout,
          compute: { module, entryPoint: 'main' },
        });
    this.pipeline.getBindGroupLayout(0);

    this.globalsBuffer = this.device.createBuffer({
      label: 'Kyxos.HybridRT.Globals.V2',
      size: GLOBAL_FLOAT_COUNT * 4,
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });
    this.initialized = true;
  }

  setSettings(settings: SceneAdvancedRenderSettings): void {
    this.settings = settings;
  }

  setScene(scene: ExtractedAdvancedScene): void {
    if (this.disposed) return;
    this.scene = scene;
    this.uploadScene(scene);
    this.resetHistory();
  }

  resetHistory(): void {
    this.frameIndex = 0;
  }

  private createStorage(data: Float32Array, label: string): any {
    const buffer = this.device.createBuffer({
      label,
      size: align4(data.byteLength),
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
    });
    if (data.byteLength) {
      this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    }
    return buffer;
  }

  private uploadScene(scene: ExtractedAdvancedScene): void {
    destroyBuffer(this.staticSceneBuffer);
    destroyBuffer(this.dynamicSceneBuffer);

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
    this.staticOffsets = staticPool.offsets;
    this.dynamicOffsets = dynamicPool.offsets;
    this.staticSceneBuffer = this.createStorage(staticPool.data, 'Kyxos.HybridRT.StaticScene.V2');
    this.dynamicSceneBuffer = this.createStorage(dynamicPool.data, 'Kyxos.HybridRT.DynamicScene.V2');
    this.bindGroup = null;
    this.boundInputs = null;
  }

  private ensureOutputs(width: number, height: number): void {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (
      this.width === nextWidth && this.height === nextHeight &&
      this.rawTexture(this.visibilityTexture) && this.rawTexture(this.reflectionTexture)
    ) return;

    this.width = nextWidth;
    this.height = nextHeight;
    this.visibilityTexture.setSize(this.width, this.height);
    this.reflectionTexture.setSize(this.width, this.height);
    this.renderer.initTexture(this.visibilityTexture);
    this.renderer.initTexture(this.reflectionTexture);
    this.bindGroup = null;
    this.boundInputs = null;
    this.resetHistory();
  }

  private rawTexture(texture: any): any {
    return this.backend?.get?.(texture)?.texture ?? null;
  }

  private ensureBindGroup(inputs: HybridRtFrameInputs): boolean {
    if (!this.pipeline || !this.globalsBuffer || !this.staticSceneBuffer || !this.dynamicSceneBuffer) return false;
    this.ensureOutputs(inputs.width, inputs.height);
    const depthGpu = this.rawTexture(inputs.depth);
    const normalGpu = this.rawTexture(inputs.normal);
    const metalRoughGpu = this.rawTexture(inputs.metalRough);
    const visibilityGpu = this.rawTexture(this.visibilityTexture);
    const reflectionGpu = this.rawTexture(this.reflectionTexture);
    if (!depthGpu || !normalGpu || !metalRoughGpu || !visibilityGpu || !reflectionGpu) return false;

    if (
      this.bindGroup && this.boundInputs &&
      this.boundInputs[0] === inputs.depth && this.boundInputs[1] === inputs.normal && this.boundInputs[2] === inputs.metalRough
    ) return true;

    this.bindGroup = this.device.createBindGroup({
      label: 'Kyxos.HybridRT.FeatureBindGroup.V2',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: this.staticSceneBuffer } },
        { binding: 2, resource: { buffer: this.dynamicSceneBuffer } },
        { binding: 3, resource: depthGpu.createView() },
        { binding: 4, resource: normalGpu.createView() },
        { binding: 5, resource: metalRoughGpu.createView() },
        { binding: 6, resource: visibilityGpu.createView() },
        { binding: 7, resource: reflectionGpu.createView() },
      ],
    });
    this.boundInputs = [inputs.depth, inputs.normal, inputs.metalRough];
    return true;
  }

  private restirCandidateBudget(): number {
    const restir = this.settings.restirDI;
    if (restir.mode === 'off') return 1;
    if (restir.mode === 'initial') return Math.min(4, restir.candidates);
    if (restir.mode === 'temporal') return Math.min(6, restir.candidates);
    return Math.min(8, Math.max(restir.candidates, restir.spatialSamples));
  }

  private writeGlobals(camera: any): void {
    camera.updateMatrixWorld?.(true);
    camera.updateProjectionMatrix?.();
    const inverseProjection = camera.projectionMatrixInverse?.elements ?? new THREE.Matrix4().copy(camera.projectionMatrix).invert().elements;
    const cameraWorld = camera.matrixWorld?.elements ?? new THREE.Matrix4().elements;
    const scene = this.scene;
    const settings = this.settings;
    const data = new Float32Array(GLOBAL_FLOAT_COUNT);
    data.set(inverseProjection, 0);
    data.set(cameraWorld, 16);
    data.set([this.width, this.height, this.frameIndex, camera.isOrthographicCamera ? 1 : 0], 32);
    data.set([
      scene?.triangleCount ?? 0,
      scene?.blasNodeCount ?? 0,
      scene?.instanceCount ?? 0,
      scene?.tlasNodeCount ?? 0,
    ], 36);
    data.set([
      scene?.lightCount ?? 0,
      scene?.environmentWidth ?? 1,
      scene?.environmentHeight ?? 1,
      scene?.materialCount ?? 1,
    ], 40);
    data.set([
      this.staticOffsets[0] ?? 0,
      this.staticOffsets[1] ?? 0,
      this.staticOffsets[2] ?? 0,
      this.staticOffsets[3] ?? 0,
    ], 44);
    data.set([
      this.staticOffsets[4] ?? 0,
      this.staticOffsets[5] ?? 0,
      this.staticOffsets[6] ?? 0,
      0,
    ], 48);
    data.set([
      this.dynamicOffsets[0] ?? 0,
      this.dynamicOffsets[1] ?? 0,
      scene?.tlasNodeCount ?? 0,
      0,
    ], 52);
    data.set([
      settings.rayTracing.shadowBias,
      settings.rayTracing.aoRadius,
      settings.rayTracing.aoStrength,
      settings.rayTracing.reflectionMaxRoughness,
    ], 56);
    data.set([
      settings.rayTracing.shadows ? 1 : 0,
      settings.rayTracing.ambientOcclusion ? 1 : 0,
      settings.rayTracing.reflections ? 1 : 0,
      this.restirCandidateBudget(),
    ], 60);
    this.device.queue.writeBuffer(this.globalsBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  render(camera: any, inputs: HybridRtFrameInputs): HybridRtFrameState {
    const readyNow = this.frameIndex >= READY_PHASE_COUNT;
    if (this.disposed || !this.initialized || !this.scene || this.gpuBusy) {
      return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false };
    }
    if (!this.ensureBindGroup(inputs)) {
      return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false };
    }

    const started = performance.now();
    this.writeGlobals(camera);
    const encoder = this.device.createCommandEncoder({ label: 'Kyxos.HybridRT.Frame.V2' });
    const compute = encoder.beginComputePass({ label: 'Kyxos.HybridRT.FeatureQueries.V2' });
    compute.setPipeline(this.pipeline);
    compute.setBindGroup(0, this.bindGroup);
    compute.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    compute.end();
    this.device.queue.submit([encoder.finish()]);
    this.frameIndex += 1;
    this.cpuFrameTimeMs = performance.now() - started;

    // Back-pressure: never enqueue another expensive ray pass until the previous
    // submission has retired. Realtime frames can continue instead of building a
    // multi-frame compute backlog that looks like a frozen viewport.
    const submittedWork = this.device.queue.onSubmittedWorkDone?.();
    if (submittedWork && typeof submittedWork.then === 'function') {
      this.gpuBusy = true;
      void submittedWork.then(() => { this.gpuBusy = false; }).catch(() => { this.gpuBusy = false; });
    }

    return {
      ready: this.frameIndex >= READY_PHASE_COUNT,
      frameIndex: this.frameIndex,
      cpuFrameTimeMs: this.cpuFrameTimeMs,
      submitted: true,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    destroyBuffer(this.globalsBuffer);
    destroyBuffer(this.staticSceneBuffer);
    destroyBuffer(this.dynamicSceneBuffer);
    this.globalsBuffer = null;
    this.staticSceneBuffer = null;
    this.dynamicSceneBuffer = null;
    this.bindGroup = null;
    this.visibilityTexture.dispose?.();
    this.reflectionTexture.dispose?.();
    this.scene = null;
  }
}
