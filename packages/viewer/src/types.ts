import type { Texture } from 'three/webgpu';

export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';
export type BackendName = 'webgpu' | 'webgl2';
export type QualityPresetName = 'low' | 'medium' | 'high' | 'cinematic' | 'capture';
export type DebugView =
  | 'final'
  | 'beauty'
  | 'depth'
  | 'velocity'
  | 'normal'
  | 'diffuseColor'
  | 'metalness'
  | 'roughness'
  | 'emissive';

export type EffectName =
  | 'traa'
  | 'fxaa'
  | 'smaa'
  | 'ssaa'
  | 'gtao'
  | 'ssao'
  | 'ssr'
  | 'ssgi'
  | 'temporalReprojection'
  | 'poissonDenoise'
  | 'temporalDenoise'
  | 'motionBlur'
  | 'bloom'
  | 'dof'
  | 'lut'
  | 'lensDistortion'
  | 'sharpness'
  | 'sparkle'
  | 'gradualBackground';

export interface EffectSettings {
  enabled: boolean;
  resolutionScale?: number;
  intensity?: number;
  radius?: number;
  quality?: number;
  samples?: number;
  thickness?: number;
  strength?: number;
  threshold?: number;
  focusDistance?: number;
  focalLength?: number;
  bokehScale?: number;
  amount?: number;
  maxDistance?: number;
  mirrorBias?: number;
  sliceCount?: number;
  stepCount?: number;
  temporalFiltering?: boolean;
  [key: string]: unknown;
}

export type EffectsState = Record<EffectName, EffectSettings>;

export interface KyxosViewerCreateOptions {
  canvas: HTMLCanvasElement;
  backend?: BackendPreference;
  quality?: QualityPresetName;
  pixelRatio?: number;
  autoStart?: boolean;
}

export type TextureInput = string | Texture | null | undefined;

export interface MaterialTextureInputs {
  baseColor?: TextureInput;
  normal?: TextureInput;
  roughness?: TextureInput;
  metalness?: TextureInput;
  ao?: TextureInput;
  emissive?: TextureInput;
}

/**
 * Parameters for Three.js' official MeshSSSNodeMaterial lighting model.
 * The optional thickness map is sampled in linear space and multiplied by color.
 */
export interface SSSMaterialSettings {
  enabled: boolean;
  color: string;
  distortion: number;
  ambient: number;
  attenuation: number;
  power: number;
  scale: number;
  thicknessMap?: TextureInput;
}

export interface SSSMaterialStatus extends Omit<SSSMaterialSettings, 'thicknessMap'> {
  hasThicknessMap: boolean;
  convertedMaterials: number;
}

export interface ViewerMetrics {
  backend: BackendName;
  fps: number;
  cpuFrameTimeMs: number;
  gpuFrameTimeMs: number | null;
  drawCalls: number;
  triangles: number;
  textures: number;
  renderTargets: number;
  totalGpuBytes: number;
  width: number;
  height: number;
  pixelRatio: number;
}

export interface CaptureOptions {
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number;
  scale?: number;
}

export type StressTestName = 'resize' | 'toggle' | 'model' | 'environment';

export interface StressResult {
  name: string;
  iterations: number;
  before: ViewerMetrics;
  after: ViewerMetrics;
  textureDelta: number;
  renderTargetDelta: number;
  passed: boolean;
  durationMs: number;
  note?: string;
}

export interface ViewerEventMap {
  ready: CustomEvent<ViewerMetrics>;
  metrics: CustomEvent<ViewerMetrics>;
  warning: CustomEvent<{ effect?: EffectName; message: string }>;
  error: CustomEvent<{ effect?: EffectName; error: unknown }>;
  disposed: CustomEvent<void>;
}
