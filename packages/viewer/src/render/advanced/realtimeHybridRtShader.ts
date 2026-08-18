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

const LEGACY_PRIMARY_SURFACE = `let worldPosition = primaryHit.positionDistance.xyz; let geometricNormal = primaryHit.normalMaterial.xyz; let worldNormal = smoothRealtimeNormal(pixel, geometricNormal);
  let metalRough = textureLoad(metalRoughTexture, pixel, 0).rg; let bias = clamp(globals.rayInfo.x, 0.0001, 0.02);`;
const CURRENT_PRIMARY_SURFACE = `let worldPosition = primaryHit.positionDistance.xyz;
  let geometricNormal = primaryHit.normalMaterial.xyz;
  let worldNormal = geometricNormal;
  let primaryMaterialCount = max(1u, u32(globals.sceneCounts1.w + 0.5));
  let primaryMaterialIndex = min(u32(max(0.0, primaryHit.normalMaterial.w)), primaryMaterialCount - 1u);
  let primaryMaterial = loadMaterial(primaryMaterialIndex);
  let primaryRoughness = clamp(primaryMaterial.emissiveRough.w, 0.015, 1.0);
  let bias = clamp(globals.rayInfo.x, 0.0001, 0.02);`;

let realtimeHybridRtWGSL = generatedHybridRtWGSL
  .replace(LEGACY_TRIANGLE_STRUCT, SMOOTH_TRIANGLE_STRUCT)
  .replace(LEGACY_TRIANGLE_LOAD, SMOOTH_TRIANGLE_LOAD)
  .replace(LEGACY_FLAT_HIT, SMOOTH_HIT)
  .replace(LEGACY_PRIMARY_SURFACE, CURRENT_PRIMARY_SURFACE)
  .replace('metalRough.y <= globals.rayInfo.w', 'primaryRoughness <= globals.rayInfo.w')
  .replace('metalRough.y * metalRough.y', 'primaryRoughness * primaryRoughness');

if (
  realtimeHybridRtWGSL === generatedHybridRtWGSL ||
  !realtimeHybridRtWGSL.includes('normalA: vec4<f32>') ||
  !realtimeHybridRtWGSL.includes('indexValue * 7u') ||
  !realtimeHybridRtWGSL.includes('triangleShadingNormal(') ||
  !realtimeHybridRtWGSL.includes('primaryRoughness') ||
  realtimeHybridRtWGSL.includes(LEGACY_FLAT_HIT)
) {
  throw new Error('Hybrid RT current-frame smooth-normal migration did not match the pinned shader.');
}

export { realtimeHybridRtWGSL };
