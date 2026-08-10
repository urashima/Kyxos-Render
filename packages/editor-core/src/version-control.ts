import type { KyxosSceneContract } from '@kyxos/scene-contract';

export interface VersionAuthor {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface VersionRevision<TSnapshot = KyxosSceneContract> {
  id: string;
  parentIds: string[];
  message: string;
  description?: string;
  author: VersionAuthor;
  createdAt: string;
  snapshotDigest: string;
  snapshot?: TSnapshot;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface VersionBranch {
  id: string;
  name: string;
  headRevisionId: string | null;
  baseRevisionId: string | null;
  protected: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  colorKey?: string;
  metadata?: Record<string, unknown>;
}

export interface VersionRepository<TSnapshot = KyxosSceneContract> {
  revisions: VersionRevision<TSnapshot>[];
  branches: VersionBranch[];
  currentBranchId: string;
  remoteHeads?: Record<string, string | null>;
}

export interface VersionGraphNode<TSnapshot = KyxosSceneContract> {
  revision: VersionRevision<TSnapshot>;
  row: number;
  lane: number;
  branchIds: string[];
  primaryParentId: string | null;
  secondaryParentIds: string[];
  isMerge: boolean;
  isHead: boolean;
  isCurrentHead: boolean;
}

export interface VersionGraphEdge {
  id: string;
  fromRevisionId: string;
  toRevisionId: string;
  fromRow: number;
  toRow: number;
  fromLane: number;
  toLane: number;
  kind: 'primary' | 'merge';
}

export interface VersionGraphLayout<TSnapshot = KyxosSceneContract> {
  nodes: VersionGraphNode<TSnapshot>[];
  edges: VersionGraphEdge[];
  laneCount: number;
  branchLaneHints: Record<string, number>;
  hiddenBranchIds: string[];
}

export interface VersionGraphIssue {
  code:
    | 'revision.duplicate-id'
    | 'revision.parent-missing'
    | 'revision.parent-self'
    | 'revision.cycle'
    | 'revision.timestamp-invalid'
    | 'branch.duplicate-id'
    | 'branch.duplicate-name'
    | 'branch.head-missing'
    | 'branch.base-missing'
    | 'branch.current-missing'
    | 'remote.head-missing';
  severity: 'error' | 'warning';
  path: string;
  message: string;
  revisionId?: string;
  branchId?: string;
}

export interface BranchAheadBehind {
  branchId: string;
  compareBranchId: string;
  ahead: number;
  behind: number;
  commonAncestorId: string | null;
  aheadRevisionIds: string[];
  behindRevisionIds: string[];
}

export type VersionDiffOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string; oldValue: unknown }
  | { op: 'replace'; path: string; oldValue: unknown; value: unknown };

export interface VersionDiffSummary {
  operations: VersionDiffOperation[];
  added: number;
  removed: number;
  changed: number;
  changedPaths: string[];
  topLevelSections: Record<string, number>;
}

export type MergeConflictKind =
  | 'add-add'
  | 'delete-modify'
  | 'modify-delete'
  | 'modify-modify'
  | 'array-order';

export interface MergeConflict {
  id: string;
  path: string;
  kind: MergeConflictKind;
  baseValue: unknown;
  oursValue: unknown;
  theirsValue: unknown;
  message: string;
}

export type MergeResolution =
  | { strategy: 'ours' }
  | { strategy: 'theirs' }
  | { strategy: 'base' }
  | { strategy: 'manual'; value: unknown };

export type MergeResolutionMap = Record<string, MergeResolution>;

export interface ThreeWayMergePlan<TSnapshot = KyxosSceneContract> {
  baseRevisionId: string | null;
  oursRevisionId: string;
  theirsRevisionId: string;
  autoMerged: TSnapshot;
  conflicts: MergeConflict[];
  oursDiff: VersionDiffSummary;
  theirsDiff: VersionDiffSummary;
  canFastForward: boolean;
  alreadyUpToDate: boolean;
}

export interface MergeResult<TSnapshot = KyxosSceneContract> {
  snapshot: TSnapshot;
  unresolved: MergeConflict[];
  appliedResolutions: string[];
}

export interface VersionControlAdapter<TSnapshot = KyxosSceneContract> {
  loadRepository(): Promise<VersionRepository<TSnapshot>>;
  loadSnapshot(revisionId: string): Promise<TSnapshot>;
  createBranch(input: {
    name: string;
    fromRevisionId: string | null;
  }): Promise<VersionBranch>;
  renameBranch(branchId: string, name: string): Promise<VersionBranch>;
  deleteBranch(branchId: string): Promise<void>;
  createCheckpoint(input: {
    branchId: string;
    parentRevisionIds: string[];
    message: string;
    description?: string;
    snapshot: TSnapshot;
    snapshotDigest: string;
  }): Promise<VersionRevision<TSnapshot>>;
  moveBranchHead(branchId: string, revisionId: string | null): Promise<VersionBranch>;
}

export interface VersionControlProgress {
  operation:
    | 'load'
    | 'checkout'
    | 'create-branch'
    | 'checkpoint'
    | 'merge'
    | 'delete-branch';
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]),
  );
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function cleanBranchName(value: string): string {
  const name = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._/-]/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (!name || name === '.' || name === '..' || name.startsWith('/') || name.endsWith('/')) {
    throw new Error('Branch name is invalid.');
  }
  return name;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pathSegments(path: string): string[] {
  if (!path || path === '/') return [];
  return path.split('/').slice(1).map(unescapePointer);
}

function getAtPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of pathSegments(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[segment];
    } else return undefined;
  }
  return clone(current);
}

function setAtPath<T>(root: T, path: string, value: unknown): T {
  if (!path || path === '/') return clone(value) as T;
  const result = clone(root);
  const segments = pathSegments(path);
  let current: unknown = result;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (Array.isArray(current)) {
      const position = Number(segment);
      if (!Number.isInteger(position)) throw new Error(`Invalid array path ${path}.`);
      if (last) current[position] = clone(value);
      else {
        current[position] ??= /^\d+$/.test(segments[index + 1]) ? [] : {};
        current = current[position];
      }
    } else if (isRecord(current)) {
      if (last) current[segment] = clone(value);
      else {
        current[segment] ??= /^\d+$/.test(segments[index + 1]) ? [] : {};
        current = current[segment];
      }
    } else throw new Error(`Cannot write ${path}.`);
  });
  return result;
}

function removeAtPath<T>(root: T, path: string): T {
  if (!path || path === '/') return undefined as T;
  const result = clone(root);
  const segments = pathSegments(path);
  let current: unknown = result;
  segments.slice(0, -1).forEach((segment) => {
    current = Array.isArray(current)
      ? current[Number(segment)]
      : isRecord(current)
        ? current[segment]
        : undefined;
  });
  const last = segments.at(-1)!;
  if (Array.isArray(current)) current.splice(Number(last), 1);
  else if (isRecord(current)) delete current[last];
  return result;
}

