import { describe, expect, it, vi } from 'vitest';
import {
  VersionControlService,
  assertVerticalConsistency,
  calculateAheadBehind,
  compactVersionBranches,
  diffSnapshots,
  findMergeBase,
  layoutVersionGraph,
  planThreeWayMerge,
  resolveMergePlan,
  splitRevisionDescription,
  validateVersionRepository,
  type MergeResolutionMap,
  type VersionBranch,
  type VersionControlAdapter,
  type VersionRepository,
  type VersionRevision,
} from '../../packages/editor-core/src/version-control';

type Snapshot = {
  metadata: { name: string };
  settings: { exposure: number; toneMapping: string };
  nodes: Array<{ id: string; name: string; visible: boolean }>;
  tags?: string[];
};

const author = { id: 'user-1', name: 'Kai' };

function revision(id: string, parentIds: string[], createdAt: string, snapshotDigest = `digest-${id}`): VersionRevision<Snapshot> {
  return { id, parentIds, message: `Revision ${id}`, author, createdAt, snapshotDigest };
}

function branch(id: string, headRevisionId: string | null, options: Partial<VersionBranch> = {}): VersionBranch {
  return {
    id,
    name: id,
    headRevisionId,
    baseRevisionId: 'r0',
    protected: id === 'main',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    createdBy: 'user-1',
    ...options,
  };
}

function divergentRepository(): VersionRepository<Snapshot> {
  return {
    revisions: [
      revision('r0', [], '2026-08-01T00:00:00.000Z'),
      revision('r1', ['r0'], '2026-08-01T01:00:00.000Z'),
      revision('main-2', ['r1'], '2026-08-02T01:00:00.000Z'),
      revision('feature-2', ['r1'], '2026-08-02T02:00:00.000Z'),
    ],
    branches: [branch('main', 'main-2'), branch('feature', 'feature-2', { protected: false })],
    currentBranchId: 'main',
  };
}

function mergeRepository(): VersionRepository<Snapshot> {
  const repository = divergentRepository();
  repository.revisions.push(revision('merge-3', ['main-2', 'feature-2'], '2026-08-03T00:00:00.000Z'));
  repository.branches[0].headRevisionId = 'merge-3';
  repository.branches.push(branch('release', 'merge-3', { protected: false, updatedAt: '2026-08-02T00:00:00.000Z' }));
  repository.branches.push(branch('stale', 'feature-2', { protected: false, updatedAt: '2026-08-01T00:00:00.000Z' }));
  repository.remoteHeads = { feature: 'feature-2' };
  return repository;
}

function baseSnapshot(): Snapshot {
  return {
    metadata: { name: 'Demo' },
    settings: { exposure: 1, toneMapping: 'AgX' },
    nodes: [{ id: 'root', name: 'Root', visible: true }],
    tags: ['base'],
  };
}

describe('Version repository validation', () => {
  it('accepts a valid DAG and reports independent malformed graph cases', () => {
    expect(validateVersionRepository(divergentRepository())).toEqual([]);
    const invalid = divergentRepository();
    invalid.revisions.push(revision('main-2', [], 'invalid'));
    invalid.revisions.push(revision('self', ['self'], '2026-08-03T01:00:00.000Z'));
    invalid.revisions.push(revision('missing-parent', ['missing'], '2026-08-03T02:00:00.000Z'));
    invalid.revisions.find((entry) => entry.id === 'r0')!.parentIds = ['main-2'];
    invalid.branches.push({ ...branch('main', 'missing'), name: 'MAIN' });
    invalid.currentBranchId = 'missing-current';
    invalid.remoteHeads = { ghost: 'missing-remote' };
    expect(validateVersionRepository(invalid).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'revision.duplicate-id',
      'revision.parent-self',
      'revision.parent-missing',
      'revision.timestamp-invalid',
      'revision.cycle',
      'branch.duplicate-id',
      'branch.duplicate-name',
      'branch.head-missing',
      'branch.current-missing',
      'remote.head-missing',
    ]));
  });
});

