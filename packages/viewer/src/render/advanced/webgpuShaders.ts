import {
  advancedPathTracingComputeWGSL as baseComputeWGSL,
  advancedPathTracingDisplayWGSL as baseDisplayWGSL,
} from './webgpuShadersBase';

const oldGlobalsBlock = `struct Globals {
  camPosTan: vec4<f32>,
  camForwardAspect: vec4<f32>,
  camRightFrame: vec4<f32>,
  camUpFlags: vec4<f32>,
  resolutionCounts: vec4<f32>,
  sceneCounts: vec4<f32>,
  modes: vec4<f32>,
  output: vec4<f32>,
  cacheInfo: vec4<f32>,
};`;

const newGlobalsBlock = `struct Globals {
  camPosTan: vec4<f32>,
  camForwardAspect: vec4<f32>,
  camRightFrame: vec4<f32>,
  camUpFlags: vec4<f32>,
  resolutionCounts: vec4<f32>,
  sceneCounts: vec4<f32>,
  modes: vec4<f32>,
  output: vec4<f32>,
  cacheInfo: vec4<f32>,
  features: vec4<f32>,
  rayInfo: vec4<f32>,
  displayInfo: vec4<f32>,
};`;

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

const oldVisible = `fn visible(origin: vec3<f32>, normal: vec3<f32>, candidate: Candidate) -> bool {
  let maximum = candidate.directionDistance.w;
  let rayMaximum = select(1e20, max(0.0002, maximum - 0.002), maximum < 1e19);
  let hit = traceClosest(origin + normal * 0.0015, candidate.directionDistance.xyz, rayMaximum);
  return hit.positionT.w < 0.0;
}`;

const newVisible = `fn visible(origin: vec3<f32>, normal: vec3<f32>, candidate: Candidate) -> bool {
  if (globals.features.z < 0.5) { return true; }
  let maximum = candidate.directionDistance.w;
  let bias = clamp(globals.rayInfo.y, 0.0001, 0.02);
  let rayMaximum = select(1e20, max(0.0002, maximum - bias * 1.5), maximum < 1e19);
  let hit = traceClosest(origin + normal * bias, candidate.directionDistance.xyz, rayMaximum);
  return hit.positionT.w < 0.0;
}`;

const oldSampleEnvironment = `fn sampleEnvironment(classProbability: f32) -> Candidate {
  let width = max(1u, u32(globals.sceneCounts.z));
  let height = max(1u, u32(globals.sceneCounts.w));
  let count = width * height;
  let bucket = min(count - 1u, u32(random() * f32(count)));
  let entry = environmentAlias[bucket];
  let selected = select(bucket, u32(entry.y + 0.5), random() > entry.x);
  let x = selected % width;
  let y = selected / width;
  let uv = vec2<f32>((f32(x) + random()) / f32(width), (f32(y) + random()) / f32(height));
  let direction = environmentUvToDirection(uv);
  let pdf = classProbability * entry.z / max(entry.w, 1e-8);
  var candidate: Candidate;
  candidate.directionDistance = vec4<f32>(direction, 1e20);
  candidate.radiancePdf = vec4<f32>(environmentRadiance(direction), max(pdf, 1e-8));
  candidate.key = vec4<f32>(4.0, f32(selected), uv.x, uv.y);
  return candidate;
}`;

const newSampleEnvironment = `fn sampleEnvironment(classProbability: f32) -> Candidate {
  let width = max(1u, u32(globals.sceneCounts.z));
  let height = max(1u, u32(globals.sceneCounts.w));
  let count = width * height;
  if (globals.features.x < 0.5) {
    let z = random() * 2.0 - 1.0;
    let phi = random() * 2.0 * 3.14159265359;
    let radial = sqrt(max(0.0, 1.0 - z * z));
    let direction = safeDirection(vec3<f32>(radial * cos(phi), z, radial * sin(phi)));
    let uv = directionToEnvironmentUv(direction);
    let x = min(width - 1u, u32(uv.x * f32(width)));
    let y = min(height - 1u, u32(uv.y * f32(height)));
    let selected = y * width + x;
    var candidate: Candidate;
    candidate.directionDistance = vec4<f32>(direction, 1e20);
    candidate.radiancePdf = vec4<f32>(
      environmentRadiance(direction),
      max(classProbability / (4.0 * 3.14159265359), 1e-8)
    );
    candidate.key = vec4<f32>(4.0, f32(selected), uv.x, uv.y);
    return candidate;
  }
  let bucket = min(count - 1u, u32(random() * f32(count)));
  let entry = environmentAlias[bucket];
  let selected = select(bucket, u32(entry.y + 0.5), random() > entry.x);
  let x = selected % width;
  let y = selected / width;
  let uv = vec2<f32>((f32(x) + random()) / f32(width), (f32(y) + random()) / f32(height));
  let direction = environmentUvToDirection(uv);
  let pdf = classProbability * entry.z / max(entry.w, 1e-8);
  var candidate: Candidate;
  candidate.directionDistance = vec4<f32>(direction, 1e20);
  candidate.radiancePdf = vec4<f32>(environmentRadiance(direction), max(pdf, 1e-8));
  candidate.key = vec4<f32>(4.0, f32(selected), uv.x, uv.y);
  return candidate;
}`;

