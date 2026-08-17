import { describe, expect, it } from 'vitest';
import {
  buildAliasTable,
  buildEnvironmentAliasTable,
  environmentSolidAnglePdf,
  mergeReservoir,
  powerHeuristic,
  reservoirFinalWeight,
  reservoirUpdate,
  sampleAlias,
} from '../../packages/viewer/src/render/advanced/sampling';
import {
  buildBvh,
  intersectTriangle,
  traceAny,
  traceClosest,
  type RayTriangle,
} from '../../packages/viewer/src/render/advanced/bvh';
import { RadianceHashCache } from '../../packages/viewer/src/render/advanced/radianceCache';
import {
  DEFAULT_TEMPORAL_DEPENDENCIES,
  TemporalHistoryRegistry,
} from '../../packages/viewer/src/render/advanced/temporalHistory';
import { resolveAdvancedRendererCapabilities } from '../../packages/viewer/src/render/advanced/backendCapabilities';
import {
  createDefaultAdvancedFeatureGraph,
  requestedFeaturesForMode,
} from '../../packages/viewer/src/render/advanced/featureGraph';
import { normalizeAdvancedRenderSettings } from '../../packages/scene-contract/src/advanced-render-settings';

describe('Truvis-inspired render foundation', () => {
  it('builds a normalized alias table and samples deterministic buckets', () => {
    const table = buildAliasTable([1, 3]);
    expect(table).toHaveLength(2);
    expect(table[0].mass).toBeCloseTo(0.25);
    expect(table[1].mass).toBeCloseTo(0.75);
    expect(sampleAlias(table, 0.75, 0.1)).toBeGreaterThanOrEqual(0);
  });

  it('weights HDR rows by spherical solid angle', () => {
    const environment = buildEnvironmentAliasTable(4, 2, (x) => (x === 0 ? [10, 10, 10] : [1, 1, 1]));
    expect(environment.entries).toHaveLength(8);
    expect(environment.totalWeight).toBeGreaterThan(0);
    expect(environmentSolidAnglePdf(environment, 0, 0)).toBeGreaterThan(environmentSolidAnglePdf(environment, 1, 0));
  });

  it('uses stable MIS and reservoir normalization', () => {
    expect(powerHeuristic(2, 1)).toBeCloseTo(0.8);
    let reservoir = reservoirUpdate(
      { sample: null as string | null, weightSum: 0, target: 0, m: 0 },
      'a', 2, 1, 0,
    );
    reservoir = reservoirUpdate(reservoir, 'b', 1, 1, 1);
    expect(reservoir.m).toBe(2);
    expect(reservoir.sample).toBe('a');
    expect(reservoirFinalWeight(reservoir)).toBeGreaterThan(0);
    const merged = mergeReservoir(
      { sample: null as string | null, weightSum: 0, target: 0, m: 0 },
      reservoir, 2, 0,
    );
    expect(merged.m).toBe(2);
  });

  it('builds and traverses a software BVH', () => {
    const triangle: RayTriangle = {
      a: [-1, -1, 0], b: [1, -1, 0], c: [0, 1, 0], materialIndex: 3,
    };
    const ray = {
      origin: [0, 0, 1] as [number, number, number],
      direction: [0, 0, -1] as [number, number, number],
    };
    expect(intersectTriangle(ray, triangle)?.distance).toBeCloseTo(1);
    const bvh = buildBvh([triangle]);
    const hit = traceClosest(bvh, ray);
    expect(hit?.materialIndex).toBe(3);
    expect(hit?.distance).toBeCloseTo(1);
    expect(traceAny(bvh, { ...ray, tMax: 0.5 })).toBe(false);
    expect(traceAny(bvh, { ...ray, tMax: 2 })).toBe(true);
  });

  it('tracks temporal dependencies without invalidating unrelated history', () => {
    const registry = new TemporalHistoryRegistry();
    registry.register('restir', DEFAULT_TEMPORAL_DEPENDENCIES.restir);
    registry.commit('restir');
    expect(registry.isValid('restir')).toBe(true);
    registry.bump('animation');
    expect(registry.isValid('restir')).toBe(true);
    registry.bump('lighting');
    expect(registry.isValid('restir')).toBe(false);
    expect(registry.dependencyDiff('restir')).toContain('lighting');
  });

  it('stores world-space radiance with bounded probing', () => {
    const cache = new RadianceHashCache(32, 1);
    cache.beginFrame();
    cache.update([0.1, 0.2, 0.3], [2, 1, 0.5]);
    cache.update([0.1, 0.2, 0.3], [2, 1, 0.5]);
    expect(cache.query([0.4, 0.2, 0.1])?.[0]).toBeCloseTo(2);
    expect(cache.stats().occupied).toBe(1);
    cache.reset();
    expect(cache.stats().occupied).toBe(0);
  });

  it('keeps WebGL and weak WebGPU adapters out of the RT enhanced tier', () => {
    expect(resolveAdvancedRendererCapabilities('webgl2').softwareRayQuery).toBe(false);
    const weak = resolveAdvancedRendererCapabilities('webgpu', {
      maxStorageBufferBindingSize: 32 * 1024 * 1024,
      maxBufferSize: 64 * 1024 * 1024,
    });
    expect(weak.tier).toBe('webgpu-basic');
    expect(weak.pathTracing).toBe(false);
    const strong = resolveAdvancedRendererCapabilities('webgpu', {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
    });
    expect(strong.pathTracing).toBe(true);
  });

  it('resolves capability-gated advanced features and dependencies in order', () => {
    const graph = createDefaultAdvancedFeatureGraph();
    const webgl = resolveAdvancedRendererCapabilities('webgl2');
    const rejected = graph.resolve(
      webgl,
      requestedFeaturesForMode('pathTracing', { restir: true, radianceCache: true, denoise: true }),
    );
    expect(rejected.enabled).toContain('environmentImportance');
    expect(rejected.enabled).not.toContain('softwareRayQuery');
    expect(rejected.unavailable.some((entry) => entry.feature === 'pathTracing')).toBe(true);

    const webgpu = resolveAdvancedRendererCapabilities('webgpu', {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
    });
    const resolved = graph.resolve(
      webgpu,
      requestedFeaturesForMode('pathTracing', { restir: true, radianceCache: true, denoise: true }),
    );
    expect(resolved.unavailable).toHaveLength(0);
    expect(resolved.enabled.indexOf('softwareRayQuery')).toBeLessThan(resolved.enabled.indexOf('pathTracing'));
    expect(resolved.enabled).toContain('restirDI');
    expect(resolved.enabled).toContain('radianceCache');
    expect(resolved.enabled).toContain('pathDenoise');
  });

  it('normalizes advanced scene settings into bounded production values', () => {
    const settings = normalizeAdvancedRenderSettings({
      renderingMode: 'pathTracing',
      restirDI: { mode: 'temporalSpatial', candidates: 999 },
      radianceCache: { capacity: 1, cellSize: -4 },
      pathTracing: { maxBounces: 100, samplesPerFrame: 99, resolutionScale: 2 },
    });
    expect(settings.renderingMode).toBe('pathTracing');
    expect(settings.restirDI.candidates).toBe(32);
    expect(settings.radianceCache.capacity).toBe(1024);
    expect(settings.pathTracing.maxBounces).toBe(16);
    expect(settings.pathTracing.samplesPerFrame).toBe(4);
    expect(settings.pathTracing.resolutionScale).toBe(1);
  });
});