describe('Version graph algorithms', () => {
  it('finds merge bases and deterministic ahead/behind sets', () => {
    const repository = divergentRepository();
    expect(findMergeBase(repository, 'main-2', 'feature-2')).toBe('r1');
    expect(calculateAheadBehind(repository, 'main', 'feature')).toEqual({
      branchId: 'main',
      compareBranchId: 'feature',
      ahead: 1,
      behind: 1,
      commonAncestorId: 'r1',
      aheadRevisionIds: ['main-2'],
      behindRevisionIds: ['feature-2'],
    });
  });

  it('lays out merges in stable lanes and preserves vertical consistency', () => {
    const repository = mergeRepository();
    const first = layoutVersionGraph(repository, { compact: false });
    expect(first).toEqual(layoutVersionGraph(structuredClone(repository), { compact: false }));
    expect(first.nodes.map((node) => node.revision.id)).toEqual(['merge-3', 'feature-2', 'main-2', 'r1', 'r0']);
    expect(first.nodes.find((node) => node.revision.id === 'merge-3')).toMatchObject({
      isMerge: true,
      branchIds: ['main', 'release'],
      isCurrentHead: true,
    });
    expect(first.edges.filter((edge) => edge.fromRevisionId === 'merge-3')).toHaveLength(2);
    expect(() => assertVerticalConsistency(first)).not.toThrow();
    expect(first.laneCount).toBeGreaterThanOrEqual(2);
  });

  it('compacts duplicate and stale branch labels while retaining current/protected/remote branches', () => {
    const repository = mergeRepository();
    const compacted = compactVersionBranches(repository);
    expect(compacted.visibleBranchIds).toEqual(expect.arrayContaining(['main', 'feature']));
    expect(compacted.hiddenBranchIds).toEqual(expect.arrayContaining(['release', 'stale']));
    const layout = layoutVersionGraph(repository, { compact: true });
    expect(layout.hiddenBranchIds).toEqual(expect.arrayContaining(['release', 'stale']));
    expect(layout.nodes.find((node) => node.revision.id === 'merge-3')?.branchIds).toEqual(['main']);
  });

  it('rejects inconsistent edges and cyclic histories', () => {
    const layout = layoutVersionGraph(divergentRepository(), { compact: false });
    layout.edges[0].toRow = layout.edges[0].fromRow;
    expect(() => assertVerticalConsistency(layout)).toThrow(/coordinates are inconsistent|must be below/);
    const cyclic = divergentRepository();
    cyclic.revisions.find((entry) => entry.id === 'r0')!.parentIds = ['main-2'];
    expect(() => layoutVersionGraph(cyclic)).toThrow(/cycle/i);
  });
});

describe('Structured revision diffs', () => {
  it('produces deterministic operations and section summaries', () => {
    const base = baseSnapshot();
    const target: Snapshot = {
      ...structuredClone(base),
      settings: { exposure: 2, toneMapping: 'AgX' },
      nodes: [
        { id: 'root', name: 'Renamed', visible: true },
        { id: 'child', name: 'Child', visible: false },
      ],
      tags: undefined,
    };
    const diff = diffSnapshots(base, target);
    expect(diff).toMatchObject({ added: 1, removed: 1, changed: 2 });
    expect(diff.changedPaths).toEqual(['/nodes/0/name', '/nodes/1', '/settings/exposure', '/tags']);
    expect(diff.topLevelSections).toEqual({ nodes: 2, settings: 1, tags: 1 });
  });

  it('splits and bounds revision descriptions', () => {
    expect(splitRevisionDescription('Fix scene import\nPreserve matrices\nKeep materials', 20)).toEqual({
      title: 'Fix scene import',
      description: 'Preserve matrices\nKeep materials',
    });
    expect(splitRevisionDescription('This title is intentionally much too long', 16).title).toBe('This title is i…');
  });
});

