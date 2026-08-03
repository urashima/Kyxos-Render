import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';

import { applyPatch, type SceneDocument } from './index';

export type ProjectRole = 'owner' | 'editor' | 'viewer';
export type CollaborationPermission =
  | 'project:read'
  | 'project:edit'
  | 'project:manage-members'
  | 'project:publish'
  | 'version:create'
  | 'branch:merge';

export interface ProjectMember {
  userId: string;
  email?: string;
  role: ProjectRole;
}

export interface PresenceState {
  userId: string;
  clientId: string;
  displayName: string;
  color: string;
  sceneId: string;
  selection: string[];
  camera?: { position: [number, number, number]; target: [number, number, number] };
  updatedAt: number;
}

export interface RealtimeOperation {
  id: string;
  projectId: string;
  sceneId: string;
  clientId: string;
  userId: string;
  sequence: number;
  baseRevision: number;
  patch: ScenePatch;
  createdAt: string;
}

export interface CollaborationTransport {
  connect(input: {
    projectId: string;
    sceneId: string;
    clientId: string;
    onOperation(operation: RealtimeOperation): void;
    onPresence(presence: PresenceState[]): void;
  }): Promise<() => void>;
  publishOperation(operation: RealtimeOperation): Promise<void>;
  publishPresence(presence: PresenceState): Promise<void>;
}

export interface SceneDifference {
  path: string;
  before: unknown;
  after: unknown;
  kind: 'add' | 'remove' | 'change';
}

export interface MergeConflict {
  path: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  resolution?: 'ours' | 'theirs';
}

export interface MergeResult<T> {
  value: T;
  conflicts: MergeConflict[];
}

export interface Checkpoint {
  id: string;
  projectId: string;
  branchId: string;
  parentId: string | null;
  label: string;
  snapshot: KyxosSceneContract;
  createdBy: string;
  createdAt: string;
}

export interface VersionBranch {
  id: string;
  projectId: string;
  name: string;
  headCheckpointId: string | null;
  baseCheckpointId: string | null;
  createdBy: string;
  createdAt: string;
}

const ROLE_PERMISSIONS: Record<ProjectRole, ReadonlySet<CollaborationPermission>> = {
  owner: new Set(['project:read', 'project:edit', 'project:manage-members', 'project:publish', 'version:create', 'branch:merge']),
  editor: new Set(['project:read', 'project:edit', 'project:publish', 'version:create', 'branch:merge']),
  viewer: new Set(['project:read']),
};

