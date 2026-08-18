import {
  advancedPathTracingComputeWGSL as generatedComputeWGSL,
  advancedPathTracingDisplayWGSL as generatedDisplayWGSL,
} from './webgpuShaders';

/**
 * WGSL reserved words from the GPUWeb WGSL Editor's Draft (2026-08-17),
 * section 16.2. Keep this list local to the renderer so generated migration
 * snippets are validated deterministically instead of relying on how permissive
 * a particular browser's shader compiler happens to be.
 */
export const WGSL_RESERVED_WORDS = [
  'NULL', 'Self', 'abstract', 'active', 'alignas', 'alignof', 'as', 'asm', 'asm_fragment',
  'async', 'attribute', 'auto', 'await', 'become', 'cast', 'catch', 'class', 'co_await',
  'co_return', 'co_yield', 'coherent', 'column_major', 'common', 'compile', 'compile_fragment',
  'concept', 'const_cast', 'consteval', 'constexpr', 'constinit', 'crate', 'debugger', 'decltype',
  'delete', 'demote', 'demote_to_helper', 'do', 'dynamic_cast', 'enum', 'explicit', 'export',
  'extends', 'extern', 'external', 'fallthrough', 'filter', 'final', 'finally', 'friend', 'from',
  'fxgroup', 'get', 'goto', 'groupshared', 'highp', 'impl', 'implements', 'import', 'inline',
  'instanceof', 'interface', 'layout', 'lowp', 'macro', 'macro_rules', 'match', 'mediump', 'meta',
  'mod', 'module', 'move', 'mut', 'mutable', 'namespace', 'new', 'nil', 'noexcept', 'noinline',
  'nointerpolation', 'non_coherent', 'noncoherent', 'noperspective', 'null', 'nullptr', 'of',
  'operator', 'package', 'packoffset', 'partition', 'pass', 'patch', 'pixelfragment', 'precise',
  'precision', 'premerge', 'priv', 'protected', 'pub', 'public', 'readonly', 'ref', 'regardless',
  'register', 'reinterpret_cast', 'require', 'resource', 'restrict', 'self', 'set', 'shared',
  'sizeof', 'smooth', 'snorm', 'static', 'static_assert', 'static_cast', 'std', 'subroutine',
  'super', 'target', 'template', 'this', 'thread_local', 'throw', 'trait', 'try', 'type', 'typedef',
  'typeid', 'typename', 'typeof', 'union', 'unless', 'unorm', 'unsafe', 'unsized', 'use', 'using',
  'varying', 'virtual', 'volatile', 'wgsl', 'where', 'with', 'writeonly', 'yield',
] as const;

const RESERVED_IDENTIFIER_RENAMES: Readonly<Record<string, string>> = {
  meta: 'nodeInfo',
  target: 'targetValue',
};

export function findReservedWGSLIdentifiers(source: string): string[] {
  return WGSL_RESERVED_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(source));
}

export function sanitizePortableWGSL(source: string): string {
  let result = source;
  for (const reserved of WGSL_RESERVED_WORDS) {
    const replacement = RESERVED_IDENTIFIER_RENAMES[reserved] ?? `kx_${reserved}`;
    result = result.replace(new RegExp(`\\b${reserved}\\b`, 'g'), replacement);
  }
  return result;
}

const LEGACY_COMPUTE_BINDINGS = `@group(0) @binding(0) var<uniform> globals: Globals;
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

const PACKED_COMPUTE_BINDINGS = `@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> staticScene: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> dynamicScene: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> accumulation: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> previousReservoir: array<Reservoir>;
@group(0) @binding(5) var<storage, read_write> nextReservoir: array<Reservoir>;
@group(0) @binding(6) var<storage, read> previousSurface: array<SurfaceKey>;
@group(0) @binding(7) var<storage, read_write> nextSurface: array<SurfaceKey>;
@group(0) @binding(8) var<storage, read_write> cache: array<CacheCell>;

fn loadTriangle(index: u32) -> Triangle {
  let base = u32(globals.staticLayout0.x) + index * 4u;
  var value: Triangle;
  value.a = staticScene[base];
  value.b = staticScene[base + 1u];
  value.c = staticScene[base + 2u];
  value.normalMaterial = staticScene[base + 3u];
  return value;
}

fn loadBvhNode(index: u32) -> BvhNode {
  let base = u32(globals.staticLayout0.y) + index * 3u;
  var value: BvhNode;
  value.minLeft = staticScene[base];
  value.maxRight = staticScene[base + 1u];
  value.nodeInfo = staticScene[base + 2u];
  return value;
}

