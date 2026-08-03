export type SearchEntryKind =
  | 'command'
  | 'entity'
  | 'asset'
  | 'scene'
  | 'template'
  | 'setting'
  | 'help';

export interface StudioSearchEntry {
  id: string;
  kind: SearchEntryKind;
  label: string;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
  run(): void | Promise<void>;
}

export type StudioSearchProvider = () => StudioSearchEntry[] | Promise<StudioSearchEntry[]>;

export class StudioSearchRegistry extends EventTarget {
  private readonly providers = new Map<string, StudioSearchProvider>();

  registerProvider(id: string, provider: StudioSearchProvider): () => void {
    if (this.providers.has(id)) throw new Error(`Search provider ${id} is already registered.`);
    this.providers.set(id, provider);
    this.dispatchEvent(new CustomEvent('change'));
    return () => {
      this.providers.delete(id);
      this.dispatchEvent(new CustomEvent('change'));
    };
  }

  async query(input: string, limit = 50): Promise<StudioSearchEntry[]> {
    const query = normalizeSearch(input);
    const entries = (await Promise.all([...this.providers.values()].map((provider) => provider()))).flat();
    const unique = new Map<string, StudioSearchEntry>();
    for (const entry of entries) unique.set(`${entry.kind}:${entry.id}`, entry);
    return [...unique.values()]
      .map((entry) => ({ entry, score: scoreSearchEntry(entry, query) }))
      .filter(({ score }) => !query || score > 0)
      .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
      .slice(0, Math.max(1, limit))
      .map(({ entry }) => entry);
  }
}

function normalizeSearch(value: string): string[] {
  return value
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function scoreSearchEntry(entry: StudioSearchEntry, tokens: string[]): number {
  if (!tokens.length) return entry.disabled ? 1 : 2;
  const label = entry.label.toLocaleLowerCase();
  const description = entry.description?.toLocaleLowerCase() ?? '';
  const keywords = (entry.keywords ?? []).join(' ').toLocaleLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (label === token) score += 120;
    else if (label.startsWith(token)) score += 80;
    else if (label.includes(token)) score += 55;
    else if (keywords.includes(token)) score += 30;
    else if (description.includes(token)) score += 18;
    else return 0;
  }
  if (entry.disabled) score -= 10;
  return score;
}

export interface StudioUserSettings {
  compactDensity: boolean;
  reducedMotion: boolean;
  showTooltips: boolean;
  hierarchyRowHeight: number;
  autosaveDelayMs: number;
  confirmDestructiveActions: boolean;
  assetViewMode: 'grid' | 'list';
}

export const DEFAULT_STUDIO_USER_SETTINGS: StudioUserSettings = {
  compactDensity: false,
  reducedMotion: false,
  showTooltips: true,
  hierarchyRowHeight: 28,
  autosaveDelayMs: 800,
  confirmDestructiveActions: true,
  assetViewMode: 'grid',
};

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class StudioSettingsStore extends EventTarget {
  private current: StudioUserSettings;

  constructor(
    private readonly key: string,
    private readonly storage: KeyValueStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
    defaults: StudioUserSettings = DEFAULT_STUDIO_USER_SETTINGS,
  ) {
    super();
    this.current = normalizeSettings(defaults);
    const stored = storage?.getItem(key);
    if (stored) {
      try {
        this.current = normalizeSettings({ ...this.current, ...JSON.parse(stored) });
      } catch {
        storage?.removeItem(key);
      }
    }
  }

  get value(): StudioUserSettings {
    return structuredClone(this.current);
  }

  update(patch: Partial<StudioUserSettings>): StudioUserSettings {
    this.current = normalizeSettings({ ...this.current, ...patch });
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    return this.value;
  }

  reset(): StudioUserSettings {
    this.current = structuredClone(DEFAULT_STUDIO_USER_SETTINGS);
    this.persist();
    this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    return this.value;
  }

  import(serialized: string): StudioUserSettings {
    const parsed = JSON.parse(serialized) as Partial<StudioUserSettings>;
    return this.update(parsed);
  }

  export(): string {
    return JSON.stringify(this.current, null, 2);
  }

  private persist(): void {
    this.storage?.setItem(this.key, JSON.stringify(this.current));
  }
}

