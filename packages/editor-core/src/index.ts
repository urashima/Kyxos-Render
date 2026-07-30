import {
  createDefaultSceneDocument,
  fail,
  ok,
  type Annotation,
  type CameraState,
  type EnvironmentState,
  type KyxosResult,
  type KyxosSceneDocument,
  type MaterialOverride,
  type SceneLight,
  type TransformState,
} from '@kyxos/scene-contract';

export type SaveState = 'Saved' | 'Saving' | 'Offline' | 'Save Failed';

export interface EditorCommand {
  id: string;
  label: string;
  apply: (document: KyxosSceneDocument) => KyxosSceneDocument;
  revert: (document: KyxosSceneDocument) => KyxosSceneDocument;
}

export interface EditorSnapshot {
  document: KyxosSceneDocument;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saveState: SaveState;
  revision: number;
}

export interface PersistedDraft {
  document: KyxosSceneDocument;
  revision: number;
  savedAt: string;
}

export interface AutosaveAdapter {
  save: (draft: PersistedDraft) => Promise<KyxosResult<PersistedDraft>>;
  loadBackup?: (projectId: string) => Promise<PersistedDraft | null>;
  writeBackup?: (draft: PersistedDraft) => Promise<void>;
  clearBackup?: (projectId: string) => Promise<void>;
}

type Listener = (snapshot: EditorSnapshot) => void;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function withUpdatedAt(document: KyxosSceneDocument) {
  const next = clone(document);
  next.project.updatedAt = new Date().toISOString();
  return next;
}

function memoryBackupAdapter() {
  const backups = new Map<string, PersistedDraft>();
  return {
    async loadBackup(projectId: string) {
      return backups.get(projectId) ?? null;
    },
    async writeBackup(draft: PersistedDraft) {
      backups.set(draft.document.project.id, clone(draft));
    },
    async clearBackup(projectId: string) {
      backups.delete(projectId);
    },
  };
}

export function createIndexedDbBackup(namespace = 'kyxos-studio-v1') {
  const memory = memoryBackupAdapter();
  if (typeof indexedDB === 'undefined') return memory;

  const openDb = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(namespace, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'projectId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  return {
    async loadBackup(projectId: string) {
      try {
        const db = await openDb();
        return await new Promise<PersistedDraft | null>((resolve, reject) => {
          const tx = db.transaction('drafts', 'readonly');
          const request = tx.objectStore('drafts').get(projectId);
          request.onsuccess = () => resolve((request.result?.draft as PersistedDraft | undefined) ?? null);
          request.onerror = () => reject(request.error);
        });
      } catch {
        return memory.loadBackup(projectId);
      }
    },
    async writeBackup(draft: PersistedDraft) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put({ projectId: draft.document.project.id, draft: clone(draft) });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        await memory.writeBackup(draft);
      }
    },
    async clearBackup(projectId: string) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').delete(projectId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        await memory.clearBackup(projectId);
      }
    },
  };
}

export class EditorSession {
  private document: KyxosSceneDocument;
  private undoStack: EditorCommand[] = [];
  private redoStack: EditorCommand[] = [];
  private listeners = new Set<Listener>();
  private dirty = false;
  private saveState: SaveState = 'Saved';
  private revision: number;

  constructor(document: KyxosSceneDocument = createDefaultSceneDocument(), revision = 0) {
    this.document = clone(document);
    this.revision = revision;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): EditorSnapshot {
    return {
      document: clone(this.document),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: this.dirty,
      saveState: this.saveState,
      revision: this.revision,
    };
  }

  dispatch(command: EditorCommand): EditorSnapshot {
    this.document = withUpdatedAt(command.apply(this.document));
    this.undoStack.push(command);
    this.redoStack = [];
    this.dirty = true;
    this.emit();
    return this.snapshot();
  }

  undo(): KyxosResult<EditorSnapshot> {
    const command = this.undoStack.pop();
    if (!command) return fail('KX_SAVE_CONFLICT', 'There is no command to undo.');
    this.document = withUpdatedAt(command.revert(this.document));
    this.redoStack.push(command);
    this.dirty = true;
    this.emit();
    return ok(this.snapshot(), 'Undo applied.');
  }

  redo(): KyxosResult<EditorSnapshot> {
    const command = this.redoStack.pop();
    if (!command) return fail('KX_SAVE_CONFLICT', 'There is no command to redo.');
    this.document = withUpdatedAt(command.apply(this.document));
    this.undoStack.push(command);
    this.dirty = true;
    this.emit();
    return ok(this.snapshot(), 'Redo applied.');
  }

  markSaving() {
    this.saveState = 'Saving';
    this.emit();
  }

  markSaved(revision: number) {
    this.revision = revision;
    this.dirty = false;
    this.saveState = 'Saved';
    this.emit();
  }

  markOffline() {
    this.saveState = 'Offline';
    this.emit();
  }

  markSaveFailed() {
    this.saveState = 'Save Failed';
    this.emit();
  }

