import {
  advancedPathTracingComputeWGSL as baseComputeWGSL,
  advancedPathTracingDisplayWGSL,
} from './webgpuShadersBase';

// Keep the long WGSL source readable while applying browser-facing fixes in one
// auditable place. The base shader intentionally mirrors the algorithm layout;
// these replacements correct WGSL mutability and use the dedicated material-count
// lane instead of overloading the radiance-cache enable lane.
export const advancedPathTracingComputeWGSL = baseComputeWGSL
  .replace('let attenuation = 1.0 / max(1.0, pow(distance, max(0.0, decay)));',
    'var attenuation = 1.0 / max(1.0, pow(distance, max(0.0, decay)));')
  .replace('let stored = atomicLoad(&cache[slot].tag);\n    if (stored == 0u) {',
    'var stored = atomicLoad(&cache[slot].tag);\n    if (stored == 0u) {')
  .replace(
    "let index = min(u32(max(0.0, hit.normalMaterial.w)), max(0u, u32(globals.modes.w) - 1u));",
    "let index = min(u32(max(0.0, hit.normalMaterial.w)), max(1u, u32(globals.cacheInfo.w)) - 1u);",
  );

export { advancedPathTracingDisplayWGSL };