export function validateVersionRepository<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
): VersionGraphIssue[] {
  const issues: VersionGraphIssue[] = [];
  const revisionById = new Map<string, VersionRevision<TSnapshot>>();
  repository.revisions.forEach((revision, index) => {
    const path = `/revisions/${index}`;
    if (!revision.id || revisionById.has(revision.id)) {
      issues.push({
        code: 'revision.duplicate-id',
        severity: 'error',
        path: `${path}/id`,
        message: 'Revision IDs must be unique.',
        revisionId: revision.id,
      });
    } else revisionById.set(revision.id, revision);
    if (!Number.isFinite(Date.parse(revision.createdAt))) {
      issues.push({
        code: 'revision.timestamp-invalid',
        severity: 'error',
        path: `${path}/createdAt`,
        message: 'Revision timestamp is invalid.',
        revisionId: revision.id,
      });
    }
    revision.parentIds.forEach((parentId, parentIndex) => {
      if (parentId === revision.id) {
        issues.push({
          code: 'revision.parent-self', severity: 'error',
          path: `${path}/parentIds/${parentIndex}`,
          message: 'A revision cannot parent itself.', revisionId: revision.id,
        });
      }
    });
  });
  repository.revisions.forEach((revision, index) => {
    revision.parentIds.forEach((parentId, parentIndex) => {
      if (!revisionById.has(parentId)) {
        issues.push({
          code: 'revision.parent-missing', severity: 'error',
          path: `/revisions/${index}/parentIds/${parentIndex}`,
          message: `Parent revision ${parentId} is missing.`, revisionId: revision.id,
        });
      }
    });
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (revisionId: string): boolean => {
    if (visiting.has(revisionId)) return true;
    if (visited.has(revisionId)) return false;
    visiting.add(revisionId);
    const cyclic = (revisionById.get(revisionId)?.parentIds ?? []).some(visit);
    visiting.delete(revisionId);
    visited.add(revisionId);
    return cyclic;
  };
  for (const revision of repository.revisions) {
    if (visit(revision.id)) {
      issues.push({
        code: 'revision.cycle', severity: 'error', path: '/revisions',
        message: 'Revision history contains a cycle.', revisionId: revision.id,
      });
      break;
    }
  }

  const branchIds = new Set<string>();
  const branchNames = new Set<string>();
  repository.branches.forEach((branch, index) => {
    const path = `/branches/${index}`;
    if (!branch.id || branchIds.has(branch.id)) {
      issues.push({ code: 'branch.duplicate-id', severity: 'error', path: `${path}/id`, message: 'Branch IDs must be unique.', branchId: branch.id });
    }
    branchIds.add(branch.id);
    const name = branch.name.toLocaleLowerCase();
    if (!name || branchNames.has(name)) {
      issues.push({ code: 'branch.duplicate-name', severity: 'error', path: `${path}/name`, message: 'Branch names must be unique.', branchId: branch.id });
    }
    branchNames.add(name);
    if (branch.headRevisionId && !revisionById.has(branch.headRevisionId)) {
      issues.push({ code: 'branch.head-missing', severity: 'error', path: `${path}/headRevisionId`, message: 'Branch head revision is missing.', branchId: branch.id });
    }
    if (branch.baseRevisionId && !revisionById.has(branch.baseRevisionId)) {
      issues.push({ code: 'branch.base-missing', severity: 'error', path: `${path}/baseRevisionId`, message: 'Branch base revision is missing.', branchId: branch.id });
    }
  });
  if (!branchIds.has(repository.currentBranchId)) {
    issues.push({ code: 'branch.current-missing', severity: 'error', path: '/currentBranchId', message: 'Current branch does not exist.', branchId: repository.currentBranchId });
  }
  for (const [branchId, revisionId] of Object.entries(repository.remoteHeads ?? {})) {
    if (revisionId && !revisionById.has(revisionId)) {
      issues.push({ code: 'remote.head-missing', severity: 'warning', path: `/remoteHeads/${escapePointer(branchId)}`, message: 'Remote branch head is missing locally.', branchId });
    }
  }
  return issues;
}

function ancestorDistances<TSnapshot>(
  revisionById: ReadonlyMap<string, VersionRevision<TSnapshot>>,
  startId: string | null,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!startId || !revisionById.has(startId)) return distances;
  const queue: Array<[string, number]> = [[startId, 0]];
  while (queue.length) {
    const [id, distance] = queue.shift()!;
    const previous = distances.get(id);
    if (previous != null && previous <= distance) continue;
    distances.set(id, distance);
    for (const parentId of revisionById.get(id)?.parentIds ?? []) queue.push([parentId, distance + 1]);
  }
  return distances;
}

export function findMergeBase<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
  leftRevisionId: string | null,
  rightRevisionId: string | null,
): string | null {
  const revisions = new Map(repository.revisions.map((revision) => [revision.id, revision]));
  const left = ancestorDistances(revisions, leftRevisionId);
  const right = ancestorDistances(revisions, rightRevisionId);
  const common = [...left.keys()].filter((id) => right.has(id));
  common.sort((a, b) => {
    const scoreA = Math.max(left.get(a)!, right.get(a)!);
    const scoreB = Math.max(left.get(b)!, right.get(b)!);
    if (scoreA !== scoreB) return scoreA - scoreB;
    const totalA = left.get(a)! + right.get(a)!;
    const totalB = left.get(b)! + right.get(b)!;
    if (totalA !== totalB) return totalA - totalB;
    return Date.parse(revisions.get(b)!.createdAt) - Date.parse(revisions.get(a)!.createdAt);
  });
  return common[0] ?? null;
}

export function calculateAheadBehind<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
  branchId: string,
  compareBranchId: string,
): BranchAheadBehind {
  const branch = repository.branches.find((entry) => entry.id === branchId);
  const compare = repository.branches.find((entry) => entry.id === compareBranchId);
  if (!branch || !compare) throw new Error('Branch not found.');
  const revisions = new Map(repository.revisions.map((revision) => [revision.id, revision]));
  const branchAncestors = ancestorDistances(revisions, branch.headRevisionId);
  const compareAncestors = ancestorDistances(revisions, compare.headRevisionId);
  const aheadRevisionIds = [...branchAncestors.keys()].filter((id) => !compareAncestors.has(id));
  const behindRevisionIds = [...compareAncestors.keys()].filter((id) => !branchAncestors.has(id));
  const newestFirst = (left: string, right: string) =>
    Date.parse(revisions.get(right)!.createdAt) - Date.parse(revisions.get(left)!.createdAt)
    || left.localeCompare(right);
  aheadRevisionIds.sort(newestFirst);
  behindRevisionIds.sort(newestFirst);
  return {
    branchId,
    compareBranchId,
    ahead: aheadRevisionIds.length,
    behind: behindRevisionIds.length,
    commonAncestorId: findMergeBase(repository, branch.headRevisionId, compare.headRevisionId),
    aheadRevisionIds,
    behindRevisionIds,
  };
}

function reachableRevisionIds<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
  branchIds: Iterable<string>,
): Set<string> {
  const revisions = new Map(repository.revisions.map((revision) => [revision.id, revision]));
  const result = new Set<string>();
  const stack = repository.branches
    .filter((branch) => new Set(branchIds).has(branch.id))
    .map((branch) => branch.headRevisionId)
    .filter((id): id is string => Boolean(id));
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const parentId of revisions.get(id)?.parentIds ?? []) stack.push(parentId);
  }
  return result;
}

