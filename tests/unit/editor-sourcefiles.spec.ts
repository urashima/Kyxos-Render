import { describe, expect, it, vi } from 'vitest';
import {
  SourceRepositoryService,
  buildSourceDependencyGraph,
  diagnoseSourceFile,
  extractSourceReferences,
  inferSourceLanguage,
  inferSourceMimeType,
  normalizeSourcePath,
  planSourceMerge,
  resolveSourceMerge,
  validateSourceRepository,
  type SourceRepositoryAdapter,
  type SourceRepositoryEntry,
  type SourceRepositorySnapshot,
} from '../../packages/editor-core/src/sourcefiles';

function entry(
  id: string,
  kind: 'file' | 'folder',
  name: string,
  path: string,
  parentId: string | null,
  options: Partial<SourceRepositoryEntry> = {},
): SourceRepositoryEntry {
  return {
    id,
    kind,
    name,
    path,
    parentId,
    contentHash: kind === 'file' ? `hash-${id}` : undefined,
    byteSize: kind === 'file' ? 1 : undefined,
    mimeType: kind === 'file' ? inferSourceMimeType(path) : undefined,
    language: kind === 'file' ? inferSourceLanguage(path) : undefined,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...options,
  };
}

function snapshot(): SourceRepositorySnapshot {
  return {
    repositoryId: 'repo',
    branchId: 'main',
    revision: '1',
    entries: [
      entry('src', 'folder', 'src', '/src', null),
      entry('components', 'folder', 'components', '/src/components', 'src'),
      entry('main', 'file', 'main.ts', '/src/main.ts', 'src'),
      entry('helper', 'file', 'helper.ts', '/src/helper.ts', 'src'),
      entry('widget', 'file', 'widget.ts', '/src/components/widget.ts', 'components'),
      entry('style', 'file', 'style.css', '/src/style.css', 'src'),
      entry('index', 'file', 'index.html', '/index.html', null),
      entry('config', 'file', 'config.json', '/config.json', null),
      entry('readonly', 'file', 'locked.ts', '/locked.ts', null, { readonly: true }),
    ],
  };
}

class MemorySourceAdapter implements SourceRepositoryAdapter {
  state: SourceRepositorySnapshot;
  readonly contents = new Map<string, { content: string; hash: string }>();
  readonly calls: string[] = [];
  failNextWrite = false;
  private counter = 0;

  constructor(initial = snapshot()) {
    this.state = structuredClone(initial);
    this.contents.set('main', { content: "import { helper } from './helper';\nexport const main = helper();\n", hash: 'hash-main' });
    this.contents.set('helper', { content: "export const helper = () => 'ok';\n", hash: 'hash-helper' });
    this.contents.set('widget', { content: "import { helper } from '../helper';\nexport const widget = helper();\n", hash: 'hash-widget' });
    this.contents.set('style', { content: "@import './missing.css';\n.hero { background: url('./hero.png'); }\n", hash: 'hash-style' });
    this.contents.set('index', { content: '<script src="./src/main.ts"></script>\n<link href="./src/style.css">\n', hash: 'hash-index' });
    this.contents.set('config', { content: '{"enabled":true}\n', hash: 'hash-config' });
    this.contents.set('readonly', { content: 'export const locked = true;\n', hash: 'hash-readonly' });
  }

  async load(repositoryId: string, branchId: string): Promise<SourceRepositorySnapshot> {
    this.calls.push(`load:${repositoryId}:${branchId}`);
    return structuredClone(this.state);
  }

  async read(entryId: string) {
    this.calls.push(`read:${entryId}`);
    const content = this.contents.get(entryId);
    const target = this.state.entries.find((candidate) => candidate.id === entryId);
    if (!content || !target) throw new Error('File not found.');
    return { content: content.content, contentHash: content.hash, entry: structuredClone(target) };
  }

  async write(input: { entryId: string; content: string; expectedContentHash: string }) {
    this.calls.push(`write:${input.entryId}`);
    const current = this.contents.get(input.entryId);
    const target = this.state.entries.find((candidate) => candidate.id === input.entryId)!;
    if (!current || current.hash !== input.expectedContentHash || this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Optimistic write conflict.');
    }
    const hash = `hash-${input.entryId}-${++this.counter}`;
    this.contents.set(input.entryId, { content: input.content, hash });
    target.contentHash = hash;
    target.byteSize = new TextEncoder().encode(input.content).byteLength;
    target.updatedAt = `2026-08-03T00:0${this.counter}:00.000Z`;
    return { entry: structuredClone(target), contentHash: hash, byteSize: target.byteSize };
  }

