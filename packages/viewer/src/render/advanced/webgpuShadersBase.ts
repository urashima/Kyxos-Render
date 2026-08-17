export const advancedPathTracingComputeWGSL = /* wgsl */ `
struct Globals {
  camPosTan: vec4<f32>,
  camForwardAspect: vec4<f32>,
  camRightFrame: vec4<f32>,
  camUpFlags: vec4<f32>,
  resolutionCounts: vec4<f32>,
  sceneCounts: vec4<f32>,
  modes: vec4<f32>,
  output: vec4<f32>,
  cacheInfo: vec4<f32>,
};

struct Triangle {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  normalMaterial: vec4<f32>,
};

struct BvhNode {
  minLeft: vec4<f32>,
  maxRight: vec4<f32>,
  meta: vec4<f32>,
};

struct Material {
  baseMetal: vec4<f32>,
  emissiveRough: vec4<f32>,
  parameters: vec4<f32>,
};

struct Light {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  colorType: vec4<f32>,
};

struct Reservoir {
  key: vec4<f32>,
  stats: vec4<f32>,
  extra: vec4<f32>,
};

struct SurfaceKey {
  positionDepth: vec4<f32>,
  normalRough: vec4<f32>,
  baseMetal: vec4<f32>,
};

struct CacheCell {
  tag: atomic<u32>,
  r: atomic<u32>,
  g: atomic<u32>,
  b: atomic<u32>,
  count: atomic<u32>,
};

struct Hit {
  positionT: vec4<f32>,
  normalMaterial: vec4<f32>,
};

struct Candidate {
  directionDistance: vec4<f32>,
  radiancePdf: vec4<f32>,
  key: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
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
@group(0) @binding(13) var<storage, read_write> cache: array<CacheCell>;

var<private> rngState: u32;

fn random() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var word = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  word = (word >> 22u) ^ word;
  return f32(word) * 2.3283064365386963e-10;
}

fn max3(value: vec3<f32>) -> f32 {
  return max(value.x, max(value.y, value.z));
}

fn luminance(value: vec3<f32>) -> f32 {
  return dot(value, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn safeDirection(value: vec3<f32>) -> vec3<f32> {
  let lengthSquared = dot(value, value);
  if (lengthSquared <= 1e-12) { return vec3<f32>(0.0, 1.0, 0.0); }
  return value * inverseSqrt(lengthSquared);
}

fn intersectAabb(origin: vec3<f32>, direction: vec3<f32>, minimum: vec3<f32>, maximum: vec3<f32>, maxDistance: f32) -> bool {
  let safe = vec3<f32>(
    select(1e-20, direction.x, abs(direction.x) > 1e-8),
    select(1e-20, direction.y, abs(direction.y) > 1e-8),
    select(1e-20, direction.z, abs(direction.z) > 1e-8)
  );
  let inverse = 1.0 / safe;
  let t0 = (minimum - origin) * inverse;
  let t1 = (maximum - origin) * inverse;
  let near3 = min(t0, t1);
  let far3 = max(t0, t1);
  let nearDistance = max(0.0001, max(near3.x, max(near3.y, near3.z)));
  let farDistance = min(maxDistance, min(far3.x, min(far3.y, far3.z)));
  return farDistance >= nearDistance;
}

fn intersectTriangle(origin: vec3<f32>, direction: vec3<f32>, triangle: Triangle, maxDistance: f32) -> f32 {
  let edge1 = triangle.b.xyz - triangle.a.xyz;
  let edge2 = triangle.c.xyz - triangle.a.xyz;
  let p = cross(direction, edge2);
  let determinant = dot(edge1, p);
  if (abs(determinant) < 1e-8) { return -1.0; }
  let inverse = 1.0 / determinant;
  let t = origin - triangle.a.xyz;
  let u = dot(t, p) * inverse;
  if (u < 0.0 || u > 1.0) { return -1.0; }
  let q = cross(t, edge1);
  let v = dot(direction, q) * inverse;
  if (v < 0.0 || u + v > 1.0) { return -1.0; }
  let distance = dot(edge2, q) * inverse;
  if (distance <= 0.0001 || distance >= maxDistance) { return -1.0; }
  return distance;
}

fn traceClosest(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> Hit {
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
}

fn visible(origin: vec3<f32>, normal: vec3<f32>, candidate: Candidate) -> bool {
  let maximum = candidate.directionDistance.w;
  let rayMaximum = select(1e20, max(0.0002, maximum - 0.002), maximum < 1e19);
  let hit = traceClosest(origin + normal * 0.0015, candidate.directionDistance.xyz, rayMaximum);
  return hit.positionT.w < 0.0;
}

fn directionToEnvironmentUv(direction: vec3<f32>) -> vec2<f32> {
  let d = safeDirection(direction);
  let u = atan2(d.z, d.x) / (2.0 * 3.14159265359) + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359;
  return vec2<f32>(fract(u + 1.0), clamp(v, 0.0, 0.999999));
}

fn environmentUvToDirection(uv: vec2<f32>) -> vec3<f32> {
  let theta = clamp(uv.y, 0.0, 1.0) * 3.14159265359;
  let phi = (uv.x * 2.0 - 1.0) * 3.14159265359;
  let sinTheta = sin(theta);
  return safeDirection(vec3<f32>(sinTheta * cos(phi), cos(theta), sinTheta * sin(phi)));
}

fn environmentRadiance(direction: vec3<f32>) -> vec3<f32> {
  let width = max(1u, u32(globals.sceneCounts.z));
  let height = max(1u, u32(globals.sceneCounts.w));
  let uv = directionToEnvironmentUv(direction);
  let x = min(width - 1u, u32(uv.x * f32(width)));
  let y = min(height - 1u, u32(uv.y * f32(height)));
  return max(environmentPixels[y * width + x].rgb, vec3<f32>(0.0));
}

fn sampleEnvironment(classProbability: f32) -> Candidate {
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
}

fn sampleLightIndex() -> u32 {
  let count = max(1u, u32(globals.resolutionCounts.w));
  let bucket = min(count - 1u, u32(random() * f32(count)));
  let entry = lightAlias[bucket];
  return select(bucket, u32(entry.y + 0.5), random() > entry.x);
}

fn lightSelectionMass(index: u32) -> f32 {
  return max(lightAlias[index].z, 1e-8);
}

fn candidateFromLight(index: u32, sampleU: f32, sampleV: f32, position: vec3<f32>, classProbability: f32) -> Candidate {
  let light = lights[index];
  let kind = u32(light.colorType.w + 0.5);
  var candidate: Candidate;
  candidate.key = vec4<f32>(f32(kind), f32(index), sampleU, sampleV);
  let mass = lightSelectionMass(index) * classProbability;
  if (kind == 0u) {
    candidate.directionDistance = vec4<f32>(safeDirection(light.a.xyz), 1e20);
    candidate.radiancePdf = vec4<f32>(max(light.colorType.rgb, vec3<f32>(0.0)), max(mass, 1e-8));
    return candidate;
  }
  if (kind == 2u) {
    let su = sqrt(clamp(sampleU, 0.0, 1.0));
    let bary = vec3<f32>(1.0 - su, su * (1.0 - sampleV), su * sampleV);
    let point = light.a.xyz * bary.x + light.b.xyz * bary.y + light.c.xyz * bary.z;
    let offset = point - position;
    let distance = max(length(offset), 0.0001);
    let direction = offset / distance;
    let normal = safeDirection(cross(light.b.xyz - light.a.xyz, light.c.xyz - light.a.xyz));
    let area = max(0.5 * length(cross(light.b.xyz - light.a.xyz, light.c.xyz - light.a.xyz)), 1e-8);
    let cosine = max(abs(dot(normal, -direction)), 1e-5);
    let pdf = mass * distance * distance / (area * cosine);
    candidate.directionDistance = vec4<f32>(direction, distance);
    candidate.radiancePdf = vec4<f32>(max(light.colorType.rgb, vec3<f32>(0.0)), max(pdf, 1e-8));
    return candidate;
  }
  let offset = light.a.xyz - position;
  let distance = max(length(offset), 0.0001);
  let direction = offset / distance;
  let decay = select(max(light.c.x, 0.0), max(light.c.y, 0.0), kind == 3u);
  let attenuation = 1.0 / max(1.0, pow(distance, max(0.0, decay)));
  if (light.a.w > 0.0 && distance > light.a.w) { attenuation = 0.0; }
  if (kind == 3u) {
    let fromLight = -direction;
    let coneCos = dot(safeDirection(light.b.xyz), fromLight);
    let outer = light.c.x;
    let inner = max(outer + 1e-5, light.b.w);
    attenuation *= smoothstep(outer, inner, coneCos);
  }
  candidate.directionDistance = vec4<f32>(direction, distance);
  candidate.radiancePdf = vec4<f32>(max(light.colorType.rgb * attenuation, vec3<f32>(0.0)), max(mass, 1e-8));
  return candidate;
}

fn candidateFromKey(key: vec4<f32>, position: vec3<f32>) -> Candidate {
  let kind = u32(key.x + 0.5);
  if (kind == 4u) {
    let uv = vec2<f32>(key.z, key.w);
    let direction = environmentUvToDirection(uv);
    let width = max(1u, u32(globals.sceneCounts.z));
    let height = max(1u, u32(globals.sceneCounts.w));
    let x = min(width - 1u, u32(uv.x * f32(width)));
    let y = min(height - 1u, u32(uv.y * f32(height)));
    let entry = environmentAlias[y * width + x];
    let hasLights = globals.resolutionCounts.w > 0.5;
    let classProbability = select(1.0, 0.5, hasLights);
    var candidate: Candidate;
    candidate.directionDistance = vec4<f32>(direction, 1e20);
    candidate.radiancePdf = vec4<f32>(environmentRadiance(direction), max(classProbability * entry.z / max(entry.w, 1e-8), 1e-8));
    candidate.key = key;
    return candidate;
  }
  let hasEnvironment = true;
  let classProbability = select(1.0, 0.5, hasEnvironment);
  return candidateFromLight(u32(key.y + 0.5), key.z, key.w, position, classProbability);
}

fn sampleLightCandidate(position: vec3<f32>) -> Candidate {
  let lightCount = u32(globals.resolutionCounts.w);
  if (lightCount == 0u) { return sampleEnvironment(1.0); }
  if (random() < 0.5) { return sampleEnvironment(0.5); }
  let index = sampleLightIndex();
  return candidateFromLight(index, random(), random(), position, 0.5);
}

fn materialAt(hit: Hit) -> Material {
  let index = min(u32(max(0.0, hit.normalMaterial.w)), max(0u, u32(globals.modes.w) - 1u));
  return materials[index];
}

fn fresnelSchlick(cosine: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

fn evaluateBrdf(material: Material, normal: vec3<f32>, viewDirection: vec3<f32>, lightDirection: vec3<f32>) -> vec3<f32> {
  let nDotL = max(dot(normal, lightDirection), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  if (nDotL <= 0.0 || nDotV <= 0.0) { return vec3<f32>(0.0); }
  let base = max(material.baseMetal.rgb, vec3<f32>(0.0));
  let metallic = clamp(material.baseMetal.w, 0.0, 1.0);
  let roughness = clamp(material.emissiveRough.w, 0.02, 1.0);
  let halfVector = safeDirection(viewDirection + lightDirection);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let vDotH = max(dot(viewDirection, halfVector), 0.0);
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  let distribution = alpha2 / max(3.14159265359 * denominator * denominator, 1e-6);
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let gv = nDotV / max(nDotV * (1.0 - k) + k, 1e-5);
  let gl = nDotL / max(nDotL * (1.0 - k) + k, 1e-5);
  let f0 = mix(vec3<f32>(0.04), base, metallic);
  let fresnel = fresnelSchlick(vDotH, f0);
  let specular = distribution * gv * gl * fresnel / max(4.0 * nDotV * nDotL, 1e-5);
  let diffuse = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic) * base / 3.14159265359;
  return (diffuse + specular) * nDotL;
}

fn evaluateCandidate(hit: Hit, viewDirection: vec3<f32>, candidate: Candidate) -> vec3<f32> {
  let material = materialAt(hit);
  return candidate.radiancePdf.rgb * evaluateBrdf(material, hit.normalMaterial.xyz, viewDirection, candidate.directionDistance.xyz) / max(candidate.radiancePdf.w, 1e-8);
}

fn candidateTarget(hit: Hit, viewDirection: vec3<f32>, candidate: Candidate) -> f32 {
  let contribution = candidate.radiancePdf.rgb * evaluateBrdf(materialAt(hit), hit.normalMaterial.xyz, viewDirection, candidate.directionDistance.xyz);
  return max(max3(contribution), 0.0);
}

fn emptyReservoir() -> Reservoir {
  var reservoir: Reservoir;
  reservoir.key = vec4<f32>(-1.0, -1.0, 0.0, 0.0);
  reservoir.stats = vec4<f32>(0.0);
  reservoir.extra = vec4<f32>(0.0);
  return reservoir;
}

fn reservoirStream(reservoir: ptr<function, Reservoir>, key: vec4<f32>, target: f32, proposalPdf: f32, represented: f32) {
  let count = max(1.0, represented);
  let weight = max(0.0, target) * count / max(proposalPdf, 1e-8);
  let nextWeight = (*reservoir).stats.x + weight;
  let nextM = (*reservoir).stats.z + count;
  if (weight > 0.0 && random() * max(nextWeight, 1e-8) <= weight) {
    (*reservoir).key = key;
    (*reservoir).stats.y = max(target, 0.0);
  }
  (*reservoir).stats.x = nextWeight;
  (*reservoir).stats.z = nextM;
}

fn reservoirFinalWeight(reservoir: Reservoir) -> f32 {
  if (reservoir.key.x < 0.0 || reservoir.stats.y <= 1e-8 || reservoir.stats.z <= 0.0) { return 0.0; }
  return reservoir.stats.x / max(reservoir.stats.y * reservoir.stats.z, 1e-8);
}

fn surfaceFromHit(hit: Hit, material: Material) -> SurfaceKey {
  var surface: SurfaceKey;
  surface.positionDepth = hit.positionT;
  surface.normalRough = vec4<f32>(hit.normalMaterial.xyz, material.emissiveRough.w);
  surface.baseMetal = material.baseMetal;
  return surface;
}

fn surfaceCompatible(current: SurfaceKey, history: SurfaceKey) -> bool {
  if (current.positionDepth.w <= 0.0 || history.positionDepth.w <= 0.0) { return false; }
  let distanceTolerance = 0.02 + 0.015 * current.positionDepth.w;
  if (distance(current.positionDepth.xyz, history.positionDepth.xyz) > distanceTolerance) { return false; }
  if (dot(current.normalRough.xyz, history.normalRough.xyz) < 0.92) { return false; }
  if (abs(current.normalRough.w - history.normalRough.w) > 0.2) { return false; }
  if (distance(current.baseMetal.rgb, history.baseMetal.rgb) > 0.35) { return false; }
  if (abs(current.baseMetal.w - history.baseMetal.w) > 0.25) { return false; }
  return true;
}

fn mergeHistory(reservoir: ptr<function, Reservoir>, source: Reservoir, currentHit: Hit, viewDirection: vec3<f32>) {
  if (source.key.x < 0.0 || source.stats.z <= 0.0) { return; }
  let candidate = candidateFromKey(source.key, currentHit.positionT.xyz);
  let target = candidateTarget(currentHit, viewDirection, candidate);
  let finalWeight = reservoirFinalWeight(source);
  if (target <= 0.0 || finalWeight <= 0.0) { return; }
  let equivalentProposal = max(target / finalWeight, 1e-8);
  reservoirStream(reservoir, source.key, target, equivalentProposal, min(source.stats.z, 64.0));
}

fn restirDirect(hit: Hit, viewDirection: vec3<f32>, pixel: u32, coord: vec2<u32>) -> vec3<f32> {
  var reservoir = emptyReservoir();
  let requested = clamp(i32(globals.modes.y), 1, 32);
  for (var candidateIndex = 0; candidateIndex < requested; candidateIndex += 1) {
    let candidate = sampleLightCandidate(hit.positionT.xyz);
    let target = candidateTarget(hit, viewDirection, candidate);
    reservoirStream(&reservoir, candidate.key, target, candidate.radiancePdf.w, 1.0);
  }

  let material = materialAt(hit);
  let currentSurface = surfaceFromHit(hit, material);
  let mode = i32(globals.modes.x);
  if (mode >= 2 && surfaceCompatible(currentSurface, previousSurface[pixel])) {
    mergeHistory(&reservoir, previousReservoir[pixel], hit, viewDirection);
  }
  if (mode >= 3) {
    let width = u32(globals.resolutionCounts.x);
    let height = u32(globals.resolutionCounts.y);
    let sampleCount = clamp(i32(globals.modes.z), 0, 32);
    for (var sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let radius = 1 + (sampleIndex % 4);
      let phase = (sampleIndex + i32(globals.camRightFrame.w)) & 7;
      var offset = vec2<i32>(radius, 0);
      if (phase == 1) { offset = vec2<i32>(-radius, 0); }
      if (phase == 2) { offset = vec2<i32>(0, radius); }
      if (phase == 3) { offset = vec2<i32>(0, -radius); }
      if (phase == 4) { offset = vec2<i32>(radius, radius); }
      if (phase == 5) { offset = vec2<i32>(-radius, radius); }
      if (phase == 6) { offset = vec2<i32>(radius, -radius); }
      if (phase == 7) { offset = vec2<i32>(-radius, -radius); }
      let nx = clamp(i32(coord.x) + offset.x, 0, i32(width) - 1);
      let ny = clamp(i32(coord.y) + offset.y, 0, i32(height) - 1);
      let neighbor = u32(ny) * width + u32(nx);
      if (surfaceCompatible(currentSurface, previousSurface[neighbor])) {
        mergeHistory(&reservoir, previousReservoir[neighbor], hit, viewDirection);
      }
    }
  }

  reservoir.stats.w = select(0.0, min(previousReservoir[pixel].stats.w + 1.0, 64.0), mode >= 2);
  nextReservoir[pixel] = reservoir;
  nextSurface[pixel] = currentSurface;
  if (reservoir.key.x < 0.0) { return vec3<f32>(0.0); }
  let selected = candidateFromKey(reservoir.key, hit.positionT.xyz);
  if (!visible(hit.positionT.xyz, hit.normalMaterial.xyz, selected)) { return vec3<f32>(0.0); }
  return evaluateCandidate(hit, viewDirection, selected) * reservoirFinalWeight(reservoir);
}

fn makeBasis(normal: vec3<f32>) -> mat3x3<f32> {
  let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.y) > 0.95);
  let tangent = safeDirection(cross(helper, normal));
  let bitangent = cross(normal, tangent);
  return mat3x3<f32>(tangent, bitangent, normal);
}

fn cosineHemisphere(normal: vec3<f32>) -> vec3<f32> {
  let r1 = random();
  let r2 = random();
  let radius = sqrt(r1);
  let angle = 2.0 * 3.14159265359 * r2;
  let local = vec3<f32>(radius * cos(angle), radius * sin(angle), sqrt(max(0.0, 1.0 - r1)));
  return safeDirection(makeBasis(normal) * local);
}

fn hashPosition(position: vec3<f32>) -> u32 {
  let cellSize = max(globals.cacheInfo.x, 0.001);
  let cell = vec3<i32>(floor(position / cellSize));
  var hash = 2166136261u;
  hash = (hash ^ bitcast<u32>(cell.x)) * 16777619u;
  hash = (hash ^ bitcast<u32>(cell.y)) * 16777619u;
  hash = (hash ^ bitcast<u32>(cell.z)) * 16777619u;
  return select(1u, hash, hash != 0u);
}

fn cacheSlot(position: vec3<f32>) -> u32 {
  let capacity = max(1u, u32(globals.cacheInfo.y));
  return hashPosition(position) % capacity;
}

fn cacheQuery(position: vec3<f32>) -> vec4<f32> {
  let tag = hashPosition(position);
  let capacity = max(1u, u32(globals.cacheInfo.y));
  let start = cacheSlot(position);
  for (var probe = 0u; probe < 8u; probe += 1u) {
    let slot = (start + probe) % capacity;
    let stored = atomicLoad(&cache[slot].tag);
    if (stored == tag) {
      let count = atomicLoad(&cache[slot].count);
      if (count >= 2u) {
        let scale = 1.0 / (1024.0 * f32(count));
        return vec4<f32>(
          f32(atomicLoad(&cache[slot].r)) * scale,
          f32(atomicLoad(&cache[slot].g)) * scale,
          f32(atomicLoad(&cache[slot].b)) * scale,
          f32(count)
        );
      }
      return vec4<f32>(0.0);
    }
    if (stored == 0u) { break; }
  }
  return vec4<f32>(0.0);
}

fn cacheUpdate(position: vec3<f32>, radiance: vec3<f32>) {
  let tag = hashPosition(position);
  let capacity = max(1u, u32(globals.cacheInfo.y));
  let start = cacheSlot(position);
  for (var probe = 0u; probe < 8u; probe += 1u) {
    let slot = (start + probe) % capacity;
    let stored = atomicLoad(&cache[slot].tag);
    if (stored == 0u) {
      let claim = atomicCompareExchangeWeak(&cache[slot].tag, 0u, tag);
      if (!claim.exchanged && claim.old_value != tag) { continue; }
      stored = tag;
    }
    if (stored == tag) {
      let safe = min(max(radiance, vec3<f32>(0.0)), vec3<f32>(4095.0));
      atomicAdd(&cache[slot].r, u32(safe.r * 1024.0));
      atomicAdd(&cache[slot].g, u32(safe.g * 1024.0));
      atomicAdd(&cache[slot].b, u32(safe.b * 1024.0));
      atomicAdd(&cache[slot].count, 1u);
      return;
    }
  }
}

fn sampleDirect(hit: Hit, viewDirection: vec3<f32>) -> vec3<f32> {
  let candidate = sampleLightCandidate(hit.positionT.xyz);
  if (!visible(hit.positionT.xyz, hit.normalMaterial.xyz, candidate)) { return vec3<f32>(0.0); }
  return evaluateCandidate(hit, viewDirection, candidate);
}

fn sampleBsdf(hit: Hit, incoming: vec3<f32>, material: Material) -> vec4<f32> {
  let normal = hit.normalMaterial.xyz;
  let base = max(material.baseMetal.rgb, vec3<f32>(0.0));
  let metallic = clamp(material.baseMetal.w, 0.0, 1.0);
  let roughness = clamp(material.emissiveRough.w, 0.015, 1.0);
  let transmission = clamp(material.parameters.x, 0.0, 1.0) * clamp(material.parameters.w, 0.0, 1.0);
  let ior = max(material.parameters.y, 1.0001);
  let clearcoat = clamp(material.parameters.z, 0.0, 1.0);
  let view = -incoming;
  let f0Scalar = pow((ior - 1.0) / (ior + 1.0), 2.0);
  let f0 = mix(vec3<f32>(f0Scalar), base, metallic);
  let fresnel = max3(fresnelSchlick(max(dot(view, normal), 0.0), f0));
  let choose = random();

  if (transmission > 0.0 && choose < transmission * (1.0 - fresnel)) {
    let eta = select(ior, 1.0 / ior, dot(incoming, normal) < 0.0);
    var transmitted = refract(incoming, normal, eta);
    if (dot(transmitted, transmitted) < 1e-8) { transmitted = reflect(incoming, normal); }
    let diffuseJitter = cosineHemisphere(select(normal, -normal, dot(transmitted, normal) < 0.0));
    let direction = safeDirection(mix(transmitted, diffuseJitter, roughness * roughness));
    return vec4<f32>(direction, max(0.05, 1.0 - transmission));
  }

  let specularChance = clamp(max(fresnel, metallic) + clearcoat * 0.15, 0.05, 0.95);
  if (choose < specularChance) {
    let reflected = reflect(incoming, normal);
    let diffuseJitter = cosineHemisphere(normal);
    let direction = safeDirection(mix(reflected, diffuseJitter, roughness * roughness));
    return vec4<f32>(direction, max(0.05, specularChance));
  }
  return vec4<f32>(cosineHemisphere(normal), max(0.05, 1.0 - specularChance));
}

fn pathSample(originInput: vec3<f32>, directionInput: vec3<f32>, pixel: u32, coord: vec2<u32>, writeHistory: bool) -> vec3<f32> {
  var origin = originInput;
  var direction = directionInput;
  var throughput = vec3<f32>(1.0);
  var radiance = vec3<f32>(0.0);
  let maxBounces = clamp(i32(globals.resolutionCounts.z), 1, 16);
  for (var depth = 0; depth < maxBounces; depth += 1) {
    let hit = traceClosest(origin, direction, 1e20);
    if (hit.positionT.w < 0.0) {
      radiance += throughput * environmentRadiance(direction);
      break;
    }
    let material = materialAt(hit);
    let emission = max(material.emissiveRough.rgb, vec3<f32>(0.0));
    if (max3(emission) > 0.0) {
      radiance += throughput * emission;
      if (depth > 0) { break; }
    }

    let viewDirection = -direction;
    var direct = vec3<f32>(0.0);
    if (depth == 0 && globals.modes.x > 0.5 && writeHistory) {
      direct = restirDirect(hit, viewDirection, pixel, coord);
    } else {
      direct = sampleDirect(hit, viewDirection);
    }
    radiance += throughput * direct;

    let cacheEnabled = globals.modes.w > 0.5;
    let roughness = material.emissiveRough.w;
    if (cacheEnabled && depth > 0 && roughness > 0.35) {
      let cached = cacheQuery(hit.positionT.xyz);
      if (cached.w >= 2.0) {
        radiance += throughput * cached.rgb;
        break;
      }
      if (random() < clamp(globals.cacheInfo.z, 0.0, 1.0)) { cacheUpdate(hit.positionT.xyz, direct); }
    }

    let bsdf = sampleBsdf(hit, direction, material);
    let base = max(material.baseMetal.rgb, vec3<f32>(0.0));
    let metallic = clamp(material.baseMetal.w, 0.0, 1.0);
    let tint = mix(base, mix(vec3<f32>(1.0), base, metallic), 0.5);
    throughput *= tint / max(bsdf.w, 0.05);
    origin = hit.positionT.xyz + hit.normalMaterial.xyz * select(-0.0015, 0.0015, dot(bsdf.xyz, hit.normalMaterial.xyz) >= 0.0);
    direction = bsdf.xyz;

    if (depth >= 3) {
      let survival = clamp(max3(throughput), 0.05, 0.95);
      if (random() > survival) { break; }
      throughput /= survival;
    }
    if (max3(throughput) < 1e-5) { break; }
  }
  return min(max(radiance, vec3<f32>(0.0)), vec3<f32>(max(globals.output.z, 1.0)));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let width = u32(globals.resolutionCounts.x);
  let height = u32(globals.resolutionCounts.y);
  if (invocation.x >= width || invocation.y >= height) { return; }
  let pixel = invocation.y * width + invocation.x;
  let spp = clamp(u32(globals.output.w), 1u, 4u);
  var sampleSum = vec3<f32>(0.0);
  for (var sampleIndex = 0u; sampleIndex < spp; sampleIndex += 1u) {
    rngState = pixel * 9781u + u32(globals.camRightFrame.w) * 6271u + sampleIndex * 13007u + 17u;
    let jitter = vec2<f32>(random(), random());
    var uv = (vec2<f32>(vec2<u32>(invocation.xy)) + jitter) / vec2<f32>(f32(width), f32(height));
    uv = uv * 2.0 - 1.0;
    let direction = safeDirection(
      globals.camForwardAspect.xyz +
      globals.camRightFrame.xyz * (uv.x * globals.camForwardAspect.w * globals.camPosTan.w) -
      globals.camUpFlags.xyz * (uv.y * globals.camPosTan.w)
    );
    sampleSum += pathSample(globals.camPosTan.xyz, direction, pixel, invocation.xy, sampleIndex == 0u);
  }
  let previous = accumulation[pixel];
  accumulation[pixel] = previous + vec4<f32>(sampleSum, f32(spp));
}
`;

