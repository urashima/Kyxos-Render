import {
  WebGpuHybridRenderer as BaseWebGpuHybridRenderer,
  type AdvancedGpuMetrics,
  type AdvancedGpuRendererOptions,
} from './webgpuHybridRendererBase';

export type { AdvancedGpuMetrics, AdvancedGpuRendererOptions };

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/**
 * Runtime-facing wrapper around the implementation class. Keeping the large GPU
 * implementation in a base module makes targeted compatibility fixes reviewable
 * without duplicating the shader/resource lifecycle code.
 */
export class WebGpuHybridRenderer extends BaseWebGpuHybridRenderer {
  constructor(baseCanvas: HTMLCanvasElement, options: AdvancedGpuRendererOptions = {}) {
    super(baseCanvas, options);
    const self = this as any;
    self.cameraData = (camera: any): { data: Float32Array; signature: string } => {
      camera.updateMatrixWorld?.(true);
      const elements = camera.matrixWorld?.elements as number[] | undefined;
      const position = elements
        ? [Number(elements[12]) || 0, Number(elements[13]) || 0, Number(elements[14]) || 0]
        : [Number(camera.position?.x) || 0, Number(camera.position?.y) || 0, Number(camera.position?.z) || 5];
      const right = elements ? normalize3(elements[0], elements[1], elements[2]) : [1, 0, 0] as [number, number, number];
      const up = elements ? normalize3(elements[4], elements[5], elements[6]) : [0, 1, 0] as [number, number, number];
      const forward = elements ? normalize3(-elements[8], -elements[9], -elements[10]) : [0, 0, -1] as [number, number, number];
      const aspect = self.pixelBuffers ? self.pixelBuffers.width / Math.max(1, self.pixelBuffers.height) : 1;
      const perspectiveFov = Number(camera.fov) || 50;
      // Orthographic cameras use the vertical span to derive a conservative ray
      // cone. The compute shader still uses a perspective-style origin, but this
      // keeps editor orthographic views stable instead of producing NaNs.
      const orthoSpan = Math.abs(Number(camera.top) - Number(camera.bottom));
      const tanHalfFov = camera.isOrthographicCamera
        ? Math.max(0.001, orthoSpan * 0.5 / Math.max(0.001, Math.abs(Number(camera.position?.z) || 5)))
        : Math.tan((perspectiveFov * Math.PI) / 360);
      const materialCount = Math.max(1, self.scene?.materialCount ?? 1);
      const mode = self.settings.renderingMode;
      const bounces = mode === 'cinematic'
        ? Math.min(3, self.settings.pathTracing.maxBounces)
        : self.settings.pathTracing.maxBounces;
      const restir = self.settings.restirDI;
      const restirMode = restir.mode === 'initial' ? 1 : restir.mode === 'temporal' ? 2 : restir.mode === 'temporalSpatial' ? 3 : 0;
      const data = new Float32Array(36);
      data.set([...position, tanHalfFov], 0);
      data.set([...forward, aspect], 4);
      data.set([...right, self.frameIndex], 8);
      data.set([...up, camera.isOrthographicCamera ? 1 : 0], 12);
      data.set([
        self.pixelBuffers?.width ?? 1,
        self.pixelBuffers?.height ?? 1,
        bounces,
        self.scene?.lightCount ?? 0,
      ], 16);
      data.set([
        self.scene?.triangleCount ?? 0,
        self.scene?.bvh.nodes.length ?? 0,
        self.scene?.environmentWidth ?? 1,
        self.scene?.environmentHeight ?? 1,
      ], 20);
      data.set([
        restirMode,
        restir.candidates,
        restir.spatialSamples,
        self.settings.radianceCache.enabled ? 1 : 0,
      ], 24);
      data.set([
        1,
        self.settings.pathTracing.denoise ? 1 : 0,
        self.settings.pathTracing.fireflyClamp,
        self.settings.pathTracing.samplesPerFrame,
      ], 28);
      data.set([
        self.settings.radianceCache.cellSize,
        self.sceneBuffers?.cacheCapacity ?? self.settings.radianceCache.capacity,
        self.settings.radianceCache.updateRatio,
        materialCount,
      ], 32);
      const signature = [
        ...position,
        ...forward,
        ...right,
        ...up,
        perspectiveFov,
        camera.zoom ?? 1,
        camera.left ?? 0,
        camera.right ?? 0,
        camera.top ?? 0,
        camera.bottom ?? 0,
        aspect,
      ].map((value) => Number(value).toFixed(5)).join('|');
      return { data, signature };
    };
  }
}