function normalizeSettings(value: StudioUserSettings): StudioUserSettings {
  return {
    compactDensity: Boolean(value.compactDensity),
    reducedMotion: Boolean(value.reducedMotion),
    showTooltips: value.showTooltips !== false,
    hierarchyRowHeight: clampNumber(value.hierarchyRowHeight, 22, 44, 28),
    autosaveDelayMs: clampNumber(value.autosaveDelayMs, 250, 10_000, 800),
    confirmDestructiveActions: value.confirmDestructiveActions !== false,
    assetViewMode: value.assetViewMode === 'list' ? 'list' : 'grid',
  };
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface StudioNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  source?: string;
  details?: unknown;
  timestamp: number;
  read: boolean;
  persistent: boolean;
}

export class StudioNotificationCenter extends EventTarget {
  private notifications: StudioNotification[] = [];

  constructor(private readonly limit = 500) { super(); }

  push(input: Omit<StudioNotification, 'id' | 'timestamp' | 'read'>): StudioNotification {
    const notification: StudioNotification = {
      ...structuredClone(input),
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      read: false,
    };
    this.notifications.unshift(notification);
    if (this.notifications.length > this.limit) this.notifications.length = this.limit;
    this.emit();
    return structuredClone(notification);
  }

  list(input: { unreadOnly?: boolean; severities?: NotificationSeverity[] } = {}): StudioNotification[] {
    const severities = new Set(input.severities ?? []);
    return this.notifications
      .filter((entry) => !input.unreadOnly || !entry.read)
      .filter((entry) => !severities.size || severities.has(entry.severity))
      .map((entry) => structuredClone(entry));
  }

  get unreadCount(): number {
    return this.notifications.filter((entry) => !entry.read).length;
  }

  markRead(id: string, read = true): void {
    const entry = this.notifications.find((item) => item.id === id);
    if (!entry || entry.read === read) return;
    entry.read = read;
    this.emit();
  }

