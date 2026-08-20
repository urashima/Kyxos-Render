import type {
  AdvancedRendererTier,
  AdvancedRenderingCapabilityDescription,
} from '@kyxos/scene-contract/advanced-render-settings';

/** Packed compute shader resource contract. Keep this in sync with webgpuPackedRenderer. */
export const ADVANCED_STORAGE_BUFFERS_PER_STAGE = 8;
export const ADVANCED_MIN_COMPUTE_INVOCATIONS = 64;

export interface RuntimeGpuLimits {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxComputeWorkgroupStorageSize: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxStorageBuffersPerShaderStage: number;
}

export interface AdvancedRendererCapabilities extends AdvancedRenderingCapabilityDescription {
  limits: RuntimeGpuLimits;
}

const ZERO_LIMITS: RuntimeGpuLimits = {
  maxStorageBufferBindingSize: 0,
  maxBufferSize: 0,
  maxComputeWorkgroupStorageSize: 0,
  maxComputeInvocationsPerWorkgroup: 0,
  maxStorageBuffersPerShaderStage: 0,
};

function readLimit(limits: Record<string, unknown> | undefined, key: string): number {
  const value = Number(limits?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hasAdvancedBindingBudget(limits: RuntimeGpuLimits): boolean {
  return limits.maxStorageBuffersPerShaderStage >= ADVANCED_STORAGE_BUFFERS_PER_STAGE &&
    limits.maxComputeInvocationsPerWorkgroup >= ADVANCED_MIN_COMPUTE_INVOCATIONS;
}

function classifyTier(limits: RuntimeGpuLimits): AdvancedRendererTier {
  if (!hasAdvancedBindingBudget(limits)) return 'webgpu-basic';
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
    maxStorageBuffersPerShaderStage: readLimit(limitsSource ?? undefined, 'maxStorageBuffersPerShaderStage'),
  };
  const tier = classifyTier(limits);
  const enhanced = tier === 'webgpu-enhanced' || tier === 'webgpu-cinematic';

  let reason: string | undefined;
  if (!enhanced) {
    reason = !hasAdvancedBindingBudget(limits)
      ? `WebGPU is available, but this adapter exposes ${limits.maxStorageBuffersPerShaderStage} storage buffers per shader stage; Kyxos packed RT requires ${ADVANCED_STORAGE_BUFFERS_PER_STAGE}. High raster fallback is active.`
      : 'WebGPU is available, but the adapter storage-buffer size budget is below the Kyxos RT Enhanced baseline.';
  }

  return {
    tier,
    compute: true,
    storageBuffer: true,
    softwareRayQuery: enhanced,
    restirDI: enhanced,
    radianceCache: enhanced,
    pathTracing: enhanced,
    reason,
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
