import type { KyxosApiClient, SourceFileRecord } from '@kyxos/api-client';
import { button, element } from '@kyxos/shared-ui';

export interface CodeEditorOptions {
  dialog: HTMLDialogElement;
  client: Pick<KyxosApiClient, 'sourceFiles'>;
  projectId: string;
  canEdit: boolean;
  onLog(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}

export async function mountCodeEditor(options: CodeEditorOptions): Promise<() => void> {
  const monaco = await import('./monaco-setup');
  let files = await options.client.sourceFiles.list(options.projectId);
  let active: SourceFileRecord | null = files[0] ?? null;
  let editor: ReturnType<typeof monaco.editor.create> | null = null;
  let model: ReturnType<typeof monaco.editor.createModel> | null = null;
  let dirty = false;
  let disposed = false;

  const header = element('header', { className: 'dialog-header' });
  const heading = element('h2', { text: 'Code Editor' });
  const state = element('span', { className: 'code-save-state', text: options.canEdit ? 'Saved' : 'Read only' });
  header.append(heading, state, button('Close', () => options.dialog.close(), 'secondary'));
  const layout = element('div', { className: 'code-editor-layout' });
  const sidebar = element('aside', { className: 'code-editor-sidebar' });
  const editorHost = element('div', { className: 'code-editor-host' });
  layout.append(sidebar, editorHost);
  options.dialog.replaceChildren(header, layout);

  function renderFiles(): void {
    sidebar.replaceChildren();
    const toolbar = element('div', { className: 'code-files-toolbar' });
    const save = button('Save', () => void saveActive(), 'primary mini');
    save.disabled = !options.canEdit || !active || !dirty;
    const create = button('New', () => void createFile(), 'mini');
    create.disabled = !options.canEdit;
    const remove = button('Delete', () => void deleteActive(), 'mini danger');
    remove.disabled = !options.canEdit || !active;
    toolbar.append(save, create, remove);
    sidebar.append(toolbar);
    for (const file of files) {
      const item = button(file.path, () => void openFile(file), file.path === active?.path ? 'code-file active' : 'code-file');
      item.title = `${file.language} · revision ${file.revision}`;
      sidebar.append(item);
    }
    if (!files.length) sidebar.append(element('p', { className: 'muted', text: 'Create a project source file to begin.' }));
  }

  async function openFile(file: SourceFileRecord): Promise<void> {
    if (dirty && active && !confirm(`Discard unsaved changes to ${active.path}?`)) return;
    active = file;
    dirty = false;
    model?.dispose();
    model = monaco.editor.createModel(
      file.content,
      file.language || languageForPath(file.path),
      monaco.Uri.parse(`kyxos://project/${options.projectId}/${file.path}`),
    );
    editor?.setModel(model);
    editor?.updateOptions({ readOnly: !options.canEdit });
    model.onDidChangeContent(() => {
      dirty = true;
      state.textContent = 'Unsaved';
      renderFiles();
    });
    state.textContent = options.canEdit ? `r${file.revision} · Saved` : `r${file.revision} · Read only`;
    renderFiles();
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
      if (confirm('The file may have changed remotely. Reload project source files?')) {
        files = await options.client.sourceFiles.list(options.projectId);
        const replacement = files.find((entry) => entry.path === active?.path);
        if (replacement) await openFile(replacement);
      }
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
    } catch (error) { options.onLog('error', `Could not create ${path}.`, error); }
  }

  async function deleteActive(): Promise<void> {
    if (!active || !options.canEdit || !confirm(`Delete ${active.path}?`)) return;
    try {
      await options.client.sourceFiles.remove(options.projectId, active.path);
      const deletedPath = active.path;
      files = files.filter((entry) => entry.path !== deletedPath);
      active = files[0] ?? null;
      model?.dispose();
      model = null;
      editor?.setModel(null);
      dirty = false;
      if (active) await openFile(active);
      else renderFiles();
      options.onLog('warn', `Deleted ${deletedPath}.`);
    } catch (error) { options.onLog('error', `Could not delete ${active.path}.`, error); }
  }

  editor = monaco.editor.create(editorHost, {
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 13,
    tabSize: 2,
    insertSpaces: true,
    readOnly: !options.canEdit,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveActive());
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    allowNonTsExtensions: true,
  });
  renderFiles();
  if (active) await openFile(active);
  if (!options.dialog.open) options.dialog.showModal();

  const onClose = () => dispose();
  options.dialog.addEventListener('close', onClose, { once: true });
  function dispose(): void {
    if (disposed) return;
    disposed = true;
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
