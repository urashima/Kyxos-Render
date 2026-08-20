import { realtimeHybridRtWGSL as generatedHybridRtWGSL } from './realtimeHybridRtRayShader';

const LEGACY_TRIANGLE_STRUCT = 'struct Triangle { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, normalMaterial: vec4<f32>, };';
const SMOOTH_TRIANGLE_STRUCT = 'struct Triangle { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, normalMaterial: vec4<f32>, normalA: vec4<f32>, normalB: vec4<f32>, normalC: vec4<f32>, };';
const LEGACY_TRIANGLE_LOAD = `fn loadTriangle(indexValue: u32) -> Triangle {
  let baseOffset = u32(globals.staticLayout0.x) + indexValue * 4u;
  var value: Triangle;
  value.a = staticScene[baseOffset]; value.b = staticScene[baseOffset + 1u]; value.c = staticScene[baseOffset + 2u]; value.normalMaterial = staticScene[baseOffset + 3u];
  return value;
}`;
const SMOOTH_TRIANGLE_LOAD = `fn loadTriangle(indexValue: u32) -> Triangle {
  let baseOffset = u32(globals.staticLayout0.x) + indexValue * 7u;
  var value: Triangle;
  value.a = staticScene[baseOffset];
  value.b = staticScene[baseOffset + 1u];
  value.c = staticScene[baseOffset + 2u];
  value.normalMaterial = staticScene[baseOffset + 3u];
  value.normalA = staticScene[baseOffset + 4u];
  value.normalB = staticScene[baseOffset + 5u];
  value.normalC = staticScene[baseOffset + 6u];
  return value;
}
fn triangleShadingNormal(triangleValue: Triangle, positionValue: vec3<f32>) -> vec3<f32> {
  let edge0 = triangleValue.b.xyz - triangleValue.a.xyz;
  let edge1 = triangleValue.c.xyz - triangleValue.a.xyz;
  let relative = positionValue - triangleValue.a.xyz;
  let d00 = dot(edge0, edge0);
  let d01 = dot(edge0, edge1);
  let d11 = dot(edge1, edge1);
  let d20 = dot(relative, edge0);
  let d21 = dot(relative, edge1);
  let denominator = d00 * d11 - d01 * d01;
  if (abs(denominator) < 1e-12) { return safeDirection(triangleValue.normalMaterial.xyz); }
  let baryV = (d11 * d20 - d01 * d21) / denominator;
  let baryW = (d00 * d21 - d01 * d20) / denominator;
  let baryU = 1.0 - baryV - baryW;
  return safeDirection(
    triangleValue.normalA.xyz * baryU +
    triangleValue.normalB.xyz * baryV +
    triangleValue.normalC.xyz * baryW
  );
}`;

const LEGACY_FLAT_HIT = 'let faceNormal = safeDirection(triangleValue.normalMaterial.xyz); resultValue.normalMaterial = vec4<f32>(select(faceNormal, -faceNormal, dot(faceNormal, direction) > 0.0), triangleValue.normalMaterial.w);';
const SMOOTH_HIT = 'let shadingNormal = triangleShadingNormal(triangleValue, resultValue.positionDistance.xyz); resultValue.normalMaterial = vec4<f32>(select(shadingNormal, -shadingNormal, dot(shadingNormal, direction) > 0.0), triangleValue.normalMaterial.w);';

const LEGACY_PRIMARY = `  let pixel = vec2<i32>(i32(invocation.x), i32(invocation.y)); let linearIndex = invocation.y * width + invocation.x; rngState = linearIndex * 9781u + u32(globals.resolutionFrame.z) * 6271u + 17u;
  let rayValue = cameraRay(pixel); let cameraPosition = globals.cameraWorld[3].xyz; let primaryHit = traceClosest(cameraPosition, rayValue.xyz, 1e20);
  if (primaryHit.positionDistance.w < 0.0) { textureStore(visibilityOutput, pixel, vec4<f32>(1.0)); textureStore(reflectionOutput, pixel, vec4<f32>(0.0, 0.0, 0.0, 1e4)); return; }
  let worldPosition = primaryHit.positionDistance.xyz; let geometricNormal = primaryHit.normalMaterial.xyz; let worldNormal = smoothRealtimeNormal(pixel, geometricNormal);
  let metalRough = textureLoad(metalRoughTexture, pixel, 0).rg; let bias = clamp(globals.rayInfo.x, 0.0001, 0.02);`;

