import {
  assertSceneContract,
  cloneSceneContract,
  type JsonPatchOperation,
  type KyxosSceneContract,
  type ScenePatch,
} from '@kyxos/scene-contract';

export type SaveState = 'Saved' | 'Dirty' | 'Saving' | 'Offline' | 'Conflict' | 'Error';
export interface RevisionedDraft { contract: KyxosSceneContract; revision: number }
export interface DraftRepository {
  save(projectId: string, contract: KyxosSceneContract, expectedRevision: number): Promise<{ revision: number }>;
  load(projectId: string): Promise<RevisionedDraft | null>;
}
export interface OfflineDraftStore {
  put(projectId: string, draft: RevisionedDraft): Promise<void>;
  get(projectId: string): Promise<RevisionedDraft | null>;
  delete(projectId: string): Promise<void>;
}

function decodePointerSegment(segment: string): string { return segment.replace(/~1/g, '/').replace(/~0/g, '~') }
function pointerParts(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error(`Invalid JSON pointer: ${path}`);
  return path.slice(1).split('/').map(decodePointerSegment);
}
function parentAt(root: unknown, path: string): { parent: any; key: string } {
  const parts = pointerParts(path);
  if (parts.length === 0) throw new Error('Root replacement is not supported by editor patches.');
  let parent: any = root;
  for (const part of parts.slice(0, -1)) {
    if (parent == null || typeof parent !== 'object') throw new Error(`Patch path not found: ${path}`);
    parent = parent[Array.isArray(parent) ? Number(part) : part];
  }
  return { parent, key: parts.at(-1)! };
}
function valueAt(root: unknown, path: string): unknown {
  let value: any = root;
  for (const part of pointerParts(path)) value = value?.[Array.isArray(value) ? Number(part) : part];
  return value;
}
function assign(parent: any, key: string, value: unknown, add: boolean): void {
  if (Array.isArray(parent)) {
    if (key === '-') parent.push(value);
    else if (add) parent.splice(Number(key), 0, value);
    else parent[Number(key)] = value;
  } else parent[key] = value;
}
function remove(parent: any, key: string): unknown {
  if (Array.isArray(parent)) return parent.splice(Number(key), 1)[0];
  const previous = parent[key]; delete parent[key]; return previous;
}

export function applyPatch<T>(input: T, patch: ScenePatch): T {
  const output = structuredClone(input);
  for (const operation of patch) {
    if (operation.op === 'test') {
      if (JSON.stringify(valueAt(output, operation.path)) !== JSON.stringify(operation.value)) throw new Error(`JSON Patch test failed at ${operation.path}.`);
      continue;
    }
    if (operation.op === 'move' || operation.op === 'copy') {
      const source = structuredClone(valueAt(output, operation.from));
      if (operation.op === 'move') { const sourceParent = parentAt(output, operation.from); remove(sourceParent.parent, sourceParent.key); }
      const target = parentAt(output, operation.path); assign(target.parent, target.key, source, true); continue;
    }
    const target = parentAt(output, operation.path);
    if (operation.op === 'remove') remove(target.parent, target.key);
    else assign(target.parent, target.key, structuredClone(operation.value), operation.op === 'add');
  }
  return output;
}

export function invertPatch(before: unknown, patch: ScenePatch): ScenePatch {
  const inverse: ScenePatch = [];
  let state = structuredClone(before);
  for (const operation of patch) {
    if (operation.op === 'add') inverse.unshift({ op: 'remove', path: operation.path });
    else if (operation.op === 'remove') inverse.unshift({ op: 'add', path: operation.path, value: structuredClone(valueAt(state, operation.path)) });
    else if (operation.op === 'replace') inverse.unshift({ op: 'replace', path: operation.path, value: structuredClone(valueAt(state, operation.path)) });
    else if (operation.op === 'move') inverse.unshift({ op: 'move', from: operation.path, path: operation.from });
    else if (operation.op === 'copy') inverse.unshift({ op: 'remove', path: operation.path });
    state = applyPatch(state, [operation]);
  }
  return inverse;
}