export function compactVersionBranches<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
  options: {
    keepBranchIds?: Iterable<string>;
    keepProtected?: boolean;
    keepCurrent?: boolean;
    includeRemote?: boolean;
  } = {},
): { visibleBranchIds: string[]; hiddenBranchIds: string[] } {
  const keep = new Set(options.keepBranchIds ?? []);
  if (options.keepCurrent !== false) keep.add(repository.currentBranchId);
  if (options.keepProtected !== false) for (const branch of repository.branches) if (branch.protected) keep.add(branch.id);
  if (options.includeRemote !== false) for (const branchId of Object.keys(repository.remoteHeads ?? {})) keep.add(branchId);
  const headGroups = new Map<string | null, VersionBranch[]>();
  for (const branch of repository.branches) {
    const group = headGroups.get(branch.headRevisionId) ?? [];
    group.push(branch);
    headGroups.set(branch.headRevisionId, group);
  }
  for (const group of headGroups.values()) {
    if (group.some((branch) => keep.has(branch.id))) continue;
    group.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.name.localeCompare(b.name));
    if (group[0]) keep.add(group[0].id);
  }
  const visibleBranchIds = repository.branches.filter((branch) => keep.has(branch.id)).map((branch) => branch.id);
  const hiddenBranchIds = repository.branches.filter((branch) => !keep.has(branch.id)).map((branch) => branch.id);
  return { visibleBranchIds, hiddenBranchIds };
}

function stableRevisionOrder<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
  visibleRevisionIds: Set<string>,
): VersionRevision<TSnapshot>[] {
  const revisions = new Map(repository.revisions.map((revision) => [revision.id, revision]));
  const childCount = new Map<string, number>();
  for (const id of visibleRevisionIds) childCount.set(id, 0);
  for (const revision of repository.revisions) {
    if (!visibleRevisionIds.has(revision.id)) continue;
    for (const parentId of revision.parentIds) if (visibleRevisionIds.has(parentId)) childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
  }
  const ready = [...visibleRevisionIds]
    .filter((id) => childCount.get(id) === 0)
    .sort((a, b) => Date.parse(revisions.get(b)!.createdAt) - Date.parse(revisions.get(a)!.createdAt) || a.localeCompare(b));
  const result: VersionRevision<TSnapshot>[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    const revision = revisions.get(id);
    if (!revision) continue;
    result.push(revision);
    for (const parentId of revision.parentIds) {
      if (!visibleRevisionIds.has(parentId)) continue;
      const next = (childCount.get(parentId) ?? 0) - 1;
      childCount.set(parentId, next);
      if (next === 0) {
        ready.push(parentId);
        ready.sort((a, b) => Date.parse(revisions.get(b)!.createdAt) - Date.parse(revisions.get(a)!.createdAt) || a.localeCompare(b));
      }
    }
  }
  if (result.length !== visibleRevisionIds.size) throw new Error('Cannot lay out a cyclic revision graph.');
  return result;
}

export function layoutVersionGraph<TSnapshot>(
  repository: VersionRepository<TSnapshot>,
  options: {
    compact?: boolean;
    keepBranchIds?: Iterable<string>;
    maxRevisions?: number;
  } = {},
): VersionGraphLayout<TSnapshot> {
  const errors = validateVersionRepository(repository).filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));
  const compacted = options.compact === false
    ? { visibleBranchIds: repository.branches.map((branch) => branch.id), hiddenBranchIds: [] }
    : compactVersionBranches(repository, { keepBranchIds: options.keepBranchIds });
  const visibleBranches = repository.branches.filter((branch) => compacted.visibleBranchIds.includes(branch.id));
  const visibleRevisionIds = reachableRevisionIds(repository, visibleBranches.map((branch) => branch.id));
  let ordered = stableRevisionOrder(repository, visibleRevisionIds);
  if (options.maxRevisions && ordered.length > options.maxRevisions) {
    ordered = ordered.slice(0, Math.max(1, options.maxRevisions));
  }
  const visible = new Set(ordered.map((revision) => revision.id));
  const branchByHead = new Map<string, VersionBranch[]>();
  for (const branch of visibleBranches) {
    if (!branch.headRevisionId || !visible.has(branch.headRevisionId)) continue;
    const list = branchByHead.get(branch.headRevisionId) ?? [];
    list.push(branch);
    branchByHead.set(branch.headRevisionId, list);
  }

  const activeLanes: Array<string | null> = [];
  const laneByRevision = new Map<string, number>();
  const branchLaneHints: Record<string, number> = {};
  const nodes: VersionGraphNode<TSnapshot>[] = [];
  const allocateLane = (revisionId: string): number => {
    const existing = activeLanes.indexOf(revisionId);
    if (existing >= 0) return existing;
    const free = activeLanes.indexOf(null);
    if (free >= 0) {
      activeLanes[free] = revisionId;
      return free;
    }
    activeLanes.push(revisionId);
    return activeLanes.length - 1;
  };

  ordered.forEach((revision, row) => {
    const lane = allocateLane(revision.id);
    laneByRevision.set(revision.id, lane);
    const parents = revision.parentIds.filter((id) => visible.has(id));
    activeLanes[lane] = parents[0] ?? null;
    for (const secondary of parents.slice(1)) allocateLane(secondary);
    const branchIds = (branchByHead.get(revision.id) ?? []).map((branch) => branch.id).sort();
    for (const branchId of branchIds) branchLaneHints[branchId] = lane;
    nodes.push({
      revision,
      row,
      lane,
      branchIds,
      primaryParentId: parents[0] ?? null,
      secondaryParentIds: parents.slice(1),
      isMerge: revision.parentIds.length > 1,
      isHead: branchIds.length > 0,
      isCurrentHead: branchIds.includes(repository.currentBranchId),
    });
  });
  const rowByRevision = new Map(nodes.map((node) => [node.revision.id, node.row]));
  const edges: VersionGraphEdge[] = [];
  for (const node of nodes) {
    node.revision.parentIds.forEach((parentId, index) => {
      const toRow = rowByRevision.get(parentId);
      const toLane = laneByRevision.get(parentId);
      if (toRow == null || toLane == null) return;
      edges.push({
        id: `${node.revision.id}->${parentId}`,
        fromRevisionId: node.revision.id,
        toRevisionId: parentId,
        fromRow: node.row,
        toRow,
        fromLane: node.lane,
        toLane,
        kind: index === 0 ? 'primary' : 'merge',
      });
    });
  }
  return {
    nodes,
    edges,
    laneCount: Math.max(1, ...nodes.map((node) => node.lane + 1)),
    branchLaneHints,
    hiddenBranchIds: compacted.hiddenBranchIds,
  };
}