  async create(input: { kind: 'file' | 'folder'; parentId: string | null; name: string; content?: string; mimeType?: string; language?: string }) {
    this.calls.push(`create:${input.kind}:${input.name}`);
    const parent = input.parentId ? this.state.entries.find((candidate) => candidate.id === input.parentId) : null;
    const id = `new-${++this.counter}`;
    const path = normalizeSourcePath(`${parent?.path ?? '/'}/${input.name}`);
    const created = entry(id, input.kind, input.name, path, input.parentId, {
      mimeType: input.mimeType,
      language: input.language,
      contentHash: input.kind === 'file' ? `hash-${id}` : undefined,
      byteSize: input.kind === 'file' ? new TextEncoder().encode(input.content ?? '').byteLength : undefined,
    });
    this.state.entries.push(structuredClone(created));
    if (input.kind === 'file') this.contents.set(id, { content: input.content ?? '', hash: `hash-${id}` });
    return created;
  }

  async move(input: { entryId: string; parentId: string | null; name: string }): Promise<SourceRepositoryEntry[]> {
    this.calls.push(`move:${input.entryId}:${input.name}`);
    const target = this.state.entries.find((candidate) => candidate.id === input.entryId)!;
    const oldPath = target.path;
    const parent = input.parentId ? this.state.entries.find((candidate) => candidate.id === input.parentId) : null;
    const nextPath = normalizeSourcePath(`${parent?.path ?? '/'}/${input.name}`);
    target.name = input.name;
    target.parentId = input.parentId;
    target.path = nextPath;
    const updated = [target];
    if (target.kind === 'folder') {
      const prefix = `${oldPath}/`;
      for (const candidate of this.state.entries) {
        if (candidate.id === target.id || !candidate.path.startsWith(prefix)) continue;
        candidate.path = `${nextPath}${candidate.path.slice(oldPath.length)}`;
        updated.push(candidate);
      }
    }
    return structuredClone(updated);
  }

  async remove(entryId: string): Promise<string[]> {
    this.calls.push(`remove:${entryId}`);
    const target = this.state.entries.find((candidate) => candidate.id === entryId)!;
    const ids = this.state.entries
      .filter((candidate) => candidate.id === entryId || candidate.path.startsWith(`${target.path}/`))
      .map((candidate) => candidate.id);
    this.state.entries = this.state.entries.filter((candidate) => !ids.includes(candidate.id));
    for (const id of ids) this.contents.delete(id);
    return ids;
  }

  remoteEdit(entryId: string, content: string): void {
    const hash = `remote-${++this.counter}`;
    this.contents.set(entryId, { content, hash });
    const target = this.state.entries.find((candidate) => candidate.id === entryId)!;
    target.contentHash = hash;
  }
}

describe('Repository path and schema validation', () => {
  it('normalizes paths, languages and MIME types', () => {
    expect(normalizeSourcePath('/src/../src\\components/./widget.ts')).toBe('/src/components/widget.ts');
    expect(inferSourceLanguage('/src/main.ts')).toBe('typescript');
    expect(inferSourceLanguage('/scene.wgsl')).toBe('shader');
    expect(inferSourceMimeType('/index.html')).toBe('text/html');
    expect(inferSourceMimeType('/config.json')).toBe('application/json');
  });

  it('detects duplicate IDs/paths, invalid parents, mismatches and cycles', () => {
    expect(validateSourceRepository(snapshot())).toEqual([]);
    const invalid = snapshot();
    invalid.entries.push(entry('main', 'file', 'MAIN.ts', '/SRC/MAIN.ts', 'missing'));
    invalid.entries.find((candidate) => candidate.id === 'src')!.parentId = 'components';
    invalid.entries.find((candidate) => candidate.id === 'helper')!.path = '/wrong/helper.ts';
    const codes = validateSourceRepository(invalid).map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(expect.arrayContaining([
      'repository.duplicate-id',
      'repository.duplicate-path',
      'repository.parent-missing',
      'repository.path-mismatch',
      'repository.hierarchy-cycle',
    ]));
  });
});

