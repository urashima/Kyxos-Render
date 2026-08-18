export const realtimeHybridRtWGSL = /* wgsl */ `
struct HybridGlobals {
  inverseProjection: mat4x4<f32>,
  cameraWorld: mat4x4<f32>,
  resolutionFrame: vec4<f32>,
  sceneCounts0: vec4<f32>,
  sceneCounts1: vec4<f32>,
  staticLayout0: vec4<f32>,
  staticLayout1: vec4<f32>,
  dynamicLayout: vec4<f32>,
  rayInfo: vec4<f32>,
  featureInfo: vec4<f32>,
};
struct Triangle { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, normalMaterial: vec4<f32>, };
struct BvhNode { minLeft: vec4<f32>, maxRight: vec4<f32>, nodeInfo: vec4<f32>, };
struct Instance {
  world0: vec4<f32>, world1: vec4<f32>, world2: vec4<f32>, world3: vec4<f32>,
  inverse0: vec4<f32>, inverse1: vec4<f32>, inverse2: vec4<f32>, inverse3: vec4<f32>, nodeInfo: vec4<f32>,
};
struct Material { baseMetal: vec4<f32>, emissiveRough: vec4<f32>, parameters: vec4<f32>, };
struct Light { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, colorKind: vec4<f32>, };
struct Hit { positionDistance: vec4<f32>, normalMaterial: vec4<f32>, };
@group(0) @binding(0) var<uniform> globals: HybridGlobals;
@group(0) @binding(1) var<storage, read> staticScene: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> dynamicScene: array<vec4<f32>>;
@group(0) @binding(3) var depthTexture: texture_depth_2d;
@group(0) @binding(4) var normalTexture: texture_2d<f32>;
@group(0) @binding(5) var metalRoughTexture: texture_2d<f32>;
@group(0) @binding(6) var visibilityOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var reflectionOutput: texture_storage_2d<rgba16float, write>;
var<private> rngState: u32;
fn randomValue() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var wordValue = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  wordValue = (wordValue >> 22u) ^ wordValue;
  return f32(wordValue) * 2.3283064365386963e-10;
}
fn safeDirection(vectorValue: vec3<f32>) -> vec3<f32> {
  let lengthSquared = dot(vectorValue, vectorValue);
  if (lengthSquared <= 1e-12) { return vec3<f32>(0.0, 1.0, 0.0); }
  return vectorValue * inverseSqrt(lengthSquared);
}
fn loadTriangle(indexValue: u32) -> Triangle {
  let baseOffset = u32(globals.staticLayout0.x) + indexValue * 4u;
  var value: Triangle;
  value.a = staticScene[baseOffset]; value.b = staticScene[baseOffset + 1u]; value.c = staticScene[baseOffset + 2u]; value.normalMaterial = staticScene[baseOffset + 3u];
  return value;
}
fn loadBvhNode(indexValue: u32) -> BvhNode {
  let baseOffset = u32(globals.staticLayout0.y) + indexValue * 3u;
  var value: BvhNode; value.minLeft = staticScene[baseOffset]; value.maxRight = staticScene[baseOffset + 1u]; value.nodeInfo = staticScene[baseOffset + 2u]; return value;
}
fn loadMaterial(indexValue: u32) -> Material {
  let baseOffset = u32(globals.staticLayout0.z) + indexValue * 3u;
  var value: Material; value.baseMetal = staticScene[baseOffset]; value.emissiveRough = staticScene[baseOffset + 1u]; value.parameters = staticScene[baseOffset + 2u]; return value;
}
fn loadLight(indexValue: u32) -> Light {
  let baseOffset = u32(globals.staticLayout0.w) + indexValue * 4u;
  var value: Light; value.a = staticScene[baseOffset]; value.b = staticScene[baseOffset + 1u]; value.c = staticScene[baseOffset + 2u]; value.colorKind = staticScene[baseOffset + 3u]; return value;
}
fn loadEnvironmentPixel(indexValue: u32) -> vec4<f32> { return staticScene[u32(globals.staticLayout1.y) + indexValue]; }
fn loadInstance(indexValue: u32) -> Instance {
  let baseOffset = u32(globals.dynamicLayout.x) + indexValue * 9u;
  var value: Instance;
  value.world0 = dynamicScene[baseOffset]; value.world1 = dynamicScene[baseOffset + 1u]; value.world2 = dynamicScene[baseOffset + 2u]; value.world3 = dynamicScene[baseOffset + 3u];
  value.inverse0 = dynamicScene[baseOffset + 4u]; value.inverse1 = dynamicScene[baseOffset + 5u]; value.inverse2 = dynamicScene[baseOffset + 6u]; value.inverse3 = dynamicScene[baseOffset + 7u]; value.nodeInfo = dynamicScene[baseOffset + 8u];
  return value;
}
fn loadTlasNode(indexValue: u32) -> BvhNode {
  let baseOffset = u32(globals.dynamicLayout.y) + indexValue * 3u;
  var value: BvhNode; value.minLeft = dynamicScene[baseOffset]; value.maxRight = dynamicScene[baseOffset + 1u]; value.nodeInfo = dynamicScene[baseOffset + 2u]; return value;
}
fn instanceInverse(instanceValue: Instance) -> mat4x4<f32> { return mat4x4<f32>(instanceValue.inverse0, instanceValue.inverse1, instanceValue.inverse2, instanceValue.inverse3); }
fn intersectsAabb(origin: vec3<f32>, direction: vec3<f32>, minimum: vec3<f32>, maximum: vec3<f32>, maximumDistance: f32) -> bool {
  let safeVector = vec3<f32>(select(1e-20, direction.x, abs(direction.x) > 1e-8), select(1e-20, direction.y, abs(direction.y) > 1e-8), select(1e-20, direction.z, abs(direction.z) > 1e-8));
  let reciprocal = 1.0 / safeVector; let distance0 = (minimum - origin) * reciprocal; let distance1 = (maximum - origin) * reciprocal;
  let nearVector = min(distance0, distance1); let farVector = max(distance0, distance1);
  return min(maximumDistance, min(farVector.x, min(farVector.y, farVector.z))) >= max(0.0001, max(nearVector.x, max(nearVector.y, nearVector.z)));
}
fn triangleDistance(origin: vec3<f32>, direction: vec3<f32>, triangleValue: Triangle, maximumDistance: f32) -> f32 {
  let edge1 = triangleValue.b.xyz - triangleValue.a.xyz; let edge2 = triangleValue.c.xyz - triangleValue.a.xyz; let pVector = cross(direction, edge2); let determinant = dot(edge1, pVector);
  if (abs(determinant) < 1e-8) { return -1.0; }
  let reciprocal = 1.0 / determinant; let tVector = origin - triangleValue.a.xyz; let baryU = dot(tVector, pVector) * reciprocal;
  if (baryU < 0.0 || baryU > 1.0) { return -1.0; }
  let qVector = cross(tVector, edge1); let baryV = dot(direction, qVector) * reciprocal;
  if (baryV < 0.0 || baryU + baryV > 1.0) { return -1.0; }
  let hitDistance = dot(edge2, qVector) * reciprocal; return select(hitDistance, -1.0, hitDistance <= 0.0001 || hitDistance >= maximumDistance);
}
fn traceBlas(rootNode: i32, origin: vec3<f32>, direction: vec3<f32>, maximumDistance: f32) -> Hit {
  var miss: Hit; miss.positionDistance = vec4<f32>(0.0, 0.0, 0.0, -1.0); miss.normalMaterial = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  let nodeCount = i32(globals.sceneCounts0.y + 0.5); if (rootNode < 0 || rootNode >= nodeCount) { return miss; }
  var stack: array<i32, 64>; var stackSize = 1; stack[0] = rootNode; var closest = maximumDistance; var resultValue = miss;
  loop {
    if (stackSize <= 0) { break; } stackSize -= 1; let nodeIndex = stack[stackSize]; if (nodeIndex < 0 || nodeIndex >= nodeCount) { continue; }
    let nodeValue = loadBvhNode(u32(nodeIndex)); if (!intersectsAabb(origin, direction, nodeValue.minLeft.xyz, nodeValue.maxRight.xyz, closest)) { continue; }
    let triangleCount = i32(nodeValue.nodeInfo.y + 0.5);
    if (triangleCount > 0) {
      let firstTriangle = i32(nodeValue.nodeInfo.x + 0.5);
      for (var localIndex = 0; localIndex < triangleCount; localIndex += 1) {
        let triangleIndex = firstTriangle + localIndex; if (triangleIndex < 0 || triangleIndex >= i32(globals.sceneCounts0.x + 0.5)) { continue; }
        let triangleValue = loadTriangle(u32(triangleIndex)); let hitDistance = triangleDistance(origin, direction, triangleValue, closest);
        if (hitDistance > 0.0 && hitDistance < closest) {
          closest = hitDistance; resultValue.positionDistance = vec4<f32>(origin + direction * hitDistance, hitDistance);
          let faceNormal = safeDirection(triangleValue.normalMaterial.xyz); resultValue.normalMaterial = vec4<f32>(select(faceNormal, -faceNormal, dot(faceNormal, direction) > 0.0), triangleValue.normalMaterial.w);
        }
      }
    } else {
      let leftIndex = i32(nodeValue.minLeft.w + 0.5); let rightIndex = i32(nodeValue.maxRight.w + 0.5);
      if (stackSize < 62) { if (rightIndex >= 0) { stack[stackSize] = rightIndex; stackSize += 1; } if (leftIndex >= 0) { stack[stackSize] = leftIndex; stackSize += 1; } }
    }
  }
  return resultValue;
}
fn traceClosest(origin: vec3<f32>, direction: vec3<f32>, maximumDistance: f32) -> Hit {
  var miss: Hit; miss.positionDistance = vec4<f32>(0.0, 0.0, 0.0, -1.0); miss.normalMaterial = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  let instanceCount = i32(globals.sceneCounts0.z + 0.5); let tlasNodeCount = i32(globals.sceneCounts0.w + 0.5); if (instanceCount <= 0 || tlasNodeCount <= 0) { return miss; }
  var stack: array<i32, 64>; var stackSize = 1; stack[0] = 0; var closest = maximumDistance; var resultValue = miss;
  loop {
    if (stackSize <= 0) { break; } stackSize -= 1; let nodeIndex = stack[stackSize]; if (nodeIndex < 0 || nodeIndex >= tlasNodeCount) { continue; }
    let nodeValue = loadTlasNode(u32(nodeIndex)); if (!intersectsAabb(origin, direction, nodeValue.minLeft.xyz, nodeValue.maxRight.xyz, closest)) { continue; }
    let leafCount = i32(nodeValue.nodeInfo.y + 0.5);
    if (leafCount > 0) {
      let firstInstance = i32(nodeValue.nodeInfo.x + 0.5);
      for (var localIndex = 0; localIndex < leafCount; localIndex += 1) {
        let instanceIndex = firstInstance + localIndex; if (instanceIndex < 0 || instanceIndex >= instanceCount) { continue; }
        let instanceValue = loadInstance(u32(instanceIndex)); let inverseWorldMatrix = instanceInverse(instanceValue);
        let localOrigin = (inverseWorldMatrix * vec4<f32>(origin, 1.0)).xyz; let localDirectionRaw = (inverseWorldMatrix * vec4<f32>(direction, 0.0)).xyz;
        let directionScale = max(length(localDirectionRaw), 1e-8); let localDirection = localDirectionRaw / directionScale;
        let localHit = traceBlas(i32(instanceValue.nodeInfo.x + 0.5), localOrigin, localDirection, closest * directionScale);
        if (localHit.positionDistance.w > 0.0) {
          let worldDistance = localHit.positionDistance.w / directionScale;
          if (worldDistance < closest) {
            closest = worldDistance; let normalMatrix = transpose(mat3x3<f32>(instanceValue.inverse0.xyz, instanceValue.inverse1.xyz, instanceValue.inverse2.xyz));
            var worldNormal = safeDirection(normalMatrix * localHit.normalMaterial.xyz); if (dot(worldNormal, direction) > 0.0) { worldNormal = -worldNormal; }
            resultValue.positionDistance = vec4<f32>(origin + direction * closest, closest); resultValue.normalMaterial = vec4<f32>(worldNormal, localHit.normalMaterial.w);
          }
        }
      }
    } else {
      let leftIndex = i32(nodeValue.minLeft.w + 0.5); let rightIndex = i32(nodeValue.maxRight.w + 0.5);
      if (stackSize < 62) { if (rightIndex >= 0) { stack[stackSize] = rightIndex; stackSize += 1; } if (leftIndex >= 0) { stack[stackSize] = leftIndex; stackSize += 1; } }
    }
  }
  return resultValue;
}
fn environmentUv(direction: vec3<f32>) -> vec2<f32> {
  let directionValue = safeDirection(direction); return vec2<f32>(fract(atan2(directionValue.z, directionValue.x) / 6.28318530718 + 1.5), clamp(acos(clamp(directionValue.y, -1.0, 1.0)) / 3.14159265359, 0.0, 0.999999));
}
fn environmentRadiance(direction: vec3<f32>) -> vec3<f32> {
  let width = max(1u, u32(globals.sceneCounts1.y + 0.5)); let height = max(1u, u32(globals.sceneCounts1.z + 0.5)); let coordinate = environmentUv(direction);
  return max(loadEnvironmentPixel(min(height - 1u, u32(coordinate.y * f32(height))) * width + min(width - 1u, u32(coordinate.x * f32(width)))).rgb, vec3<f32>(0.0));
}
fn cameraRay(pixel: vec2<i32>) -> vec4<f32> {
  let resolution = max(globals.resolutionFrame.xy, vec2<f32>(1.0)); let uvValue = (vec2<f32>(pixel) + vec2<f32>(0.5)) / resolution;
  let clipNear = vec4<f32>(uvValue.x * 2.0 - 1.0, 1.0 - uvValue.y * 2.0, 0.0, 1.0); let clipFar = vec4<f32>(clipNear.xy, 1.0, 1.0);
  let nearH = globals.inverseProjection * clipNear; let farH = globals.inverseProjection * clipFar;
  let nearView = nearH.xyz / max(abs(nearH.w), 1e-8); let farView = farH.xyz / max(abs(farH.w), 1e-8);
  let nearWorld = (globals.cameraWorld * vec4<f32>(nearView, 1.0)).xyz; let farWorld = (globals.cameraWorld * vec4<f32>(farView, 1.0)).xyz;
  let cameraPosition = globals.cameraWorld[3].xyz; let orthographic = globals.resolutionFrame.w > 0.5;
  let rayOrigin = select(cameraPosition, nearWorld, orthographic); let rayDirection = safeDirection(farWorld - nearWorld); return vec4<f32>(rayDirection, 0.0) + vec4<f32>(0.0);
}
fn smoothRealtimeNormal(pixel: vec2<i32>, fallbackNormal: vec3<f32>) -> vec3<f32> {
  let depthValue = textureLoad(depthTexture, pixel, 0); if (depthValue >= 0.999999) { return fallbackNormal; }
  let packedNormal = textureLoad(normalTexture, pixel, 0).rgb; let viewNormal = safeDirection(packedNormal * 2.0 - 1.0);
  let worldBasis = mat3x3<f32>(globals.cameraWorld[0].xyz, globals.cameraWorld[1].xyz, globals.cameraWorld[2].xyz); let worldNormal = safeDirection(worldBasis * viewNormal);
  return select(worldNormal, -worldNormal, dot(worldNormal, fallbackNormal) < 0.0);
}
fn randomHemisphere(normalValue: vec3<f32>) -> vec3<f32> {
  let randomVector = safeDirection(vec3<f32>(randomValue() * 2.0 - 1.0, randomValue() * 2.0 - 1.0, randomValue() * 2.0 - 1.0)); return select(randomVector, -randomVector, dot(randomVector, normalValue) < 0.0);
}
fn luminance3(colorValue: vec3<f32>) -> f32 { return dot(colorValue, vec3<f32>(0.2126, 0.7152, 0.0722)); }
fn lightDirectionAndDistance(lightValue: Light, position: vec3<f32>) -> vec4<f32> {
  let kind = u32(lightValue.colorKind.w + 0.5); if (kind == 0u) { return vec4<f32>(safeDirection(lightValue.a.xyz), 1e20); }
  if (kind == 2u) { let center = (lightValue.a.xyz + lightValue.b.xyz + lightValue.c.xyz) / 3.0; let offset = center - position; let distanceValue = max(length(offset), 1e-4); return vec4<f32>(offset / distanceValue, distanceValue); }
  let offset = lightValue.a.xyz - position; let distanceValue = max(length(offset), 1e-4); return vec4<f32>(offset / distanceValue, distanceValue);
}
fn selectedShadowLight(position: vec3<f32>, normalValue: vec3<f32>, pixelSeed: u32) -> vec4<f32> {
  let lightCount = u32(globals.sceneCounts1.x + 0.5); if (lightCount == 0u) { return vec4<f32>(0.0, 1.0, 0.0, -1.0); }
  let requested = max(1u, min(8u, u32(globals.featureInfo.w + 0.5))); var bestDirection = vec4<f32>(0.0, 1.0, 0.0, -1.0); var bestScore = -1.0;
  for (var candidateIndex = 0u; candidateIndex < 8u; candidateIndex += 1u) {
    if (candidateIndex >= requested) { break; }
    let lightIndex = (pixelSeed * 1664525u + candidateIndex * 1013904223u + u32(globals.resolutionFrame.z)) % lightCount; let lightValue = loadLight(lightIndex);
    let directionDistance = lightDirectionAndDistance(lightValue, position); let cosineValue = max(dot(normalValue, directionDistance.xyz), 0.0);
    let attenuation = select(1.0 / max(directionDistance.w * directionDistance.w, 1.0), 1.0, directionDistance.w > 1e19); let score = luminance3(lightValue.colorKind.rgb) * cosineValue * attenuation;
    if (score > bestScore) { bestScore = score; bestDirection = directionDistance; }
  }
  return bestDirection;
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let width = u32(globals.resolutionFrame.x + 0.5); let height = u32(globals.resolutionFrame.y + 0.5); if (invocation.x >= width || invocation.y >= height) { return; }
  let pixel = vec2<i32>(i32(invocation.x), i32(invocation.y)); let linearIndex = invocation.y * width + invocation.x; rngState = linearIndex * 9781u + u32(globals.resolutionFrame.z) * 6271u + 17u;
  let rayValue = cameraRay(pixel); let cameraPosition = globals.cameraWorld[3].xyz; let primaryHit = traceClosest(cameraPosition, rayValue.xyz, 1e20);
  if (primaryHit.positionDistance.w < 0.0) { textureStore(visibilityOutput, pixel, vec4<f32>(1.0)); textureStore(reflectionOutput, pixel, vec4<f32>(0.0, 0.0, 0.0, 1e4)); return; }
  let worldPosition = primaryHit.positionDistance.xyz; let geometricNormal = primaryHit.normalMaterial.xyz; let worldNormal = smoothRealtimeNormal(pixel, geometricNormal);
  let metalRough = textureLoad(metalRoughTexture, pixel, 0).rg; let bias = clamp(globals.rayInfo.x, 0.0001, 0.02);
  var aoVisibility = 1.0;
  if (globals.featureInfo.y > 0.5) { let aoHit = traceClosest(worldPosition + geometricNormal * bias, randomHemisphere(worldNormal), max(0.01, globals.rayInfo.y)); let rawVisibility = select(1.0, 0.0, aoHit.positionDistance.w > 0.0); aoVisibility = mix(1.0, rawVisibility, clamp(globals.rayInfo.z, 0.0, 1.0)); }
  var shadowVisibility = 1.0;
  if (globals.featureInfo.x > 0.5) {
    let lightRay = selectedShadowLight(worldPosition, worldNormal, linearIndex);
    if (lightRay.w > 0.0 && dot(worldNormal, lightRay.xyz) > 0.0) { let maximumDistance = select(1e20, max(0.0002, lightRay.w - bias * 2.0), lightRay.w < 1e19); let shadowHit = traceClosest(worldPosition + geometricNormal * bias, lightRay.xyz, maximumDistance); shadowVisibility = select(1.0, 0.72, shadowHit.positionDistance.w > 0.0); }
  }
  textureStore(visibilityOutput, pixel, vec4<f32>(min(aoVisibility, shadowVisibility), shadowVisibility, aoVisibility, 1.0));
  var reflectionColor = vec3<f32>(0.0); var rayLength = 1e4;
  if (globals.featureInfo.z > 0.5 && metalRough.y <= globals.rayInfo.w) {
    let perfectReflection = safeDirection(reflect(rayValue.xyz, worldNormal)); let reflectionDirection = safeDirection(mix(perfectReflection, randomHemisphere(worldNormal), metalRough.y * metalRough.y));
    let reflectionHit = traceClosest(worldPosition + geometricNormal * bias, reflectionDirection, 1e20);
    if (reflectionHit.positionDistance.w > 0.0) {
      rayLength = reflectionHit.positionDistance.w; let materialCount = max(1u, u32(globals.sceneCounts1.w + 0.5)); let materialIndex = min(u32(max(0.0, reflectionHit.normalMaterial.w)), materialCount - 1u);
      let materialValue = loadMaterial(materialIndex); reflectionColor = max(materialValue.emissiveRough.rgb, vec3<f32>(0.0)) + max(materialValue.baseMetal.rgb, vec3<f32>(0.0)) * environmentRadiance(reflect(reflectionDirection, reflectionHit.normalMaterial.xyz));
    } else { reflectionColor = environmentRadiance(reflectionDirection); }
  }
  textureStore(reflectionOutput, pixel, vec4<f32>(reflectionColor, rayLength));
}
`;
