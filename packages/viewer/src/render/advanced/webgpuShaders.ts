import {
  advancedPathTracingComputeWGSL as baseComputeWGSL,
  advancedPathTracingDisplayWGSL,
} from './webgpuShadersBase';

const oldBindingBlock = `@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(2) var<storage, read> nodes: array<BvhNode>;
@group(0) @binding(3) var<storage, read> materials: array<Material>;
@group(0) @binding(4) var<storage, read> lights: array<Light>;
@group(0) @binding(5) var<storage, read> lightAlias: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> accumulation: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> previousReservoir: array<Reservoir>;
@group(0) @binding(8) var<storage, read_write> nextReservoir: array<Reservoir>;
@group(0) @binding(9) var<storage, read> previousSurface: array<SurfaceKey>;
@group(0) @binding(10) var<storage, read_write> nextSurface: array<SurfaceKey>;
@group(0) @binding(11) var<storage, read> environmentPixels: array<vec4<f32>>;
@group(0) @binding(12) var<storage, read> environmentAlias: array<vec4<f32>>;
@group(0) @binding(13) var<storage, read_write> cache: array<CacheCell>;`;

const newBindingBlock = `struct Instance {
  world0: vec4<f32>,
  world1: vec4<f32>,
  world2: vec4<f32>,
  world3: vec4<f32>,
  inverse0: vec4<f32>,
  inverse1: vec4<f32>,
  inverse2: vec4<f32>,
  inverse3: vec4<f32>,
  meta: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(2) var<storage, read> nodes: array<BvhNode>;
@group(0) @binding(3) var<storage, read> instances: array<Instance>;
@group(0) @binding(4) var<storage, read> tlasNodes: array<BvhNode>;
@group(0) @binding(5) var<storage, read> materials: array<Material>;
@group(0) @binding(6) var<storage, read> lights: array<Light>;
@group(0) @binding(7) var<storage, read> lightAlias: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> accumulation: array<vec4<f32>>;
@group(0) @binding(9) var<storage, read> previousReservoir: array<Reservoir>;
@group(0) @binding(10) var<storage, read_write> nextReservoir: array<Reservoir>;
@group(0) @binding(11) var<storage, read> previousSurface: array<SurfaceKey>;
@group(0) @binding(12) var<storage, read_write> nextSurface: array<SurfaceKey>;
@group(0) @binding(13) var<storage, read> environmentPixels: array<vec4<f32>>;
@group(0) @binding(14) var<storage, read> environmentAlias: array<vec4<f32>>;
@group(0) @binding(15) var<storage, read_write> cache: array<CacheCell>;`;

const oldTraceClosest = `fn traceClosest(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> Hit {
  var miss: Hit;
  miss.positionT = vec4<f32>(0.0, 0.0, 0.0, -1.0);
  miss.normalMaterial = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  let nodeCount = i32(globals.sceneCounts.y);
  if (nodeCount <= 0) { return miss; }
  var stack: array<i32, 64>;
  var stackSize = 1;
  stack[0] = 0;
  var closest = maxDistance;
  var result = miss;
  loop {
    if (stackSize <= 0) { break; }
    stackSize -= 1;
    let nodeIndex = stack[stackSize];
    if (nodeIndex < 0 || nodeIndex >= nodeCount) { continue; }
    let node = nodes[u32(nodeIndex)];
    if (!intersectAabb(origin, direction, node.minLeft.xyz, node.maxRight.xyz, closest)) { continue; }
    let triangleCount = i32(node.meta.y + 0.5);
    if (triangleCount > 0) {
      let first = i32(node.meta.x + 0.5);
      for (var local = 0; local < triangleCount; local += 1) {
        let triangleIndex = first + local;
        if (triangleIndex < 0 || triangleIndex >= i32(globals.sceneCounts.x)) { continue; }
        let triangle = triangles[u32(triangleIndex)];
        let distance = intersectTriangle(origin, direction, triangle, closest);
        if (distance > 0.0 && distance < closest) {
          closest = distance;
          result.positionT = vec4<f32>(origin + direction * distance, distance);
          let facing = select(triangle.normalMaterial.xyz, -triangle.normalMaterial.xyz, dot(triangle.normalMaterial.xyz, direction) > 0.0);
          result.normalMaterial = vec4<f32>(safeDirection(facing), triangle.normalMaterial.w);
        }
      }
    } else {
      let left = i32(node.minLeft.w + 0.5);
      let right = i32(node.maxRight.w + 0.5);
      if (stackSize < 62) {
        if (right >= 0) { stack[stackSize] = right; stackSize += 1; }
        if (left >= 0) { stack[stackSize] = left; stackSize += 1; }
      }
    }
  }
  return result;
}`;