describe('References and diagnostics', () => {
  it('extracts TypeScript, CSS and HTML references with resolved locations', () => {
    const paths = new Set(['/src/main.ts', '/src/helper.ts', '/src/style.css', '/index.html']);
    expect(extractSourceReferences('/src/main.ts', "import x from './helper';\nconst y = import('./lazy');\n", 'typescript', paths)).toMatchObject([
      { specifier: './helper', resolvedPath: '/src/helper.ts', kind: 'import', line: 1 },
      { specifier: './lazy', resolvedPath: null, kind: 'dynamic-import', line: 2 },
    ]);
    expect(extractSourceReferences('/src/style.css', "@import './base.css'; .x{background:url('./x.png')}", 'css', paths).map((entry) => entry.kind)).toEqual(['import', 'url']);
    expect(extractSourceReferences('/index.html', '<script src="./src/main.ts"></script><link href="./src/style.css">', 'html', paths).map((entry) => entry.resolvedPath)).toEqual(['/src/main.ts', '/src/style.css']);
  });

  it('builds dependencies, reverse dependencies, missing references and cycles', () => {
    const files = [
      { entry: entry('a', 'file', 'a.ts', '/a.ts', null), content: "import './b';" },
      { entry: entry('b', 'file', 'b.ts', '/b.ts', null), content: "import './c';" },
      { entry: entry('c', 'file', 'c.ts', '/c.ts', null), content: "import './a'; import './missing';" },
    ];
    const graph = buildSourceDependencyGraph(files);
    expect(graph.dependencies['/a.ts']).toEqual(['/b.ts']);
    expect(graph.dependents['/a.ts']).toEqual(['/c.ts']);
    expect(graph.missing.map((reference) => reference.specifier)).toEqual(['./missing']);
    expect(graph.cycles).toHaveLength(1);
  });

  it('diagnoses JSON, brackets, references, whitespace and long lines', () => {
    const paths = new Set(['/main.ts']);
    const json = diagnoseSourceFile(entry('json', 'file', 'bad.json', '/bad.json', null), '{');
    expect(json.map((diagnostic) => diagnostic.code)).toContain('source.json-invalid');
    const source = diagnoseSourceFile(
      entry('main', 'file', 'main.ts', '/main.ts', null),
      "import './missing';\nexport const x = {\nconst long = '" + 'x'.repeat(170) + "';   ",
      paths,
    );
    expect(source.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'source.bracket-unclosed',
      'source.reference-missing',
      'source.trailing-whitespace',
      'source.line-too-long',
    ]));
  });
});

describe('Source text merge', () => {
  it('auto-merges independent line changes and resolves overlapping lines', () => {
    const independent = planSourceMerge('a\nb\nc', 'A\nb\nc', 'a\nb\nC');
    expect(independent).toMatchObject({ mergedText: 'A\nb\nC', conflicts: [] });
    const conflicted = planSourceMerge('a\nb', 'ours\nb', 'theirs\nb');
    expect(conflicted.conflicts).toHaveLength(1);
    expect(resolveSourceMerge(conflicted, {}).unresolved).toHaveLength(1);
    expect(resolveSourceMerge(conflicted, { 'line:1': { strategy: 'theirs' } })).toEqual({ text: 'theirs\nb', unresolved: [] });
    expect(resolveSourceMerge(conflicted, { 'line:1': { strategy: 'manual', value: 'combined' } })).toEqual({ text: 'combined\nb', unresolved: [] });
  });
});

