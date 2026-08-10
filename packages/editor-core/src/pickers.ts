import type { KyxosSceneContract } from '@kyxos/scene-contract';

export type StudioPickerKind =
  | 'asset'
  | 'entity'
  | 'material'
  | 'texture'
  | 'animation'
  | 'camera'
  | 'light'
  | 'curve'
  | 'gradient'
  | 'project-resource'
  | 'merge-conflict'
  | (string & {});

export interface StudioPickerOption<T = unknown> {
  id: string;
  label: string;
  value: T;
  description?: string;
  group?: string;
  keywords?: string[];
  disabled?: boolean;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

export interface StudioPickerQuery {
  kind: StudioPickerKind;
  query?: string;
  selectedIds?: string[];
  multiple?: boolean;
  limit?: number;
  filters?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface StudioPickerProvider<T = unknown> {
  id: string;
  kinds: StudioPickerKind[];
  priority?: number;
  search(query: StudioPickerQuery): StudioPickerOption<T>[] | Promise<StudioPickerOption<T>[]>;
  validate?(option: StudioPickerOption<T>, query: StudioPickerQuery): string | null;
}

export interface StudioPickerSearchResult<T = unknown> extends StudioPickerOption<T> {
  providerId: string;
  score: number;
  validationError: string | null;
}

export interface StudioPickerPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PickerPreferences {
  version: 1;
  recent: Record<string, string[]>;
  favorites: Record<string, string[]>;
}

function normalizeQuery(value: string): string[] {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function scoreOption(option: StudioPickerOption, terms: string[]): number {
  if (!terms.length) return 1;
  const label = option.label.toLocaleLowerCase();
  const id = option.id.toLocaleLowerCase();
  const description = option.description?.toLocaleLowerCase() ?? '';
  const keywords = option.keywords?.join(' ').toLocaleLowerCase() ?? '';
  let score = 0;
  for (const term of terms) {
    if (label === term) score += 100;
    else if (label.startsWith(term)) score += 50;
    else if (label.includes(term)) score += 25;
    if (id === term) score += 60;
    else if (id.includes(term)) score += 15;
    if (keywords.includes(term)) score += 12;
    if (description.includes(term)) score += 5;
  }
  return score;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class StudioPickerRegistry extends EventTarget {
  private readonly providers = new Map<string, StudioPickerProvider>();
  private readonly preferences: PickerPreferences;

  constructor(
    private readonly storageKey = 'kyxos.studio.pickers.v1',
    private readonly storage: StudioPickerPreferenceStorage | null = typeof localStorage === 'undefined'
      ? null
      : localStorage,
  ) {
    super();
    this.preferences = this.loadPreferences();
  }

  register(provider: StudioPickerProvider): () => void {
    if (!provider.id.trim()) throw new Error('Picker provider ID is required.');
    if (!provider.kinds.length) throw new Error('Picker providers must support at least one kind.');
    if (this.providers.has(provider.id)) throw new Error(`Picker provider ${provider.id} is already registered.`);
    this.providers.set(provider.id, provider);
    this.dispatchEvent(new CustomEvent('change', { detail: { providerId: provider.id, registered: true } }));
    return () => {
      if (!this.providers.delete(provider.id)) return;
      this.dispatchEvent(new CustomEvent('change', { detail: { providerId: provider.id, registered: false } }));
    };
  }

  listProviders(kind?: StudioPickerKind): StudioPickerProvider[] {
    return [...this.providers.values()]
      .filter((provider) => !kind || provider.kinds.includes(kind))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
  }

  async search<T = unknown>(query: StudioPickerQuery): Promise<StudioPickerSearchResult<T>[]> {
    if (query.signal?.aborted) throw new DOMException('Picker search aborted.', 'AbortError');
    const limit = Math.max(1, Math.min(1_000, Math.floor(query.limit ?? 100)));
    const terms = normalizeQuery(query.query ?? '');
    const selected = new Set(query.selectedIds ?? []);
    const recent = this.preferences.recent[query.kind] ?? [];
    const favorites = new Set(this.preferences.favorites[query.kind] ?? []);
    const providers = this.listProviders(query.kind);
    const batches = await Promise.all(providers.map(async (provider) => {
      const values = await provider.search({ ...query, signal: query.signal });
      if (query.signal?.aborted) throw new DOMException('Picker search aborted.', 'AbortError');
      return values.map((option) => {
        const relevance = scoreOption(option, terms);
        const recentIndex = recent.indexOf(option.id);
        const preferenceScore = favorites.has(option.id) ? 30 : recentIndex >= 0 ? Math.max(1, 15 - recentIndex) : 0;
        const selectedScore = selected.has(option.id) ? 2 : 0;
        const validationError = provider.validate?.(option, query) ?? null;
        return {
          ...clone(option),
          providerId: provider.id,
          score: relevance + preferenceScore + selectedScore + (provider.priority ?? 0),
          validationError,
          disabled: option.disabled || Boolean(validationError),
        } satisfies StudioPickerSearchResult;
      });
    }));

    const byId = new Map<string, StudioPickerSearchResult>();
    for (const result of batches.flat()) {
      if (terms.length && result.score <= (result.providerId ? (this.providers.get(result.providerId)?.priority ?? 0) : 0)) continue;
      const previous = byId.get(result.id);
      if (!previous || result.score > previous.score) byId.set(result.id, result);
    }
    return [...byId.values()]
      .sort((left, right) =>
        Number(Boolean(right.metadata?.favorite)) - Number(Boolean(left.metadata?.favorite))
        || right.score - left.score
        || (left.group ?? '').localeCompare(right.group ?? '')
        || left.label.localeCompare(right.label),
      )
      .slice(0, limit) as StudioPickerSearchResult<T>[];
  }

  commit(kind: StudioPickerKind, optionIds: Iterable<string>): void {
    const current = this.preferences.recent[kind] ?? [];
    const next = [...new Set([...optionIds, ...current])].slice(0, 30);
    this.preferences.recent[kind] = next;
    this.persist();
    this.dispatchEvent(new CustomEvent('preferences', { detail: { kind, recent: [...next] } }));
  }

  setFavorite(kind: StudioPickerKind, optionId: string, favorite: boolean): void {
    const values = new Set(this.preferences.favorites[kind] ?? []);
    favorite ? values.add(optionId) : values.delete(optionId);
    this.preferences.favorites[kind] = [...values].slice(0, 200);
    this.persist();
    this.dispatchEvent(new CustomEvent('preferences', {
      detail: { kind, favorites: [...this.preferences.favorites[kind]] },
    }));
  }

  isFavorite(kind: StudioPickerKind, optionId: string): boolean {
    return (this.preferences.favorites[kind] ?? []).includes(optionId);
  }

  clearPreferences(kind?: StudioPickerKind): void {
    if (kind) {
      delete this.preferences.recent[kind];
      delete this.preferences.favorites[kind];
    } else {
      this.preferences.recent = {};
      this.preferences.favorites = {};
    }
    this.persist();
    this.dispatchEvent(new CustomEvent('preferences', { detail: { kind: kind ?? null, cleared: true } }));
  }

  private loadPreferences(): PickerPreferences {
    try {
      const value = JSON.parse(this.storage?.getItem(this.storageKey) ?? 'null') as PickerPreferences | null;
      if (value?.version === 1 && value.recent && value.favorites) return clone(value);
    } catch {
      // Invalid preferences are replaced with a clean document.
    }
    return { version: 1, recent: {}, favorites: {} };
  }

  private persist(): void {
    this.storage?.setItem(this.storageKey, JSON.stringify(this.preferences));
  }
}

export interface CurveKey {
  time: number;
  value: number;
  interpolation?: 'step' | 'linear' | 'cubic';
  inTangent?: number;
  outTangent?: number;
}

export interface CurveValue {
  keys: CurveKey[];
  preInfinity?: 'constant' | 'linear' | 'cycle';
  postInfinity?: 'constant' | 'linear' | 'cycle';
}

export interface GradientStop {
  position: number;
  color: string;
}

export interface GradientValue {
  stops: GradientStop[];
  interpolation?: 'linear' | 'constant';
}

export function normalizeCurve(value: CurveValue): CurveValue {
  const keys = value.keys
    .filter((key) => Number.isFinite(key.time) && Number.isFinite(key.value))
    .map((key) => ({
      time: key.time,
      value: key.value,
      interpolation: key.interpolation ?? 'linear',
      inTangent: Number.isFinite(key.inTangent) ? key.inTangent : undefined,
      outTangent: Number.isFinite(key.outTangent) ? key.outTangent : undefined,
    }))
    .sort((left, right) => left.time - right.time);
  return {
    keys,
    preInfinity: value.preInfinity ?? 'constant',
    postInfinity: value.postInfinity ?? 'constant',
  };
}

export function evaluateCurve(value: CurveValue, time: number): number {
  const curve = normalizeCurve(value);
  if (!curve.keys.length) return 0;
  if (curve.keys.length === 1 || time <= curve.keys[0].time) return curve.keys[0].value;
  if (time >= curve.keys.at(-1)!.time) return curve.keys.at(-1)!.value;
  const rightIndex = curve.keys.findIndex((key) => key.time >= time);
  const left = curve.keys[rightIndex - 1];
  const right = curve.keys[rightIndex];
  if (left.interpolation === 'step') return left.value;
  const duration = right.time - left.time;
  const alpha = duration <= 0 ? 0 : (time - left.time) / duration;
  if (left.interpolation !== 'cubic') return left.value + (right.value - left.value) * alpha;
  const t2 = alpha * alpha;
  const t3 = t2 * alpha;
  const leftTangent = (left.outTangent ?? 0) * duration;
  const rightTangent = (right.inTangent ?? 0) * duration;
  return (2 * t3 - 3 * t2 + 1) * left.value
    + (t3 - 2 * t2 + alpha) * leftTangent
    + (-2 * t3 + 3 * t2) * right.value
    + (t3 - t2) * rightTangent;
}

function normalizeHexColor(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized.slice(1).split('').map((entry) => entry.repeat(2)).join('')}`;
  }
  return '#ffffff';
}

export function normalizeGradient(value: GradientValue): GradientValue {
  const stops = value.stops
    .filter((stop) => Number.isFinite(stop.position))
    .map((stop) => ({
      position: Math.max(0, Math.min(1, stop.position)),
      color: normalizeHexColor(stop.color),
    }))
    .sort((left, right) => left.position - right.position);
  return {
    stops: stops.length ? stops : [{ position: 0, color: '#ffffff' }, { position: 1, color: '#000000' }],
    interpolation: value.interpolation ?? 'linear',
  };
}

function hexChannels(color: string): [number, number, number] {
  const value = normalizeHexColor(color).slice(1);
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function evaluateGradient(value: GradientValue, position: number): string {
  const gradient = normalizeGradient(value);
  const clamped = Math.max(0, Math.min(1, position));
  const first = gradient.stops[0];
  const last = gradient.stops.at(-1)!;
  if (clamped <= first.position) return first.color;
  if (clamped >= last.position) return last.color;
  const rightIndex = gradient.stops.findIndex((stop) => stop.position >= clamped);
  const left = gradient.stops[rightIndex - 1];
  const right = gradient.stops[rightIndex];
  if (gradient.interpolation === 'constant') return left.color;
  const alpha = (clamped - left.position) / Math.max(Number.EPSILON, right.position - left.position);
  const leftChannels = hexChannels(left.color);
  const rightChannels = hexChannels(right.color);
  const channels = leftChannels.map((channel, index) =>
    Math.round(channel + (rightChannels[index] - channel) * alpha),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function createScenePickerProviders(
  getScene: () => KyxosSceneContract,
): StudioPickerProvider[] {
  const provider = <T>(
    id: string,
    kinds: StudioPickerKind[],
    list: (scene: KyxosSceneContract, query: StudioPickerQuery) => StudioPickerOption<T>[],
  ): StudioPickerProvider<T> => ({ id, kinds, priority: 10, search: (query) => list(getScene(), query) });

  return [
    provider('scene.entities', ['entity'], (scene) => scene.nodes.map((node) => ({
      id: node.id,
      label: node.name,
      value: node.id,
      description: node.cameraId ? 'Camera entity' : node.lightId ? 'Light entity' : node.meshAssetId ? 'Mesh entity' : 'Entity',
      keywords: [node.id, node.meshAssetId ?? '', ...(node.materialSlots ?? [])],
      disabled: Boolean(node.locked),
    }))),
    provider('scene.assets', ['asset', 'texture', 'project-resource'], (scene, query) =>
      Object.values(scene.assets)
        .filter((asset) => query.kind !== 'texture' || asset.kind === 'texture')
        .filter((asset) => {
          const kinds = query.filters?.assetKinds;
          return !Array.isArray(kinds) || !kinds.length || kinds.includes(asset.kind);
        })
        .map((asset) => ({
          id: asset.id,
          label: asset.name ?? asset.id,
          value: asset.id,
          description: `${asset.kind} · ${asset.mimeType}`,
          group: asset.kind,
          keywords: [asset.id, asset.kind, asset.mimeType, asset.contentHash],
          metadata: { byteSize: asset.byteSize, uri: asset.uri },
        }))),
    provider('scene.materials', ['material'], (scene) => Object.values(scene.materials).map((material) => ({
      id: material.id,
      label: material.name,
      value: material.id,
      description: `${material.alphaMode} · metal ${material.metalness.toFixed(2)} · rough ${material.roughness.toFixed(2)}`,
      keywords: [material.id, material.alphaMode],
    }))),
    provider('scene.animations', ['animation'], (scene) => scene.animations.map((animation) => ({
      id: animation.id,
      label: animation.name,
      value: animation.id,
      description: `${animation.duration.toFixed(2)}s${animation.autoplay ? ' · autoplay' : ''}`,
      keywords: [animation.id, ...(animation.channels?.map((channel) => channel.path) ?? [])],
    }))),
    provider('scene.cameras', ['camera'], (scene) => scene.cameras.map((camera) => ({
      id: camera.id,
      label: camera.name,
      value: camera.id,
      description: `${camera.projection} · near ${camera.near} · far ${camera.far}`,
      keywords: [camera.id, camera.projection],
    }))),
    provider('scene.lights', ['light'], (scene) => (scene.lights ?? []).map((light) => ({
      id: light.id,
      label: light.name,
      value: light.id,
      description: `${light.type} · intensity ${light.intensity}`,
      keywords: [light.id, light.type],
    }))),
  ];
}