describe('Three-way merge planning', () => {
  it('auto-merges independent changes and resolves one value conflict', () => {
    const repository = divergentRepository();
    const base = baseSnapshot();
    const ours = structuredClone(base);
    ours.settings.exposure = 2;
    ours.nodes[0].name = 'Local Root';
    const theirs = structuredClone(base);
    theirs.settings.toneMapping = 'Filmic';
    theirs.nodes[0].name = 'Remote Root';
    const plan = planThreeWayMerge({
      repository,
      oursRevisionId: 'main-2',
      theirsRevisionId: 'feature-2',
      baseSnapshot: base,
      oursSnapshot: ours,
      theirsSnapshot: theirs,
    });
    expect(plan.baseRevisionId).toBe('r1');
    expect(plan.autoMerged).toMatchObject({ settings: { exposure: 2, toneMapping: 'Filmic' }, nodes: [{ name: 'Local Root' }] });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ path: '/nodes/0/name', kind: 'modify-modify', baseValue: 'Root', oursValue: 'Local Root', theirsValue: 'Remote Root' });
    const conflict = plan.conflicts[0];
    expect(resolveMergePlan(plan, {}).unresolved).toHaveLength(1);
    expect(resolveMergePlan(plan, { [conflict.id]: { strategy: 'theirs' } }).snapshot.nodes[0].name).toBe('Remote Root');
    expect(resolveMergePlan(plan, { [conflict.id]: { strategy: 'base' } }).snapshot.nodes[0].name).toBe('Root');
    expect(resolveMergePlan(plan, { [conflict.id]: { strategy: 'manual', value: 'Combined' } }).snapshot.nodes[0].name).toBe('Combined');
  });

  it('detects delete/modify, array-order, fast-forward and up-to-date states', () => {
    const repository = divergentRepository();
    const base = baseSnapshot();
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.tags = undefined;
    theirs.tags = ['base', 'remote'];
    base.nodes.push({ id: 'b', name: 'B', visible: true }, { id: 'c', name: 'C', visible: true });
    ours.nodes = [base.nodes[0], base.nodes[2], base.nodes[1]];
    theirs.nodes = [base.nodes[1], base.nodes[0], base.nodes[2]];
    const conflicted = planThreeWayMerge({ repository, oursRevisionId: 'main-2', theirsRevisionId: 'feature-2', baseSnapshot: base, oursSnapshot: ours, theirsSnapshot: theirs });
    expect(conflicted.conflicts.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['delete-modify', 'array-order']));

    const history = mergeRepository();
    const snapshot = baseSnapshot();
    expect(planThreeWayMerge({ repository: history, oursRevisionId: 'r1', theirsRevisionId: 'main-2', baseSnapshot: snapshot, oursSnapshot: snapshot, theirsSnapshot: snapshot }).canFastForward).toBe(true);
    expect(planThreeWayMerge({ repository: history, oursRevisionId: 'merge-3', theirsRevisionId: 'feature-2', baseSnapshot: snapshot, oursSnapshot: snapshot, theirsSnapshot: snapshot }).alreadyUpToDate).toBe(true);
  });
});

class MemoryVersionAdapter implements VersionControlAdapter<Snapshot> {
  readonly repository: VersionRepository<Snapshot>;
  readonly snapshots = new Map<string, Snapshot>();
  readonly calls: string[] = [];
  private counter = 0;

  constructor(repository: VersionRepository<Snapshot>, snapshots: Record<string, Snapshot>) {
    this.repository = structuredClone(repository);
    for (const [id, snapshot] of Object.entries(snapshots)) this.snapshots.set(id, structuredClone(snapshot));
  }

  async loadRepository(): Promise<VersionRepository<Snapshot>> { this.calls.push('load'); return structuredClone(this.repository); }
  async loadSnapshot(revisionId: string): Promise<Snapshot> {
    this.calls.push(`snapshot:${revisionId}`);
    const snapshot = this.snapshots.get(revisionId);
    if (!snapshot) throw new Error(`Snapshot ${revisionId} is missing.`);
    return structuredClone(snapshot);
  }
  async createBranch(input: { name: string; fromRevisionId: string | null }): Promise<VersionBranch> {
    this.calls.push(`branch:${input.name}`);
    const created = branch(`branch-${++this.counter}`, input.fromRevisionId, { name: input.name, baseRevisionId: input.fromRevisionId, protected: false });
    this.repository.branches.push(structuredClone(created));
    return created;
  }
  async renameBranch(branchId: string, name: string): Promise<VersionBranch> {
    this.calls.push(`rename:${branchId}:${name}`);
    const target = this.repository.branches.find((entry) => entry.id === branchId)!;
    target.name = name;
    return structuredClone(target);
  }
  async deleteBranch(branchId: string): Promise<void> {
    this.calls.push(`delete:${branchId}`);
    this.repository.branches = this.repository.branches.filter((entry) => entry.id !== branchId);
  }
  async createCheckpoint(input: { branchId: string; parentRevisionIds: string[]; message: string; description?: string; snapshot: Snapshot; snapshotDigest: string }): Promise<VersionRevision<Snapshot>> {
    this.calls.push(`checkpoint:${input.branchId}`);
    const id = `new-${++this.counter}`;
    const created = revision(id, input.parentRevisionIds, `2026-08-03T0${this.counter}:00:00.000Z`, input.snapshotDigest);
    created.message = input.message;
    created.description = input.description;
    this.repository.revisions.push(structuredClone(created));
    this.repository.branches.find((entry) => entry.id === input.branchId)!.headRevisionId = id;
    this.snapshots.set(id, structuredClone(input.snapshot));
    return created;
  }
  async moveBranchHead(branchId: string, revisionId: string | null): Promise<VersionBranch> {
    this.calls.push(`move:${branchId}:${revisionId}`);
    const target = this.repository.branches.find((entry) => entry.id === branchId)!;
    target.headRevisionId = revisionId;
    return structuredClone(target);
  }
}

