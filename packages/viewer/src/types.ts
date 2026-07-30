import type { Texture } from 'three/webgpu';
import type {
  Annotation,
  AnimationClipSummary,
  CameraState,
  CompatibilityResult,
  EnvironmentState,
  KyxosResult,
  KyxosSceneDocument,
  RuntimeMaterial,
  SceneGraphNode,
  SceneLight,
  TransformState,
  ViewerCapabilities,
} from '@kyxos/scene-contract';

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
  'asset-progress': CustomEvent<{ loaded: number; total?: number; url: string }>;
  'asset-ready': CustomEvent<{ assetId: string | null }>;
  'selection-change': CustomEvent<{ objectId: string | null }>;
  'camera-change': CustomEvent<CameraState>;
  'animation-change': CustomEvent<{ activeClipId: string | null; playing: boolean; time: number }>;
  'scene-dirty': CustomEvent<{ reason: string }>;
  warning: CustomEvent<{ effect?: EffectName; message: string }>;
  error: CustomEvent<{ effect?: EffectName; error: unknown }>;
  disposed: CustomEvent<void>;
}

export type {
  Annotation,
  AnimationClipSummary,
  CameraState,
  CompatibilityResult,
  EnvironmentState,
  KyxosResult,
  KyxosSceneDocument,
  RuntimeMaterial,
  SceneGraphNode,
  SceneLight,
  TransformState,
  ViewerCapabilities,
};