const GBUFFER_PRIMARY = `  let pixel = vec2<i32>(i32(invocation.x), i32(invocation.y)); let linearIndex = invocation.y * width + invocation.x; rngState = linearIndex * 9781u + u32(globals.resolutionFrame.z) * 6271u + 17u;
  let pixelPhase = (invocation.x & 1u) | ((invocation.y & 1u) << 1u);
  let framePhase = u32(globals.resolutionFrame.z) & 3u;
  if (pixelPhase != framePhase) {
    if (globals.resolutionFrame.z < 0.5) {
      textureStore(visibilityOutput, pixel, vec4<f32>(1.0, 1.0, 1.0, 1.0));
      textureStore(reflectionOutput, pixel, vec4<f32>(0.0, 0.0, 0.0, 1e4));
    }
    return;
  }
  let rayValue = cameraRay(pixel);
  let depthValue = textureLoad(depthTexture, pixel, 0);
  if (depthValue >= 0.999999) { textureStore(visibilityOutput, pixel, vec4<f32>(1.0)); textureStore(reflectionOutput, pixel, vec4<f32>(0.0, 0.0, 0.0, 1e4)); return; }
  let resolutionValue = max(globals.resolutionFrame.xy, vec2<f32>(1.0));
  let uvValue = (vec2<f32>(pixel) + vec2<f32>(0.5)) / resolutionValue;
  let clipPosition = vec4<f32>(uvValue.x * 2.0 - 1.0, 1.0 - uvValue.y * 2.0, depthValue, 1.0);
  let viewH = globals.inverseProjection * clipPosition;
  let viewPosition = viewH.xyz / max(abs(viewH.w), 1e-8);
  let worldPosition = (globals.cameraWorld * vec4<f32>(viewPosition, 1.0)).xyz;
  let packedNormal = textureLoad(normalTexture, pixel, 0).rgb;
  let viewNormal = safeDirection(packedNormal * 2.0 - 1.0);
  let worldBasis = mat3x3<f32>(globals.cameraWorld[0].xyz, globals.cameraWorld[1].xyz, globals.cameraWorld[2].xyz);
  let worldNormal = safeDirection(worldBasis * viewNormal);
  let geometricNormal = worldNormal;
  let metalRough = textureLoad(metalRoughTexture, pixel, 0).rg;
  let bias = clamp(globals.rayInfo.x, 0.0001, 0.02);`;

const realtimeHybridRtWGSL = generatedHybridRtWGSL
  .replace(LEGACY_TRIANGLE_STRUCT, SMOOTH_TRIANGLE_STRUCT)
  .replace(LEGACY_TRIANGLE_LOAD, SMOOTH_TRIANGLE_LOAD)
  .replace(LEGACY_FLAT_HIT, SMOOTH_HIT)
  .replace(LEGACY_PRIMARY, GBUFFER_PRIMARY);

if (
  realtimeHybridRtWGSL === generatedHybridRtWGSL ||
  !realtimeHybridRtWGSL.includes('normalA: vec4<f32>') ||
  !realtimeHybridRtWGSL.includes('indexValue * 7u') ||
  !realtimeHybridRtWGSL.includes('triangleShadingNormal(') ||
  !realtimeHybridRtWGSL.includes('pixelPhase') ||
  !realtimeHybridRtWGSL.includes('clipPosition') ||
  realtimeHybridRtWGSL.includes(LEGACY_PRIMARY)
) {
  throw new Error('Hybrid RT GBuffer/checkerboard shader migration did not match the pinned shader.');
}

export { realtimeHybridRtWGSL };
