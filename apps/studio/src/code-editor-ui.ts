import type { KyxosApiClient, SourceFileRecord } from '@kyxos/api-client';
import { button, element } from '@kyxos/shared-ui';
import './code-editor-parity.css';

export interface CodeEditorOptions {
  dialog: HTMLDialogElement;
  client: Pick<KyxosApiClient, 'sourceFiles'>;
  projectId: string;
  canEdit: boolean;
  onLog(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}

export async function mountCodeEditor(options: CodeEditorOptions): Promise<() => void> {
  const monaco = await import('./monaco-setup');
  const activeStorageKey = `kyxos.studio.code.active:${options.projectId}`;
  let files = await options.client.sourceFiles.list(options.projectId);
  const rememberedPath = safeStorageGet(activeStorageKey);
  let active: SourceFileRecord | null = files.find((entry) => entry.path === rememberedPath) ?? files[0] ?? null;
  let editor: ReturnType<typeof monaco.editor.create> | null = null;
  let model: ReturnType<typeof monaco.editor.createModel> | null = null;
  let dirty = false;
  let disposed = false;
  let query = '';
  const viewStates = new Map<string, ReturnType<ReturnType<typeof monaco.editor.create>['saveViewState']>>();

  const header = element('header', { className: 'dialog-header code-editor-header' });
  const heading = element('h2', { text: 'Code Editor' });
  const state = element('span', { className: 'code-save-state', text: options.canEdit ? 'Saved' : 'Read only' });
  const close = button('Close', () => requestClose(), 'secondary');
  header.append(heading, state, close);

  const layout = element('div', { className: 'code-editor-layout' });
  const sidebar = element('aside', { className: 'code-editor-sidebar' });
  const editorColumn = element('section', { className: 'code-editor-column' });
  const editorTabs = element('div', { className: 'code-editor-tabs' });
  const editorHost = element('div', { className: 'code-editor-host' });
  const editorStatus = element('footer', { className: 'code-editor-status' });
  editorColumn.append(editorTabs, editorHost, editorStatus);
  layout.append(sidebar, editorColumn);
  options.dialog.replaceChildren(header, layout);

  const toolbar = element('div', { className: 'code-files-toolbar' });
  const save = button('Save', () => void saveActive(), 'primary mini');
  const create = button('New', () => void createFile(), 'mini');
  const rename = button('Rename', () => void renameActive(), 'mini');
  const duplicate = button('Duplicate', () => void duplicateActive(), 'mini');
  const refresh = button('Refresh', () => void refreshFiles(), 'mini');
  const remove = button('Delete', () => void deleteActive(), 'mini danger');
  toolbar.append(save, create, rename, duplicate, refresh, remove);

  const fileSearch = element('input', {
    attrs: {
      type: 'search',
      placeholder: 'Filter files or contents…',
      'aria-label': 'Filter source files',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;
  const fileList = element('div', { className: 'code-file-list', attrs: { role: 'list' } });
  const fileSummary = element('div', { className: 'code-file-summary' });
  sidebar.append(toolbar, fileSearch, fileList, fileSummary);

  fileSearch.addEventListener('input', () => {
    query = fileSearch.value.trim().toLocaleLowerCase();
    renderFiles();
  });

  function renderFiles(): void {
    save.disabled = !options.canEdit || !active || !dirty;
    create.disabled = !options.canEdit;
    rename.disabled = !options.canEdit || !active;
    duplicate.disabled = !options.canEdit || !active;
    remove.disabled = !options.canEdit || !active;

    const visible = files.filter((file) => {
      if (!query) return true;
      return `${file.path}\n${file.language}\n${file.content}`.toLocaleLowerCase().includes(query);
    });

    fileList.replaceChildren();
    for (const file of visible) {
      const selected = file.path === active?.path;
      const item = button(
        `${file.path}${selected && dirty ? ' •' : ''}`,
        () => void openFile(file),
        selected ? 'code-file active' : 'code-file',
      );
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-current', selected ? 'true' : 'false');
      item.title = `${file.language} · revision ${file.revision}`;
      fileList.append(item);
    }

    if (!visible.length) {
      fileList.append(element('p', {
        className: 'muted code-files-empty',
        text: files.length ? 'No source files match this filter.' : 'Create a project source file to begin.',
      }));
    }
    fileSummary.textContent = `${visible.length}/${files.length} files`;
    renderActiveTab();
  }

  function renderActiveTab(): void {
    editorTabs.replaceChildren();
    if (!active) {
      editorTabs.append(element('span', { className: 'code-tab-empty', text: 'No file open' }));
      editorStatus.textContent = options.canEdit ? 'Ready' : 'Read only';
      return;
    }
    const tab = element('button', {
      className: `code-editor-tab active${dirty ? ' dirty' : ''}`,
      text: `${active.path}${dirty ? ' •' : ''}`,
      attrs: { type: 'button', title: active.path },
    }) as HTMLButtonElement;
    editorTabs.append(tab);
    const language = model?.getLanguageId() ?? active.language ?? languageForPath(active.path);
    editorStatus.textContent = `${language} · r${active.revision}${dirty ? ' · modified' : ''}`;
  }

  function rememberActive(path: string | null): void {
    if (path) safeStorageSet(activeStorageKey, path);
    else safeStorageRemove(activeStorageKey);
  }

  function canDiscardActive(): boolean {
    return !dirty || !active || confirm(`Discard unsaved changes to ${active.path}?`);
  }

  async function openFile(file: SourceFileRecord, skipDiscardCheck = false): Promise<void> {
    if (!skipDiscardCheck && !canDiscardActive()) return;
    if (active?.path && editor) viewStates.set(active.path, editor.saveViewState());
    active = file;
    rememberActive(file.path);
    dirty = false;
    model?.dispose();
    model = monaco.editor.createModel(
      file.content,
      file.language || languageForPath(file.path),
      monaco.Uri.parse(`kyxos://project/${options.projectId}/${file.path}`),
    );
    editor?.setModel(model);
    editor?.updateOptions({ readOnly: !options.canEdit });
    const viewState = viewStates.get(file.path);
    if (viewState) editor?.restoreViewState(viewState);
    model.onDidChangeContent(() => {
      dirty = true;
      state.textContent = 'Unsaved';
      renderFiles();
    });
    state.textContent = options.canEdit ? `r${file.revision} · Saved` : `r${file.revision} · Read only`;
    renderFiles();
    editor?.focus();
  }

  async function saveActive(): Promise<void> {
    if (!active || !model || !options.canEdit) return;
    state.textContent = 'Saving…';
    try {
      const saved = await options.client.sourceFiles.save(
        options.projectId,
        active.path,
        model.getLanguageId(),
        model.getValue(),
        active.revision,
      );
      active = saved;
      files = files.map((entry) => entry.path === saved.path ? saved : entry);
      dirty = false;
      state.textContent = `r${saved.revision} · Saved`;
      options.onLog('info', `Saved ${saved.path} at revision ${saved.revision}.`, undefined);
      renderFiles();
    } catch (error) {
      state.textContent = 'Conflict / Error';
      options.onLog('error', `Could not save ${active.path}.`, error);
      if (confirm('The file may have changed remotely. Reload project source files?')) await refreshFiles(true);
    }
  }

  async function refreshFiles(force = false): Promise<void> {
    if (!force && !canDiscardActive()) return;
    const currentPath = active?.path ?? null;
    state.textContent = 'Refreshing…';
    try {
      files = await options.client.sourceFiles.list(options.projectId);
      const replacement = currentPath ? files.find((entry) => entry.path === currentPath) ?? null : null;
      if (replacement) await openFile(replacement, true);
      else {
        active = files[0] ?? null;
        if (active) await openFile(active, true);
        else {
          model?.dispose();
          model = null;
          editor?.setModel(null);
          dirty = false;
          rememberActive(null);
          state.textContent = options.canEdit ? 'Saved' : 'Read only';
          renderFiles();
        }
      }
      options.onLog('info', 'Refreshed project source files.');
    } catch (error) {
      state.textContent = 'Refresh error';
      options.onLog('error', 'Could not refresh project source files.', error);
    }
  }

  async function createFile(): Promise<void> {
    const raw = prompt('Project-relative file path', 'scripts/main.ts');
    if (!raw) return;
    let path: string;
    try {
      path = normalizePath(raw);
    } catch (error) {
      options.onLog('error', error instanceof Error ? error.message : 'Invalid project-relative path.', error);
      return;
    }
    if (files.some((entry) => entry.path === path)) {
      const existing = files.find((entry) => entry.path === path)!;
      await openFile(existing);
      return;
    }
    try {
      const created = await options.client.sourceFiles.save(
        options.projectId,
        path,
        languageForPath(path),
        starterForPath(path),
        0,
      );
      files = [...files, created].sort((left, right) => left.path.localeCompare(right.path));
      await openFile(created);
      options.onLog('info', `Created ${path}.`);
    } catch (error) {
      options.onLog('error', `Could not create ${path}.`, error);
    }
  }

  async function renameActive(): Promise<void> {
    if (!active || !options.canEdit) return;
    const raw = prompt('Rename project-relative file path', active.path);
    if (!raw) return;
    let path: string;
    try {
      path = normalizePath(raw);
    } catch (error) {
      options.onLog('error', error instanceof Error ? error.message : 'Invalid project-relative path.', error);
      return;
    }
    if (path === active.path) return;
    if (files.some((entry) => entry.path === path)) {
      options.onLog('error', `A source file already exists at ${path}.`);
      return;
    }

    const previous = active;
    const content = model?.getValue() ?? previous.content;
    try {
      state.textContent = 'Renaming…';
      const created = await options.client.sourceFiles.save(
        options.projectId,
        path,
        languageForPath(path),
        content,
        0,
      );
      await options.client.sourceFiles.remove(options.projectId, previous.path);
      files = files
        .filter((entry) => entry.path !== previous.path)
        .concat(created)
        .sort((left, right) => left.path.localeCompare(right.path));
      viewStates.delete(previous.path);
      dirty = false;
      await openFile(created, true);
      options.onLog('info', `Renamed ${previous.path} to ${path}.`);
    } catch (error) {
      state.textContent = 'Rename error';
      options.onLog('error', `Could not rename ${previous.path}.`, error);
      files = await options.client.sourceFiles.list(options.projectId);
      renderFiles();
    }
  }

  async function duplicateActive(): Promise<void> {
    if (!active || !options.canEdit) return;
    const suggested = duplicatePath(active.path);
    const raw = prompt('Duplicate to project-relative path', suggested);
    if (!raw) return;
    let path: string;
    try {
      path = normalizePath(raw);
    } catch (error) {
      options.onLog('error', error instanceof Error ? error.message : 'Invalid project-relative path.', error);
      return;
    }
    if (files.some((entry) => entry.path === path)) {
      options.onLog('error', `A source file already exists at ${path}.`);
      return;
    }
    try {
      const created = await options.client.sourceFiles.save(
        options.projectId,
        path,
        languageForPath(path),
        model?.getValue() ?? active.content,
        0,
      );
      files = [...files, created].sort((left, right) => left.path.localeCompare(right.path));
      await openFile(created, true);
      options.onLog('info', `Duplicated source file to ${path}.`);
    } catch (error) {
      options.onLog('error', `Could not duplicate ${active.path}.`, error);
    }
  }

  async function deleteActive(): Promise<void> {
    if (!active || !options.canEdit || !confirm(`Delete ${active.path}?`)) return;
    try {
      await options.client.sourceFiles.remove(options.projectId, active.path);
      const deletedPath = active.path;
      files = files.filter((entry) => entry.path !== deletedPath);
      viewStates.delete(deletedPath);
      active = files[0] ?? null;
      model?.dispose();
      model = null;
      editor?.setModel(null);
      dirty = false;
      if (active) await openFile(active, true);
      else {
        rememberActive(null);
        state.textContent = options.canEdit ? 'Saved' : 'Read only';
        renderFiles();
      }
      options.onLog('warn', `Deleted ${deletedPath}.`);
    } catch (error) {
      options.onLog('error', `Could not delete ${active.path}.`, error);
    }
  }

  function requestClose(): void {
    if (!canDiscardActive()) return;
    options.dialog.close();
  }

  editor = monaco.editor.create(editorHost, {
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: true, showSlider: 'mouseover' },
    stickyScroll: { enabled: true },
    glyphMargin: true,
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    insertSpaces: true,
    readOnly: !options.canEdit,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    formatOnPaste: true,
    formatOnType: true,
    quickSuggestions: true,
    smoothScrolling: true,
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveActive());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
    fileSearch.focus();
    fileSearch.select();
  });
  editor.addCommand(monaco.KeyCode.F2, () => void renameActive());
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    allowNonTsExtensions: true,
  });

