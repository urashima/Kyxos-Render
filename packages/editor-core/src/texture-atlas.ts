export interface AtlasPoint {
  x: number;
  y: number;
}

export interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasBorder {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TextureAtlasFrame {
  id: string;
  name: string;
  rect: AtlasRect;
  pivot: AtlasPoint;
  border: AtlasBorder;
  rotated: boolean;
  metadata?: Record<string, unknown>;
}

export interface TextureAtlasDocument {
  version: 1;
  sourceAssetId?: string;
  imageWidth: number;
  imageHeight: number;
  frames: TextureAtlasFrame[];
  metadata?: Record<string, unknown>;
}

export interface TextureAtlasValidationIssue {
  code:
    | 'image.invalid-size'
    | 'frame.empty-name'
    | 'frame.duplicate-name'
    | 'frame.invalid-size'
    | 'frame.out-of-bounds'
    | 'frame.invalid-pivot'
    | 'frame.invalid-border'
    | 'frame.overlap';
  severity: 'error' | 'warning';
  message: string;
  frameId?: string;
  otherFrameId?: string;
}

export interface AtlasGridSliceOptions {
  columns: number;
  rows: number;
  padding?: number;
  spacing?: number;
  prefix?: string;
}

export interface AtlasAlphaDetectionOptions {
  threshold?: number;
  minimumPixels?: number;
  padding?: number;
  connectivity?: 4 | 8;
}

export interface DetectedAtlasRegion extends AtlasRect {
  pixelCount: number;
}

interface AtlasHistoryEntry {
  label: string;
  before: TextureAtlasDocument;
  after: TextureAtlasDocument;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteInteger(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizeName(value: string, fallback: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || fallback;
}

function uniqueFrameName(document: TextureAtlasDocument, base: string, ignoreId?: string): string {
  const reserved = new Set(
    document.frames
      .filter((frame) => frame.id !== ignoreId)
      .map((frame) => frame.name.toLocaleLowerCase()),
  );
  if (!reserved.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (reserved.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function normalizeRect(rect: AtlasRect): AtlasRect {
  return {
    x: finiteInteger(rect.x),
    y: finiteInteger(rect.y),
    width: Math.max(1, finiteInteger(rect.width, 1)),
    height: Math.max(1, finiteInteger(rect.height, 1)),
  };
}

function normalizePoint(point: AtlasPoint): AtlasPoint {
  return {
    x: Number.isFinite(point.x) ? clamp(point.x, 0, 1) : 0.5,
    y: Number.isFinite(point.y) ? clamp(point.y, 0, 1) : 0.5,
  };
}

function normalizeBorder(border: AtlasBorder, rect: AtlasRect): AtlasBorder {
  const left = clamp(finiteInteger(border.left), 0, rect.width);
  const right = clamp(finiteInteger(border.right), 0, Math.max(0, rect.width - left));
  const top = clamp(finiteInteger(border.top), 0, rect.height);
  const bottom = clamp(finiteInteger(border.bottom), 0, Math.max(0, rect.height - top));
  return { left, top, right, bottom };
}

function rectanglesOverlap(left: AtlasRect, right: AtlasRect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

export function createTextureAtlasDocument(
  imageWidth: number,
  imageHeight: number,
  sourceAssetId?: string,
): TextureAtlasDocument {
  const width = finiteInteger(imageWidth);
  const height = finiteInteger(imageHeight);
  if (width <= 0 || height <= 0) throw new Error('Texture atlas image dimensions must be positive integers.');
  return {
    version: 1,
    sourceAssetId,
    imageWidth: width,
    imageHeight: height,
    frames: [],
  };
}

export function normalizeTextureAtlasDocument(input: TextureAtlasDocument): TextureAtlasDocument {
  if (input.version !== 1) throw new Error('Unsupported texture atlas document version.');
  const document = createTextureAtlasDocument(input.imageWidth, input.imageHeight, input.sourceAssetId);
  document.metadata = input.metadata ? clone(input.metadata) : undefined;
  const ids = new Set<string>();
  for (let index = 0; index < input.frames.length; index += 1) {
    const source = input.frames[index];
    let id = String(source.id || crypto.randomUUID());
    while (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const rect = normalizeRect(source.rect);
    const baseName = normalizeName(source.name, `Frame ${index + 1}`);
    document.frames.push({
      id,
      name: uniqueFrameName(document, baseName),
      rect,
      pivot: normalizePoint(source.pivot ?? { x: 0.5, y: 0.5 }),
      border: normalizeBorder(source.border ?? { left: 0, top: 0, right: 0, bottom: 0 }, rect),
      rotated: Boolean(source.rotated),
      metadata: source.metadata ? clone(source.metadata) : undefined,
    });
  }
  return document;
}

export function sliceTextureAtlasGrid(
  imageWidth: number,
  imageHeight: number,
  options: AtlasGridSliceOptions,
): AtlasRect[] {
  const columns = Math.max(1, finiteInteger(options.columns, 1));
  const rows = Math.max(1, finiteInteger(options.rows, 1));
  const padding = Math.max(0, finiteInteger(options.padding ?? 0));
  const spacing = Math.max(0, finiteInteger(options.spacing ?? 0));
  const availableWidth = imageWidth - padding * 2 - spacing * (columns - 1);
  const availableHeight = imageHeight - padding * 2 - spacing * (rows - 1);
  if (availableWidth < columns || availableHeight < rows) {
    throw new Error('Grid padding and spacing leave no room for the requested cells.');
  }
  const cellWidth = Math.floor(availableWidth / columns);
  const cellHeight = Math.floor(availableHeight / rows);
  const rectangles: AtlasRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = padding + column * (cellWidth + spacing);
      const y = padding + row * (cellHeight + spacing);
      rectangles.push({
        x,
        y,
        width: column === columns - 1 ? imageWidth - padding - x : cellWidth,
        height: row === rows - 1 ? imageHeight - padding - y : cellHeight,
      });
    }
  }
  return rectangles;
}

export function detectTextureAtlasRegions(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  options: AtlasAlphaDetectionOptions = {},
): DetectedAtlasRegion[] {
  const imageWidth = finiteInteger(width);
  const imageHeight = finiteInteger(height);
  if (imageWidth <= 0 || imageHeight <= 0 || alpha.length < imageWidth * imageHeight) {
    throw new Error('Alpha buffer dimensions are invalid.');
  }
  const threshold = clamp(finiteInteger(options.threshold ?? 1, 1), 0, 255);
  const minimumPixels = Math.max(1, finiteInteger(options.minimumPixels ?? 1, 1));
  const padding = Math.max(0, finiteInteger(options.padding ?? 0));
  const connectivity = options.connectivity ?? 4;
  const visited = new Uint8Array(imageWidth * imageHeight);
  const queue = new Int32Array(imageWidth * imageHeight);
  const neighbors = connectivity === 8
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const regions: DetectedAtlasRegion[] = [];

  for (let start = 0; start < imageWidth * imageHeight; start += 1) {
    if (visited[start] || Number(alpha[start]) < threshold) continue;
    visited[start] = 1;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    let minimumX = start % imageWidth;
    let maximumX = minimumX;
    let minimumY = Math.floor(start / imageWidth);
    let maximumY = minimumY;
    let pixelCount = 0;

    while (head < tail) {
      const index = queue[head++];
      const x = index % imageWidth;
      const y = Math.floor(index / imageWidth);
      pixelCount += 1;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
      for (const [offsetX, offsetY] of neighbors) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= imageWidth || nextY >= imageHeight) continue;
        const nextIndex = nextY * imageWidth + nextX;
        if (visited[nextIndex] || Number(alpha[nextIndex]) < threshold) continue;
        visited[nextIndex] = 1;
        queue[tail++] = nextIndex;
      }
    }

    if (pixelCount < minimumPixels) continue;
    const x = Math.max(0, minimumX - padding);
    const y = Math.max(0, minimumY - padding);
    const right = Math.min(imageWidth, maximumX + 1 + padding);
    const bottom = Math.min(imageHeight, maximumY + 1 + padding);
    regions.push({ x, y, width: right - x, height: bottom - y, pixelCount });
  }

  return regions.sort((left, right) => left.y - right.y || left.x - right.x || right.pixelCount - left.pixelCount);
}

export function validateTextureAtlas(document: TextureAtlasDocument): TextureAtlasValidationIssue[] {
  const issues: TextureAtlasValidationIssue[] = [];
  if (document.imageWidth <= 0 || document.imageHeight <= 0) {
    issues.push({
      code: 'image.invalid-size',
      severity: 'error',
      message: 'The source image dimensions must be positive.',
    });
  }
  const names = new Map<string, TextureAtlasFrame[]>();
  for (const frame of document.frames) {
    const normalized = frame.name.trim().toLocaleLowerCase();
    if (!normalized) {
      issues.push({ code: 'frame.empty-name', severity: 'error', message: 'Frame name cannot be empty.', frameId: frame.id });
    } else {
      names.set(normalized, [...(names.get(normalized) ?? []), frame]);
    }
    if (frame.rect.width <= 0 || frame.rect.height <= 0) {
      issues.push({ code: 'frame.invalid-size', severity: 'error', message: 'Frame width and height must be positive.', frameId: frame.id });
    }
    if (
      frame.rect.x < 0
      || frame.rect.y < 0
      || frame.rect.x + frame.rect.width > document.imageWidth
      || frame.rect.y + frame.rect.height > document.imageHeight
    ) {
      issues.push({ code: 'frame.out-of-bounds', severity: 'error', message: 'Frame extends outside the source image.', frameId: frame.id });
    }
    if (frame.pivot.x < 0 || frame.pivot.x > 1 || frame.pivot.y < 0 || frame.pivot.y > 1) {
      issues.push({ code: 'frame.invalid-pivot', severity: 'error', message: 'Frame pivot must be normalized between 0 and 1.', frameId: frame.id });
    }
    if (
      frame.border.left < 0
      || frame.border.top < 0
      || frame.border.right < 0
      || frame.border.bottom < 0
      || frame.border.left + frame.border.right > frame.rect.width
      || frame.border.top + frame.border.bottom > frame.rect.height
    ) {
      issues.push({ code: 'frame.invalid-border', severity: 'error', message: 'Nine-slice borders must fit inside the frame.', frameId: frame.id });
    }
  }
  for (const duplicates of names.values()) {
    if (duplicates.length < 2) continue;
    for (const frame of duplicates) {
      issues.push({ code: 'frame.duplicate-name', severity: 'error', message: `Frame name “${frame.name}” is duplicated.`, frameId: frame.id });
    }
  }
  for (let leftIndex = 0; leftIndex < document.frames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < document.frames.length; rightIndex += 1) {
      const left = document.frames[leftIndex];
      const right = document.frames[rightIndex];
      if (!rectanglesOverlap(left.rect, right.rect)) continue;
      issues.push({
        code: 'frame.overlap',
        severity: 'warning',
        message: `Frames “${left.name}” and “${right.name}” overlap.`,
        frameId: left.id,
        otherFrameId: right.id,
      });
    }
  }
  return issues;
}

export class TextureAtlasEditor extends EventTarget {
  private document: TextureAtlasDocument;
  private selection = new Set<string>();
  private undoStack: AtlasHistoryEntry[] = [];
  private redoStack: AtlasHistoryEntry[] = [];

  constructor(
    document: TextureAtlasDocument,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
    this.document = normalizeTextureAtlasDocument(document);
  }

  get value(): TextureAtlasDocument { return clone(this.document) }
  get selected(): string[] { return [...this.selection] }
  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  select(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    if (mode === 'replace') this.selection.clear();
    for (const id of ids) {
      if (!this.document.frames.some((frame) => frame.id === id)) continue;
      if (mode === 'toggle' && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.emit('selection', { selected: this.selected });
  }

  addFrame(rect: AtlasRect, name = 'Frame'): string {
    const id = this.createId();
    this.execute('Add frame', (document) => {
      const normalizedRect = normalizeRect(rect);
      document.frames.push({
        id,
        name: uniqueFrameName(document, normalizeName(name, 'Frame')),
        rect: normalizedRect,
        pivot: { x: 0.5, y: 0.5 },
        border: { left: 0, top: 0, right: 0, bottom: 0 },
        rotated: false,
      });
    });
    this.select([id]);
    return id;
  }

  updateFrame(
    id: string,
    patch: Partial<Omit<TextureAtlasFrame, 'id'>>,
    label = 'Edit frame',
  ): void {
    this.execute(label, (document) => {
      const frame = document.frames.find((entry) => entry.id === id);
      if (!frame) throw new Error('Texture atlas frame not found.');
      if (patch.name != null) frame.name = uniqueFrameName(document, normalizeName(patch.name, frame.name), id);
      if (patch.rect) frame.rect = normalizeRect(patch.rect);
      if (patch.pivot) frame.pivot = normalizePoint(patch.pivot);
      if (patch.border) frame.border = normalizeBorder(patch.border, patch.rect ? normalizeRect(patch.rect) : frame.rect);
      if (patch.rotated != null) frame.rotated = Boolean(patch.rotated);
      if (patch.metadata !== undefined) frame.metadata = patch.metadata ? clone(patch.metadata) : undefined;
      frame.border = normalizeBorder(frame.border, frame.rect);
    });
  }

  removeFrames(ids: Iterable<string>): void {
    const removing = new Set(ids);
    if (!removing.size) return;
    this.execute('Delete frames', (document) => {
      document.frames = document.frames.filter((frame) => !removing.has(frame.id));
    });
    for (const id of removing) this.selection.delete(id);
    this.emit('selection', { selected: this.selected });
  }

  duplicateFrames(ids: Iterable<string>): string[] {
    const selected = new Set(ids);
    const created: string[] = [];
    this.execute('Duplicate frames', (document) => {
      for (const source of document.frames.filter((frame) => selected.has(frame.id))) {
        const id = this.createId();
        created.push(id);
        const rect = {
          ...source.rect,
          x: clamp(source.rect.x + 4, 0, Math.max(0, document.imageWidth - source.rect.width)),
          y: clamp(source.rect.y + 4, 0, Math.max(0, document.imageHeight - source.rect.height)),
        };
        document.frames.push({
          ...clone(source),
          id,
          name: uniqueFrameName(document, `${source.name} Copy`),
          rect,
        });
      }
    });
    this.select(created);
    return created;
  }

  sliceGrid(options: AtlasGridSliceOptions): string[] {
    const rectangles = sliceTextureAtlasGrid(this.document.imageWidth, this.document.imageHeight, options);
    const created: string[] = [];
    this.execute('Slice texture atlas grid', (document) => {
      document.frames = [];
      for (let index = 0; index < rectangles.length; index += 1) {
        const id = this.createId();
        created.push(id);
        document.frames.push({
          id,
          name: uniqueFrameName(document, `${options.prefix?.trim() || 'Frame'} ${index + 1}`),
          rect: rectangles[index],
          pivot: { x: 0.5, y: 0.5 },
          border: { left: 0, top: 0, right: 0, bottom: 0 },
          rotated: false,
        });
      }
    });
    this.select(created.length ? [created[0]] : []);
    return created;
  }

  replaceWithDetectedRegions(regions: Iterable<AtlasRect>, prefix = 'Frame'): string[] {
    const created: string[] = [];
    this.execute('Detect texture atlas frames', (document) => {
      document.frames = [];
      let index = 0;
      for (const region of regions) {
        const id = this.createId();
        created.push(id);
        document.frames.push({
          id,
          name: uniqueFrameName(document, `${prefix} ${++index}`),
          rect: normalizeRect(region),
          pivot: { x: 0.5, y: 0.5 },
          border: { left: 0, top: 0, right: 0, bottom: 0 },
          rotated: false,
        });
      }
    });
    this.select(created.length ? [created[0]] : []);
    return created;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.document = clone(entry.before);
    this.redoStack.push(entry);
    this.selection = new Set([...this.selection].filter((id) => this.document.frames.some((frame) => frame.id === id)));
    this.emit('change', { label: `Undo ${entry.label}`, document: this.value });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.document = clone(entry.after);
    this.undoStack.push(entry);
    this.emit('change', { label: `Redo ${entry.label}`, document: this.value });
    return true;
  }

  serialize(): string {
    return JSON.stringify(this.document, null, 2);
  }

  private execute(label: string, mutate: (document: TextureAtlasDocument) => void): void {
    const before = this.value;
    const next = this.value;
    mutate(next);
    this.document = normalizeTextureAtlasDocument(next);
    const after = this.value;
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.undoStack.push({ label, before, after });
    this.redoStack = [];
    this.emit('change', { label, document: after, issues: validateTextureAtlas(after) });
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}

export function textureAtlasToAssetMetadata(document: TextureAtlasDocument): Record<string, unknown> {
  return {
    textureAtlas: normalizeTextureAtlasDocument(document),
  };
}

export function textureAtlasFromAssetMetadata(
  metadata: Record<string, unknown> | undefined,
): TextureAtlasDocument | null {
  const value = metadata?.textureAtlas;
  if (!value || typeof value !== 'object') return null;
  return normalizeTextureAtlasDocument(value as TextureAtlasDocument);
}