export function assertVerticalConsistency<TSnapshot>(layout: VersionGraphLayout<TSnapshot>): void {
  const nodes = new Map(layout.nodes.map((node) => [node.revision.id, node]));
  const edgeIds = new Set<string>();
  for (const edge of layout.edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate graph edge ${edge.id}.`);
    edgeIds.add(edge.id);
    const child = nodes.get(edge.fromRevisionId);
    const parent = nodes.get(edge.toRevisionId);
    if (!child || !parent) throw new Error(`Graph edge ${edge.id} references a hidden node.`);
    if (parent.row <= child.row) throw new Error(`Parent ${parent.revision.id} must be below child ${child.revision.id}.`);
    if (edge.fromRow !== child.row || edge.toRow !== parent.row || edge.fromLane !== child.lane || edge.toLane !== parent.lane) {
      throw new Error(`Graph edge ${edge.id} coordinates are inconsistent.`);
    }
  }
  const rows = new Set(layout.nodes.map((node) => node.row));
  if (rows.size !== layout.nodes.length) throw new Error('Each visible revision must occupy one row.');
}

function diffValue(base: unknown, target: unknown, path: string, operations: VersionDiffOperation[]): void {
  if (equal(base, target)) return;
  if (base === undefined) {
    operations.push({ op: 'add', path: path || '/', value: clone(target) });
    return;
  }
  if (target === undefined) {
    operations.push({ op: 'remove', path: path || '/', oldValue: clone(base) });
    return;
  }
  if (Array.isArray(base) && Array.isArray(target)) {
    const shared = Math.min(base.length, target.length);
    for (let index = 0; index < shared; index += 1) diffValue(base[index], target[index], `${path}/${index}`, operations);
    for (let index = base.length - 1; index >= target.length; index -= 1) {
      operations.push({ op: 'remove', path: `${path}/${index}`, oldValue: clone(base[index]) });
    }
    for (let index = shared; index < target.length; index += 1) {
      operations.push({ op: 'add', path: `${path}/${index}`, value: clone(target[index]) });
    }
    return;
  }
  if (isRecord(base) && isRecord(target)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
    for (const key of [...keys].sort()) diffValue(base[key], target[key], `${path}/${escapePointer(key)}`, operations);
    return;
  }
  operations.push({ op: 'replace', path: path || '/', oldValue: clone(base), value: clone(target) });
}

export function diffSnapshots(base: unknown, target: unknown): VersionDiffSummary {
  const operations: VersionDiffOperation[] = [];
  diffValue(base, target, '', operations);
  const topLevelSections: Record<string, number> = {};
  for (const operation of operations) {
    const section = pathSegments(operation.path)[0] ?? '/';
    topLevelSections[section] = (topLevelSections[section] ?? 0) + 1;
  }
  return {
    operations,
    added: operations.filter((operation) => operation.op === 'add').length,
    removed: operations.filter((operation) => operation.op === 'remove').length,
    changed: operations.filter((operation) => operation.op === 'replace').length,
    changedPaths: operations.map((operation) => operation.path),
    topLevelSections,
  };
}

function conflictId(path: string, kind: MergeConflictKind): string {
  return `${kind}:${path || '/'}`;
}

function mergeArrays(
  base: unknown[],
  ours: unknown[],
  theirs: unknown[],
  path: string,
  conflicts: MergeConflict[],
): unknown[] {
  if (equal(ours, theirs)) return clone(ours);
  if (equal(base, ours)) return clone(theirs);
  if (equal(base, theirs)) return clone(ours);
  const max = Math.max(base.length, ours.length, theirs.length);
  const result: unknown[] = [];
  for (let index = 0; index < max; index += 1) {
    const value = mergeValue(base[index], ours[index], theirs[index], `${path}/${index}`, conflicts);
    if (value !== undefined) result.push(value);
  }
  const baseOrder = base.map((entry) => JSON.stringify(canonical(entry)));
  const oursOrder = ours.map((entry) => JSON.stringify(canonical(entry)));
  const theirsOrder = theirs.map((entry) => JSON.stringify(canonical(entry)));
  const sameMembers = new Set([...baseOrder, ...oursOrder, ...theirsOrder]).size === new Set(baseOrder).size
    && baseOrder.length === oursOrder.length && baseOrder.length === theirsOrder.length;
  if (sameMembers && !equal(oursOrder, theirsOrder) && !equal(baseOrder, oursOrder) && !equal(baseOrder, theirsOrder)) {
    conflicts.push({
      id: conflictId(path, 'array-order'),
      path: path || '/',
      kind: 'array-order',
      baseValue: clone(base),
      oursValue: clone(ours),
      theirsValue: clone(theirs),
      message: 'Both branches reordered the same array differently.',
    });
    return clone(ours);
  }
  return result;
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  path: string,
  conflicts: MergeConflict[],
): unknown {
  if (equal(ours, theirs)) return clone(ours);
  if (equal(base, ours)) return clone(theirs);
  if (equal(base, theirs)) return clone(ours);
  if (base === undefined) {
    if (ours !== undefined && theirs !== undefined) {
      conflicts.push({ id: conflictId(path, 'add-add'), path: path || '/', kind: 'add-add', baseValue: undefined, oursValue: clone(ours), theirsValue: clone(theirs), message: 'Both branches added different values.' });
      return clone(ours);
    }
    return clone(ours ?? theirs);
  }
  if (ours === undefined && theirs !== undefined) {
    conflicts.push({ id: conflictId(path, 'delete-modify'), path: path || '/', kind: 'delete-modify', baseValue: clone(base), oursValue: undefined, theirsValue: clone(theirs), message: 'Current branch deleted a value changed by the incoming branch.' });
    return undefined;
  }
  if (theirs === undefined && ours !== undefined) {
    conflicts.push({ id: conflictId(path, 'modify-delete'), path: path || '/', kind: 'modify-delete', baseValue: clone(base), oursValue: clone(ours), theirsValue: undefined, message: 'Incoming branch deleted a value changed by the current branch.' });
    return clone(ours);
  }
  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    return mergeArrays(base, ours, theirs, path, conflicts);
  }
  if (isRecord(base) && isRecord(ours) && isRecord(theirs)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
    for (const key of [...keys].sort()) {
      const merged = mergeValue(base[key], ours[key], theirs[key], `${path}/${escapePointer(key)}`, conflicts);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }
  conflicts.push({
    id: conflictId(path, 'modify-modify'),
    path: path || '/',
    kind: 'modify-modify',
    baseValue: clone(base),
    oursValue: clone(ours),
    theirsValue: clone(theirs),
    message: 'Both branches changed the same value differently.',
  });
  return clone(ours);
}

export function planThreeWayMerge<TSnapshot>(input: {
  repository: VersionRepository<TSnapshot>;
  oursRevisionId: string;
  theirsRevisionId: string;
  baseSnapshot: TSnapshot;
  oursSnapshot: TSnapshot;
  theirsSnapshot: TSnapshot;
}): ThreeWayMergePlan<TSnapshot> {
  const baseRevisionId = findMergeBase(input.repository, input.oursRevisionId, input.theirsRevisionId);
  const conflicts: MergeConflict[] = [];
  const autoMerged = mergeValue(input.baseSnapshot, input.oursSnapshot, input.theirsSnapshot, '', conflicts) as TSnapshot;
  const revisions = new Map(input.repository.revisions.map((revision) => [revision.id, revision]));
  const oursAncestors = ancestorDistances(revisions, input.oursRevisionId);
  const theirsAncestors = ancestorDistances(revisions, input.theirsRevisionId);
  return {
    baseRevisionId,
    oursRevisionId: input.oursRevisionId,
    theirsRevisionId: input.theirsRevisionId,
    autoMerged,
    conflicts,
    oursDiff: diffSnapshots(input.baseSnapshot, input.oursSnapshot),
    theirsDiff: diffSnapshots(input.baseSnapshot, input.theirsSnapshot),
    canFastForward: oursAncestors.has(input.theirsRevisionId) === false && theirsAncestors.has(input.oursRevisionId),
    alreadyUpToDate: oursAncestors.has(input.theirsRevisionId),
  };
}

export function resolveMergePlan<TSnapshot>(
  plan: ThreeWayMergePlan<TSnapshot>,
  resolutions: MergeResolutionMap,
): MergeResult<TSnapshot> {
  let snapshot = clone(plan.autoMerged);
  const appliedResolutions: string[] = [];
  const unresolved: MergeConflict[] = [];
  for (const conflict of plan.conflicts) {
    const resolution = resolutions[conflict.id];
    if (!resolution) {
      unresolved.push(conflict);
      continue;
    }
    let value: unknown;
    switch (resolution.strategy) {
      case 'ours': value = conflict.oursValue; break;
      case 'theirs': value = conflict.theirsValue; break;
      case 'base': value = conflict.baseValue; break;
      case 'manual': value = resolution.value; break;
    }
    snapshot = value === undefined
      ? removeAtPath(snapshot, conflict.path)
      : setAtPath(snapshot, conflict.path, value);
    appliedResolutions.push(conflict.id);
  }
  return { snapshot, unresolved, appliedResolutions };
}

export function splitRevisionDescription(value: string, maxTitleLength = 72): {
  title: string;
  description: string;
} {
  const normalized = value.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
  const [first = '', ...rest] = normalized.split('\n');
  const title = first.length <= maxTitleLength
    ? first
    : `${first.slice(0, Math.max(1, maxTitleLength - 1)).trimEnd()}…`;
  return { title, description: rest.join('\n').trim() };
}

export class VersionControlService<TSnapshot = KyxosSceneContract> extends EventTarget {
  private repository: VersionRepository<TSnapshot> | null = null;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly adapter: VersionControlAdapter<TSnapshot>) {
    super();
  }

  get state(): VersionRepository<TSnapshot> | null {
    return this.repository ? clone(this.repository) : null;
  }

  async load(): Promise<VersionRepository<TSnapshot>> {
    return this.run('load', 'Loading version history…', async () => {
      const repository = await this.adapter.loadRepository();
      const errors = validateVersionRepository(repository).filter((issue) => issue.severity === 'error');
      if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));
      this.repository = clone(repository);
      return this.state!;
    });
  }

  async createBranch(name: string, fromRevisionId?: string | null): Promise<VersionBranch> {
    return this.run('create-branch', 'Creating branch…', async () => {
      const repository = this.requireRepository();
      const normalized = cleanBranchName(name);
      if (repository.branches.some((branch) => branch.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) throw new Error('Branch name already exists.');
      const current = repository.branches.find((branch) => branch.id === repository.currentBranchId)!;
      const branch = await this.adapter.createBranch({ name: normalized, fromRevisionId: fromRevisionId ?? current.headRevisionId });
      repository.branches.push(clone(branch));
      return clone(branch);
    });
  }

  async renameBranch(branchId: string, name: string): Promise<VersionBranch> {
    return this.run('create-branch', 'Renaming branch…', async () => {
      const repository = this.requireRepository();
      const branch = repository.branches.find((entry) => entry.id === branchId);
      if (!branch) throw new Error('Branch not found.');
      if (branch.protected) throw new Error('Protected branches cannot be renamed.');
      const normalized = cleanBranchName(name);
      if (repository.branches.some((entry) => entry.id !== branchId && entry.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) throw new Error('Branch name already exists.');
      const updated = await this.adapter.renameBranch(branchId, normalized);
      Object.assign(branch, clone(updated));
      return clone(branch);
    });
  }

  async deleteBranch(branchId: string): Promise<void> {
    await this.run('delete-branch', 'Deleting branch…', async () => {
      const repository = this.requireRepository();
      const branch = repository.branches.find((entry) => entry.id === branchId);
      if (!branch) throw new Error('Branch not found.');
      if (branch.id === repository.currentBranchId) throw new Error('Current branch cannot be deleted.');
      if (branch.protected) throw new Error('Protected branch cannot be deleted.');
      await this.adapter.deleteBranch(branchId);
      repository.branches = repository.branches.filter((entry) => entry.id !== branchId);
    });
  }

  async checkout(branchId: string): Promise<TSnapshot> {
    return this.run('checkout', 'Checking out branch…', async () => {
      const repository = this.requireRepository();
      const branch = repository.branches.find((entry) => entry.id === branchId);
      if (!branch) throw new Error('Branch not found.');
      if (!branch.headRevisionId) throw new Error('Branch has no checkpoint to check out.');
      const snapshot = await this.adapter.loadSnapshot(branch.headRevisionId);
      repository.currentBranchId = branchId;
      return clone(snapshot);
    });
  }

  async checkpoint(input: {
    message: string;
    description?: string;
    snapshot: TSnapshot;
    snapshotDigest: string;
  }): Promise<VersionRevision<TSnapshot>> {
    return this.run('checkpoint', 'Creating checkpoint…', async () => {
      const repository = this.requireRepository();
      const branch = repository.branches.find((entry) => entry.id === repository.currentBranchId)!;
      const message = input.message.normalize('NFKC').trim().slice(0, 200);
      if (!message) throw new Error('Checkpoint message is required.');
      const revision = await this.adapter.createCheckpoint({
        branchId: branch.id,
        parentRevisionIds: branch.headRevisionId ? [branch.headRevisionId] : [],
        message,
        description: input.description?.trim() || undefined,
        snapshot: clone(input.snapshot),
        snapshotDigest: input.snapshotDigest,
      });
      repository.revisions.push(clone(revision));
      branch.headRevisionId = revision.id;
      branch.updatedAt = revision.createdAt;
      return clone(revision);
    });
  }

  async merge(input: {
    sourceBranchId: string;
    resolutions?: MergeResolutionMap;
    message?: string;
    digest(snapshot: TSnapshot): Promise<string> | string;
  }): Promise<{ revision: VersionRevision<TSnapshot> | null; plan: ThreeWayMergePlan<TSnapshot>; result: MergeResult<TSnapshot> }> {
    return this.run('merge', 'Preparing merge…', async (report) => {
      const repository = this.requireRepository();
      const target = repository.branches.find((branch) => branch.id === repository.currentBranchId)!;
      const source = repository.branches.find((branch) => branch.id === input.sourceBranchId);
      if (!source || !source.headRevisionId || !target.headRevisionId) throw new Error('Both branches need a checkpoint before merging.');
      const baseId = findMergeBase(repository, target.headRevisionId, source.headRevisionId);
      if (!baseId) throw new Error('Branches do not share a common ancestor.');
      report(0.2, 'Loading merge snapshots…');
      const [baseSnapshot, oursSnapshot, theirsSnapshot] = await Promise.all([
        this.adapter.loadSnapshot(baseId),
        this.adapter.loadSnapshot(target.headRevisionId),
        this.adapter.loadSnapshot(source.headRevisionId),
      ]);
      const plan = planThreeWayMerge({
        repository,
        oursRevisionId: target.headRevisionId,
        theirsRevisionId: source.headRevisionId,
        baseSnapshot,
        oursSnapshot,
        theirsSnapshot,
      });
      const result = resolveMergePlan(plan, input.resolutions ?? {});
      if (result.unresolved.length) return { revision: null, plan, result };
      if (plan.alreadyUpToDate) return { revision: null, plan, result };
      if (plan.canFastForward) {
        await this.adapter.moveBranchHead(target.id, source.headRevisionId);
        target.headRevisionId = source.headRevisionId;
        target.updatedAt = source.updatedAt;
        return { revision: null, plan, result };
      }
      report(0.7, 'Creating merge checkpoint…');
      const digest = await input.digest(result.snapshot);
      const revision = await this.adapter.createCheckpoint({
        branchId: target.id,
        parentRevisionIds: [target.headRevisionId, source.headRevisionId],
        message: input.message?.trim() || `Merge ${source.name} into ${target.name}`,
        snapshot: result.snapshot,
        snapshotDigest: digest,
      });
      repository.revisions.push(clone(revision));
      target.headRevisionId = revision.id;
      target.updatedAt = revision.createdAt;
      return { revision: clone(revision), plan, result };
    });
  }

  private requireRepository(): VersionRepository<TSnapshot> {
    if (!this.repository) throw new Error('Version repository has not been loaded.');
    return this.repository;
  }

  private async run<T>(
    operation: VersionControlProgress['operation'],
    message: string,
    work: (report: (progress: number, message: string) => void) => Promise<T>,
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      const report = (progress: number, nextMessage: string) => this.dispatchEvent(new CustomEvent<VersionControlProgress>('progress', { detail: { operation, status: 'running', progress: Math.max(0, Math.min(1, progress)), message: nextMessage } }));
      report(0, message);
      try {
        const result = await work(report);
        this.dispatchEvent(new CustomEvent<VersionControlProgress>('progress', { detail: { operation, status: 'completed', progress: 1, message: `${message.replace(/…$/, '')} complete.` } }));
        this.dispatchEvent(new CustomEvent('change', { detail: { operation, repository: this.state } }));
        return result;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.dispatchEvent(new CustomEvent<VersionControlProgress>('progress', { detail: { operation, status: 'failed', progress: 1, message: `${message.replace(/…$/, '')} failed.`, error: reason } }));
        throw error;
      }
    };
    const result = this.operation.then(execute, execute);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }
}