  replaceDocument(document: KyxosSceneDocument, revision = this.revision) {
    this.document = clone(document);
    this.revision = revision;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.saveState = 'Saved';
    this.emit();
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export class AutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<KyxosResult<PersistedDraft>> | null = null;

  constructor(
    private readonly session: EditorSession,
    private readonly adapter: AutosaveAdapter,
    private readonly debounceMs = 800,
  ) {}

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flushPromise) return this.flushPromise;
    const snapshot = this.session.snapshot();
    const draft: PersistedDraft = {
      document: snapshot.document,
      revision: snapshot.revision,
      savedAt: new Date().toISOString(),
    };
    this.session.markSaving();
    await this.adapter.writeBackup?.(draft);
    this.flushPromise = this.adapter
      .save(draft)
      .then(async (result) => {
        if (result.ok && result.data) {
          this.session.markSaved(result.data.revision);
          await this.adapter.clearBackup?.(result.data.document.project.id);
        } else {
          this.session.markSaveFailed();
        }
        return result;
      })
      .catch((error) => {
        this.session.markOffline();
        return fail<PersistedDraft>('KX_ASSET_UPLOAD_FAILED', 'Autosave failed; local backup retained.', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.flushPromise = null;
      });
    return this.flushPromise;
  }

  async restore(projectId: string) {
    return (await this.adapter.loadBackup?.(projectId)) ?? null;
  }
}

function patchCommand<T>(
  id: string,
  label: string,
  read: (document: KyxosSceneDocument) => T,
  write: (document: KyxosSceneDocument, value: T) => KyxosSceneDocument,
  before: T,
  after: T,
): EditorCommand {
  return {
    id,
    label,
    apply: (document) => write(document, clone(after)),
    revert: (document) => write(document, clone(before)),
  };
}

export function setTransformCommand(before: TransformState, after: TransformState): EditorCommand {
  return patchCommand(
    'SetTransformCommand',
    'Set transform',
    (document) => document.model.transform,
    (document, value) => ({ ...clone(document), model: { ...clone(document.model), transform: value } }),
    before,
    after,
  );
}

export function setMaterialCommand(
  materialId: string,
  before: MaterialOverride | null,
  after: MaterialOverride,
): EditorCommand {
  return {
    id: 'SetMaterialCommand',
    label: 'Set material',
    apply: (document) => {
      const next = clone(document);
      next.materials[materialId] = clone(after);
      return next;
    },
    revert: (document) => {
      const next = clone(document);
      if (before) next.materials[materialId] = clone(before);
      else delete next.materials[materialId];
      return next;
    },
  };
}

export function setCameraCommand(before: CameraState, after: CameraState): EditorCommand {
  return patchCommand(
    'SetCameraCommand',
    'Set camera',
    (document) => document.camera,
    (document, value) => ({ ...clone(document), camera: value }),
    before,
    after,
  );
}

export function setEnvironmentCommand(before: EnvironmentState, after: EnvironmentState): EditorCommand {
  return patchCommand(
    'SetEnvironmentCommand',
    'Set environment',
    (document) => document.environment,
    (document, value) => ({ ...clone(document), environment: value }),
    before,
    after,
  );
}

export function addLightCommand(light: SceneLight): EditorCommand {
  return {
    id: 'AddLightCommand',
    label: 'Add light',
    apply: (document) => ({ ...clone(document), lights: [...document.lights, clone(light)].slice(0, 4) }),
    revert: (document) => ({
      ...clone(document),
      lights: document.lights.filter((item) => item.id !== light.id),
    }),
  };
}

export function removeLightCommand(light: SceneLight): EditorCommand {
  return {
    id: 'RemoveLightCommand',
    label: 'Remove light',
    apply: (document) => ({
      ...clone(document),
      lights: document.lights.filter((item) => item.id !== light.id),
    }),
    revert: (document) => ({ ...clone(document), lights: [...document.lights, clone(light)].slice(0, 4) }),
  };
}

export function setAnimationCommand(
  before: KyxosSceneDocument['animation'],
  after: KyxosSceneDocument['animation'],
): EditorCommand {
  return patchCommand(
    'SetAnimationCommand',
    'Set animation',
    (document) => document.animation,
    (document, value) => ({ ...clone(document), animation: value }),
    before,
    after,
  );
}

export function setEffectCommand(
  before: KyxosSceneDocument['effects'],
  after: KyxosSceneDocument['effects'],
): EditorCommand {
  return patchCommand(
    'SetEffectCommand',
    'Set effect',
    (document) => document.effects,
    (document, value) => ({ ...clone(document), effects: value }),
    before,
    after,
  );
}

export function addAnnotationCommand(annotation: Annotation): EditorCommand {
  return {
    id: 'AddAnnotationCommand',
    label: 'Add annotation',
    apply: (document) => ({
      ...clone(document),
      annotations: [...document.annotations, sanitizeAnnotation(annotation)],
    }),
    revert: (document) => ({
      ...clone(document),
      annotations: document.annotations.filter((item) => item.id !== annotation.id),
    }),
  };
}

export function sanitizeAnnotation(annotation: Annotation): Annotation {
  return {
    ...clone(annotation),
    title: annotation.title.replace(/[<>]/g, '').slice(0, 120),
    markdown: annotation.markdown
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .slice(0, 4000),
  };
}

export function detectRevisionConflict(localRevision: number, remoteRevision: number): KyxosResult<number> {
  if (remoteRevision > localRevision) {
    return fail('KX_SAVE_CONFLICT', 'Remote draft has a newer revision.', { localRevision, remoteRevision });
  }
  return ok(localRevision, 'No revision conflict.');
}
