export type SourceEntryKind = 'file' | 'folder';

export interface SourceRepositoryEntry {
  id: string;
  kind: SourceEntryKind;
  name: string;
  path: string;
  parentId: string | null;
  contentHash?: string;
  byteSize?: number;
  mimeType?: string;
  language?: string;
  readonly?: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SourceRepositorySnapshot {
  repositoryId: string;
  branchId: string;
  revision: string;
  entries: SourceRepositoryEntry[];
}

export interface SourceTextPosition {
  line: number;
  column: number;
}

export interface SourceTextSelection {
  anchor: SourceTextPosition;
  focus: SourceTextPosition;
}

export interface SourceFileDraft {
  entryId: string;
  path: string;
  language: string;
  mimeType: string;
  baseContent: string;
  baseContentHash: string;
  content: string;
  dirty: boolean;
  stale: boolean;
  readonly: boolean;
  openedAt: string;
  editedAt?: string;
  selection?: SourceTextSelection;
}

export interface SourceTab {
  entryId: string;
  pinned: boolean;
  preview: boolean;
  active: boolean;
  openedAt: string;
}

export interface SourceWriteResult {
  entry: SourceRepositoryEntry;
  contentHash: string;
  byteSize: number;
}

export interface SourceRepositoryAdapter {
  load(repositoryId: string, branchId: string): Promise<SourceRepositorySnapshot>;
  read(entryId: string): Promise<{ content: string; contentHash: string; entry: SourceRepositoryEntry }>;
  write(input: {
    entryId: string;
    content: string;
    expectedContentHash: string;
  }): Promise<SourceWriteResult>;
  create(input: {
    kind: SourceEntryKind;
    parentId: string | null;
    name: string;
    content?: string;
    mimeType?: string;
    language?: string;
  }): Promise<SourceRepositoryEntry>;
  move(input: {
    entryId: string;
    parentId: string | null;
    name: string;
  }): Promise<SourceRepositoryEntry[]>;
  remove(entryId: string): Promise<string[]>;
}

export type SourceReferenceKind =
  | 'import'
  | 'dynamic-import'
  | 'require'
  | 'url'
  | 'script'
  | 'stylesheet'
  | 'asset';

export interface SourceReference {
  sourcePath: string;
  specifier: string;
  resolvedPath: string | null;
  kind: SourceReferenceKind;
  line: number;
  column: number;
  external: boolean;
}

export interface SourceDependencyGraph {
  references: SourceReference[];
  dependencies: Record<string, string[]>;
  dependents: Record<string, string[]>;
  missing: SourceReference[];
  cycles: string[][];
}

export interface SourceDiagnostic {
  id: string;
  entryId?: string;
  path: string;
  severity: 'error' | 'warning' | 'info';
  code:
    | 'repository.duplicate-id'
    | 'repository.duplicate-path'
    | 'repository.parent-missing'
    | 'repository.parent-kind'
    | 'repository.path-mismatch'
    | 'repository.hierarchy-cycle'
    | 'source.json-invalid'
    | 'source.bracket-unclosed'
    | 'source.bracket-unexpected'
    | 'source.reference-missing'
    | 'source.trailing-whitespace'
    | 'source.line-too-long';
  message: string;
  line?: number;
  column?: number;
}

export interface SourceMergeConflict {
  id: string;
  line: number;
  baseLine: string | null;
  oursLine: string | null;
  theirsLine: string | null;
  message: string;
}

export interface SourceMergePlan {
  mergedText: string;
  conflicts: SourceMergeConflict[];
  baseText: string;
  oursText: string;
  theirsText: string;
}

export type SourceMergeResolution =
  | { strategy: 'ours' }
  | { strategy: 'theirs' }
  | { strategy: 'base' }
  | { strategy: 'manual'; value: string | null };

export type SourceMergeResolutionMap = Record<string, SourceMergeResolution>;

export interface SourceSaveConflict {
  entryId: string;
  path: string;
  baseContentHash: string;
  remoteContentHash: string;
  merge: SourceMergePlan;
}

export interface SourceRepositoryProgress {
  operation: 'load' | 'open' | 'save' | 'create' | 'move' | 'delete';
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  entryId?: string;
  error?: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSegment(value: string): string {
  const result = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .slice(0, 180);
  if (!result || result === '.' || result === '..') throw new Error('File or folder name is invalid.');
  return result;
}

export function normalizeSourcePath(value: string): string {
  const segments: string[] = [];
  for (const raw of value.replace(/\\/g, '/').split('/')) {
    const segment = raw.trim();
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

function parentPath(path: string): string {
  const normalized = normalizeSourcePath(path);
  const segments = normalized.split('/').filter(Boolean);
  segments.pop();
  return `/${segments.join('/')}`;
}

function joinPath(parent: string, name: string): string {
  return normalizeSourcePath(`${parent}/${normalizeSegment(name)}`);
}

function extension(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLocaleLowerCase() : '';
}

export function inferSourceLanguage(path: string, mimeType?: string): string {
  const ext = extension(path);
  if (['ts', 'tsx'].includes(ext)) return 'typescript';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return 'javascript';
  if (ext === 'json' || mimeType === 'application/json') return 'json';
  if (ext === 'css') return 'css';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['wgsl', 'glsl', 'vert', 'frag'].includes(ext)) return 'shader';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'plaintext';
}

export function inferSourceMimeType(path: string): string {
  switch (extension(path)) {
    case 'ts':
    case 'tsx': return 'text/typescript';
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx': return 'text/javascript';
    case 'json': return 'application/json';
    case 'css': return 'text/css';
    case 'html':
    case 'htm': return 'text/html';
    case 'wgsl': return 'text/wgsl';
    case 'glsl':
    case 'vert':
    case 'frag': return 'text/x-glsl';
    case 'md': return 'text/markdown';
    default: return 'text/plain';
  }
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, Math.max(0, offset));
  const lines = prefix.split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function isExternalSpecifier(specifier: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(specifier)
    || /^(?:data|blob|asset):/i.test(specifier)
    || (!specifier.startsWith('.') && !specifier.startsWith('/'));
}

function candidatePaths(path: string): string[] {
  if (extension(path)) return [path];
  return [
    path,
    `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.jsx`, `${path}.json`, `${path}.css`, `${path}.html`,
    `${path}/index.ts`, `${path}/index.tsx`, `${path}/index.js`, `${path}/index.jsx`, `${path}/index.json`,
  ];
}

export function resolveSourceSpecifier(
  sourcePath: string,
  specifier: string,
  availablePaths: ReadonlySet<string>,
): string | null {
  if (isExternalSpecifier(specifier)) return null;
  const unresolved = specifier.startsWith('/')
    ? normalizeSourcePath(specifier)
    : normalizeSourcePath(`${parentPath(sourcePath)}/${specifier}`);
  return candidatePaths(unresolved).find((candidate) => availablePaths.has(candidate)) ?? null;
}

export function extractSourceReferences(
  sourcePath: string,
  content: string,
  language = inferSourceLanguage(sourcePath),
  availablePaths: ReadonlySet<string> = new Set(),
): SourceReference[] {
  const references: SourceReference[] = [];
  const add = (specifier: string, kind: SourceReferenceKind, offset: number): void => {
    const location = lineColumn(content, offset);
    references.push({
      sourcePath,
      specifier,
      resolvedPath: resolveSourceSpecifier(sourcePath, specifier, availablePaths),
      kind,
      ...location,
      external: isExternalSpecifier(specifier),
    });
  };
  const patterns: Array<[RegExp, SourceReferenceKind, number]> = [];
  if (language === 'typescript' || language === 'javascript') {
    patterns.push(
      [/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g, 'import', 1],
      [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'dynamic-import', 1],
      [/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'require', 1],
    );
  } else if (language === 'css') {
    patterns.push(
      [/@import\s+(?:url\(\s*)?['"]?([^'"\s;)]+)['"]?\s*\)?/g, 'import', 1],
      [/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g, 'url', 1],
    );
  } else if (language === 'html') {
    patterns.push(
      [/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi, 'script', 1],
      [/<link\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"]/gi, 'stylesheet', 1],
      [/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi, 'asset', 1],
    );
  }
  for (const [pattern, kind, group] of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const specifier = match[group];
      if (specifier) add(specifier, kind, match.index + match[0].indexOf(specifier));
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return references.sort((left, right) => left.line - right.line || left.column - right.column || left.specifier.localeCompare(right.specifier));
}

export function validateSourceRepository(snapshot: SourceRepositorySnapshot): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const byId = new Map<string, SourceRepositoryEntry>();
  const byPath = new Map<string, SourceRepositoryEntry>();
  snapshot.entries.forEach((entry, index) => {
    const path = `/entries/${index}`;
    if (!entry.id || byId.has(entry.id)) diagnostics.push({ id: `duplicate-id:${index}`, code: 'repository.duplicate-id', severity: 'error', path: `${path}/id`, message: 'Repository entry IDs must be unique.' });
    else byId.set(entry.id, entry);
    const normalized = normalizeSourcePath(entry.path).toLocaleLowerCase();
    if (byPath.has(normalized)) diagnostics.push({ id: `duplicate-path:${index}`, code: 'repository.duplicate-path', severity: 'error', path: `${path}/path`, message: 'Repository paths must be unique, including case-insensitive filesystems.' });
    else byPath.set(normalized, entry);
  });
  snapshot.entries.forEach((entry, index) => {
    const path = `/entries/${index}`;
    const parent = entry.parentId ? byId.get(entry.parentId) : null;
    if (entry.parentId && !parent) diagnostics.push({ id: `parent-missing:${entry.id}`, entryId: entry.id, code: 'repository.parent-missing', severity: 'error', path: `${path}/parentId`, message: 'Parent folder is missing.' });
    if (parent && parent.kind !== 'folder') diagnostics.push({ id: `parent-kind:${entry.id}`, entryId: entry.id, code: 'repository.parent-kind', severity: 'error', path: `${path}/parentId`, message: 'Parent entry must be a folder.' });
    const expectedPath = joinPath(parent?.path ?? '/', entry.name);
    if (normalizeSourcePath(entry.path) !== expectedPath) diagnostics.push({ id: `path-mismatch:${entry.id}`, entryId: entry.id, code: 'repository.path-mismatch', severity: 'error', path: `${path}/path`, message: `Expected path ${expectedPath}.` });
    const visited = new Set<string>([entry.id]);
    let parentId = entry.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        diagnostics.push({ id: `cycle:${entry.id}`, entryId: entry.id, code: 'repository.hierarchy-cycle', severity: 'error', path: `${path}/parentId`, message: 'Repository folder hierarchy contains a cycle.' });
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  });
  return diagnostics;
}

function bracketDiagnostics(entry: SourceRepositoryEntry, content: string): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const openToClose: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closeToOpen: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: Array<{ char: string; offset: number }> = [];
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (openToClose[char]) stack.push({ char, offset: index });
    else if (closeToOpen[char]) {
      const open = stack.pop();
      if (!open || open.char !== closeToOpen[char]) {
        const position = lineColumn(content, index);
        diagnostics.push({ id: `unexpected:${entry.id}:${index}`, entryId: entry.id, code: 'source.bracket-unexpected', severity: 'error', path: entry.path, message: `Unexpected ${char}.`, ...position });
      }
    }
  }
  for (const open of stack) {
    const position = lineColumn(content, open.offset);
    diagnostics.push({ id: `unclosed:${entry.id}:${open.offset}`, entryId: entry.id, code: 'source.bracket-unclosed', severity: 'error', path: entry.path, message: `Unclosed ${open.char}.`, ...position });
  }
  return diagnostics;
}

export function diagnoseSourceFile(
  entry: SourceRepositoryEntry,
  content: string,
  availablePaths: ReadonlySet<string> = new Set(),
): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const language = entry.language ?? inferSourceLanguage(entry.path, entry.mimeType);
  if (language === 'json') {
    try { JSON.parse(content); }
    catch (error) {
      diagnostics.push({ id: `json:${entry.id}`, entryId: entry.id, code: 'source.json-invalid', severity: 'error', path: entry.path, message: error instanceof Error ? error.message : 'Invalid JSON.' });
    }
  } else diagnostics.push(...bracketDiagnostics(entry, content));
  content.split('\n').forEach((line, index) => {
    if (/[ \t]+$/.test(line)) diagnostics.push({ id: `whitespace:${entry.id}:${index}`, entryId: entry.id, code: 'source.trailing-whitespace', severity: 'info', path: entry.path, line: index + 1, column: line.length, message: 'Trailing whitespace.' });
    if (line.length > 160) diagnostics.push({ id: `line-length:${entry.id}:${index}`, entryId: entry.id, code: 'source.line-too-long', severity: 'warning', path: entry.path, line: index + 1, column: 161, message: 'Line exceeds 160 characters.' });
  });
  for (const reference of extractSourceReferences(entry.path, content, language, availablePaths)) {
    if (!reference.external && !reference.resolvedPath) diagnostics.push({ id: `reference:${entry.id}:${reference.line}:${reference.column}`, entryId: entry.id, code: 'source.reference-missing', severity: 'error', path: entry.path, line: reference.line, column: reference.column, message: `Cannot resolve ${reference.specifier}.` });
  }
  return diagnostics;
}

export function buildSourceDependencyGraph(
  files: Array<{ entry: SourceRepositoryEntry; content: string }>,
): SourceDependencyGraph {
  const availablePaths = new Set(files.map(({ entry }) => normalizeSourcePath(entry.path)));
  const references = files.flatMap(({ entry, content }) => extractSourceReferences(entry.path, content, entry.language ?? inferSourceLanguage(entry.path, entry.mimeType), availablePaths));
  const dependencies: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};
  for (const path of availablePaths) { dependencies[path] = []; dependents[path] = []; }
  for (const reference of references) {
    if (!reference.resolvedPath) continue;
    dependencies[reference.sourcePath] ??= [];
    dependencies[reference.sourcePath].push(reference.resolvedPath);
    dependents[reference.resolvedPath] ??= [];
    dependents[reference.resolvedPath].push(reference.sourcePath);
  }
  for (const values of [...Object.values(dependencies), ...Object.values(dependents)]) values.splice(0, values.length, ...[...new Set(values)].sort());
  const cycles: string[][] = [];
  const visiting: string[] = [];
  const visited = new Set<string>();
  const recorded = new Set<string>();
  const visit = (path: string): void => {
    const activeIndex = visiting.indexOf(path);
    if (activeIndex >= 0) {
      const cycle = [...visiting.slice(activeIndex), path];
      const key = [...new Set(cycle.slice(0, -1))].sort().join('|');
      if (!recorded.has(key)) { recorded.add(key); cycles.push(cycle); }
      return;
    }
    if (visited.has(path)) return;
    visiting.push(path);
    for (const dependency of dependencies[path] ?? []) visit(dependency);
    visiting.pop();
    visited.add(path);
  };
  for (const path of availablePaths) visit(path);
  return {
    references,
    dependencies,
    dependents,
    missing: references.filter((reference) => !reference.external && !reference.resolvedPath),
    cycles,
  };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

export function planSourceMerge(baseText: string, oursText: string, theirsText: string): SourceMergePlan {
  if (oursText === theirsText) return { mergedText: oursText, conflicts: [], baseText, oursText, theirsText };
  if (baseText === oursText) return { mergedText: theirsText, conflicts: [], baseText, oursText, theirsText };
  if (baseText === theirsText) return { mergedText: oursText, conflicts: [], baseText, oursText, theirsText };
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);
  const count = Math.max(base.length, ours.length, theirs.length);
  const merged: string[] = [];
  const conflicts: SourceMergeConflict[] = [];
  for (let index = 0; index < count; index += 1) {
    const baseLine = base[index] ?? null;
    const oursLine = ours[index] ?? null;
    const theirsLine = theirs[index] ?? null;
    if (oursLine === theirsLine) merged.push(oursLine ?? '');
    else if (oursLine === baseLine) merged.push(theirsLine ?? '');
    else if (theirsLine === baseLine) merged.push(oursLine ?? '');
    else {
      conflicts.push({ id: `line:${index + 1}`, line: index + 1, baseLine, oursLine, theirsLine, message: `Both versions changed line ${index + 1}.` });
      merged.push(oursLine ?? '');
    }
  }
  return { mergedText: merged.join('\n'), conflicts, baseText, oursText, theirsText };
}