  const onDialogCancel = (event: Event) => {
    if (canDiscardActive()) return;
    event.preventDefault();
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  options.dialog.addEventListener('cancel', onDialogCancel);
  window.addEventListener('beforeunload', onBeforeUnload);

  renderFiles();
  if (active) await openFile(active, true);
  if (!options.dialog.open) options.dialog.showModal();

  const onClose = () => dispose();
  options.dialog.addEventListener('close', onClose, { once: true });
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (active?.path && editor) viewStates.set(active.path, editor.saveViewState());
    options.dialog.removeEventListener('cancel', onDialogCancel);
    window.removeEventListener('beforeunload', onBeforeUnload);
    model?.dispose();
    editor?.dispose();
    model = null;
    editor = null;
  }
  return dispose;
}

function normalizePath(value: string): string {
  const path = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Use a safe project-relative path.');
  return path;
}

function duplicatePath(path: string): string {
  const slash = path.lastIndexOf('/');
  const directory = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${directory}${name}.copy`;
  return `${directory}${name.slice(0, dot)}.copy${name.slice(dot)}`;
}

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', glsl: 'cpp',
  } as Record<string, string>)[extension ?? ''] ?? 'plaintext';
}

function starterForPath(path: string): string {
  const language = languageForPath(path);
  if (language === 'typescript') return "export function initialize(): void {\n  console.info('Kyxos script initialized');\n}\n";
  if (language === 'javascript') return "export function initialize() {\n  console.info('Kyxos script initialized');\n}\n";
  if (language === 'json') return '{}\n';
  return '';
}

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best effort.
  }
}

function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best effort.
  }
}