export class SceneDocument extends EventTarget {
  private scene: KyxosSceneContract;
  private revision = 0;
  constructor(scene: KyxosSceneContract) { super(); assertSceneContract(scene); this.scene = cloneSceneContract(scene) }
  get value(): KyxosSceneContract { return cloneSceneContract(this.scene) }
  get version(): number { return this.revision }
  replace(scene: KyxosSceneContract, source = 'replace'): void {
    assertSceneContract(scene); this.scene = cloneSceneContract(scene); this.revision += 1;
    this.dispatchEvent(new CustomEvent('change', { detail: { patch: [], source, revision: this.revision } }));
  }
  apply(patch: ScenePatch, source = 'command'): void {
    const next = applyPatch(this.scene, patch); assertSceneContract(next); this.scene = next; this.revision += 1;
    this.scene.metadata.updatedAt = new Date().toISOString();
    this.dispatchEvent(new CustomEvent('change', { detail: { patch, source, revision: this.revision } }));
  }
  findNodeIndex(nodeId: string): number { return this.scene.nodes.findIndex((node) => node.id === nodeId) }
}

export interface EditorCommand { id: string; label: string; patch(document: KyxosSceneContract): ScenePatch; mergeKey?: string }
export interface HistoryEntry { id: string; label: string; forward: ScenePatch; backward: ScenePatch; mergeKey?: string; timestamp: number }

export class HistoryService extends EventTarget {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  constructor(private readonly document: SceneDocument) { super() }
  push(entry: HistoryEntry): void {
    const previous = this.undoStack.at(-1);
    if (entry.mergeKey && previous?.mergeKey === entry.mergeKey && entry.timestamp - previous.timestamp < 1200) {
      previous.forward = entry.forward; previous.timestamp = entry.timestamp; previous.label = entry.label;
    } else this.undoStack.push(entry);
    this.redoStack = []; this.emit();
  }
  undo(): boolean {
    const entry = this.undoStack.pop(); if (!entry) return false;
    this.document.apply(entry.backward, 'undo'); this.redoStack.push(entry); this.emit(); return true;
  }
  redo(): boolean {
    const entry = this.redoStack.pop(); if (!entry) return false;
    this.document.apply(entry.forward, 'redo'); this.undoStack.push(entry); this.emit(); return true;
  }
  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  clear(): void { this.undoStack = []; this.redoStack = []; this.emit() }
  private emit(): void { this.dispatchEvent(new CustomEvent('change', { detail: { canUndo: this.canUndo, canRedo: this.canRedo } })) }
}

export class CommandBus extends EventTarget {
  constructor(private readonly document: SceneDocument, private readonly history: HistoryService) { super() }
  execute(command: EditorCommand): void {
    const before = this.document.value;
    const forward = command.patch(before);
    if (forward.length === 0) return;
    const backward = invertPatch(before, forward);
    this.document.apply(forward, command.id);
    this.history.push({ id: command.id, label: command.label, forward, backward, mergeKey: command.mergeKey, timestamp: Date.now() });
    this.dispatchEvent(new CustomEvent('execute', { detail: { command, forward } }));
  }
}

export class SelectionService extends EventTarget {
  private ids = new Set<string>(); private locked = new Set<string>();
  get selected(): string[] { return [...this.ids] }
  select(ids: string[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    if (mode === 'replace') this.ids.clear();
    for (const id of ids) {
      if (this.locked.has(id)) continue;
      if (mode === 'toggle' && this.ids.has(id)) this.ids.delete(id); else this.ids.add(id);
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { nodeIds: this.selected } }));
  }
  clear(): void { this.select([]) }
  lock(id: string, locked = true): void { locked ? this.locked.add(id) : this.locked.delete(id); if (locked) this.ids.delete(id); this.dispatchEvent(new CustomEvent('lock', { detail: { id, locked } })) }
  isLocked(id: string): boolean { return this.locked.has(id) }
}

export class ClipboardService {
  private payload: unknown = null;
  copy(value: unknown): void { this.payload = structuredClone(value) }
  paste<T>(): T | null { return this.payload == null ? null : structuredClone(this.payload) as T }
  clear(): void { this.payload = null }
}

export class AssetRegistry extends EventTarget {
  private assets = new Map<string, { id: string; hash: string; name: string; mimeType: string; metadata?: Record<string, unknown> }>();
  add(asset: { id: string; hash: string; name: string; mimeType: string; metadata?: Record<string, unknown> }): void { this.assets.set(asset.id, structuredClone(asset)); this.dispatchEvent(new CustomEvent('change')) }
  get(id: string) { const value = this.assets.get(id); return value ? structuredClone(value) : null }
  list() { return [...this.assets.values()].map((value) => structuredClone(value)) }
}

