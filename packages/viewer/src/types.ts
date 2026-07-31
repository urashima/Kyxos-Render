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
  | 'emissive'
  | 'sssMask'
  | 'sssThickness'
  | 'sssStochastic'
  | 'sssTemporal'
  | 'sssDiffusion'
  | 'sssTranslucency';

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

export type ScreenSpaceSSSQuality = 'low' | 'medium' | 'high';

/**
 * Deferred, material-selective screen-space subsurface scattering controls.
 * `materialNames` matches mesh or material names; null/empty selects every
 * eligible non-metal PBR material unless userData.kyxosSSS is explicitly false.
 *
 * Low/Medium/High evaluate 2/4/6 stochastic color taps per frame. Temporal
 * reprojection accumulates those samples into the published 5/7-tap target
 * profiles while rejecting invalid history with depth, normal and velocity.
 */
export interface ScreenSpaceSSSSettings {
  enabled: boolean;
  color: string;
  strength: number;
  radius: number;
  falloff: [number, number, number];
  thickness: number;
  depthFalloff: number;
  normalThreshold: number;
  quality: ScreenSpaceSSSQuality;
  temporalFiltering: boolean;
  temporalMaxFrames: number;
  temporalClamp: number;
  temporalFlickerSuppression: number;
  materialNames?: string[] | null;
}

export interface ScreenSpaceSSSStatus extends ScreenSpaceSSSSettings {
  materialNames: string[] | null;
  samplesPerFrame: number;
  temporalActive: boolean;
  markedMaterials: number;
  eligibleMaterials: number;
  lastError: string | null;
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