export function resolveSourceMerge(
  plan: SourceMergePlan,
  resolutions: SourceMergeResolutionMap,
): { text: string; unresolved: SourceMergeConflict[] } {
  const lines = splitLines(plan.mergedText);
  const unresolved: SourceMergeConflict[] = [];
  for (const conflict of plan.conflicts) {
    const resolution = resolutions[conflict.id];
    if (!resolution) { unresolved.push(conflict); continue; }
    const value = resolution.strategy === 'ours' ? conflict.oursLine
      : resolution.strategy === 'theirs' ? conflict.theirsLine
        : resolution.strategy === 'base' ? conflict.baseLine
          : resolution.value;
    if (value == null) lines.splice(conflict.line - 1, 1);
    else lines[conflict.line - 1] = value;
  }
  return { text: lines.join('\n'), unresolved };
}

export class SourceRepositoryService extends EventTarget {
  private snapshot: SourceRepositorySnapshot | null = null;
  private readonly drafts = new Map<string, SourceFileDraft>();
  private tabs: SourceTab[] = [];
  private activeEntryId: string | null = null;
  private readonly saveConflicts = new Map<string, SourceSaveConflict>();
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly adapter: SourceRepositoryAdapter) {
    super();
  }

  get repository(): SourceRepositorySnapshot | null { return this.snapshot ? clone(this.snapshot) : null; }
  get openTabs(): SourceTab[] { return clone(this.tabs); }
  get activeFileId(): string | null { return this.activeEntryId; }
  get dirtyEntryIds(): string[] { return [...this.drafts.values()].filter((draft) => draft.dirty).map((draft) => draft.entryId); }
  get conflicts(): SourceSaveConflict[] { return [...this.saveConflicts.values()].map(clone); }

  getDraft(entryId: string): SourceFileDraft | null {
    const draft = this.drafts.get(entryId);
    return draft ? clone(draft) : null;
  }

  async load(repositoryId: string, branchId: string): Promise<SourceRepositorySnapshot> {
    return this.run('load', 'Loading source repository…', async () => {
      const snapshot = await this.adapter.load(repositoryId, branchId);
      const errors = validateSourceRepository(snapshot).filter((diagnostic) => diagnostic.severity === 'error');
      if (errors.length) throw new Error(errors.map((diagnostic) => diagnostic.message).join(' '));
      this.snapshot = clone(snapshot);
      this.drafts.clear();
      this.tabs = [];
      this.activeEntryId = null;
      this.saveConflicts.clear();
      return this.repository!;
    });
  }

  async open(entryId: string, options: { preview?: boolean; pinned?: boolean } = {}): Promise<SourceFileDraft> {
    return this.run('open', 'Opening source file…', async () => {
      const entry = this.requireEntry(entryId);
      if (entry.kind !== 'file') throw new Error('Only files can be opened.');
      let draft = this.drafts.get(entryId);
      if (!draft) {
        const result = await this.adapter.read(entryId);
        draft = {
          entryId,
          path: result.entry.path,
          language: result.entry.language ?? inferSourceLanguage(result.entry.path, result.entry.mimeType),
          mimeType: result.entry.mimeType ?? inferSourceMimeType(result.entry.path),
          baseContent: result.content,
          baseContentHash: result.contentHash,
          content: result.content,
          dirty: false,
          stale: false,
          readonly: Boolean(result.entry.readonly),
          openedAt: new Date().toISOString(),
        };
        this.drafts.set(entryId, draft);
      }
      const existing = this.tabs.find((tab) => tab.entryId === entryId);
      if (!existing) {
        if (options.preview !== false) {
          const preview = this.tabs.find((tab) => tab.preview && !tab.pinned && !this.drafts.get(tab.entryId)?.dirty);
          if (preview) this.close(preview.entryId, { force: true });
        }
        this.tabs.push({ entryId, pinned: Boolean(options.pinned), preview: options.preview !== false && !options.pinned, active: false, openedAt: new Date().toISOString() });
      } else if (options.pinned) { existing.pinned = true; existing.preview = false; }
      this.activate(entryId);
      return clone(draft);
    }, entryId);
  }

  activate(entryId: string): void {
    if (!this.tabs.some((tab) => tab.entryId === entryId)) throw new Error('File is not open.');
    this.activeEntryId = entryId;
    for (const tab of this.tabs) tab.active = tab.entryId === entryId;
    this.emit('change', { type: 'tab:activate', entryId });
  }

  pin(entryId: string): void {
    const tab = this.tabs.find((entry) => entry.entryId === entryId);
    if (!tab) throw new Error('File is not open.');
    tab.pinned = true;
    tab.preview = false;
    this.emit('change', { type: 'tab:pin', entryId });
  }

  close(entryId: string, options: { force?: boolean } = {}): void {
    const draft = this.drafts.get(entryId);
    if (draft?.dirty && !options.force) throw new Error('File has unsaved changes.');
    const index = this.tabs.findIndex((tab) => tab.entryId === entryId);
    if (index < 0) return;
    const wasActive = this.activeEntryId === entryId;
    this.tabs.splice(index, 1);
    this.drafts.delete(entryId);
    this.saveConflicts.delete(entryId);
    if (wasActive) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
      this.activeEntryId = next?.entryId ?? null;
      for (const tab of this.tabs) tab.active = tab.entryId === this.activeEntryId;
    }
    this.emit('change', { type: 'tab:close', entryId });
  }

  edit(entryId: string, content: string, selection?: SourceTextSelection): void {
    const draft = this.requireDraft(entryId);
    if (draft.readonly) throw new Error('File is read only.');
    draft.content = content.replace(/\r\n?/g, '\n');
    draft.dirty = draft.content !== draft.baseContent;
    draft.editedAt = new Date().toISOString();
    if (selection) draft.selection = clone(selection);
    const tab = this.tabs.find((entry) => entry.entryId === entryId);
    if (tab && draft.dirty) { tab.preview = false; tab.pinned = true; }
    this.emit('change', { type: 'file:edit', entryId, dirty: draft.dirty });
  }

  revert(entryId: string): void {
    const draft = this.requireDraft(entryId);
    draft.content = draft.baseContent;
    draft.dirty = false;
    draft.stale = false;
    draft.editedAt = undefined;
    this.saveConflicts.delete(entryId);
    this.emit('change', { type: 'file:revert', entryId });
  }

  async refresh(entryId: string): Promise<SourceFileDraft> {
    const draft = this.requireDraft(entryId);
    const remote = await this.adapter.read(entryId);
    if (remote.contentHash === draft.baseContentHash) return clone(draft);
    if (!draft.dirty) {
      draft.baseContent = remote.content;
      draft.content = remote.content;
      draft.baseContentHash = remote.contentHash;
      draft.path = remote.entry.path;
      draft.stale = false;
    } else draft.stale = true;
    this.replaceEntry(remote.entry);
    this.emit('change', { type: 'file:refresh', entryId, stale: draft.stale });
    return clone(draft);
  }

  async save(entryId: string): Promise<SourceFileDraft> {
    return this.run('save', 'Saving source file…', async () => {
      const draft = this.requireDraft(entryId);
      if (draft.readonly) throw new Error('File is read only.');
      if (!draft.dirty) return clone(draft);
      try {
        const result = await this.adapter.write({ entryId, content: draft.content, expectedContentHash: draft.baseContentHash });
        draft.baseContent = draft.content;
        draft.baseContentHash = result.contentHash;
        draft.dirty = false;
        draft.stale = false;
        draft.editedAt = undefined;
        this.saveConflicts.delete(entryId);
        this.replaceEntry(result.entry);
        return clone(draft);
      } catch (error) {
        const remote = await this.adapter.read(entryId);
        if (remote.contentHash !== draft.baseContentHash) {
          const conflict: SourceSaveConflict = {
            entryId,
            path: draft.path,
            baseContentHash: draft.baseContentHash,
            remoteContentHash: remote.contentHash,
            merge: planSourceMerge(draft.baseContent, draft.content, remote.content),
          };
          this.saveConflicts.set(entryId, conflict);
          draft.stale = true;
          this.emit('change', { type: 'file:conflict', entryId, conflict: clone(conflict) });
          throw new Error('Source file changed remotely. Resolve the save conflict.');
        }
        throw error;
      }
    }, entryId);
  }

  async saveAll(): Promise<{ saved: string[]; failed: Array<{ entryId: string; error: string }> }> {
    const saved: string[] = [];
    const failed: Array<{ entryId: string; error: string }> = [];
    for (const entryId of this.dirtyEntryIds) {
      try { await this.save(entryId); saved.push(entryId); }
      catch (error) { failed.push({ entryId, error: error instanceof Error ? error.message : String(error) }); }
    }
    return { saved, failed };
  }

  resolveConflict(entryId: string, resolutions: SourceMergeResolutionMap): SourceFileDraft {
    const conflict = this.saveConflicts.get(entryId);
    const draft = this.requireDraft(entryId);
    if (!conflict) throw new Error('Save conflict not found.');
    const result = resolveSourceMerge(conflict.merge, resolutions);
    if (result.unresolved.length) throw new Error(`Resolve ${result.unresolved.length} remaining conflicts.`);
    draft.content = result.text;
    draft.baseContent = conflict.merge.theirsText;
    draft.baseContentHash = conflict.remoteContentHash;
    draft.dirty = draft.content !== draft.baseContent;
    draft.stale = false;
    this.saveConflicts.delete(entryId);
    this.emit('change', { type: 'file:conflict-resolved', entryId });
    return clone(draft);
  }

  async createFile(parentId: string | null, name: string, content = ''): Promise<SourceRepositoryEntry> {
    return this.create('file', parentId, name, content);
  }

  async createFolder(parentId: string | null, name: string): Promise<SourceRepositoryEntry> {
    return this.create('folder', parentId, name);
  }

  async rename(entryId: string, name: string): Promise<SourceRepositoryEntry[]> {
    const entry = this.requireEntry(entryId);
    return this.move(entryId, entry.parentId, name);
  }

  async move(entryId: string, parentId: string | null, name?: string): Promise<SourceRepositoryEntry[]> {
    return this.run('move', 'Moving repository entry…', async () => {
      const entry = this.requireEntry(entryId);
      if (entry.readonly) throw new Error('Repository entry is read only.');
      if (parentId === entryId) throw new Error('An entry cannot contain itself.');
      if (parentId) {
        const parent = this.requireEntry(parentId);
        if (parent.kind !== 'folder') throw new Error('Destination must be a folder.');
        if (entry.kind === 'folder' && this.descendantIds(entryId).has(parentId)) throw new Error('Cannot move a folder into its descendant.');
      }
      const nextName = normalizeSegment(name ?? entry.name);
      this.assertPathAvailable(joinPath(parentId ? this.requireEntry(parentId).path : '/', nextName), entryId);
      const updated = await this.adapter.move({ entryId, parentId, name: nextName });
      for (const next of updated) this.replaceEntry(next);
      for (const next of updated) {
        const draft = this.drafts.get(next.id);
        if (draft) draft.path = next.path;
      }
      return clone(updated);
    }, entryId);
  }

  async remove(entryId: string, options: { force?: boolean } = {}): Promise<string[]> {
    return this.run('delete', 'Deleting repository entry…', async () => {
      const entry = this.requireEntry(entryId);
      if (entry.readonly) throw new Error('Repository entry is read only.');
      const ids = new Set([entryId, ...this.descendantIds(entryId)]);
      const dirty = [...ids].filter((id) => this.drafts.get(id)?.dirty);
      if (dirty.length && !options.force) throw new Error('Deleted subtree contains unsaved files.');
      const removed = await this.adapter.remove(entryId);
      this.snapshot!.entries = this.snapshot!.entries.filter((candidate) => !removed.includes(candidate.id));
      for (const id of removed) this.close(id, { force: true });
      return [...removed];
    }, entryId);
  }

  diagnostics(): SourceDiagnostic[] {
    const snapshot = this.requireSnapshot();
    const paths = new Set(snapshot.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
    const result = validateSourceRepository(snapshot);
    for (const draft of this.drafts.values()) {
      const entry = snapshot.entries.find((candidate) => candidate.id === draft.entryId);
      if (entry) result.push(...diagnoseSourceFile(entry, draft.content, paths));
    }
    return result;
  }

  dependencyGraph(): SourceDependencyGraph {
    const snapshot = this.requireSnapshot();
    const files = [...this.drafts.values()].map((draft) => ({
      entry: snapshot.entries.find((entry) => entry.id === draft.entryId)!,
      content: draft.content,
    })).filter(({ entry }) => Boolean(entry));
    return buildSourceDependencyGraph(files);
  }

  private async create(kind: SourceEntryKind, parentId: string | null, name: string, content?: string): Promise<SourceRepositoryEntry> {
    return this.run('create', `Creating ${kind}…`, async () => {
      if (parentId && this.requireEntry(parentId).kind !== 'folder') throw new Error('Parent must be a folder.');
      const normalizedName = normalizeSegment(name);
      const path = joinPath(parentId ? this.requireEntry(parentId).path : '/', normalizedName);
      this.assertPathAvailable(path);
      const entry = await this.adapter.create({
        kind,
        parentId,
        name: normalizedName,
        content: kind === 'file' ? content ?? '' : undefined,
        mimeType: kind === 'file' ? inferSourceMimeType(path) : undefined,
        language: kind === 'file' ? inferSourceLanguage(path) : undefined,
      });
      this.snapshot!.entries.push(clone(entry));
      return clone(entry);
    });
  }

  private assertPathAvailable(path: string, excludingId?: string): void {
    const normalized = normalizeSourcePath(path).toLocaleLowerCase();
    if (this.requireSnapshot().entries.some((entry) => entry.id !== excludingId && normalizeSourcePath(entry.path).toLocaleLowerCase() === normalized)) throw new Error(`Path ${path} already exists.`);
  }

  private descendantIds(entryId: string): Set<string> {
    const snapshot = this.requireSnapshot();
    const result = new Set<string>();
    const stack = [entryId];
    while (stack.length) {
      const parentId = stack.pop()!;
      for (const child of snapshot.entries.filter((entry) => entry.parentId === parentId)) {
        if (result.has(child.id)) continue;
        result.add(child.id);
        stack.push(child.id);
      }
    }
    return result;
  }

  private replaceEntry(entry: SourceRepositoryEntry): void {
    const snapshot = this.requireSnapshot();
    const index = snapshot.entries.findIndex((candidate) => candidate.id === entry.id);
    if (index < 0) snapshot.entries.push(clone(entry));
    else snapshot.entries[index] = clone(entry);
  }

  private requireSnapshot(): SourceRepositorySnapshot {
    if (!this.snapshot) throw new Error('Source repository has not been loaded.');
    return this.snapshot;
  }

  private requireEntry(entryId: string): SourceRepositoryEntry {
    const entry = this.requireSnapshot().entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error(`Repository entry ${entryId} not found.`);
    return entry;
  }

  private requireDraft(entryId: string): SourceFileDraft {
    const draft = this.drafts.get(entryId);
    if (!draft) throw new Error('Source file is not open.');
    return draft;
  }

  private async run<T>(operation: SourceRepositoryProgress['operation'], message: string, work: () => Promise<T>, entryId?: string): Promise<T> {
    const execute = async (): Promise<T> => {
      this.emit('progress', { operation, status: 'running', progress: 0, message, entryId });
      try {
        const result = await work();
        this.emit('progress', { operation, status: 'completed', progress: 1, message: `${message.replace(/…$/, '')} complete.`, entryId });
        this.emit('change', { type: operation, entryId });
        return result;
      } catch (error) {
        this.emit('progress', { operation, status: 'failed', progress: 1, message: `${message.replace(/…$/, '')} failed.`, entryId, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };
    const result = this.operation.then(execute, execute);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}
