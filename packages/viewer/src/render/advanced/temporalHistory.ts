export type TemporalRevisionKey =
  | 'camera'
  | 'cameraCut'
  | 'geometry'
  | 'transform'
  | 'material'
  | 'lighting'
  | 'environment'
  | 'animation'
  | 'resolution'
  | 'pipeline';

export type TemporalRevisionSnapshot = Record<TemporalRevisionKey, number>;

const REVISION_KEYS: readonly TemporalRevisionKey[] = [
  'camera',
  'cameraCut',
  'geometry',
  'transform',
  'material',
  'lighting',
  'environment',
  'animation',
  'resolution',
  'pipeline',
];

function freshSnapshot(): TemporalRevisionSnapshot {
  return {
    camera: 0,
    cameraCut: 0,
    geometry: 0,
    transform: 0,
    material: 0,
    lighting: 0,
    environment: 0,
    animation: 0,
    resolution: 0,
    pipeline: 0,
  };
}

interface FeatureHistory {
  dependencies: ReadonlySet<TemporalRevisionKey>;
  committed: TemporalRevisionSnapshot | null;
  explicitInvalidation: number;
  committedInvalidation: number;
}

export class TemporalHistoryRegistry {
  private revisions = freshSnapshot();
  private features = new Map<string, FeatureHistory>();

  register(name: string, dependencies: readonly TemporalRevisionKey[]): void {
    const existing = this.features.get(name);
    if (existing) {
      existing.dependencies = new Set(dependencies);
      return;
    }
    this.features.set(name, {
      dependencies: new Set(dependencies),
      committed: null,
      explicitInvalidation: 0,
      committedInvalidation: -1,
    });
  }

  bump(...keys: TemporalRevisionKey[]): TemporalRevisionSnapshot {
    for (const key of new Set(keys)) this.revisions[key] += 1;
    return this.snapshot();
  }

  invalidate(name?: string): void {
    if (name) {
      const feature = this.features.get(name);
      if (feature) feature.explicitInvalidation += 1;
      return;
    }
    for (const feature of this.features.values()) feature.explicitInvalidation += 1;
  }

  isValid(name: string): boolean {
    const feature = this.features.get(name);
    if (!feature?.committed) return false;
    if (feature.explicitInvalidation !== feature.committedInvalidation) return false;
    for (const key of feature.dependencies) {
      if (feature.committed[key] !== this.revisions[key]) return false;
    }
    return true;
  }

  commit(name: string): void {
    const feature = this.features.get(name);
    if (!feature) throw new Error(`Temporal feature '${name}' is not registered.`);
    feature.committed = this.snapshot();
    feature.committedInvalidation = feature.explicitInvalidation;
  }

  reset(): void {
    this.revisions = freshSnapshot();
    for (const feature of this.features.values()) {
      feature.committed = null;
      feature.explicitInvalidation = 0;
      feature.committedInvalidation = -1;
    }
  }

  snapshot(): TemporalRevisionSnapshot {
    return { ...this.revisions };
  }

  dependencyDiff(name: string): TemporalRevisionKey[] {
    const feature = this.features.get(name);
    if (!feature?.committed) return [...(feature?.dependencies ?? REVISION_KEYS)];
    return [...feature.dependencies].filter((key) => feature.committed?.[key] !== this.revisions[key]);
  }
}

export const DEFAULT_TEMPORAL_DEPENDENCIES = {
  traa: ['cameraCut', 'geometry', 'transform', 'material', 'resolution', 'pipeline'],
  ssr: ['cameraCut', 'geometry', 'transform', 'material', 'environment', 'resolution', 'pipeline'],
  ssgi: ['cameraCut', 'geometry', 'transform', 'material', 'lighting', 'environment', 'resolution', 'pipeline'],
  sss: ['cameraCut', 'geometry', 'transform', 'material', 'resolution', 'pipeline'],
  restir: ['cameraCut', 'geometry', 'transform', 'material', 'lighting', 'environment', 'resolution', 'pipeline'],
  radianceCache: ['geometry', 'material', 'lighting', 'environment', 'pipeline'],
  pathTracing: ['camera', 'cameraCut', 'geometry', 'transform', 'material', 'lighting', 'environment', 'animation', 'resolution', 'pipeline'],
} as const satisfies Record<string, readonly TemporalRevisionKey[]>;