const newTraceClosest = `fn instanceWorld(instance: Instance) -> mat4x4<f32> {
  return mat4x4<f32>(instance.world0, instance.world1, instance.world2, instance.world3);
}

fn instanceInverse(instance: Instance) -> mat4x4<f32> {
  return mat4x4<f32>(instance.inverse0, instance.inverse1, instance.inverse2, instance.inverse3);
}

fn traceBlas(rootNode: i32, origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> Hit {
  var miss: Hit;
  miss.positionT = vec4<f32>(0.0, 0.0, 0.0, -1.0);
  miss.normalMaterial = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  let nodeCount = i32(globals.sceneCounts.y);
  if (rootNode < 0 || rootNode >= nodeCount) { return miss; }
  var stack: array<i32, 64>;
  var stackSize = 1;
  stack[0] = rootNode;
  var closest = maxDistance;
  var result = miss;
  loop {
    if (stackSize <= 0) { break; }
    stackSize -= 1;
    let nodeIndex = stack[stackSize];
    if (nodeIndex < 0 || nodeIndex >= nodeCount) { continue; }
    let node = nodes[u32(nodeIndex)];
    if (!intersectAabb(origin, direction, node.minLeft.xyz, node.maxRight.xyz, closest)) { continue; }
    let triangleCount = i32(node.meta.y + 0.5);
    if (triangleCount > 0) {
      let first = i32(node.meta.x + 0.5);
      for (var local = 0; local < triangleCount; local += 1) {
        let triangleIndex = first + local;
        if (triangleIndex < 0 || triangleIndex >= i32(globals.sceneCounts.x)) { continue; }
        let triangle = triangles[u32(triangleIndex)];
        let distance = intersectTriangle(origin, direction, triangle, closest);
        if (distance > 0.0 && distance < closest) {
          closest = distance;
          result.positionT = vec4<f32>(origin + direction * distance, distance);
          let facing = select(
            triangle.normalMaterial.xyz,
            -triangle.normalMaterial.xyz,
            dot(triangle.normalMaterial.xyz, direction) > 0.0
          );
          result.normalMaterial = vec4<f32>(safeDirection(facing), triangle.normalMaterial.w);
        }
      }
    } else {
      let left = i32(node.minLeft.w + 0.5);
      let right = i32(node.maxRight.w + 0.5);
      if (stackSize < 62) {
        if (right >= 0) { stack[stackSize] = right; stackSize += 1; }
        if (left >= 0) { stack[stackSize] = left; stackSize += 1; }
      }
    }
  }
  return result;
}

fn traceClosest(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> Hit {
  var miss: Hit;
  miss.positionT = vec4<f32>(0.0, 0.0, 0.0, -1.0);
  miss.normalMaterial = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  let instanceCount = i32(globals.camUpFlags.w + 0.5);
  let tlasNodeCount = i32(arrayLength(&tlasNodes));
  if (instanceCount <= 0 || tlasNodeCount <= 0) { return miss; }

  var stack: array<i32, 64>;
  var stackSize = 1;
  stack[0] = 0;
  var closest = maxDistance;
  var result = miss;

  loop {
    if (stackSize <= 0) { break; }
    stackSize -= 1;
    let nodeIndex = stack[stackSize];
    if (nodeIndex < 0 || nodeIndex >= tlasNodeCount) { continue; }
    let node = tlasNodes[u32(nodeIndex)];
    if (!intersectAabb(origin, direction, node.minLeft.xyz, node.maxRight.xyz, closest)) { continue; }
    let leafCount = i32(node.meta.y + 0.5);
    if (leafCount > 0) {
      let first = i32(node.meta.x + 0.5);
      for (var local = 0; local < leafCount; local += 1) {
        let instanceIndex = first + local;
        if (instanceIndex < 0 || instanceIndex >= instanceCount) { continue; }
        let instance = instances[u32(instanceIndex)];
        let inverseWorld = instanceInverse(instance);
        let localOrigin = (inverseWorld * vec4<f32>(origin, 1.0)).xyz;
        let localDirection = (inverseWorld * vec4<f32>(direction, 0.0)).xyz;
        let localHit = traceBlas(i32(instance.meta.x + 0.5), localOrigin, localDirection, closest);
        if (localHit.positionT.w > 0.0 && localHit.positionT.w < closest) {
          closest = localHit.positionT.w;
          let normalMatrix = transpose(mat3x3<f32>(
            instance.inverse0.xyz,
            instance.inverse1.xyz,
            instance.inverse2.xyz
          ));
          var worldNormal = safeDirection(normalMatrix * localHit.normalMaterial.xyz);
          if (dot(worldNormal, direction) > 0.0) { worldNormal = -worldNormal; }
          result.positionT = vec4<f32>(origin + direction * closest, closest);
          result.normalMaterial = vec4<f32>(worldNormal, localHit.normalMaterial.w);
        }
      }
    } else {
      let left = i32(node.minLeft.w + 0.5);
      let right = i32(node.maxRight.w + 0.5);
      if (stackSize < 62) {
        if (right >= 0) { stack[stackSize] = right; stackSize += 1; }
        if (left >= 0) { stack[stackSize] = left; stackSize += 1; }
      }
    }
  }
  return result;
}`;

const migrated = baseComputeWGSL
  .replace(oldBindingBlock, newBindingBlock)
  .replace(oldTraceClosest, newTraceClosest)
  .replace(
    'let attenuation = 1.0 / max(1.0, pow(distance, max(0.0, decay)));',
    'var attenuation = 1.0 / max(1.0, pow(distance, max(0.0, decay)));',
  )
  .replace(
    'let stored = atomicLoad(&cache[slot].tag);\n    if (stored == 0u) {',
    'var stored = atomicLoad(&cache[slot].tag);\n    if (stored == 0u) {',
  )
  .replace(
    "let index = min(u32(max(0.0, hit.normalMaterial.w)), max(0u, u32(globals.modes.w) - 1u));",
    "let index = min(u32(max(0.0, hit.normalMaterial.w)), max(1u, u32(globals.cacheInfo.w)) - 1u);",
  );

if (migrated === baseComputeWGSL || !migrated.includes('@binding(15)') || !migrated.includes('fn traceBlas(')) {
  throw new Error('Kyxos advanced WGSL migration did not match the pinned base shader.');
}

export const advancedPathTracingComputeWGSL = migrated;
export { advancedPathTracingDisplayWGSL };
