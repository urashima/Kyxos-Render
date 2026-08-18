import * as THREE from 'three/webgpu';
import type { SceneAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import type { ExtractedAdvancedScene } from './sceneExtraction';
import { realtimeHybridRtWGSL } from './realtimeHybridRtShaderV3';

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const SHADER_STAGE = (globalThis as any).GPUShaderStage ?? { COMPUTE: 4 };
const GLOBAL_FLOAT_COUNT = 68;

interface PackedPool {
  data: Float32Array;
  offsets: number[];
}

export interface RealtimeRtFrameInputs {
  depth: any;
  normal: any;
  metalRough: any;
  width: number;
  height: number;
}

export type RealtimeRtSkipReason =
  | 'disposed'
  | 'not-initialized'
  | 'no-scene'
  | 'gpu-busy'
  | 'output-initializing'
  | 'pipeline-resources'
  | 'depth-gpu-texture'
  | 'normal-gpu-texture'
  | 'metalrough-gpu-texture'
  | 'visibility-gpu-texture'
  | 'reflection-gpu-texture'
  | 'refraction-gpu-texture';

export interface RealtimeRtFrameState {
  ready: boolean;
  frameIndex: number;
  cpuFrameTimeMs: number;
  submitted: boolean;
  skipReason?: RealtimeRtSkipReason;
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

function stageError(stage: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Realtime RT ${stage} failed: ${message}`);
}

/**
 * Realtime RT feature pass.
 *
 * This pass is deliberately not an accumulation renderer. Every interactive
 * frame attempts one interleaved RT update. The 2x2 phase only limits ray cost;
 * temporal reprojection and recurrent denoise reconstruct the full-resolution
 * result continuously while the camera moves. GPU back-pressure skips optional
 * RT work instead of ever blocking the authoritative realtime raster pipeline.
 */
export class RealtimeRtFeaturePassV3 {
  readonly visibilityTexture: any;
  readonly reflectionTexture: any;
  readonly refractionTexture: any;

  private readonly renderer: any;
  private readonly backend: any;
  private readonly device: any;
  private settings: SceneAdvancedRenderSettings;
  private pipeline: any = null;
  private bindGroupLayout: any = null;
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
  private outputInitPending = false;
  private outputInitGeneration = 0;
  private outputInitError: Error | null = null;

  constructor(viewer: any, settings: SceneAdvancedRenderSettings) {
    this.renderer = viewer.renderer;
    this.backend = this.renderer?.backend;
    this.device = this.backend?.device;
    this.settings = settings;
    if (!this.device || this.backend?.isWebGPUBackend !== true) {
      throw new Error('Realtime RT requires the active Kyxos WebGPU renderer device.');
    }

    this.visibilityTexture = this.createOutputTexture('Kyxos.RealtimeRT.Visibility.V3');
    this.reflectionTexture = this.createOutputTexture('Kyxos.RealtimeRT.Reflection.V3');
    this.refractionTexture = this.createOutputTexture('Kyxos.RealtimeRT.Refraction.V3');
  }

  private createOutputTexture(name: string): any {
    const texture = new (THREE as any).StorageTexture(1, 1);
    texture.name = name;
    texture.type = THREE.HalfFloatType;
    texture.format = THREE.RGBAFormat;
    texture.internalFormat = 'rgba16float';
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.disposed) return;
    const storageTextureLimit = Number(this.device.limits?.maxStorageTexturesPerShaderStage ?? 0);
    if (storageTextureLimit > 0 && storageTextureLimit < 3) {
      throw new Error(`Realtime RT requires 3 storage textures per compute stage; this device exposes ${storageTextureLimit}.`);
    }

    let module: any;
    try {
      module = this.device.createShaderModule({
        label: 'Kyxos.RealtimeRT.FeatureCompute.V3',
        code: realtimeHybridRtWGSL,
      });
    } catch (error) {
      throw stageError('shader-module creation', error);
    }

    try {
      this.bindGroupLayout = this.device.createBindGroupLayout({
        label: 'Kyxos.RealtimeRT.FeatureLayout.V3',
        entries: [
          { binding: 0, visibility: SHADER_STAGE.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: SHADER_STAGE.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: SHADER_STAGE.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false } },
          { binding: 4, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
          { binding: 5, visibility: SHADER_STAGE.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
          { binding: 6, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
          { binding: 7, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
          { binding: 8, visibility: SHADER_STAGE.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
        ],
      });
    } catch (error) {
      throw stageError('bind-group-layout creation', error);
    }

    let pipelineLayout: any;
    try {
      pipelineLayout = this.device.createPipelineLayout({
        label: 'Kyxos.RealtimeRT.FeaturePipelineLayout.V3',
        bindGroupLayouts: [this.bindGroupLayout],
      });
    } catch (error) {
      throw stageError('pipeline-layout creation', error);
    }

    try {
      this.pipeline = this.device.createComputePipeline({
        label: 'Kyxos.RealtimeRT.FeaturePipeline.V3',
        layout: pipelineLayout,
        compute: { module, entryPoint: 'main' },
      });
    } catch (error) {
      throw stageError('compute-pipeline creation', error);
    }

    try {
      this.globalsBuffer = this.device.createBuffer({
        label: 'Kyxos.RealtimeRT.Globals.V3',
        size: GLOBAL_FLOAT_COUNT * 4,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      });
    } catch (error) {
      throw stageError('globals-buffer creation', error);
    }
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
    if (data.byteLength) this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
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
    this.staticSceneBuffer = this.createStorage(staticPool.data, 'Kyxos.RealtimeRT.StaticScene.V3');
    this.dynamicSceneBuffer = this.createStorage(dynamicPool.data, 'Kyxos.RealtimeRT.DynamicScene.V3');
    this.bindGroup = null;
    this.boundInputs = null;
  }

  private rawTexture(texture: any): any {
    return this.backend?.get?.(texture)?.texture ?? null;
  }

  private beginOutputInitialization(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.bindGroup = null;
    this.boundInputs = null;
    this.frameIndex = 0;
    this.outputInitError = null;
    const generation = ++this.outputInitGeneration;
    this.outputInitPending = true;
    const tasks: Promise<unknown>[] = [];
    for (const texture of [this.visibilityTexture, this.reflectionTexture, this.refractionTexture]) {
      texture.setSize(this.width, this.height);
      try {
        tasks.push(Promise.resolve(this.renderer.initTexture(texture)));
      } catch (error) {
        tasks.push(Promise.reject(error));
      }
    }
    void Promise.all(tasks).then(() => {
      if (this.disposed || generation !== this.outputInitGeneration) return;
      this.outputInitPending = false;
    }).catch((error) => {
      if (this.disposed || generation !== this.outputInitGeneration) return;
      this.outputInitPending = false;
      this.outputInitError = stageError('storage-texture initialization', error);
    });
  }

  private ensureOutputs(width: number, height: number): RealtimeRtSkipReason | null {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (this.width !== nextWidth || this.height !== nextHeight) {
      this.beginOutputInitialization(nextWidth, nextHeight);
      return 'output-initializing';
    }
    if (this.outputInitError) throw this.outputInitError;
    if (this.outputInitPending) return 'output-initializing';
    return null;
  }

  private ensureBindGroup(inputs: RealtimeRtFrameInputs): RealtimeRtSkipReason | null {
    if (!this.pipeline || !this.bindGroupLayout || !this.globalsBuffer || !this.staticSceneBuffer || !this.dynamicSceneBuffer) {
      return 'pipeline-resources';
    }
    const outputReason = this.ensureOutputs(inputs.width, inputs.height);
    if (outputReason) return outputReason;
    const depthGpu = this.rawTexture(inputs.depth);
    if (!depthGpu) return 'depth-gpu-texture';
    const normalGpu = this.rawTexture(inputs.normal);
    if (!normalGpu) return 'normal-gpu-texture';
    const metalRoughGpu = this.rawTexture(inputs.metalRough);
    if (!metalRoughGpu) return 'metalrough-gpu-texture';
    const visibilityGpu = this.rawTexture(this.visibilityTexture);
    if (!visibilityGpu) return 'visibility-gpu-texture';
    const reflectionGpu = this.rawTexture(this.reflectionTexture);
    if (!reflectionGpu) return 'reflection-gpu-texture';
    const refractionGpu = this.rawTexture(this.refractionTexture);
    if (!refractionGpu) return 'refraction-gpu-texture';

    if (
      this.bindGroup && this.boundInputs &&
      this.boundInputs[0] === inputs.depth && this.boundInputs[1] === inputs.normal && this.boundInputs[2] === inputs.metalRough
    ) return null;

    this.bindGroup = this.device.createBindGroup({
      label: 'Kyxos.RealtimeRT.FeatureBindGroup.V3',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: this.staticSceneBuffer } },
        { binding: 2, resource: { buffer: this.dynamicSceneBuffer } },
        { binding: 3, resource: depthGpu.createView() },
        { binding: 4, resource: normalGpu.createView() },
        { binding: 5, resource: metalRoughGpu.createView() },
        { binding: 6, resource: visibilityGpu.createView() },
        { binding: 7, resource: reflectionGpu.createView() },
        { binding: 8, resource: refractionGpu.createView() },
      ],
    });
    this.boundInputs = [inputs.depth, inputs.normal, inputs.metalRough];
    return null;
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
    data.set([scene?.triangleCount ?? 0, scene?.blasNodeCount ?? 0, scene?.instanceCount ?? 0, scene?.tlasNodeCount ?? 0], 36);
    data.set([scene?.lightCount ?? 0, scene?.environmentWidth ?? 1, scene?.environmentHeight ?? 1, scene?.materialCount ?? 1], 40);
    data.set([this.staticOffsets[0] ?? 0, this.staticOffsets[1] ?? 0, this.staticOffsets[2] ?? 0, this.staticOffsets[3] ?? 0], 44);
    data.set([this.staticOffsets[4] ?? 0, this.staticOffsets[5] ?? 0, this.staticOffsets[6] ?? 0, 0], 48);
    data.set([this.dynamicOffsets[0] ?? 0, this.dynamicOffsets[1] ?? 0, scene?.tlasNodeCount ?? 0, 0], 52);
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
    data.set([
      settings.rayTracing.refractions ? 1 : 0,
      settings.rayTracing.refractionMaxRoughness,
      settings.rayTracing.refractionStrength,
      0,
    ], 64);
    this.device.queue.writeBuffer(this.globalsBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  render(camera: any, inputs: RealtimeRtFrameInputs): RealtimeRtFrameState {
    const readyNow = this.frameIndex > 0;
    if (this.disposed) return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false, skipReason: 'disposed' };
    if (!this.initialized) return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false, skipReason: 'not-initialized' };
    if (!this.scene) return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false, skipReason: 'no-scene' };
    if (this.gpuBusy) return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false, skipReason: 'gpu-busy' };

    const bindReason = this.ensureBindGroup(inputs);
    if (bindReason) return { ready: readyNow, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: false, skipReason: bindReason };

    const started = performance.now();
    this.writeGlobals(camera);
    const encoder = this.device.createCommandEncoder({ label: 'Kyxos.RealtimeRT.Frame.V3' });
    const compute = encoder.beginComputePass({ label: 'Kyxos.RealtimeRT.FeatureQueries.V3' });
    compute.setPipeline(this.pipeline);
    compute.setBindGroup(0, this.bindGroup);
    compute.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    compute.end();
    this.device.queue.submit([encoder.finish()]);
    this.frameIndex += 1;
    this.cpuFrameTimeMs = performance.now() - started;

    const submittedWork = this.device.queue.onSubmittedWorkDone?.();
    if (submittedWork && typeof submittedWork.then === 'function') {
      this.gpuBusy = true;
      void submittedWork.then(() => { this.gpuBusy = false; }).catch(() => { this.gpuBusy = false; });
    }

    return { ready: true, frameIndex: this.frameIndex, cpuFrameTimeMs: this.cpuFrameTimeMs, submitted: true };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.outputInitGeneration += 1;
    destroyBuffer(this.globalsBuffer);
    destroyBuffer(this.staticSceneBuffer);
    destroyBuffer(this.dynamicSceneBuffer);
    this.globalsBuffer = null;
    this.staticSceneBuffer = null;
    this.dynamicSceneBuffer = null;
    this.bindGroupLayout = null;
    this.bindGroup = null;
    this.visibilityTexture.dispose?.();
    this.reflectionTexture.dispose?.();
    this.refractionTexture.dispose?.();
    this.scene = null;
  }
}
