import type { SceneAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import { normalizeAdvancedRenderSettings } from '@kyxos/scene-contract/advanced-render-settings';
import type { AdvancedRendererCapabilities } from './backendCapabilities';
import { ADVANCED_STORAGE_BUFFERS_PER_STAGE, resolveAdvancedRendererCapabilities } from './backendCapabilities';
import type { ExtractedAdvancedScene } from './sceneExtraction';
import { advancedPathTracingComputeWGSL, advancedPathTracingDisplayWGSL } from './webgpuShadersPortable';

const BUFFER_USAGE = (globalThis as any).GPUBufferUsage ?? { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const TEXTURE_USAGE = (globalThis as any).GPUTextureUsage ?? { RENDER_ATTACHMENT: 16 };

export interface AdvancedGpuMetrics {
  width: number;
  height: number;
  samples: number;
  cpuFrameTimeMs: number;
  sceneBytes: number;
  historyBytes: number;
  cacheBytes: number;
  totalBytes: number;
}

export interface AdvancedGpuRendererOptions {
  onDeviceLost?: (message: string) => void;
  onError?: (error: unknown) => void;
}

interface PixelBuffers {
  accumulation: any;
  reservoirA: any;
  reservoirB: any;
  surfaceA: any;
  surfaceB: any;
  width: number;
  height: number;
  bytes: number;
}

interface SceneBuffers {
  triangles: any;
  nodes: any;
  instances: any;
  tlasNodes: any;
  materials: any;
  lights: any;
  lightAlias: any;
  environmentPixels: any;
  environmentAlias: any;
  cache: any;
  cacheCapacity: number;
  bytes: number;
}

function align4(value: number): number {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

function destroyBuffer(buffer: any): void {
  try { buffer?.destroy?.(); } catch { /* device may already be lost */ }
}

function restirModeNumber(mode: string): number {
  if (mode === 'initial') return 1;
  if (mode === 'temporal') return 2;
  if (mode === 'temporalSpatial') return 3;
  return 0;
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Advanced canvas capture failed.')), mimeType, quality);
  });
}

export class WebGpuHybridRenderer {
  readonly overlay: HTMLCanvasElement;
  protected readonly baseCanvas: HTMLCanvasElement;
  private readonly options: AdvancedGpuRendererOptions;
  protected adapter: any = null;
  protected device: any = null;
  private context: any = null;
  private format = 'bgra8unorm';
  protected globalsBuffer: any = null;
  private computePipeline: any = null;
  private displayPipeline: any = null;
  protected sceneBuffers: SceneBuffers | null = null;
  protected pixelBuffers: PixelBuffers | null = null;
  private computeBindGroups: any[] = [];
  private displayBindGroups: any[] = [];
  protected scene: ExtractedAdvancedScene | null = null;
  protected settings = normalizeAdvancedRenderSettings(null);
  protected frameIndex = 0;
  private samples = 0;
  private ping = 0;
  private disposed = false;
  private initialized = false;
  private lastCpuFrameTimeMs = 0;
  private lastCameraSignature = '';
  private lastScale = -1;

  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    this.baseCanvas = baseCanvas;
    this.options = options;
    this.overlay = document.createElement('canvas');
    this.overlay.dataset.kyxosAdvancedRenderer = 'webgpu';
    Object.assign(this.overlay.style, {
      position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '3', margin: '0', padding: '0',
    });
    document.body.append(this.overlay);
  }

  async initialize(): Promise<AdvancedRendererCapabilities> {
    if (this.disposed) throw new Error('Advanced renderer has been disposed.');
    if (this.initialized && this.adapter) return resolveAdvancedRendererCapabilities('webgpu', this.adapter.limits);
    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    if (!gpu?.requestAdapter) throw new Error('WebGPU is unavailable.');
    this.adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!this.adapter) throw new Error('No WebGPU adapter is available.');
    const capabilities = resolveAdvancedRendererCapabilities('webgpu', this.adapter.limits as Record<string, unknown>);
    if (!capabilities.softwareRayQuery) throw new Error(capabilities.reason ?? 'WebGPU RT Enhanced limits are unavailable.');
    this.device = await this.adapter.requestDevice({
      requiredLimits: {
        maxStorageBuffersPerShaderStage: ADVANCED_STORAGE_BUFFERS_PER_STAGE,
      },
    });
    this.device.lost?.then?.((info: any) => {
      if (this.disposed) return;
      const message = `Advanced WebGPU device lost: ${String(info?.message ?? info?.reason ?? 'unknown reason')}`;
      this.initialized = false;
      this.overlay.style.display = 'none';
      this.options.onDeviceLost?.(message);
    });
    this.context = this.overlay.getContext('webgpu');
    if (!this.context) throw new Error('Unable to create WebGPU canvas context.');
    this.format = gpu.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque', usage: TEXTURE_USAGE.RENDER_ATTACHMENT });
    this.globalsBuffer = this.device.createBuffer({
      label: 'Kyxos.Advanced.Globals', size: 9 * 16, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    });
    const computeModule = this.device.createShaderModule({ label: 'Kyxos.Advanced.PathCompute', code: advancedPathTracingComputeWGSL });
    const displayModule = this.device.createShaderModule({ label: 'Kyxos.Advanced.Display', code: advancedPathTracingDisplayWGSL });
    this.computePipeline = this.device.createComputePipeline({
      label: 'Kyxos.Advanced.PathPipeline', layout: 'auto', compute: { module: computeModule, entryPoint: 'main' },
    });
    this.displayPipeline = this.device.createRenderPipeline({
      label: 'Kyxos.Advanced.DisplayPipeline', layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vertexMain' },
      fragment: { module: displayModule, entryPoint: 'fragmentMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.initialized = true;
    return capabilities;
  }

  setSettings(value: SceneAdvancedRenderSettings): void {
    const next = normalizeAdvancedRenderSettings(value);
    const old = this.settings;
    this.settings = next;
    if (
      old.restirDI.mode !== next.restirDI.mode || old.restirDI.candidates !== next.restirDI.candidates ||
      old.restirDI.spatialSamples !== next.restirDI.spatialSamples || old.radianceCache.enabled !== next.radianceCache.enabled ||
      old.radianceCache.cellSize !== next.radianceCache.cellSize || old.pathTracing.maxBounces !== next.pathTracing.maxBounces ||
      old.pathTracing.resolutionScale !== next.pathTracing.resolutionScale
    ) this.resetAccumulation();
    if (this.scene && old.radianceCache.capacity !== next.radianceCache.capacity) this.uploadScene(this.scene);
  }

  setScene(scene: ExtractedAdvancedScene): void {
    this.scene = scene;
    if (this.initialized) this.uploadScene(scene);
  }

  private createStorage(data: ArrayBufferView, label: string): any {
    const buffer = this.device.createBuffer({ label, size: align4(data.byteLength), usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
    if (data.byteLength) this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  private createEmptyStorage(size: number, label: string): any {
    return this.device.createBuffer({ label, size: align4(size), usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
  }

  private uploadScene(scene: ExtractedAdvancedScene): void {
    if (!this.device) return;
    this.destroySceneBuffers();
    const cacheCapacity = Math.max(1024, Math.min(1048576, this.settings.radianceCache.capacity));
    const cacheBytes = cacheCapacity * 20;
    this.sceneBuffers = {
      triangles: this.createStorage(scene.triangles, 'Kyxos.Advanced.BLASTriangles'),
      nodes: this.createStorage(scene.nodes, 'Kyxos.Advanced.BLASNodes'),
      instances: this.createStorage(scene.instances, 'Kyxos.Advanced.Instances'),
      tlasNodes: this.createStorage(scene.tlasNodes, 'Kyxos.Advanced.TLASNodes'),
      materials: this.createStorage(scene.materials, 'Kyxos.Advanced.Materials'),
      lights: this.createStorage(scene.lights, 'Kyxos.Advanced.Lights'),
      lightAlias: this.createStorage(scene.lightAlias, 'Kyxos.Advanced.LightAlias'),
      environmentPixels: this.createStorage(scene.environmentPixels, 'Kyxos.Advanced.Environment'),
      environmentAlias: this.createStorage(scene.environmentAlias, 'Kyxos.Advanced.EnvironmentAlias'),
      cache: this.createEmptyStorage(cacheBytes, 'Kyxos.Advanced.RadianceCache'),
      cacheCapacity,
      bytes: scene.estimatedBytes + cacheBytes,
    };
    this.clearBuffer(this.sceneBuffers.cache);
    this.rebuildBindGroups();
    this.resetAccumulation();
  }

  private destroySceneBuffers(): void {
    if (!this.sceneBuffers) return;
    for (const key of [
      'triangles', 'nodes', 'instances', 'tlasNodes', 'materials', 'lights', 'lightAlias',
      'environmentPixels', 'environmentAlias', 'cache',
    ] as const) destroyBuffer(this.sceneBuffers[key]);
    this.sceneBuffers = null;
  }

  private destroyPixelBuffers(): void {
    if (!this.pixelBuffers) return;
    for (const key of ['accumulation', 'reservoirA', 'reservoirB', 'surfaceA', 'surfaceB'] as const) destroyBuffer(this.pixelBuffers[key]);
    this.pixelBuffers = null;
  }
  private ensurePixelBuffers(width: number, height: number): void {
    if (!this.device || (this.pixelBuffers?.width === width && this.pixelBuffers.height === height)) return;
    this.destroyPixelBuffers();
    const pixelCount = Math.max(1, width * height);
    const accumulationBytes = pixelCount * 16;
    const reservoirBytes = pixelCount * 48;
    const surfaceBytes = pixelCount * 48;
    this.pixelBuffers = {
      accumulation: this.createEmptyStorage(accumulationBytes, 'Kyxos.Advanced.Accumulation'),
      reservoirA: this.createEmptyStorage(reservoirBytes, 'Kyxos.Advanced.ReservoirA'),
      reservoirB: this.createEmptyStorage(reservoirBytes, 'Kyxos.Advanced.ReservoirB'),
      surfaceA: this.createEmptyStorage(surfaceBytes, 'Kyxos.Advanced.SurfaceA'),
      surfaceB: this.createEmptyStorage(surfaceBytes, 'Kyxos.Advanced.SurfaceB'),
      width, height, bytes: accumulationBytes + reservoirBytes * 2 + surfaceBytes * 2,
    };
    this.rebuildBindGroups();
    this.resetAccumulation();
  }

  private clearBuffer(buffer: any): void {
    if (!this.device || !buffer) return;
    const encoder = this.device.createCommandEncoder({ label: 'Kyxos.Advanced.Clear' });
    encoder.clearBuffer(buffer);
    this.device.queue.submit([encoder.finish()]);
  }

  resetAccumulation(): void {
    this.frameIndex = 0; this.samples = 0; this.ping = 0; this.lastCameraSignature = '';
    if (!this.device) return;
    const encoder = this.device.createCommandEncoder({ label: 'Kyxos.Advanced.ResetHistory' });
    if (this.pixelBuffers) {
      encoder.clearBuffer(this.pixelBuffers.accumulation); encoder.clearBuffer(this.pixelBuffers.reservoirA);
      encoder.clearBuffer(this.pixelBuffers.reservoirB); encoder.clearBuffer(this.pixelBuffers.surfaceA); encoder.clearBuffer(this.pixelBuffers.surfaceB);
    }
    if (this.sceneBuffers?.cache) encoder.clearBuffer(this.sceneBuffers.cache);
    this.device.queue.submit([encoder.finish()]);
  }

  private rebuildBindGroups(): void {
    if (!this.device || !this.computePipeline || !this.displayPipeline || !this.sceneBuffers || !this.pixelBuffers) return;
    const s = this.sceneBuffers; const p = this.pixelBuffers;
    const makeCompute = (previousReservoir: any, nextReservoir: any, previousSurface: any, nextSurface: any) => this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } },
        { binding: 1, resource: { buffer: s.triangles } }, { binding: 2, resource: { buffer: s.nodes } },
        { binding: 3, resource: { buffer: s.instances } }, { binding: 4, resource: { buffer: s.tlasNodes } },
        { binding: 5, resource: { buffer: s.materials } }, { binding: 6, resource: { buffer: s.lights } },
        { binding: 7, resource: { buffer: s.lightAlias } }, { binding: 8, resource: { buffer: p.accumulation } },
        { binding: 9, resource: { buffer: previousReservoir } }, { binding: 10, resource: { buffer: nextReservoir } },
        { binding: 11, resource: { buffer: previousSurface } }, { binding: 12, resource: { buffer: nextSurface } },
        { binding: 13, resource: { buffer: s.environmentPixels } }, { binding: 14, resource: { buffer: s.environmentAlias } },
        { binding: 15, resource: { buffer: s.cache } },
      ],
    });
    const makeDisplay = (surface: any) => this.device.createBindGroup({
      layout: this.displayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuffer } }, { binding: 1, resource: { buffer: p.accumulation } },
        { binding: 2, resource: { buffer: surface } },
      ],
    });
    this.computeBindGroups = [
      makeCompute(p.reservoirA, p.reservoirB, p.surfaceA, p.surfaceB),
      makeCompute(p.reservoirB, p.reservoirA, p.surfaceB, p.surfaceA),
    ];
    this.displayBindGroups = [makeDisplay(p.surfaceB), makeDisplay(p.surfaceA)];
  }

  private alignOverlay(mode: 'cinematic' | 'pathTracing'): void {
    const rect = this.baseCanvas.getBoundingClientRect();
    this.overlay.style.left = `${rect.left}px`; this.overlay.style.top = `${rect.top}px`;
    this.overlay.style.width = `${Math.max(1, rect.width)}px`; this.overlay.style.height = `${Math.max(1, rect.height)}px`;
    this.overlay.style.borderRadius = getComputedStyle(this.baseCanvas).borderRadius;
    const dpr = Math.min(2, window.devicePixelRatio || 1); const configuredScale = this.settings.pathTracing.resolutionScale;
    const scale = mode === 'cinematic' ? Math.min(0.5, configuredScale) : configuredScale;
    let width = Math.max(1, Math.floor(rect.width * dpr * scale)); let height = Math.max(1, Math.floor(rect.height * dpr * scale));
    const maxDimension = mode === 'cinematic' ? 1280 : 1920; const downscale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.floor(width * downscale)); height = Math.max(1, Math.floor(height * downscale));
    if (this.overlay.width !== width || this.overlay.height !== height || this.lastScale !== scale) {
      this.overlay.width = width; this.overlay.height = height; this.lastScale = scale; this.ensurePixelBuffers(width, height);
    }
  }

  protected cameraData(camera: any): { data: Float32Array; signature: string } {
    camera.updateMatrixWorld?.(true);
    const e = camera.matrixWorld?.elements as number[] | undefined;
    const position = e ? [e[12], e[13], e[14]] : [0, 0, 5];
    const forward = e ? [-e[8], -e[9], -e[10]] : [0, 0, -1];
    const right = e ? [e[0], e[1], e[2]] : [1, 0, 0]; const up = e ? [e[4], e[5], e[6]] : [0, 1, 0];
    const aspect = this.pixelBuffers ? this.pixelBuffers.width / Math.max(1, this.pixelBuffers.height) : 1;
    const tanHalfFov = Math.tan(((Number(camera.fov) || 50) * Math.PI) / 360); const materialCount = Math.max(1, this.scene?.materialCount ?? 1);
    const mode = this.settings.renderingMode; const bounces = mode === 'cinematic' ? Math.min(3, this.settings.pathTracing.maxBounces) : this.settings.pathTracing.maxBounces;
    const restir = this.settings.restirDI; const data = new Float32Array(36);
    data.set([...position, tanHalfFov], 0); data.set([...forward, aspect], 4); data.set([...right, this.frameIndex], 8);
    data.set([...up, this.scene?.instanceCount ?? 0], 12);
    data.set([this.pixelBuffers?.width ?? 1, this.pixelBuffers?.height ?? 1, bounces, this.scene?.lightCount ?? 0], 16);
    data.set([this.scene?.triangleCount ?? 0, this.scene?.blasNodeCount ?? 0, this.scene?.environmentWidth ?? 1, this.scene?.environmentHeight ?? 1], 20);
    data.set([restirModeNumber(restir.mode), restir.candidates, restir.spatialSamples, this.settings.radianceCache.enabled ? 1 : 0], 24);
    data.set([1, this.settings.pathTracing.denoise ? 1 : 0, this.settings.pathTracing.fireflyClamp, this.settings.pathTracing.samplesPerFrame], 28);
    data.set([this.settings.radianceCache.cellSize, this.sceneBuffers?.cacheCapacity ?? this.settings.radianceCache.capacity, this.settings.radianceCache.updateRatio, materialCount], 32);
    const signature = [...position, ...forward, ...right, ...up, Number(camera.fov) || 50, aspect].map((v) => Number(v).toFixed(5)).join('|');
    return { data, signature };
  }

  render(camera: any, mode: 'cinematic' | 'pathTracing'): AdvancedGpuMetrics | null {
    if (!this.initialized || !this.device || !this.scene || !this.sceneBuffers) return null;
    this.alignOverlay(mode);
    if (!this.pixelBuffers || !this.computeBindGroups.length || !this.displayBindGroups.length) return null;
    this.overlay.style.display = 'block'; const start = performance.now(); const cameraData = this.cameraData(camera);
    if (this.lastCameraSignature && cameraData.signature !== this.lastCameraSignature) this.resetAccumulation();
    this.lastCameraSignature = cameraData.signature; const refreshed = this.cameraData(camera);
    this.device.queue.writeBuffer(this.globalsBuffer, 0, refreshed.data.buffer, refreshed.data.byteOffset, refreshed.data.byteLength);
    try {
      const encoder = this.device.createCommandEncoder({ label: 'Kyxos.Advanced.Frame' });
      const compute = encoder.beginComputePass({ label: 'Kyxos.Advanced.PathTrace' });
      compute.setPipeline(this.computePipeline); compute.setBindGroup(0, this.computeBindGroups[this.ping]);
      compute.dispatchWorkgroups(Math.ceil(this.pixelBuffers.width / 8), Math.ceil(this.pixelBuffers.height / 8)); compute.end();
      const render = encoder.beginRenderPass({ label: 'Kyxos.Advanced.Resolve', colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      render.setPipeline(this.displayPipeline); render.setBindGroup(0, this.displayBindGroups[this.ping]); render.draw(3); render.end();
      this.device.queue.submit([encoder.finish()]); this.frameIndex += 1; this.samples += this.settings.pathTracing.samplesPerFrame; this.ping = 1 - this.ping;
      this.lastCpuFrameTimeMs = performance.now() - start;
    } catch (error) { this.options.onError?.(error); throw error; }
    return this.getMetrics();
  }

  hide(): void { this.overlay.style.display = 'none'; }
  getMetrics(): AdvancedGpuMetrics {
    const historyBytes = this.pixelBuffers?.bytes ?? 0; const sceneBytes = this.scene?.estimatedBytes ?? 0; const cacheBytes = (this.sceneBuffers?.cacheCapacity ?? 0) * 20;
    return { width: this.pixelBuffers?.width ?? 0, height: this.pixelBuffers?.height ?? 0, samples: this.samples, cpuFrameTimeMs: this.lastCpuFrameTimeMs, sceneBytes, historyBytes, cacheBytes, totalBytes: sceneBytes + historyBytes + cacheBytes };
  }
  async capture(mimeType = 'image/png', quality = 0.92): Promise<Blob> { return canvasBlob(this.overlay, mimeType, quality); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.hide(); this.destroyPixelBuffers(); this.destroySceneBuffers(); destroyBuffer(this.globalsBuffer);
    this.globalsBuffer = null; this.computeBindGroups = []; this.displayBindGroups = [];
    try { this.context?.unconfigure?.(); } catch { /* ignored */ }
    this.overlay.remove(); this.device = null; this.adapter = null; this.context = null; this.initialized = false;
  }
}