describe('Source repository service', () => {
  it('manages preview/pinned tabs, edits, saves, reverts and read-only files', async () => {
    const adapter = new MemorySourceAdapter();
    const service = new SourceRepositoryService(adapter);
    const progress = vi.fn();
    service.addEventListener('progress', progress);
    await service.load('repo', 'main');
    await service.open('main');
    expect(service.openTabs).toMatchObject([{ entryId: 'main', preview: true, active: true }]);
    await service.open('helper');
    expect(service.openTabs.map((tab) => tab.entryId)).toEqual(['helper']);
    service.pin('helper');
    await service.open('main');
    expect(service.openTabs.map((tab) => tab.entryId)).toEqual(['helper', 'main']);

    service.edit('main', "export const changed = true;\n");
    expect(service.dirtyEntryIds).toEqual(['main']);
    expect(() => service.close('main')).toThrow(/unsaved/);
    await service.save('main');
    expect(service.getDraft('main')).toMatchObject({ dirty: false, stale: false, content: "export const changed = true;\n" });
    service.edit('main', 'temporary');
    service.revert('main');
    expect(service.getDraft('main')?.content).toBe("export const changed = true;\n");

    await service.open('readonly', { pinned: true });
    expect(() => service.edit('readonly', 'changed')).toThrow(/read only/);
    expect(progress).toHaveBeenCalled();
  });

  it('detects remote save conflicts and applies line resolutions before retrying', async () => {
    const adapter = new MemorySourceAdapter();
    const service = new SourceRepositoryService(adapter);
    await service.load('repo', 'main');
    await service.open('helper', { pinned: true });
    service.edit('helper', "export const helper = () => 'ours';\n");
    adapter.remoteEdit('helper', "export const helper = () => 'theirs';\n");
    await expect(service.save('helper')).rejects.toThrow(/changed remotely/);
    expect(service.getDraft('helper')).toMatchObject({ dirty: true, stale: true });
    expect(service.conflicts).toHaveLength(1);
    const conflict = service.conflicts[0].merge.conflicts[0];
    service.resolveConflict('helper', { [conflict.id]: { strategy: 'manual', value: "export const helper = () => 'combined';" } });
    expect(service.getDraft('helper')).toMatchObject({ dirty: true, stale: false, content: "export const helper = () => 'combined';\n" });
    await service.save('helper');
    expect(service.getDraft('helper')?.dirty).toBe(false);
  });

  it('refreshes clean files, marks dirty files stale and saves all independently', async () => {
    const adapter = new MemorySourceAdapter();
    const service = new SourceRepositoryService(adapter);
    await service.load('repo', 'main');
    await service.open('main', { pinned: true });
    adapter.remoteEdit('main', 'remote clean\n');
    expect(await service.refresh('main')).toMatchObject({ content: 'remote clean\n', dirty: false, stale: false });
    service.edit('main', 'local dirty\n');
    adapter.remoteEdit('main', 'remote dirty\n');
    expect(await service.refresh('main')).toMatchObject({ content: 'local dirty\n', dirty: true, stale: true });

    await service.open('helper', { pinned: true });
    service.edit('helper', 'saved helper\n');
    const result = await service.saveAll();
    expect(result.saved).toEqual(['helper']);
    expect(result.failed).toMatchObject([{ entryId: 'main' }]);
  });

  it('creates, renames and moves directory subtrees while preserving open draft paths', async () => {
    const adapter = new MemorySourceAdapter();
    const service = new SourceRepositoryService(adapter);
    await service.load('repo', 'main');
    const folder = await service.createFolder(null, 'generated');
    const file = await service.createFile(folder.id, 'code.ts', 'export const value = 1;\n');
    await service.open(file.id, { pinned: true });
    await service.rename(folder.id, 'output');
    expect(service.repository?.entries.find((candidate) => candidate.id === file.id)?.path).toBe('/output/code.ts');
    expect(service.getDraft(file.id)?.path).toBe('/output/code.ts');
    await service.move(file.id, 'src', 'generated.ts');
    expect(service.getDraft(file.id)?.path).toBe('/src/generated.ts');
    await expect(service.move('src', 'components')).rejects.toThrow(/descendant/);
    await expect(service.createFile('src', 'MAIN.ts')).rejects.toThrow(/already exists/);
  });

  it('guards destructive subtree deletion and exposes diagnostics/dependencies for open files', async () => {
    const adapter = new MemorySourceAdapter();
    const service = new SourceRepositoryService(adapter);
    await service.load('repo', 'main');
    await service.open('widget', { pinned: true });
    service.edit('widget', 'dirty');
    await expect(service.remove('components')).rejects.toThrow(/unsaved/);
    expect(await service.remove('components', { force: true })).toEqual(['components', 'widget']);
    expect(service.repository?.entries.some((candidate) => candidate.id === 'widget')).toBe(false);

    await service.open('main', { pinned: true });
    await service.open('helper', { pinned: true });
    expect(service.dependencyGraph().dependencies['/src/main.ts']).toEqual(['/src/helper.ts']);
    expect(service.diagnostics().some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
  });
});