export class ValidationService {
  validate(scene: KyxosSceneContract): string[] {
    try { assertSceneContract(scene); return [] } catch (error) { return [error instanceof Error ? error.message : String(error)] }
  }
}

export interface PublishRepository { publish(projectId: string, scene: KyxosSceneContract, expectedRevision: number): Promise<{ versionId: string; versionNumber: number; slug: string }> }
export class PublishService {
  constructor(private readonly repository: PublishRepository, private readonly validation = new ValidationService()) {}
  async publish(projectId: string, document: SceneDocument, revision: number) {
    const scene = document.value; const errors = this.validation.validate(scene);
    if (errors.length) throw new Error(errors.join('\n'));
    return this.repository.publish(projectId, scene, revision);
  }
}

export class AutosaveController extends EventTarget {
  private timer: number | null = null; private stateValue: SaveState = 'Saved'; private revisionValue: number;
  private flushing: Promise<void> | null = null;
  constructor(
    private readonly projectId: string,
    private readonly document: SceneDocument,
    private readonly repository: DraftRepository,
    private readonly offline: OfflineDraftStore,
    revision = 0,
    private readonly delayMs = 750,
  ) {
    super(); this.revisionValue = revision;
    document.addEventListener('change', () => { this.setState('Dirty'); this.schedule() });
    window.addEventListener('online', () => void this.recover());
    window.addEventListener('offline', () => this.setState('Offline'));
  }
  get state(): SaveState { return this.stateValue }
  get revision(): number { return this.revisionValue }
  private setState(state: SaveState, error?: unknown): void { this.stateValue = state; this.dispatchEvent(new CustomEvent('state', { detail: { state, revision: this.revisionValue, error } })) }
  private schedule(): void { if (this.timer != null) window.clearTimeout(this.timer); this.timer = window.setTimeout(() => void this.flush(), this.delayMs) }
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.timer != null) { window.clearTimeout(this.timer); this.timer = null }
    this.flushing = this.save().finally(() => { this.flushing = null }); return this.flushing;
  }
  private async save(): Promise<void> {
    const draft = { contract: this.document.value, revision: this.revisionValue };
    if (!navigator.onLine) { await this.offline.put(this.projectId, draft); this.setState('Offline'); return }
    this.setState('Saving');
    try {
      const result = await this.repository.save(this.projectId, draft.contract, this.revisionValue);
      this.revisionValue = result.revision; await this.offline.delete(this.projectId); this.setState('Saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/revision|conflict|409/i.test(message)) this.setState('Conflict', error);
      else { await this.offline.put(this.projectId, draft); this.setState(navigator.onLine ? 'Error' : 'Offline', error) }
    }
  }
  async recover(): Promise<void> {
    const pending = await this.offline.get(this.projectId); if (!pending) return;
    try { const result = await this.repository.save(this.projectId, pending.contract, pending.revision); this.revisionValue = result.revision; await this.offline.delete(this.projectId); this.setState('Saved') }
    catch (error) { this.setState(/revision|conflict|409/i.test(String(error)) ? 'Conflict' : 'Error', error) }
  }
  dispose(): void { if (this.timer != null) window.clearTimeout(this.timer) }
}

export class ProjectSession {
  readonly history: HistoryService; readonly commands: CommandBus; readonly selection = new SelectionService(); readonly clipboard = new ClipboardService(); readonly assets = new AssetRegistry();
  constructor(public readonly projectId: string, public readonly document: SceneDocument) { this.history = new HistoryService(document); this.commands = new CommandBus(document, this.history) }
}

export function replaceCommand(path: string, value: unknown, label: string, mergeKey?: string): EditorCommand {
  return { id: `replace:${path}`, label, mergeKey, patch: () => [{ op: 'replace', path, value }] };
}
export function removeCommand(path: string, label: string): EditorCommand { return { id: `remove:${path}`, label, patch: () => [{ op: 'remove', path }] } }
export function addCommand(path: string, value: unknown, label: string): EditorCommand { return { id: `add:${path}`, label, patch: () => [{ op: 'add', path, value }] } }
