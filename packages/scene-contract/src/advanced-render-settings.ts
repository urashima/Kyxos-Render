export type AdvancedRenderingMode = 'realtime' | 'cinematic' | 'pathTracing';
export type RestirDIMode = 'off' | 'initial' | 'temporal' | 'temporalSpatial';
export type AdvancedRendererTier = 'webgl' | 'webgpu-basic' | 'webgpu-enhanced' | 'webgpu-cinematic';

export interface SceneRestirDISettings {
  mode: RestirDIMode;
  candidates: number;
  spatialSamples: number;
}

export interface SceneRadianceCacheSettings {
  enabled: boolean;
  cellSize: number;
  capacity: number;
  updateRatio: number;
}

export interface ScenePathTracingSettings {
  maxBounces: number;
  samplesPerFrame: number;
  denoise: boolean;
  fireflyClamp: number;
  resolutionScale: number;
}

export interface SceneAdvancedRenderSettings {
  renderingMode: AdvancedRenderingMode;
  restirDI: SceneRestirDISettings;
  radianceCache: SceneRadianceCacheSettings;
  pathTracing: ScenePathTracingSettings;
}

export interface AdvancedRenderingCapabilityDescription {
  tier: AdvancedRendererTier;
  compute: boolean;
  storageBuffer: boolean;
  softwareRayQuery: boolean;
  restirDI: boolean;
  radianceCache: boolean;
  pathTracing: boolean;
  reason?: string;
}

export const DEFAULT_ADVANCED_RENDER_SETTINGS: SceneAdvancedRenderSettings = {
  renderingMode: 'realtime',
  restirDI: {
    mode: 'temporalSpatial',
    candidates: 8,
    spatialSamples: 8,
  },
  radianceCache: {
    enabled: true,
    cellSize: 0.5,
    capacity: 65536,
    updateRatio: 0.04,
  },
  pathTracing: {
    maxBounces: 8,
    samplesPerFrame: 1,
    denoise: true,
    fireflyClamp: 20,
    resolutionScale: 0.5,
  },
};

function finite(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.round(finite(value, fallback, minimum, maximum));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeAdvancedRenderSettings(value: unknown): SceneAdvancedRenderSettings {
  const source = record(value);
  const restir = record(source.restirDI);
  const cache = record(source.radianceCache);
  const path = record(source.pathTracing);
  const defaults = DEFAULT_ADVANCED_RENDER_SETTINGS;

  const renderingMode: AdvancedRenderingMode =
    source.renderingMode === 'cinematic' || source.renderingMode === 'pathTracing'
      ? source.renderingMode
      : 'realtime';
  const mode: RestirDIMode =
    restir.mode === 'off' ||
    restir.mode === 'initial' ||
    restir.mode === 'temporal' ||
    restir.mode === 'temporalSpatial'
      ? restir.mode
      : defaults.restirDI.mode;

  return {
    renderingMode,
    restirDI: {
      mode,
      candidates: integer(restir.candidates, defaults.restirDI.candidates, 1, 32),
      spatialSamples: integer(restir.spatialSamples, defaults.restirDI.spatialSamples, 0, 32),
    },
    radianceCache: {
      enabled: cache.enabled !== false,
      cellSize: finite(cache.cellSize, defaults.radianceCache.cellSize, 0.05, 16),
      capacity: integer(cache.capacity, defaults.radianceCache.capacity, 1024, 1048576),
      updateRatio: finite(cache.updateRatio, defaults.radianceCache.updateRatio, 0.0025, 1),
    },
    pathTracing: {
      maxBounces: integer(path.maxBounces, defaults.pathTracing.maxBounces, 1, 16),
      samplesPerFrame: integer(path.samplesPerFrame, defaults.pathTracing.samplesPerFrame, 1, 4),
      denoise: path.denoise !== false,
      fireflyClamp: finite(path.fireflyClamp, defaults.pathTracing.fireflyClamp, 1, 1000),
      resolutionScale: finite(path.resolutionScale, defaults.pathTracing.resolutionScale, 0.25, 1),
    },
  };
}
