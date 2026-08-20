import { realtimeHybridRtWGSL as realtimeHybridRtV2WGSL } from './realtimeHybridRtShaderV2';
import { findReservedWGSLIdentifiers, sanitizePortableWGSL } from './webgpuShadersPortable';

const FEATURE_BINDINGS = `@group(0) @binding(7) var reflectionOutput: texture_storage_2d<rgba16float, write>;`;
const FEATURE_BINDINGS_V3 = `${FEATURE_BINDINGS}\n@group(0) @binding(8) var refractionOutput: texture_storage_2d<rgba16float, write>;`;

const GLOBALS_END = `  featureInfo: vec4<f32>,\n};`;
const GLOBALS_END_V3 = `  featureInfo: vec4<f32>,\n  refractionInfo: vec4<f32>,\n};`;

const NEUTRAL_REFLECTION = `textureStore(reflectionOutput, pixel, vec4<f32>(0.0, 0.0, 0.0, 1e4));`;
const NEUTRAL_REFLECTION_V3 = `${NEUTRAL_REFLECTION} textureStore(refractionOutput, pixel, vec4<f32>(0.0, 0.0, 0.0, 1e4));`;
const NEUTRAL_VISIBILITY = `textureStore(visibilityOutput, pixel, vec4<f32>(1.0));`;
const NEUTRAL_VISIBILITY_V3 = `textureStore(visibilityOutput, pixel, vec4<f32>(1.0, 1.0, 1.0, 0.0));`;
const INITIAL_VISIBILITY = `textureStore(visibilityOutput, pixel, vec4<f32>(1.0, 1.0, 1.0, 1.0));`;
const INITIAL_VISIBILITY_V3 = `textureStore(visibilityOutput, pixel, vec4<f32>(1.0, 1.0, 1.0, 0.0));`;

const PRIMARY_BIAS = `  let metalRough = textureLoad(metalRoughTexture, pixel, 0).rg;\n  let bias = clamp(globals.rayInfo.x, 0.0001, 0.02);`;
const PRIMARY_BIAS_V3 = `${PRIMARY_BIAS}\n  var transmissionValue = 0.0;\n  var primaryIor = 1.5;\n  if (globals.refractionInfo.x > 0.5) {\n    let cameraPositionForMaterial = globals.cameraWorld[3].xyz;\n    let primaryMaterialHit = traceClosest(cameraPositionForMaterial, rayValue.xyz, length(worldPosition - cameraPositionForMaterial) + bias * 8.0);\n    if (primaryMaterialHit.positionDistance.w > 0.0) {\n      let primaryMaterialCount = max(1u, u32(globals.sceneCounts1.w + 0.5));\n      let primaryMaterialIndex = min(u32(max(0.0, primaryMaterialHit.normalMaterial.w)), primaryMaterialCount - 1u);\n      let primaryMaterial = loadMaterial(primaryMaterialIndex);\n      transmissionValue = clamp(primaryMaterial.parameters.x, 0.0, 1.0);\n      primaryIor = clamp(primaryMaterial.parameters.y, 1.0001, 3.0);\n    }\n  }`;

const VISIBILITY_STORE = `textureStore(visibilityOutput, pixel, vec4<f32>(min(aoVisibility, shadowVisibility), shadowVisibility, aoVisibility, 1.0));`;
const VISIBILITY_STORE_V3 = `textureStore(visibilityOutput, pixel, vec4<f32>(min(aoVisibility, shadowVisibility), shadowVisibility, aoVisibility, transmissionValue));`;

const REFLECTION_STORE = `  textureStore(reflectionOutput, pixel, vec4<f32>(reflectionColor, rayLength));`;
const REFLECTION_AND_REFRACTION_STORE = `${REFLECTION_STORE}\n  var refractionColor = vec3<f32>(0.0);\n  var refractionRayLength = 1e4;\n  if (globals.refractionInfo.x > 0.5 && transmissionValue > 1e-4 && metalRough.y <= globals.refractionInfo.y) {\n    let eta = 1.0 / max(primaryIor, 1.0001);\n    let idealRefraction = refract(rayValue.xyz, worldNormal, eta);\n    if (dot(idealRefraction, idealRefraction) > 1e-8) {\n      let roughnessMix = clamp(metalRough.y * metalRough.y, 0.0, 0.95);\n      let refractionDirection = safeDirection(mix(idealRefraction, randomHemisphere(-worldNormal), roughnessMix));\n      let refractionOrigin = worldPosition - worldNormal * bias + refractionDirection * bias * 2.0;\n      let refractionHit = traceClosest(refractionOrigin, refractionDirection, 1e20);\n      if (refractionHit.positionDistance.w > 0.0) {\n        refractionRayLength = refractionHit.positionDistance.w;\n        let materialCount = max(1u, u32(globals.sceneCounts1.w + 0.5));\n        let materialIndex = min(u32(max(0.0, refractionHit.normalMaterial.w)), materialCount - 1u);\n        let materialValue = loadMaterial(materialIndex);\n        let throughEnvironment = environmentRadiance(refractionDirection);\n        refractionColor = max(materialValue.emissiveRough.rgb, vec3<f32>(0.0)) + max(materialValue.baseMetal.rgb, vec3<f32>(0.0)) * throughEnvironment;\n      } else {\n        refractionColor = environmentRadiance(refractionDirection);\n      }\n    }\n  }\n  textureStore(refractionOutput, pixel, vec4<f32>(refractionColor, refractionRayLength));`;

const migratedRealtimeRtWGSL = realtimeHybridRtV2WGSL
  .replace(GLOBALS_END, GLOBALS_END_V3)
  .replace(FEATURE_BINDINGS, FEATURE_BINDINGS_V3)
  .replaceAll(NEUTRAL_REFLECTION, NEUTRAL_REFLECTION_V3)
  .replaceAll(INITIAL_VISIBILITY, INITIAL_VISIBILITY_V3)
  .replaceAll(NEUTRAL_VISIBILITY, NEUTRAL_VISIBILITY_V3)
  .replace(PRIMARY_BIAS, PRIMARY_BIAS_V3)
  .replace(VISIBILITY_STORE, VISIBILITY_STORE_V3)
  .replace(REFLECTION_STORE, REFLECTION_AND_REFRACTION_STORE);

const realtimeHybridRtWGSL = sanitizePortableWGSL(migratedRealtimeRtWGSL);
const reservedIdentifiers = findReservedWGSLIdentifiers(realtimeHybridRtWGSL);

if (
  migratedRealtimeRtWGSL === realtimeHybridRtV2WGSL ||
  !realtimeHybridRtWGSL.includes('refractionInfo: vec4<f32>') ||
  !realtimeHybridRtWGSL.includes('@binding(8) var refractionOutput') ||
  !realtimeHybridRtWGSL.includes('transmissionValue') ||
  !realtimeHybridRtWGSL.includes('refract(rayValue.xyz') ||
  !realtimeHybridRtWGSL.includes('textureStore(refractionOutput') ||
  realtimeHybridRtWGSL.includes('vec4<f32>(1.0, 1.0, 1.0, 1.0)') ||
  realtimeHybridRtWGSL.includes('.negate()') ||
  reservedIdentifiers.length > 0
) {
  throw new Error(`Realtime RT V3 WGSL portability migration failed${reservedIdentifiers.length ? `: ${reservedIdentifiers.join(', ')}` : ''}.`);
}

export { realtimeHybridRtWGSL };