const migratedCompute = baseComputeWGSL
  .replace(oldGlobalsBlock, newGlobalsBlock)
  .replace(oldBindingBlock, newBindingBlock)
  .replace(oldTraceClosest, newTraceClosest)
  .replace(oldVisible, newVisible)
  .replace(oldSampleEnvironment, newSampleEnvironment)
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
  )
  .replace(
    '  if (kind == 2u) {',
    `  if (kind == 2u && globals.features.y < 0.5) {
    candidate.directionDistance = vec4<f32>(0.0, 1.0, 0.0, 1e20);
    candidate.radiancePdf = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    return candidate;
  }
  if (kind == 2u) {`,
  )
  .replace(
    '    candidate.radiancePdf = vec4<f32>(environmentRadiance(direction), max(classProbability * entry.z / max(entry.w, 1e-8), 1e-8));',
    `    let environmentPdf = select(
      1.0 / (4.0 * 3.14159265359),
      entry.z / max(entry.w, 1e-8),
      globals.features.x > 0.5
    );
    candidate.radiancePdf = vec4<f32>(environmentRadiance(direction), max(classProbability * environmentPdf, 1e-8));`,
  )
  .replace(
    '  let specularChance = clamp(max(fresnel, metallic) + clearcoat * 0.15, 0.05, 0.95);',
    `  let reflectionEnabled = globals.rayInfo.x > 0.5 && roughness <= clamp(globals.displayInfo.x, 0.02, 1.0);
  if (!reflectionEnabled) {
    return vec4<f32>(cosineHemisphere(normal), 1.0);
  }
  let specularChance = clamp(max(fresnel, metallic) + clearcoat * 0.15, 0.05, 0.95);`,
  )
  .replace(
    '    radiance += throughput * direct;',
    `    if (depth == 0 && globals.features.w > 0.5) {
      let randomDirection = safeDirection(vec3<f32>(random() * 2.0 - 1.0, random() * 2.0 - 1.0, random() * 2.0 - 1.0));
      let aoDirection = select(randomDirection, -randomDirection, dot(randomDirection, hit.normalMaterial.xyz) < 0.0);
      let aoRadius = max(0.01, globals.rayInfo.z);
      let aoBias = clamp(globals.rayInfo.y, 0.0001, 0.02);
      let aoHit = traceClosest(hit.positionT.xyz + hit.normalMaterial.xyz * aoBias, aoDirection, aoRadius);
      let aoVisibility = select(1.0, 0.0, aoHit.positionT.w > 0.0);
      direct *= mix(1.0, aoVisibility, clamp(globals.rayInfo.w, 0.0, 1.0));
    }
    radiance += throughput * direct;`,
  );

const migratedDisplay = baseDisplayWGSL
  .replace(oldGlobalsBlock, newGlobalsBlock)
  .replace(
    '  var color = samplePixel(x, y);\n  if (globals.output.y > 0.5) {',
    `  var color = samplePixel(x, y);
  let rawColor = color;
  let denoiseRadius = i32(clamp(globals.displayInfo.y, 0.0, 2.0));
  if (globals.output.y > 0.5 && denoiseRadius > 0 && globals.displayInfo.z > 0.001) {`,
  )
  .replace('    for (var oy = -1; oy <= 1; oy += 1) {', '    for (var oy = -2; oy <= 2; oy += 1) {')
  .replace(
    '      for (var ox = -1; ox <= 1; ox += 1) {\n        if (ox == 0 && oy == 0) { continue; }',
    `      for (var ox = -2; ox <= 2; ox += 1) {
        if (abs(ox) > denoiseRadius || abs(oy) > denoiseRadius) { continue; }
        if (ox == 0 && oy == 0) { continue; }`,
  )
  .replace(
    '    color = weighted / max(weightSum, 1e-5);',
    '    color = mix(rawColor, weighted / max(weightSum, 1e-5), clamp(globals.displayInfo.z, 0.0, 1.0));',
  );

if (
  migratedCompute === baseComputeWGSL ||
  !migratedCompute.includes('@binding(15)') ||
  !migratedCompute.includes('fn traceBlas(') ||
  !migratedCompute.includes('globals.features') ||
  !migratedCompute.includes('globals.rayInfo')
) {
  throw new Error('Kyxos advanced compute WGSL migration did not match the pinned base shader.');
}
if (migratedDisplay === baseDisplayWGSL || !migratedDisplay.includes('globals.displayInfo')) {
  throw new Error('Kyxos advanced display WGSL migration did not match the pinned base shader.');
}

export const advancedPathTracingComputeWGSL = migratedCompute;
export const advancedPathTracingDisplayWGSL = migratedDisplay;