describe('Version control adapter service', () => {
  it('serializes branch lifecycle, checkpoint and checkout operations', async () => {
    const base = baseSnapshot();
    const adapter = new MemoryVersionAdapter(divergentRepository(), {
      r0: base,
      r1: base,
      'main-2': { ...structuredClone(base), settings: { exposure: 2, toneMapping: 'AgX' } },
      'feature-2': { ...structuredClone(base), settings: { exposure: 1, toneMapping: 'Filmic' } },
    });
    const service = new VersionControlService(adapter);
    const progress = vi.fn();
    service.addEventListener('progress', progress);
    await service.load();
    const created = await service.createBranch('  review branch  ');
    expect(created.name).toBe('review-branch');
    expect((await service.renameBranch(created.id, 'review/final')).name).toBe('review/final');
    const snapshot = baseSnapshot();
    snapshot.metadata.name = 'Checkpoint';
    const checkpoint = await service.checkpoint({ message: 'Save work', snapshot, snapshotDigest: 'digest-new' });
    expect(service.state?.branches.find((entry) => entry.id === 'main')?.headRevisionId).toBe(checkpoint.id);
    expect(await service.checkout('feature')).toMatchObject({ settings: { toneMapping: 'Filmic' } });
    await service.deleteBranch(created.id);
    expect(service.state?.branches.some((entry) => entry.id === created.id)).toBe(false);
    expect(progress).toHaveBeenCalled();
  });

  it('creates a two-parent checkpoint after explicit conflict resolution', async () => {
    const base = baseSnapshot();
    const ours = structuredClone(base);
    ours.settings.exposure = 2;
    ours.nodes[0].name = 'Ours';
    const theirs = structuredClone(base);
    theirs.settings.toneMapping = 'Filmic';
    theirs.nodes[0].name = 'Theirs';
    const adapter = new MemoryVersionAdapter(divergentRepository(), { r0: base, r1: base, 'main-2': ours, 'feature-2': theirs });
    const service = new VersionControlService(adapter);
    await service.load();
    const preview = await service.merge({ sourceBranchId: 'feature', digest: () => 'ignored' });
    expect(preview.revision).toBeNull();
    expect(preview.result.unresolved).toHaveLength(1);
    const conflict = preview.plan.conflicts[0];
    const resolutions: MergeResolutionMap = { [conflict.id]: { strategy: 'manual', value: 'Merged Root' } };
    const merged = await service.merge({ sourceBranchId: 'feature', resolutions, message: 'Merge feature', digest: () => 'digest-merge' });
    expect(merged.revision).toMatchObject({ parentIds: ['main-2', 'feature-2'], message: 'Merge feature', snapshotDigest: 'digest-merge' });
    expect(merged.result.snapshot).toMatchObject({ settings: { exposure: 2, toneMapping: 'Filmic' }, nodes: [{ name: 'Merged Root' }] });
  });

  it('fast-forwards and protects current/protected branches', async () => {
    const repository: VersionRepository<Snapshot> = {
      revisions: [revision('r0', [], '2026-08-01T00:00:00.000Z'), revision('r1', ['r0'], '2026-08-02T00:00:00.000Z')],
      branches: [branch('main', 'r0'), branch('feature', 'r1', { protected: false })],
      currentBranchId: 'main',
    };
    const base = baseSnapshot();
    const feature = structuredClone(base);
    feature.settings.exposure = 2;
    const adapter = new MemoryVersionAdapter(repository, { r0: base, r1: feature });
    const service = new VersionControlService(adapter);
    await service.load();
    const merged = await service.merge({ sourceBranchId: 'feature', digest: () => 'unused' });
    expect(merged.plan.canFastForward).toBe(true);
    expect(merged.revision).toBeNull();
    expect(service.state?.branches.find((entry) => entry.id === 'main')?.headRevisionId).toBe('r1');
    expect(adapter.calls).toContain('move:main:r1');
    await expect(service.deleteBranch('main')).rejects.toThrow(/Current branch/);
    await expect(service.renameBranch('main', 'renamed')).rejects.toThrow(/Protected/);
    await expect(service.createBranch('main')).rejects.toThrow(/already exists/);
  });
});