fn loadInstance(index: u32) -> Instance {
  let base = u32(globals.dynamicLayout.x) + index * 9u;
  var value: Instance;
  value.world0 = dynamicScene[base];
  value.world1 = dynamicScene[base + 1u];
  value.world2 = dynamicScene[base + 2u];
  value.world3 = dynamicScene[base + 3u];
  value.inverse0 = dynamicScene[base + 4u];
  value.inverse1 = dynamicScene[base + 5u];
  value.inverse2 = dynamicScene[base + 6u];
  value.inverse3 = dynamicScene[base + 7u];
  value.nodeInfo = dynamicScene[base + 8u];
  return value;
}

fn loadTlasNode(index: u32) -> BvhNode {
  let base = u32(globals.dynamicLayout.y) + index * 3u;
  var value: BvhNode;
  value.minLeft = dynamicScene[base];
  value.maxRight = dynamicScene[base + 1u];
  value.nodeInfo = dynamicScene[base + 2u];
  return value;
}

fn loadMaterial(index: u32) -> Material {
  let base = u32(globals.staticLayout0.z) + index * 3u;
  var value: Material;
  value.baseMetal = staticScene[base];
  value.emissiveRough = staticScene[base + 1u];
  value.parameters = staticScene[base + 2u];
  return value;
}

fn loadLight(index: u32) -> Light {
  let base = u32(globals.staticLayout0.w) + index * 4u;
  var value: Light;
  value.a = staticScene[base];
  value.b = staticScene[base + 1u];
  value.c = staticScene[base + 2u];
  value.colorType = staticScene[base + 3u];
  return value;
}

fn loadLightAlias(index: u32) -> vec4<f32> {
  return staticScene[u32(globals.staticLayout1.x) + index];
}

fn loadEnvironmentPixel(index: u32) -> vec4<f32> {
  return staticScene[u32(globals.staticLayout1.y) + index];
}

fn loadEnvironmentAlias(index: u32) -> vec4<f32> {
  return staticScene[u32(globals.staticLayout1.z) + index];
}`;

const GLOBALS_LAYOUT_TAIL = `  displayInfo: vec4<f32>,
};`;
const PACKED_GLOBALS_LAYOUT_TAIL = `  displayInfo: vec4<f32>,
  staticLayout0: vec4<f32>,
  staticLayout1: vec4<f32>,
  dynamicLayout: vec4<f32>,
};`;

function replaceArrayReads(source: string, name: string, loader: string): string {
  return source.replace(new RegExp(`\\b${name}\\[([^\\]\\n]+)\\]`, 'g'), `${loader}($1)`);
}

function packComputeWGSL(source: string): string {
  let result = source
    .replace(GLOBALS_LAYOUT_TAIL, PACKED_GLOBALS_LAYOUT_TAIL)
    .replace(LEGACY_COMPUTE_BINDINGS, PACKED_COMPUTE_BINDINGS)
    .replace('arrayLength(&tlasNodes)', 'u32(globals.dynamicLayout.z)');

  const reads: ReadonlyArray<readonly [string, string]> = [
    ['triangles', 'loadTriangle'],
    ['nodes', 'loadBvhNode'],
    ['instances', 'loadInstance'],
    ['tlasNodes', 'loadTlasNode'],
    ['materials', 'loadMaterial'],
    ['lights', 'loadLight'],
    ['lightAlias', 'loadLightAlias'],
    ['environmentPixels', 'loadEnvironmentPixel'],
    ['environmentAlias', 'loadEnvironmentAlias'],
  ];
  for (const [name, loader] of reads) result = replaceArrayReads(result, name, loader);

  if (
    result.includes('@binding(9)') ||
    result.includes('@binding(15)') ||
    !result.includes('var<storage, read> staticScene') ||
    !result.includes('var<storage, read> dynamicScene') ||
    !result.includes('fn loadTriangle(') ||
    !result.includes('fn loadInstance(')
  ) {
    throw new Error('Kyxos packed WGSL migration did not reduce the compute binding contract to eight storage buffers.');
  }
  return result;
}

const sanitizedCompute = sanitizePortableWGSL(generatedComputeWGSL);
const sanitizedDisplay = sanitizePortableWGSL(generatedDisplayWGSL);

export const advancedPathTracingComputeWGSL = packComputeWGSL(sanitizedCompute);
export const advancedPathTracingDisplayWGSL = sanitizedDisplay.replace(
  GLOBALS_LAYOUT_TAIL,
  PACKED_GLOBALS_LAYOUT_TAIL,
);

const remainingReserved = [
  ...findReservedWGSLIdentifiers(advancedPathTracingComputeWGSL),
  ...findReservedWGSLIdentifiers(advancedPathTracingDisplayWGSL),
];
if (remainingReserved.length) {
  throw new Error(`Kyxos portable WGSL still contains reserved identifiers: ${[...new Set(remainingReserved)].join(', ')}`);
}
