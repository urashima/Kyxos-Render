export type RadianceVec3 = [number, number, number];

interface CacheEntry {
  tag: number;
  radiance: RadianceVec3;
  samples: number;
  age: number;
}

export interface RadianceCacheStats {
  capacity: number;
  occupied: number;
  samples: number;
  estimatedBytes: number;
}

function hash32(x: number, y: number, z: number): number {
  let hash = 2166136261 >>> 0;
  hash = Math.imul(hash ^ (x >>> 0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (y >>> 0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (z >>> 0), 16777619) >>> 0;
  return hash || 1;
}

function cell(value: number, cellSize: number): number {
  return Math.floor(value / cellSize) | 0;
}

export class RadianceHashCache {
  readonly capacity: number;
  readonly cellSize: number;
  private entries: CacheEntry[];
  private frame = 0;

  constructor(capacity = 65536, cellSize = 0.5) {
    this.capacity = Math.max(16, Math.floor(capacity));
    this.cellSize = Math.max(0.001, cellSize);
    this.entries = Array.from({ length: this.capacity }, () => ({
      tag: 0,
      radiance: [0, 0, 0],
      samples: 0,
      age: 0,
    }));
  }

  beginFrame(): void {
    this.frame += 1;
  }

  private address(position: RadianceVec3): { tag: number; slot: number } {
    const x = cell(position[0], this.cellSize);
    const y = cell(position[1], this.cellSize);
    const z = cell(position[2], this.cellSize);
    const tag = hash32(x, y, z);
    return { tag, slot: tag % this.capacity };
  }

  private find(position: RadianceVec3, insert: boolean): CacheEntry | null {
    const { tag, slot } = this.address(position);
    let stale: CacheEntry | null = null;
    for (let probe = 0; probe < 8; probe += 1) {
      const entry = this.entries[(slot + probe) % this.capacity];
      if (entry.tag === tag) return entry;
      if (entry.tag === 0) {
        if (!insert) return null;
        entry.tag = tag;
        entry.radiance = [0, 0, 0];
        entry.samples = 0;
        entry.age = this.frame;
        return entry;
      }
      if (!stale || entry.age < stale.age) stale = entry;
    }
    if (!insert || !stale) return null;
    stale.tag = tag;
    stale.radiance = [0, 0, 0];
    stale.samples = 0;
    stale.age = this.frame;
    return stale;
  }

  update(position: RadianceVec3, radiance: RadianceVec3, weight = 1): void {
    const entry = this.find(position, true);
    if (!entry) return;
    const w = Math.max(0, Number.isFinite(weight) ? weight : 0);
    if (w <= 0) return;
    const previous = entry.samples;
    const next = Math.min(65535, previous + w);
    const retained = previous / Math.max(next, 1e-6);
    const incoming = w / Math.max(next, 1e-6);
    entry.radiance = [
      entry.radiance[0] * retained + Math.max(0, radiance[0]) * incoming,
      entry.radiance[1] * retained + Math.max(0, radiance[1]) * incoming,
      entry.radiance[2] * retained + Math.max(0, radiance[2]) * incoming,
    ];
    entry.samples = next;
    entry.age = this.frame;
  }

  query(position: RadianceVec3, minimumSamples = 2): RadianceVec3 | null {
    const entry = this.find(position, false);
    if (!entry || entry.samples < minimumSamples) return null;
    entry.age = this.frame;
    return [...entry.radiance] as RadianceVec3;
  }

  evictOlderThan(maxAge: number): number {
    const threshold = this.frame - Math.max(0, maxAge);
    let evicted = 0;
    for (const entry of this.entries) {
      if (entry.tag && entry.age < threshold) {
        entry.tag = 0;
        entry.radiance = [0, 0, 0];
        entry.samples = 0;
        entry.age = 0;
        evicted += 1;
      }
    }
    return evicted;
  }

  reset(): void {
    this.frame = 0;
    for (const entry of this.entries) {
      entry.tag = 0;
      entry.radiance = [0, 0, 0];
      entry.samples = 0;
      entry.age = 0;
    }
  }

  stats(): RadianceCacheStats {
    let occupied = 0;
    let samples = 0;
    for (const entry of this.entries) {
      if (!entry.tag) continue;
      occupied += 1;
      samples += entry.samples;
    }
    return {
      capacity: this.capacity,
      occupied,
      samples,
      // GPU representation: tag + rgb accum + count/age, rounded to a 32-byte aligned cell.
      estimatedBytes: this.capacity * 32,
    };
  }
}
