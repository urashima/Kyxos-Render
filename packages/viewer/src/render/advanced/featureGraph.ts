import type { AdvancedRendererCapabilities } from './backendCapabilities';

export type AdvancedRenderFeatureName =
  | 'environmentImportance'
  | 'softwareRayQuery'
  | 'rayShadow'
  | 'rayAO'
  | 'rayReflection'
  | 'restirDI'
  | 'radianceCache'
  | 'pathTracing'
  | 'pathDenoise';

export interface AdvancedRenderFeatureContext {
  capabilities: AdvancedRendererCapabilities;
  requested: ReadonlySet<AdvancedRenderFeatureName>;
}

export interface AdvancedRenderFeatureDefinition {
  name: AdvancedRenderFeatureName;
  dependencies?: readonly AdvancedRenderFeatureName[];
  supported?: (capabilities: AdvancedRendererCapabilities) => boolean;
}

export interface ResolvedAdvancedFeatureGraph {
  enabled: AdvancedRenderFeatureName[];
  unavailable: Array<{ feature: AdvancedRenderFeatureName; reason: string }>;
}

export class AdvancedRenderFeatureGraph {
  private readonly definitions = new Map<AdvancedRenderFeatureName, AdvancedRenderFeatureDefinition>();

  register(definition: AdvancedRenderFeatureDefinition): this {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Advanced render feature '${definition.name}' is already registered.`);
    }
    this.definitions.set(definition.name, {
      ...definition,
      dependencies: [...(definition.dependencies ?? [])],
    });
    return this;
  }

  resolve(
    capabilities: AdvancedRendererCapabilities,
    requested: Iterable<AdvancedRenderFeatureName>,
  ): ResolvedAdvancedFeatureGraph {
    const requestedSet = new Set(requested);
    const enabled: AdvancedRenderFeatureName[] = [];
    const enabledSet = new Set<AdvancedRenderFeatureName>();
    const unavailable: Array<{ feature: AdvancedRenderFeatureName; reason: string }> = [];
    const visiting = new Set<AdvancedRenderFeatureName>();

    const visit = (name: AdvancedRenderFeatureName, explicit: boolean): boolean => {
      if (enabledSet.has(name)) return true;
      const definition = this.definitions.get(name);
      if (!definition) {
        if (explicit) unavailable.push({ feature: name, reason: 'Feature is not registered.' });
        return false;
      }
      if (visiting.has(name)) throw new Error(`Advanced render feature dependency cycle detected at '${name}'.`);
      if (definition.supported && !definition.supported(capabilities)) {
        if (explicit) {
          unavailable.push({
            feature: name,
            reason: capabilities.reason ?? `Feature '${name}' is unsupported by the active renderer tier.`,
          });
        }
        return false;
      }
      visiting.add(name);
      for (const dependency of definition.dependencies ?? []) {
        if (!visit(dependency, explicit)) {
          visiting.delete(name);
          if (explicit && !unavailable.some((entry) => entry.feature === name)) {
            unavailable.push({ feature: name, reason: `Required dependency '${dependency}' is unavailable.` });
          }
          return false;
        }
      }
      visiting.delete(name);
      enabledSet.add(name);
      enabled.push(name);
      return true;
    };

    for (const name of requestedSet) visit(name, true);
    return { enabled, unavailable };
  }
}

export function createDefaultAdvancedFeatureGraph(): AdvancedRenderFeatureGraph {
  const graph = new AdvancedRenderFeatureGraph();
  graph
    .register({ name: 'environmentImportance' })
    .register({
      name: 'softwareRayQuery',
      supported: (capabilities) => capabilities.softwareRayQuery,
    })
    .register({
      name: 'rayShadow',
      dependencies: ['softwareRayQuery'],
      supported: (capabilities) => capabilities.softwareRayQuery,
    })
    .register({
      name: 'rayAO',
      dependencies: ['softwareRayQuery'],
      supported: (capabilities) => capabilities.softwareRayQuery,
    })
    .register({
      name: 'rayReflection',
      dependencies: ['softwareRayQuery'],
      supported: (capabilities) => capabilities.softwareRayQuery,
    })
    .register({
      name: 'restirDI',
      dependencies: ['environmentImportance', 'rayShadow'],
      supported: (capabilities) => capabilities.restirDI,
    })
    .register({
      name: 'radianceCache',
      dependencies: ['softwareRayQuery'],
      supported: (capabilities) => capabilities.radianceCache,
    })
    .register({
      name: 'pathTracing',
      dependencies: ['environmentImportance', 'softwareRayQuery', 'rayShadow'],
      supported: (capabilities) => capabilities.pathTracing,
    })
    .register({
      name: 'pathDenoise',
      dependencies: ['pathTracing'],
      supported: (capabilities) => capabilities.pathTracing,
    });
  return graph;
}

export function requestedFeaturesForMode(
  mode: 'realtime' | 'cinematic' | 'pathTracing',
  options: { restir: boolean; radianceCache: boolean; denoise: boolean },
): AdvancedRenderFeatureName[] {
  if (mode === 'realtime') return ['environmentImportance'];
  const requested: AdvancedRenderFeatureName[] = [
    'environmentImportance',
    'softwareRayQuery',
    'rayShadow',
    'rayAO',
    'rayReflection',
  ];
  if (options.restir) requested.push('restirDI');
  if (options.radianceCache) requested.push('radianceCache');
  if (mode === 'pathTracing') {
    requested.push('pathTracing');
    if (options.denoise) requested.push('pathDenoise');
  }
  return requested;
}
