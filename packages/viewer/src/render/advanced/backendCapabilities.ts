import type {
  AdvancedRendererTier,
  AdvancedRenderingCapabilityDescription,
} from '@kyxos/scene-contract/advanced-render-settings';

export interface RuntimeGpuLimits {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxComputeWorkgroupStorageSize: number;
  maxComputeInvocationsPerWorkgroup: number;
}

export interface AdvancedRendererCapabilities extends AdvancedRenderingCapabilityDescription {
  limits: RuntimeGpuLimits;
}

const ZERO_LIMITS: RuntimeGpuLimits = {
  maxStorageBufferBindingSize: 0,
  maxBufferSize: 0,
  maxComputeWorkgroupStorageSize: 0,
  maxComputeInvocationsPerWorkgroup: 0,
};

function readLimit(limits: Record<string, unknown> | undefined, key: string): number {
  const value = Number(limits?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function classifyTier(limits: RuntimeGpuLimits): AdvancedRendererTier {
  if (limits.maxStorageBufferBindingSize >= 128 * 1024 * 1024 && limits.maxBufferSize >= 256 * 1024 * 1024) {
    return 'webgpu-cinematic';
  }
  if (limits.maxStorageBufferBindingSize >= 64 * 1024 * 1024 && limits.maxBufferSize >= 128 * 1024 * 1024) {
    return 'webgpu-enhanced';
  }
  return 'webgpu-basic';
}

export function resolveAdvancedRendererCapabilities(
  backend: 'webgpu' | 'webgl2',
  limitsSource?: Record<string, unknown> | null,
): AdvancedRendererCapabilities {
  if (backend !== 'webgpu') {
    return {
      tier: 'webgl',
      compute: false,
      storageBuffer: false,
      softwareRayQuery: false,
      restirDI: false,
      radianceCache: false,
      pathTracing: false,
      reason: 'Advanced rendering requires WebGPU; the WebGL2 realtime raster fallback is active.',
      limits: ZERO_LIMITS,
    };
  }

  const limits: RuntimeGpuLimits = {
    maxStorageBufferBindingSize: readLimit(limitsSource ?? undefined, 'maxStorageBufferBindingSize'),
    maxBufferSize: readLimit(limitsSource ?? undefined, 'maxBufferSize'),
    maxComputeWorkgroupStorageSize: readLimit(limitsSource ?? undefined, 'maxComputeWorkgroupStorageSize'),
    maxComputeInvocationsPerWorkgroup: readLimit(limitsSource ?? undefined, 'maxComputeInvocationsPerWorkgroup'),
  };
  const tier = classifyTier(limits);
  const enhanced = tier === 'webgpu-enhanced' || tier === 'webgpu-cinematic';

  return {
    tier,
    compute: true,
    storageBuffer: true,
    softwareRayQuery: enhanced,
    restirDI: enhanced,
    radianceCache: enhanced,
    pathTracing: enhanced,
    reason: enhanced
      ? undefined
      : 'WebGPU is available, but the adapter storage-buffer budget is below the Kyxos RT Enhanced baseline.',
    limits,
  };
}

export async function queryBrowserAdvancedRendererCapabilities(): Promise<AdvancedRendererCapabilities> {
  const gpu = (globalThis.navigator as Navigator & { gpu?: any } | undefined)?.gpu;
  if (!gpu?.requestAdapter) return resolveAdvancedRendererCapabilities('webgl2');

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return resolveAdvancedRendererCapabilities('webgl2');
    const limits = adapter.limits as Record<string, unknown>;
    return resolveAdvancedRendererCapabilities('webgpu', limits);
  } catch (error) {
    const fallback = resolveAdvancedRendererCapabilities('webgl2');
    return {
      ...fallback,
      reason: `WebGPU capability query failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