export function roleCan(role: ProjectRole, permission: CollaborationPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function assertRole(role: ProjectRole, permission: CollaborationPermission): void {
  if (!roleCan(role, permission)) throw new Error(`${role} cannot perform ${permission}.`);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function at(root: unknown, path: string): unknown {
  let value: any = root;
  for (const part of path.slice(1).split('/').filter(Boolean).map((value) => value.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    value = value?.[Array.isArray(value) ? Number(part) : part];
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffValues(before: unknown, after: unknown, basePath = ''): SceneDifference[] {
  if (equal(before, after)) return [];
  if (
    before == null ||
    after == null ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return [{
      path: basePath || '/',
      before: structuredClone(before),
      after: structuredClone(after),
      kind: before === undefined ? 'add' : after === undefined ? 'remove' : 'change',
    }];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      return [{ path: basePath || '/', before: structuredClone(before), after: structuredClone(after), kind: 'change' }];
    }
    return before.flatMap((value, index) => diffValues(value, after[index], `${basePath}/${index}`));
  }
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
  return [...keys].flatMap((key) => diffValues((before as any)[key], (after as any)[key], `${basePath}/${escapePointer(key)}`));
}

function setAt(root: any, path: string, value: unknown): void {
  const parts = path.slice(1).split('/').filter(Boolean).map((value) => value.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!parts.length) throw new Error('Root assignment is not supported.');
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    const key = Array.isArray(parent) ? Number(part) : part;
    parent[key] ??= {};
    parent = parent[key];
  }
  const key = parts.at(-1)!;
  if (value === undefined) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else parent[Array.isArray(parent) ? Number(key) : key] = structuredClone(value);
}

export function threeWayMerge<T>(base: T, ours: T, theirs: T): MergeResult<T> {
  const result = structuredClone(ours);
  const oursByPath = new Map(diffValues(base, ours).map((change) => [change.path, change]));
  const conflicts: MergeConflict[] = [];
  for (const change of diffValues(base, theirs)) {
    const oursChange = oursByPath.get(change.path);
    if (oursChange && !equal(oursChange.after, change.after)) {
      conflicts.push({
        path: change.path,
        base: structuredClone(at(base, change.path)),
        ours: structuredClone(oursChange.after),
        theirs: structuredClone(change.after),
      });
      continue;
    }
    setAt(result, change.path, change.after);
  }
  return { value: result, conflicts };
}

export function resolveMergeConflicts<T>(merge: MergeResult<T>, resolutions: Record<string, 'ours' | 'theirs'>): T {
  const value = structuredClone(merge.value);
  for (const conflict of merge.conflicts) {
    const resolution = resolutions[conflict.path];
    if (!resolution) throw new Error(`Merge conflict ${conflict.path} is unresolved.`);
    setAt(value, conflict.path, resolution === 'ours' ? conflict.ours : conflict.theirs);
  }
  return value;
}

export class PresenceService extends EventTarget {
  private entries = new Map<string, PresenceState>();

  update(states: PresenceState[], staleAfterMs = 30_000): void {
    const cutoff = Date.now() - staleAfterMs;
    this.entries = new Map(
      states.filter((state) => state.updatedAt >= cutoff).map((state) => [`${state.userId}:${state.clientId}`, structuredClone(state)]),
    );
    this.dispatchEvent(new CustomEvent('change', { detail: { states: this.list() } }));
  }

  list(sceneId?: string): PresenceState[] {
    return [...this.entries.values()]
      .filter((entry) => !sceneId || entry.sceneId === sceneId)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((entry) => structuredClone(entry));
  }
}

export class RealtimeCollaborationController extends EventTarget {
  readonly presence = new PresenceService();
  private disposeTransport: (() => void) | null = null;
  private sequence = 0;
  private revision: number;
  private readonly seen = new Set<string>();

  constructor(
    private readonly input: { projectId: string; sceneId: string; clientId: string; userId: string; role: ProjectRole },
    private readonly document: SceneDocument,
    private readonly transport: CollaborationTransport,
    revision = 0,
  ) {
    super();
    this.revision = revision;
  }

  async connect(): Promise<void> {
    this.disposeTransport?.();
    this.disposeTransport = await this.transport.connect({
      projectId: this.input.projectId,
      sceneId: this.input.sceneId,
      clientId: this.input.clientId,
      onOperation: (operation) => this.receive(operation),
      onPresence: (presence) => this.presence.update(presence),
    });
  }

  async publish(patch: ScenePatch): Promise<RealtimeOperation> {
    assertRole(this.input.role, 'project:edit');
    const operation: RealtimeOperation = {
      id: crypto.randomUUID(),
      projectId: this.input.projectId,
      sceneId: this.input.sceneId,
      clientId: this.input.clientId,
      userId: this.input.userId,
      sequence: ++this.sequence,
      baseRevision: this.revision,
      patch: structuredClone(patch),
      createdAt: new Date().toISOString(),
    };
    this.seen.add(operation.id);
    this.document.apply(patch, 'realtime-local');
    this.revision += 1;
    await this.transport.publishOperation(operation);
    this.dispatchEvent(new CustomEvent('operation', { detail: { operation, local: true } }));
    return operation;
  }

  async publishPresence(state: Omit<PresenceState, 'updatedAt'>): Promise<void> {
    await this.transport.publishPresence({ ...structuredClone(state), updatedAt: Date.now() });
  }

  dispose(): void {
    this.disposeTransport?.();
    this.disposeTransport = null;
  }

  private receive(operation: RealtimeOperation): void {
    if (this.seen.has(operation.id)) return;
    if (operation.projectId !== this.input.projectId || operation.sceneId !== this.input.sceneId) return;
    if (operation.baseRevision > this.revision) {
      this.dispatchEvent(new CustomEvent('conflict', { detail: { operation, revision: this.revision } }));
      return;
    }
    try {
      const next = applyPatch(this.document.value, operation.patch);
      this.document.replace(next, 'realtime-remote');
      this.revision = Math.max(this.revision + 1, operation.baseRevision + 1);
      this.seen.add(operation.id);
      this.dispatchEvent(new CustomEvent('operation', { detail: { operation, local: false } }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent('conflict', { detail: { operation, revision: this.revision, error } }));
    }
  }
}

export class VersionControlService extends EventTarget {
  private branches: VersionBranch[] = [];
  private checkpoints: Checkpoint[] = [];

  constructor(
    private readonly projectId: string,
    private readonly userId: string,
    private readonly role: ProjectRole,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) { super() }

  listBranches(): VersionBranch[] { return structuredClone(this.branches) }
  listCheckpoints(branchId?: string): Checkpoint[] {
    return structuredClone(this.checkpoints.filter((entry) => !branchId || entry.branchId === branchId));
  }

  createBranch(name: string, baseCheckpointId: string | null = null): VersionBranch {
    assertRole(this.role, 'version:create');
    if (!name.trim()) throw new Error('Branch name is required.');
    if (baseCheckpointId && !this.checkpoints.some((entry) => entry.id === baseCheckpointId)) throw new Error('Base checkpoint does not exist.');
    const branch: VersionBranch = {
      id: this.createId(), projectId: this.projectId, name: name.trim(),
      headCheckpointId: baseCheckpointId, baseCheckpointId,
      createdBy: this.userId, createdAt: new Date().toISOString(),
    };
    this.branches.push(branch);
    this.emit('branch-created', { branchId: branch.id });
    return structuredClone(branch);
  }

  checkpoint(branchId: string, label: string, snapshot: KyxosSceneContract): Checkpoint {
    assertRole(this.role, 'version:create');
    const branch = this.branch(branchId);
    const checkpoint: Checkpoint = {
      id: this.createId(), projectId: this.projectId, branchId,
      parentId: branch.headCheckpointId, label: label.trim() || 'Checkpoint',
      snapshot: structuredClone(snapshot), createdBy: this.userId, createdAt: new Date().toISOString(),
    };
    this.checkpoints.push(checkpoint);
    branch.headCheckpointId = checkpoint.id;
    this.emit('checkpoint-created', { branchId, checkpointId: checkpoint.id });
    return structuredClone(checkpoint);
  }

  diff(leftCheckpointId: string, rightCheckpointId: string): SceneDifference[] {
    return diffValues(this.checkpointById(leftCheckpointId).snapshot, this.checkpointById(rightCheckpointId).snapshot);
  }

  merge(sourceBranchId: string, targetBranchId: string): MergeResult<KyxosSceneContract> {
    assertRole(this.role, 'branch:merge');
    const source = this.branch(sourceBranchId);
    const target = this.branch(targetBranchId);
    if (!source.headCheckpointId || !target.headCheckpointId) throw new Error('Both branches need a checkpoint before merging.');
    const baseId = source.baseCheckpointId ?? target.baseCheckpointId;
    const base = baseId ? this.checkpointById(baseId).snapshot : this.checkpointById(target.headCheckpointId).snapshot;
    return threeWayMerge(base, this.checkpointById(target.headCheckpointId).snapshot, this.checkpointById(source.headCheckpointId).snapshot);
  }

  completeMerge(targetBranchId: string, label: string, merge: MergeResult<KyxosSceneContract>, resolutions: Record<string, 'ours' | 'theirs'>): Checkpoint {
    const snapshot = resolveMergeConflicts(merge, resolutions);
    return this.checkpoint(targetBranchId, label, snapshot);
  }

  private branch(id: string): VersionBranch {
    const branch = this.branches.find((entry) => entry.id === id);
    if (!branch) throw new Error(`Branch ${id} does not exist.`);
    return branch;
  }

  private checkpointById(id: string): Checkpoint {
    const checkpoint = this.checkpoints.find((entry) => entry.id === id);
    if (!checkpoint) throw new Error(`Checkpoint ${id} does not exist.`);
    return checkpoint;
  }

  private emit(type: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
  }
}