export const advancedPathTracingDisplayWGSL = /* wgsl */ `
struct Globals {
  camPosTan: vec4<f32>,
  camForwardAspect: vec4<f32>,
  camRightFrame: vec4<f32>,
  camUpFlags: vec4<f32>,
  resolutionCounts: vec4<f32>,
  sceneCounts: vec4<f32>,
  modes: vec4<f32>,
  output: vec4<f32>,
  cacheInfo: vec4<f32>,
};

struct SurfaceKey {
  positionDepth: vec4<f32>,
  normalRough: vec4<f32>,
  baseMetal: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> accumulation: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> surface: array<SurfaceKey>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var output: VertexOutput;
  let position = positions[vertexIndex];
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = position * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  return output;
}

fn samplePixel(x: i32, y: i32) -> vec3<f32> {
  let width = i32(globals.resolutionCounts.x);
  let height = i32(globals.resolutionCounts.y);
  let px = clamp(x, 0, width - 1);
  let py = clamp(y, 0, height - 1);
  let value = accumulation[u32(py * width + px)];
  return value.rgb / max(value.a, 1.0);
}

fn aces(value: vec3<f32>) -> vec3<f32> {
  let x = max(value * max(globals.output.x, 0.0), vec3<f32>(0.0));
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3<f32>(b))) / (x * (c * x + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let width = i32(globals.resolutionCounts.x);
  let height = i32(globals.resolutionCounts.y);
  let x = clamp(i32(input.uv.x * f32(width)), 0, width - 1);
  let y = clamp(i32(input.uv.y * f32(height)), 0, height - 1);
  var color = samplePixel(x, y);
  if (globals.output.y > 0.5) {
    let centerIndex = u32(y * width + x);
    let center = surface[centerIndex];
    var weighted = color;
    var weightSum = 1.0;
    for (var oy = -1; oy <= 1; oy += 1) {
      for (var ox = -1; ox <= 1; ox += 1) {
        if (ox == 0 && oy == 0) { continue; }
        let nx = clamp(x + ox, 0, width - 1);
        let ny = clamp(y + oy, 0, height - 1);
        let neighbor = surface[u32(ny * width + nx)];
        let normalWeight = pow(max(dot(center.normalRough.xyz, neighbor.normalRough.xyz), 0.0), 16.0);
        let depthWeight = exp(-abs(center.positionDepth.w - neighbor.positionDepth.w) * 8.0);
        let roughWeight = exp(-abs(center.normalRough.w - neighbor.normalRough.w) * 4.0);
        let weight = normalWeight * depthWeight * roughWeight;
        weighted += samplePixel(nx, ny) * weight;
        weightSum += weight;
      }
    }
    color = weighted / max(weightSum, 1e-5);
  }
  let mapped = aces(color);
  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
`;