  markAllRead(): void {
    let changed = false;
    for (const entry of this.notifications) {
      if (!entry.read) {
        entry.read = true;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  dismiss(id: string): void {
    const index = this.notifications.findIndex((entry) => entry.id === id);
    if (index < 0 || this.notifications[index].persistent) return;
    this.notifications.splice(index, 1);
    this.emit();
  }

  clearRead(): void {
    const next = this.notifications.filter((entry) => !entry.read || entry.persistent);
    if (next.length === this.notifications.length) return;
    this.notifications = next;
    this.emit();
  }

  private emit(): void {
    this.dispatchEvent(new CustomEvent('change', {
      detail: { unreadCount: this.unreadCount, notifications: this.list() },
    }));
  }
}

export interface StudioHelpTopic {
  id: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  shortcut?: string;
}

export interface StudioOnboardingStep {
  id: string;
  title: string;
  description: string;
}

export class StudioHelpRegistry extends EventTarget {
  private readonly topics = new Map<string, StudioHelpTopic>();
  private readonly steps = new Map<string, StudioOnboardingStep>();
  private completed = new Set<string>();

  constructor(
    private readonly storageKey: string,
    private readonly storage: KeyValueStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
  ) {
    super();
    try {
      this.completed = new Set(JSON.parse(storage?.getItem(storageKey) ?? '[]'));
    } catch {
      this.completed = new Set();
    }
  }

  registerTopic(topic: StudioHelpTopic): () => void {
    if (this.topics.has(topic.id)) throw new Error(`Help topic ${topic.id} is already registered.`);
    this.topics.set(topic.id, structuredClone(topic));
    this.dispatchEvent(new CustomEvent('change'));
    return () => {
      this.topics.delete(topic.id);
      this.dispatchEvent(new CustomEvent('change'));
    };
  }

  registerStep(step: StudioOnboardingStep): () => void {
    if (this.steps.has(step.id)) throw new Error(`Onboarding step ${step.id} is already registered.`);
    this.steps.set(step.id, structuredClone(step));
    this.dispatchEvent(new CustomEvent('change'));
    return () => {
      this.steps.delete(step.id);
      this.completed.delete(step.id);
      this.persist();
      this.dispatchEvent(new CustomEvent('change'));
    };
  }

  search(input = ''): StudioHelpTopic[] {
    const tokens = normalizeSearch(input);
    return [...this.topics.values()]
      .map((topic) => ({
        topic,
        score: tokens.reduce((score, token) => {
          const title = topic.title.toLocaleLowerCase();
          const haystack = `${topic.summary} ${topic.body} ${topic.keywords.join(' ')}`.toLocaleLowerCase();
          return score + (title.includes(token) ? 50 : haystack.includes(token) ? 20 : -1_000);
        }, 0),
      }))
      .filter(({ score }) => !tokens.length || score >= 0)
      .sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title))
      .map(({ topic }) => structuredClone(topic));
  }

  listSteps(): Array<StudioOnboardingStep & { completed: boolean }> {
    return [...this.steps.values()].map((step) => ({
      ...structuredClone(step),
      completed: this.completed.has(step.id),
    }));
  }

  setStepCompleted(id: string, completed: boolean): void {
    if (!this.steps.has(id)) throw new Error(`Onboarding step ${id} does not exist.`);
    if (completed) this.completed.add(id);
    else this.completed.delete(id);
    this.persist();
    this.dispatchEvent(new CustomEvent('change'));
  }

  resetOnboarding(): void {
    this.completed.clear();
    this.persist();
    this.dispatchEvent(new CustomEvent('change'));
  }

  private persist(): void {
    this.storage?.setItem(this.storageKey, JSON.stringify([...this.completed]));
  }
}

export function createDefaultStudioHelpRegistry(
  storageKey: string,
  storage?: KeyValueStorage | null,
): StudioHelpRegistry {
  const registry = new StudioHelpRegistry(storageKey, storage);
  const topics: StudioHelpTopic[] = [
    {
      id: 'hierarchy',
      title: 'Hierarchy selection and parenting',
      summary: 'Select ranges, multi-select, rename, duplicate, reparent and isolate entities.',
      body: 'Use Shift for a visible range, Ctrl/Cmd to toggle entities, F2 to rename, and drag between insertion indicators to reorder or reparent. Locked entities reject edits.',
      keywords: ['tree', 'entity', 'parent', 'duplicate', 'rename', 'lock', 'hide', 'isolate'],
      shortcut: 'F2 / Ctrl+C / Ctrl+V',
    },
    {
      id: 'inspector',
      title: 'Schema Inspector',
      summary: 'Edit one or many entities with validation, mixed values and imported overrides.',
      body: 'Mixed values remain unchanged until a field is edited. Reset restores schema defaults; Restore returns imported material data; template override controls live in Scenes & Templates.',
      keywords: ['mixed', 'material', 'camera', 'light', 'reset', 'restore', 'override'],
    },
    {
      id: 'assets',
      title: 'Asset Workspace and reimport',
      summary: 'Organize, search, inspect references and reimport project assets.',
      body: 'Use folders and filters to organize assets. Dependency inspection shows forward and reverse references. Reimport can preserve or reset authored overrides.',
      keywords: ['folder', 'thumbnail', 'dependency', 'reference', 'trash', 'reimport', 'gltf'],
    },
    {
      id: 'viewport',
      title: 'Viewport controls',
      summary: 'Navigate, frame selection and transform selected entities.',
      body: 'Use Select, Move, Rotate and Scale in the top toolbar. Choose Local or World coordinates and enable snapping. Viewport picks synchronize with the Hierarchy.',
      keywords: ['orbit', 'pan', 'zoom', 'move', 'rotate', 'scale', 'snap', 'frame'],
    },
    {
      id: 'publish',
      title: 'Versions, preview and publishing',
      summary: 'Preview the draft, create immutable releases and copy fixed or current links.',
      body: 'Preview uses the active in-memory document. Publishing first saves the draft, then creates an immutable release. Fixed links never advance; current links follow the selected release.',
      keywords: ['release', 'version', 'embed', 'public', 'immutable', 'preview'],
    },
    {
      id: 'collaboration',
      title: 'Collaboration and conflict handling',
      summary: 'Understand roles, presence, checkpoints, branches and explicit merge resolution.',
      body: 'Owners manage members and publish. Editors author scenes. Viewers are read-only. Realtime conflicts and branch conflicts require an explicit ours/theirs decision.',
      keywords: ['owner', 'editor', 'viewer', 'presence', 'realtime', 'branch', 'merge', 'conflict'],
    },
  ];
  topics.forEach((topic) => registry.registerTopic(topic));
  [
    ['create-project', 'Create or open a project', 'Start from an empty Studio project rather than Playground procedural content.'],
    ['import-model', 'Import a GLB or external glTF', 'Drop or select the model and review import warnings and tasks.'],
    ['edit-scene', 'Edit hierarchy and properties', 'Select real imported nodes, transform them and edit material slots.'],
    ['save-checkpoint', 'Create a checkpoint', 'Capture a named project state before a risky edit or branch.'],
    ['publish-release', 'Publish an immutable release', 'Open the fixed Public Viewer and Embed links to verify the authored result.'],
  ].forEach(([id, title, description]) => registry.registerStep({ id, title, description }));
  return registry;
}

export interface ImageInspection {
  name: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  aspectRatio: number;
  megapixels: number;
}

export interface ImageConvertOptions {
  width?: number;
  height?: number;
  fit?: 'contain' | 'cover' | 'stretch';
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number;
  background?: string;
  allowUpscale?: boolean;
}

export function fitImageSize(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  allowUpscale = false,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('Source image dimensions must be positive.');
  const safeWidth = Math.max(1, targetWidth || sourceWidth);
  const safeHeight = Math.max(1, targetHeight || sourceHeight);
  const scale = Math.min(safeWidth / sourceWidth, safeHeight / sourceHeight, allowUpscale ? Infinity : 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export async function inspectImage(file: Blob & { name?: string }): Promise<ImageInspection> {
  const bitmap = await createImageBitmap(file);
  try {
    return {
      name: file.name ?? 'image',
      mimeType: file.type || 'application/octet-stream',
      byteSize: file.size,
      width: bitmap.width,
      height: bitmap.height,
      aspectRatio: bitmap.width / Math.max(1, bitmap.height),
      megapixels: (bitmap.width * bitmap.height) / 1_000_000,
    };
  } finally {
    bitmap.close();
  }
}

export async function convertImage(file: Blob, options: ImageConvertOptions = {}): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const fit = options.fit ?? 'contain';
    const requestedWidth = Math.max(1, Math.round(options.width ?? bitmap.width));
    const requestedHeight = Math.max(1, Math.round(options.height ?? bitmap.height));
    const output = fit === 'stretch'
      ? { width: requestedWidth, height: requestedHeight }
      : fitImageSize(bitmap.width, bitmap.height, requestedWidth, requestedHeight, options.allowUpscale);
    const canvas = createImageCanvas(output.width, output.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    if (options.background) {
      context.fillStyle = options.background;
      context.fillRect(0, 0, output.width, output.height);
    }
    if (fit === 'cover') {
      const scale = Math.max(output.width / bitmap.width, output.height / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (output.width - width) / 2, (output.height - height) / 2, width, height);
    } else {
      context.drawImage(bitmap, 0, 0, output.width, output.height);
    }
    return await canvasToBlob(
      canvas,
      options.mimeType ?? (file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png'),
      Math.max(0, Math.min(1, options.quality ?? 0.9)),
    );
  } finally {
    bitmap.close();
  }
}

type ImageCanvas = HTMLCanvasElement | OffscreenCanvas;

function createImageCanvas(width: number, height: number): ImageCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Image conversion requires a browser canvas.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas: ImageCanvas, mimeType: string, quality: number): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mimeType, quality });
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), mimeType, quality);
  });
}
