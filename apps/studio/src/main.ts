import './styles.css';
import {
  createApiClient,
  hashBlob,
  type AssetManifest,
  type BranchRecord,
  type CheckpointRecord,
  type CollaborationConnection,
  type CollaborationOperation,
  type CollaborationPresence,
  type ProjectSummary,
  type ProjectMemberRecord,
  type ReleaseRecord,
} from '@kyxos/api-client';
import {
  AssetWorkspaceService,
  AutosaveController,
  DiagnosticConsole,
  HierarchyService,
  ImportTaskQueue,
  MIXED_VALUE,
  ProjectSession,
  SceneWorkspaceService,
  SceneDocument,
  SchemaInspectorModel,
  StudioApi,
  StudioMcpBridge,
  StudioPluginRegistry,
  createAnimationStateGraph,
  createProjectWorkspace,
  createDefaultInspectorRegistry,
  diffValues,
  mergeReimportedScene,
  rangeSelection,
  resolveMergeConflicts,
  roleCan,
  threeWayMerge,
  type InspectorFieldSchema,
  type OfflineDraftStore,
  type ProjectWorkspace,
} from '@kyxos/editor-core';
import {
  createEmptySceneContract,
  type JsonPatchOperation,
  type KyxosSceneContract,
  type SceneAnimation,
  type SceneCamera,
  type SceneLight,
  type SceneMaterial,
  type SceneNode,
  type ScenePatch,
  type Transform,
} from '@kyxos/scene-contract';
import { button, element, safeText, setBusy } from '@kyxos/shared-ui';
import { createStudioShell } from '@kyxos/studio-shell';
import {
  BrowserKyxosViewportAdapter,
  type EditorTool,
  type SnapSettings,
} from '@kyxos/viewer-adapter';
import { bundleExternalGltf, type ExternalGltfBundleResult } from './gltf-bundler';
import { mountAnimationGraphEditor } from './animation-graph-ui';
import { mountAdvancedTools } from './advanced-tools-ui';
import { mountCodeEditor } from './code-editor-ui';

const app = document.querySelector<HTMLElement>('#app')!;
const client = createApiClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  functionsUrl: import.meta.env.VITE_KYXOS_FUNCTIONS_URL,
});

const offlineStore = createIndexedDbDraftStore();
let disposeCurrentScreen: (() => void) | null = null;

void boot();

async function boot(): Promise<void> {
  disposeCurrentScreen?.();
  disposeCurrentScreen = null;
  const session = await client.auth.getSession();
  if (session) await renderProjects();
  else renderLogin();
}

function renderLogin(): void {
  const panel = element('form', { className: 'auth-card' });
  panel.innerHTML = [
    '<div class="brand-mark">K</div>',
    '<h1>Kyxos Studio</h1>',
    '<p>Sign in to create, edit and publish immutable 3D scenes.</p>',
    '<label>Email<input name="email" type="email" required autocomplete="email"></label>',
    '<label>Password<input name="password" type="password" required autocomplete="current-password"></label>',
    '<button type="submit">Sign in</button>',
    '<small>Without Supabase variables, this preview uses the local acceptance provider.</small>',
    '<div class="form-error" role="alert"></div>',
  ].join('');
  panel.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = panel.querySelector<HTMLButtonElement>('button[type=submit]')!;
    setBusy(submit, true);
    try {
      const data = new FormData(panel);
      await client.auth.signIn(String(data.get('email')), String(data.get('password')));
      await renderProjects();
    } catch (error) {
      panel.querySelector<HTMLElement>('.form-error')!.textContent = errorMessage(error);
    } finally {
      setBusy(submit, false);
    }
  });

  const screen = element('main', { className: 'auth-screen' });
  screen.append(panel);
  app.replaceChildren(screen);
}

async function renderProjects(): Promise<void> {
  disposeCurrentScreen?.();
  disposeCurrentScreen = null;
  const screen = element('main', { className: 'projects-screen' });
  const header = element('header', { className: 'projects-header' });
  const brand = element('div');
  brand.innerHTML = '<span class="brand-mark small">K</span><strong>Kyxos Studio</strong>';
  const actions = element('div', { className: 'project-actions' });
  actions.append(
    button('New project', async () => {
      const name = prompt('Project name', 'Untitled Project');
      if (!name) return;
      await openProject(await client.projects.create(name));
    }),
    button(
      'Sign out',
      async () => {
        await client.auth.signOut();
        renderLogin();
      },
      'secondary',
    ),
  );
  header.append(brand, actions);

  const grid = element('section', { className: 'project-grid' });
  const projects = await client.projects.list();
  if (!projects.length) {
    grid.append(
      element('div', {
        className: 'empty-state',
        text: 'Create a project, upload a GLB, edit it, and publish an immutable version.',
      }),
    );
  }
  for (const project of projects) {
    const card = element('article', { className: 'project-card' });
    card.innerHTML = [
      '<div class="project-thumb">3D</div>',
      '<div class="project-copy">',
      `<h2>${safeText(project.name)}</h2>`,
      `<p>Updated ${new Date(project.updatedAt).toLocaleString()}</p>`,
      '</div>',
    ].join('');
    card.tabIndex = 0;
    card.addEventListener('click', () => void openProject(project));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void openProject(project);
    });
    const menu = button(
      '•••',
      () => {
        const action = prompt('Action: rename, duplicate, archive, delete');
        void handleProjectAction(project, action ?? '');
      },
      'icon-button',
    );
    menu.addEventListener('click', (event) => event.stopPropagation());
    card.append(menu);
    grid.append(card);
  }

  screen.append(header, element('div', { className: 'projects-title', text: 'Projects' }), grid);
  app.replaceChildren(screen);
}

async function handleProjectAction(project: ProjectSummary, action: string): Promise<void> {
  if (action === 'rename') {
    const name = prompt('New name', project.name);
    if (name) await client.projects.rename(project.id, name);
  } else if (action === 'duplicate') {
    await client.projects.duplicate(project.id);
  } else if (action === 'archive') {
    await client.projects.archive(project.id);
  } else if (action === 'delete') {
    await client.projects.remove(project.id);
  }
  await renderProjects();
}

async function openProject(project: ProjectSummary): Promise<void> {
  disposeCurrentScreen?.();
  const [draft, storedWorkspace, authSession, initialMembers] = await Promise.all([
    client.drafts.load(project.id),
    client.workspaces.load(project.id),
    client.auth.getSession(),
    client.members.list(project.id),
  ]);
  if (!authSession) {
    renderLogin();
    return;
  }
  let projectMembers: ProjectMemberRecord[] = initialMembers;
  const currentRole = projectMembers.find((member) => member.userId === authSession.userId)?.role ?? 'viewer';
  const canEdit = roleCan(currentRole, 'project:edit');
  const canManageMembers = roleCan(currentRole, 'project:manage-members');
  let workspace: SceneWorkspaceService;
  try {
    workspace = new SceneWorkspaceService(
      storedWorkspace?.workspace as unknown as ProjectWorkspace
        ?? createProjectWorkspace(project.id, draft?.contract ?? createEmptySceneContract(project.name)),
    );
  } catch {
    workspace = new SceneWorkspaceService(
      createProjectWorkspace(project.id, draft?.contract ?? createEmptySceneContract(project.name)),
    );
  }
  let workspaceRevision = storedWorkspace?.revision ?? 0;
  const initial = structuredClone(workspace.activeScene.document);
  if (!initial.lights?.length) initial.lights = createDefaultLights();
  workspace.updateScene(workspace.activeScene.id, initial);
  const document = new SceneDocument(initial);
  const session = new ProjectSession(project.id, document);
  const commandHost = {
    getScene: () => document.value,
    execute: (
      label: string,
      patch: (scene: KyxosSceneContract) => ScenePatch,
      mergeKey?: string,
    ) => execute(label, patch, mergeKey),
  };
  const hierarchy = new HierarchyService(commandHost, session.clipboard);
  const assetWorkspace = new AssetWorkspaceService(commandHost);
  const importQueue = new ImportTaskQueue<void>(2);
  const diagnosticConsole = new DiagnosticConsole();
  const studioApi = new StudioApi({
    getScene: () => document.value,
    applyPatch: (label, patch) => execute(label, () => patch),
    getSelection: () => session.selection.selected,
    setSelection: (ids) => session.selection.select(ids),
  });
  const pluginRegistry = new StudioPluginRegistry(studioApi, diagnosticConsole);
  const mcpBridge = new StudioMcpBridge(studioApi, canEdit);
  let manifest: AssetManifest = await client.assets.getManifest(Object.keys(initial.assets));
  const resolver = {
    resolve(asset: { uri: string }): string {
      const url = manifest.assets[asset.uri];
      if (!url) throw new Error(`Asset is not available: ${asset.uri}`);
      return url;
    },
  };

  const shell = createStudioShell(app);
  const canvas = element('canvas', {
    attrs: { id: 'studio-canvas', tabindex: '0' },
  });
  const viewportNotice = element('div', { className: 'viewport-overlay' });
  shell.viewport.append(canvas, viewportNotice);
  const releaseDialog = element('dialog', { className: 'release-dialog' });
  const animationGraphDialog = element('dialog', { className: 'release-dialog animation-graph-dialog' });
  const codeDialog = element('dialog', { className: 'release-dialog code-editor-dialog' });
  const advancedDialog = element('dialog', { className: 'release-dialog advanced-tools-dialog' });
  shell.root.append(releaseDialog, animationGraphDialog, codeDialog, advancedDialog);
  let disposeAnimationGraph: (() => void) | null = null;
  let disposeCodeEditor: (() => void) | null = null;
  let disposeAdvancedTools: (() => void) | null = null;

  const adapter = new BrowserKyxosViewportAdapter(resolver, {
    backend: initial.renderSettings.backend,
    quality: initial.renderSettings.qualityPreset,
  });
  await adapter.mount(canvas);
  await adapter.loadDocument(document);
  const inspectorModel = new SchemaInspectorModel(
    createDefaultInspectorRegistry(adapter.getCapabilities()),
  );
  const unbindAdapter = adapter.bindSession(session);

  const autosave = new AutosaveController(
    project.id,
    document,
    {
      save: (id, contract, revision) => canEdit
        ? client.drafts.save(id, contract, revision)
        : Promise.resolve({ revision }),
      load: async (id) => {
        const value = await client.drafts.load(id);
        return value
          ? { contract: value.contract, revision: value.revision }
          : null;
      },
    },
    offlineStore,
    draft?.revision ?? 0,
  );

  let previewMode = false;
  let activeAnimationId = initial.animations.find((entry) => entry.autoplay)?.id ?? initial.animations[0]?.id;
  let animationPlaying = false;
  let selectedMaterialSlot = 0;
  let hierarchyAnchorId: string | null = null;
  let renamingNodeId: string | null = null;
  let assetQuery = '';
  let activeAssetFolderId: string | null | undefined = undefined;
  let showDeletedAssets = false;
  let assetKindFilter = '';
  let pendingReimportAssetId: string | null = null;
  let assetSearchTimer: number | null = null;
  let workspaceSaveTimer: number | null = null;
  let workspaceSaveInFlight: Promise<void> | null = null;
  let workspaceDirty = storedWorkspace == null;
  const collaborationClientId = crypto.randomUUID();
  let collaborationConnection: CollaborationConnection | null = null;
  let collaborationGeneration = 0;
  let collaborationSequence = 0;
  let collaborationRevision = 0;
  let collaborationPresence: CollaborationPresence[] = [];
  const collaborationConflicts: CollaborationOperation[] = [];
  const recentLocalPaths = new Map<string, number>();
  let snap: SnapSettings = {
    translation: 0.1,
    rotation: 15,
    scale: 0.1,
    enabled: false,
  };

  const saveBadge = element('span', {
    className: 'save-state',
    text: autosave.state,
  });
  autosave.addEventListener('state', (event) => {
    const detail = (event as CustomEvent).detail;
    saveBadge.textContent = detail.state;
    saveBadge.dataset.state = detail.state;
    shell.observer.set('status', detail.state);
    shell.status.textContent = detail.error
      ? `${detail.state}: ${errorMessage(detail.error)}`
      : `${detail.state} · revision ${detail.revision}`;
  });

  const projectButton = button(
    '← Projects',
    async () => {
      await Promise.all([autosave.flush(), flushWorkspace()]);
      cleanup();
      await renderProjects();
    },
    'secondary',
  );
  const title = element('strong', { text: `${project.name} / ${workspace.activeScene.name}` });
  const roleBadge = element('span', { className: `role-badge ${currentRole}`, text: currentRole });
  const presenceStrip = element('div', { className: 'presence-strip', attrs: { 'aria-label': 'Online collaborators' } });
  shell.root.classList.toggle('studio-read-only', !canEdit);
  shell.topbar.append(projectButton, title, roleBadge, presenceStrip, saveBadge);

  const toolGroup = element('div', { className: 'tool-group' });
  const toolButtons = new Map<EditorTool, HTMLButtonElement>();
  for (const [label, tool] of [
    ['Select', 'select'],
    ['Move', 'translate'],
    ['Rotate', 'rotate'],
    ['Scale', 'scale'],
  ] as const) {
    const control = button(label, () => setTool(tool), tool === 'select' ? 'active' : '');
    control.disabled = !canEdit && tool !== 'select';
    toolButtons.set(tool, control);
    toolGroup.append(control);
  }
  shell.topbar.append(toolGroup);

  const coordinateSelect = element('select', {
    attrs: { 'aria-label': 'Coordinate space' },
  });
  coordinateSelect.append(new Option('Local', 'local'), new Option('World', 'world'));
  coordinateSelect.addEventListener('change', () =>
    adapter.setCoordinateSpace(coordinateSelect.value as 'local' | 'world'),
  );
  coordinateSelect.disabled = !canEdit;
  const snapButton = button('Snap off', () => {
    snap = { ...snap, enabled: !snap.enabled };
    adapter.setSnap(snap);
    snapButton.textContent = snap.enabled ? 'Snap on' : 'Snap off';
    snapButton.classList.toggle('active', snap.enabled);
  });
  snapButton.disabled = !canEdit;
  shell.topbar.append(coordinateSelect, snapButton);

  const undoButton = button('Undo', () => session.history.undo());
  const redoButton = button('Redo', () => session.history.redo());
  const refreshHistoryButtons = () => {
    undoButton.disabled = !canEdit || !session.history.canUndo;
    redoButton.disabled = !canEdit || !session.history.canRedo;
  };
  session.history.addEventListener('change', refreshHistoryButtons);
  refreshHistoryButtons();

  const previewButton = button('Preview', () => {
    previewMode = !previewMode;
    shell.root.classList.toggle('preview-mode', previewMode);
    previewButton.textContent = previewMode ? 'Exit preview' : 'Preview';
    previewButton.classList.toggle('active', previewMode);
    requestAnimationFrame(() => adapter.resetCamera());
  }, 'preview-toggle secondary');
  shell.topbar.append(undoButton, redoButton, previewButton);

  const uploadInput = element('input', {
    attrs: {
      type: 'file',
      accept: '.glb,.gltf,.bin,.hdr,.exr,.png,.jpg,.jpeg,.webp,.ktx2',
      multiple: '',
      hidden: '',
    },
  });
  uploadInput.addEventListener('change', () => {
    const files = [...(uploadInput.files ?? [])];
    uploadInput.value = '';
    if (files.length) void importFiles(files);
  });
  const reimportInput = element('input', {
    attrs: {
      type: 'file',
      accept: '.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2',
      multiple: '',
      hidden: '',
    },
  });
  reimportInput.addEventListener('change', () => {
    const files = [...(reimportInput.files ?? [])];
    reimportInput.value = '';
    const assetId = pendingReimportAssetId;
    pendingReimportAssetId = null;
    if (!assetId || !files.length) return;
    const answer = prompt('Reimport mode: keep-overrides, reset-overrides, replace', 'keep-overrides');
    const mode = answer === 'reset-overrides' || answer === 'replace' ? answer : 'keep-overrides';
    importQueue.enqueue(`Reimport ${files[0].name}`, async (context) => {
      context.report('parsing', 0.1);
      const gltf = files.find((file) => file.name.toLowerCase().endsWith('.gltf'));
      const bundle = gltf ? await bundleExternalGltf(files, gltf.name) : undefined;
      context.report('uploading', 0.25);
      await importAsset(bundle?.file ?? files[0], bundle, { assetId, mode });
      context.report('building', 0.95);
    });
  });
  const uploadButton = button('Upload', () => uploadInput.click());
  const publishButton = button('Publish', () => void publish(), 'primary');
  uploadButton.disabled = !canEdit;
  publishButton.disabled = !roleCan(currentRole, 'project:publish');
  shell.topbar.append(
    uploadInput,
    reimportInput,
    uploadButton,
    button('Scenes', () => void showSceneManager(), 'secondary'),
    button('State Graph', () => void showAnimationGraphEditor(), 'secondary'),
    button('Collaborate', () => void showCollaborationManager(), 'secondary'),
    button('History', () => void showVersionControl(), 'secondary'),
    button('Code', () => void showCodeEditor(), 'secondary'),
    button('Tools', () => showAdvancedTools(), 'secondary'),
    button('Versions', () => void showReleaseManager(), 'secondary'),
    publishButton,
  );

  const hierarchyToolbar = element('div', { className: 'panel-toolbar' });
  const hierarchySearch = element('input', {
    attrs: { type: 'search', placeholder: 'Search hierarchy' },
  });
  const addHierarchyButton = button('Add', () => {
    const rect = addHierarchyButton.getBoundingClientRect();
    showHierarchyMenu(rect.left, rect.bottom, session.selection.selected[0] ?? null, true);
  }, 'mini');
  const duplicateHierarchyButton = button('Duplicate', duplicateSelected, 'mini');
  const isolateHierarchyButton = button('Isolate', isolateSelected, 'mini');
  const deleteHierarchyButton = button('Delete', deleteSelected, 'mini');
  addHierarchyButton.disabled = !canEdit;
  duplicateHierarchyButton.disabled = !canEdit;
  isolateHierarchyButton.disabled = !canEdit;
  deleteHierarchyButton.disabled = !canEdit;
  hierarchyToolbar.append(
    hierarchySearch,
    addHierarchyButton,
    button('Frame', () => adapter.frame(session.selection.selected), 'mini'),
    duplicateHierarchyButton,
    isolateHierarchyButton,
    deleteHierarchyButton,
  );
  const tree = element('div', { className: 'hierarchy-tree' });
  tree.setAttribute('role', 'tree');
  tree.tabIndex = 0;
  const hierarchyMenu = element('div', {
    className: 'studio-context-menu',
    attrs: { role: 'menu', hidden: '' },
  });
  shell.hierarchy.append(hierarchyToolbar, tree);
  shell.root.append(hierarchyMenu);
  hierarchySearch.addEventListener('input', () => renderHierarchy());
  hierarchy.addEventListener('expansion', () => renderHierarchy());

  const unregisterCorePlugin = pluginRegistry.register({
    manifest: {
      id: 'kyxos.core.tools',
      name: 'Kyxos Core Studio Tools',
      version: '1.0.0',
      description: 'Built-in commands exposed through the Studio API and MCP bridge.',
      permissions: ['scene:read', 'scene:write', 'selection:read', 'selection:write', 'commands:register', 'panels:register'],
    },
    activate(context) {
      const disposers = [
        context.api.registerCommand({
          id: 'scene.validate',
          label: 'Validate Scene Contract',
          run() {
            diagnosticConsole.log('info', 'Scene Contract is valid.', {
              nodes: document.value.nodes.length,
              assets: Object.keys(document.value.assets).length,
            }, 'validation');
          },
        }),
        context.api.registerCommand({
          id: 'hierarchy.add-empty',
          label: 'Add Empty Entity',
          enabled: () => canEdit,
          run() { session.selection.select([hierarchy.add('empty', session.selection.selected[0] ?? null)]); },
        }),
        context.api.registerCommand({
          id: 'selection.frame',
          label: 'Frame Selection',
          shortcut: 'F',
          run() { adapter.frame(session.selection.selected); },
        }),
        context.api.registerCommand({
          id: 'scene.export-contract',
          label: 'Export Scene Contract',
          run() { downloadText(`${project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-scene.json`, JSON.stringify(document.value, null, 2), 'application/json'); },
        }),
        context.api.registerPanel({
          id: 'scene.summary',
          title: 'Scene Summary',
          mount(container) {
            const scene = context.api.getScene();
            container.textContent = `${scene.nodes.length} nodes · ${Object.keys(scene.assets).length} assets`;
          },
        }),
      ];
      return () => disposers.reverse().forEach((dispose) => dispose());
    },
  });
  void pluginRegistry.activate('kyxos.core.tools').catch((error) => diagnosticConsole.log('error', errorMessage(error), error, 'plugins'));
  const studioGlobal = Object.freeze({ api: studioApi, plugins: pluginRegistry, console: diagnosticConsole, mcp: mcpBridge });
  (globalThis as typeof globalThis & { kyxosStudio?: unknown }).kyxosStudio = studioGlobal;

  session.selection.addEventListener('change', () => {
    renderHierarchy();
    renderInspector();
    void publishPresence();
  });
  session.document.addEventListener('change', (event) => {
    workspace.updateScene(workspace.activeScene.id, document.value);
    renderHierarchy();
    renderInspector();
    renderAssets();
    const detail = (event as CustomEvent<{ patch?: ScenePatch; source?: string }>).detail;
    if (detail?.patch?.length && detail.source !== 'realtime-remote') {
      void publishCollaborationOperation(detail.patch);
    }
  });
  workspace.addEventListener('change', () => scheduleWorkspaceSave());
  importQueue.addEventListener('change', () => renderAssets());

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if ((target.matches('input,textarea,select') || target.closest('.monaco-editor')) && event.key !== 'Escape') return;
    if (canEdit && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? session.history.redo() : session.history.undo();
    } else if (canEdit && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      session.history.redo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      hierarchy.copy(session.selection.selected);
    } else if (canEdit && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      hierarchy.cut(session.selection.selected);
      session.selection.clear();
    } else if (canEdit && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      session.selection.select(hierarchy.paste(session.selection.selected[0] ?? null));
    } else if (canEdit && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      session.selection.select(hierarchy.duplicate(session.selection.selected));
    } else if (canEdit && event.key === 'F2' && session.selection.selected.length === 1) {
      event.preventDefault();
      startInlineRename(session.selection.selected[0]);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      const ids = hierarchy.rows(hierarchySearch.value).map((entry) => entry.id);
      if (!ids.length) return;
      event.preventDefault();
      const current = Math.max(0, ids.indexOf(session.selection.selected.at(-1) ?? ''));
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
      const nextId = ids[index];
      session.selection.select(event.shiftKey ? rangeSelection(ids, hierarchyAnchorId, nextId) : [nextId]);
      if (!event.shiftKey) hierarchyAnchorId = nextId;
      tree.querySelector<HTMLElement>(`[data-node="${CSS.escape(nextId)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const nodeId = session.selection.selected.at(-1);
      const node = document.value.nodes.find((entry) => entry.id === nodeId);
      if (!node) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') {
        if (hierarchy.isExpanded(node.id)) hierarchy.setExpanded(node.id, false);
        else if (node.parentId) session.selection.select([node.parentId]);
      } else if (node.children.length && !hierarchy.isExpanded(node.id)) {
        hierarchy.setExpanded(node.id, true);
      } else if (node.children[0]) session.selection.select([node.children[0]]);
    } else if (event.key.toLowerCase() === 'f') {
      adapter.frame(session.selection.selected);
    } else if (canEdit && event.key.toLowerCase() === 'w') {
      setTool('translate');
    } else if (canEdit && event.key.toLowerCase() === 'e') {
      setTool('rotate');
    } else if (canEdit && event.key.toLowerCase() === 'r') {
      setTool('scale');
    } else if (canEdit && (event.key === 'Delete' || event.key === 'Backspace')) {
      deleteSelected();
    } else if (event.key === 'Escape' && previewMode) {
      previewButton.click();
    }
  };
  const onPageHide = () => void Promise.all([autosave.flush(), flushWorkspace()]);
  const onGlobalPointerDown = (event: PointerEvent) => {
    if (!hierarchyMenu.contains(event.target as Node)) hierarchyMenu.hidden = true;
  };
  const onVisibility = () => {
    if (documentGlobal.hidden) void autosave.flush();
  };
  const onWindowError = (event: ErrorEvent) => {
    diagnosticConsole.log('error', event.message, { filename: event.filename, line: event.lineno, column: event.colno }, 'window');
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    diagnosticConsole.log('error', 'Unhandled promise rejection.', event.reason, 'window');
  };
  const documentGlobal = globalThis.document;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onGlobalPointerDown);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  documentGlobal.addEventListener('visibilitychange', onVisibility);

  disposeCurrentScreen = cleanup;
  renderHierarchy();
  renderInspector();
  renderAssets();
  renderPresence();
  void connectCollaboration();
  const presenceHeartbeat = window.setInterval(() => void publishPresence(), 10_000);
  shell.status.textContent = `Viewer ${adapter.getCapabilities()?.viewerApiVersion ?? 'starting'} · ${adapter.getCapabilities()?.backend ?? 'unknown backend'}`;

  function cleanup(): void {
    if (disposeCurrentScreen !== cleanup && !shell.root.isConnected) return;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onGlobalPointerDown);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    documentGlobal.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(presenceHeartbeat);
    collaborationGeneration += 1;
    collaborationConnection?.dispose();
    collaborationConnection = null;
    unbindAdapter();
    adapter.dispose();
    autosave.dispose();
    if (assetSearchTimer != null) window.clearTimeout(assetSearchTimer);
    if (workspaceSaveTimer != null) window.clearTimeout(workspaceSaveTimer);
    disposeAnimationGraph?.();
    disposeAnimationGraph = null;
    disposeCodeEditor?.();
    disposeCodeEditor = null;
    disposeAdvancedTools?.();
    disposeAdvancedTools = null;
    pluginRegistry.deactivate('kyxos.core.tools');
    unregisterCorePlugin();
    if ((globalThis as typeof globalThis & { kyxosStudio?: unknown }).kyxosStudio === studioGlobal) {
      delete (globalThis as typeof globalThis & { kyxosStudio?: unknown }).kyxosStudio;
    }
    animationGraphDialog.close();
    codeDialog.close();
    advancedDialog.close();
    releaseDialog.close();
    shell.destroy();
    if (disposeCurrentScreen === cleanup) disposeCurrentScreen = null;
  }

  function setTool(tool: EditorTool): void {
    adapter.setTool(tool);
    for (const [name, control] of toolButtons) {
      control.classList.toggle('active', name === tool);
    }
  }

  function execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void {
    if (!canEdit) {
      showNotice('This project is read-only for Viewer members.', true);
      return;
    }
    session.commands.execute({
      id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${crypto.randomUUID()}`,
      label,
      mergeKey,
      patch,
    });
  }

  function scheduleWorkspaceSave(): void {
    if (!canEdit) return;
    workspaceDirty = true;
    if (workspaceSaveTimer != null) window.clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = window.setTimeout(() => void flushWorkspace(), 650);
  }

  async function flushWorkspace(): Promise<void> {
    if (workspaceSaveTimer != null) {
      window.clearTimeout(workspaceSaveTimer);
      workspaceSaveTimer = null;
    }
    if (workspaceSaveInFlight) await workspaceSaveInFlight;
    if (!workspaceDirty || !canEdit) {
      workspaceDirty = false;
      return;
    }
    workspaceDirty = false;
    workspaceSaveInFlight = (async () => {
      try {
        const result = await client.workspaces.save(
          project.id,
          workspace.value as unknown as Record<string, unknown>,
          workspaceRevision,
        );
        workspaceRevision = result.revision;
      } catch (error) {
        workspaceDirty = true;
        showNotice(`Workspace save failed: ${errorMessage(error)}`, true);
      }
    })();
    await workspaceSaveInFlight;
    workspaceSaveInFlight = null;
    if (workspaceDirty && shell.root.isConnected) scheduleWorkspaceSave();
  }

  async function connectCollaboration(): Promise<void> {
    const generation = ++collaborationGeneration;
    collaborationConnection?.dispose();
    collaborationConnection = null;
    collaborationPresence = [];
    renderPresence();
    try {
      const connection = await client.collaboration.connect({
        projectId: project.id,
        sceneId: workspace.activeScene.id,
        clientId: collaborationClientId,
        onOperation: (operation) => receiveCollaborationOperation(operation),
        onPresence: (presence) => {
          if (generation !== collaborationGeneration) return;
          collaborationPresence = presence.filter((entry) => Date.now() - entry.updatedAt < 60_000);
          renderPresence();
        },
      });
      if (generation !== collaborationGeneration) {
        connection.dispose();
        return;
      }
      collaborationConnection = connection;
      await publishPresence();
    } catch (error) {
      if (generation === collaborationGeneration) showNotice(`Realtime offline: ${errorMessage(error)}`, true);
    }
  }

  async function publishCollaborationOperation(patch: ScenePatch): Promise<void> {
    if (!canEdit || !collaborationConnection) return;
    const now = Date.now();
    for (const operation of patch) recentLocalPaths.set(operation.path, now);
    for (const [path, timestamp] of recentLocalPaths) {
      if (now - timestamp > 10_000) recentLocalPaths.delete(path);
    }
    const operation: CollaborationOperation = {
      id: crypto.randomUUID(),
      projectId: project.id,
      sceneId: workspace.activeScene.id,
      clientId: collaborationClientId,
      userId: authSession.userId,
      sequence: ++collaborationSequence,
      baseRevision: collaborationRevision++,
      patch: structuredClone(patch),
      createdAt: new Date().toISOString(),
    };
    try {
      await collaborationConnection.publishOperation(operation);
    } catch (error) {
      showNotice(`Realtime publish failed: ${errorMessage(error)}`, true);
    }
  }

  function receiveCollaborationOperation(operation: CollaborationOperation): void {
    if (operation.clientId === collaborationClientId || operation.sceneId !== workspace.activeScene.id) return;
    const patch = operation.patch as ScenePatch;
    const now = Date.now();
    const overlaps = patch.some((entry) => {
      const timestamp = recentLocalPaths.get(entry.path);
      return timestamp != null && now - timestamp <= 10_000;
    });
    if (overlaps) {
      collaborationConflicts.push(structuredClone(operation));
      showNotice('Realtime conflict detected. Open Collaborate to choose a resolution.', true);
      return;
    }
    try {
      document.apply(patch, 'realtime-remote');
      collaborationRevision = Math.max(collaborationRevision + 1, operation.baseRevision + 1);
    } catch (error) {
      collaborationConflicts.push(structuredClone(operation));
      showNotice(`Realtime conflict: ${errorMessage(error)}`, true);
    }
  }

  async function publishPresence(): Promise<void> {
    if (!collaborationConnection) return;
    try {
      await collaborationConnection.publishPresence({
        projectId: project.id,
        userId: authSession.userId,
        clientId: collaborationClientId,
        displayName: authSession.email.split('@')[0] || authSession.email,
        color: userColor(authSession.userId),
        sceneId: workspace.activeScene.id,
        selection: session.selection.selected,
        updatedAt: Date.now(),
      });
    } catch {
      // The connection status is surfaced by operation errors and the empty presence strip.
    }
  }

  function renderPresence(): void {
    presenceStrip.replaceChildren();
    const visible = collaborationPresence.filter((entry) => entry.sceneId === workspace.activeScene.id);
    for (const presence of visible.slice(0, 6)) {
      const avatar = element('span', {
        className: 'presence-avatar',
        text: presence.displayName.slice(0, 1).toUpperCase(),
        attrs: { title: `${presence.displayName}${presence.selection.length ? ` · ${presence.selection.length} selected` : ''}` },
      });
      avatar.style.setProperty('--presence-color', presence.color);
      presenceStrip.append(avatar);
    }
    if (visible.length > 6) presenceStrip.append(element('span', { className: 'presence-more', text: `+${visible.length - 6}` }));
  }

  function renderHierarchy(): void {
    tree.replaceChildren();
    const scene = document.value;
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    const rows = hierarchy.rows(hierarchySearch.value);
    for (const hierarchyRow of rows) {
      const node = byId.get(hierarchyRow.id);
      if (!node) continue;
      const row = element('div', {
        className: 'hierarchy-row',
        attrs: {
          draggable: String(canEdit),
          'data-node': node.id,
          role: 'treeitem',
          'aria-level': String(hierarchyRow.depth + 1),
          'aria-selected': String(session.selection.selected.includes(node.id)),
        },
      });
      if (hierarchyRow.hasChildren) row.setAttribute('aria-expanded', String(hierarchyRow.expanded));
      row.style.paddingLeft = `${6 + hierarchyRow.depth * 14}px`;
      row.classList.toggle('selected', session.selection.selected.includes(node.id));
      row.classList.toggle('locked', Boolean(node.locked));

      const visibility = button(
        node.visible ? '◉' : '○',
        () => hierarchy.setVisible([node.id], !node.visible, true),
        'mini',
      );
      visibility.title = node.visible ? 'Hide subtree' : 'Show subtree';
      visibility.disabled = !canEdit;
      visibility.addEventListener('click', (event) => event.stopPropagation());
      const disclosure = button(
        hierarchyRow.hasChildren ? (hierarchyRow.expanded ? '▾' : '▸') : '',
        () => hierarchy.toggleExpanded(node.id),
        'hierarchy-disclosure mini',
      );
      disclosure.disabled = !hierarchyRow.hasChildren;
      disclosure.addEventListener('click', (event) => event.stopPropagation());
      const name = renamingNodeId === node.id
        ? createInlineRename(node)
        : element('span', { className: 'hierarchy-name', text: node.name });
      name.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        if (canEdit) startInlineRename(node.id);
      });
      const lock = button(
        node.locked ? '🔒' : '◇',
        () => hierarchy.setLocked([node.id], !node.locked),
        'mini',
      );
      lock.title = node.locked ? 'Unlock' : 'Lock';
      lock.disabled = !canEdit;
      lock.addEventListener('click', (event) => event.stopPropagation());
      row.append(disclosure, visibility, nodeIcon(node), name, lock);
      row.addEventListener('click', (event) => {
        const visibleIds = rows.map((entry) => entry.id);
        if (event.shiftKey) {
          session.selection.select(rangeSelection(visibleIds, hierarchyAnchorId, node.id));
        } else if (event.ctrlKey || event.metaKey) {
          session.selection.select([node.id], 'toggle');
          hierarchyAnchorId = node.id;
        } else {
          session.selection.select([node.id]);
          hierarchyAnchorId = node.id;
        }
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (!session.selection.selected.includes(node.id)) session.selection.select([node.id]);
        showHierarchyMenu(event.clientX, event.clientY, node.id);
      });
      row.addEventListener('dragstart', (event) => {
        if (!canEdit) {
          event.preventDefault();
          return;
        }
        const ids = session.selection.selected.includes(node.id)
          ? session.selection.selected
          : [node.id];
        event.dataTransfer?.setData('application/x-kyxos-nodes', JSON.stringify(ids));
        event.dataTransfer?.setData('text/kyxos-node', node.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (event) => {
        if (!canEdit) return;
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
        const position = ratio < 0.27 ? 'before' : ratio > 0.73 ? 'after' : 'inside';
        row.dataset.dropPosition = position;
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('dragleave', () => delete row.dataset.dropPosition);
      row.addEventListener('drop', (event) => {
        if (!canEdit) return;
        event.preventDefault();
        const raw = event.dataTransfer?.getData('application/x-kyxos-nodes');
        const ids = raw ? JSON.parse(raw) as string[] : [event.dataTransfer?.getData('text/kyxos-node') ?? ''];
        const position = (row.dataset.dropPosition ?? 'inside') as 'before' | 'inside' | 'after';
        delete row.dataset.dropPosition;
        try { hierarchy.move(ids.filter(Boolean), node.id, position) }
        catch (error) { showNotice(errorMessage(error), true) }
      });
      tree.append(row);
    }
  }

  function startInlineRename(nodeId: string): void {
    if (!canEdit) return;
    renamingNodeId = nodeId;
    renderHierarchy();
    requestAnimationFrame(() => tree.querySelector<HTMLInputElement>(`[data-rename-node="${CSS.escape(nodeId)}"]`)?.select());
  }

  function createInlineRename(node: SceneNode): HTMLInputElement {
    const input = element('input', {
      className: 'hierarchy-rename',
      attrs: { value: node.name, 'data-rename-node': node.id, 'aria-label': `Rename ${node.name}` },
    });
    let cancelled = false;
    const commit = () => {
      if (cancelled || renamingNodeId !== node.id) return;
      renamingNodeId = null;
      try { hierarchy.rename(node.id, input.value) }
      catch (error) { showNotice(errorMessage(error), true) }
      renderHierarchy();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); commit() }
      else if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        renamingNodeId = null;
        renderHierarchy();
      }
    });
    input.addEventListener('blur', commit);
    return input;
  }

  function showHierarchyMenu(x: number, y: number, nodeId: string | null, addOnly = false): void {
    hierarchyMenu.replaceChildren();
    const selected = session.selection.selected;
    const addItem = (label: string, action: () => void, disabled = false) => {
      const item = button(label, () => {
        hierarchyMenu.hidden = true;
        try { action() } catch (error) { showNotice(errorMessage(error), true) }
      });
      item.setAttribute('role', 'menuitem');
      item.disabled = disabled;
      hierarchyMenu.append(item);
    };
    addItem('Add Empty', () => session.selection.select([hierarchy.add('empty', nodeId)]), !canEdit);
    addItem('Add Camera', () => session.selection.select([hierarchy.add('camera', nodeId)]), !canEdit);
    addItem('Add Directional Light', () => session.selection.select([hierarchy.add('directional-light', nodeId)]), !canEdit);
    addItem('Add Point Light', () => session.selection.select([hierarchy.add('point-light', nodeId)]), !canEdit);
    addItem('Add Spot Light', () => session.selection.select([hierarchy.add('spot-light', nodeId)]), !canEdit);
    if (!addOnly) {
      hierarchyMenu.append(element('hr'));
      addItem('Rename', () => nodeId && startInlineRename(nodeId), !canEdit || !nodeId || selected.length !== 1);
      addItem('Cut', () => hierarchy.cut(selected), !canEdit || !selected.length);
      addItem('Copy', () => hierarchy.copy(selected), !selected.length);
      addItem('Paste as Child', () => session.selection.select(hierarchy.paste(nodeId)), !canEdit);
      addItem('Duplicate', () => session.selection.select(hierarchy.duplicate(selected)), !canEdit || !selected.length);
      hierarchyMenu.append(element('hr'));
      addItem('Lock', () => hierarchy.setLocked(selected, true), !canEdit || !selected.length);
      addItem('Unlock', () => hierarchy.setLocked(selected, false), !canEdit || !selected.length);
      addItem('Hide', () => hierarchy.setVisible(selected, false, true), !canEdit || !selected.length);
      addItem('Show', () => hierarchy.setVisible(selected, true, true), !canEdit || !selected.length);
      addItem('Isolate', () => hierarchy.isolate(selected), !canEdit || !selected.length);
      addItem('Unisolate', () => hierarchy.unisolate(), !canEdit);
      hierarchyMenu.append(element('hr'));
      addItem('Delete', () => { hierarchy.remove(selected); session.selection.clear() }, !canEdit || !selected.length);
    }
    hierarchyMenu.style.left = `${Math.max(4, Math.min(window.innerWidth - 210, x))}px`;
    hierarchyMenu.style.top = `${Math.max(4, Math.min(window.innerHeight - 360, y))}px`;
    hierarchyMenu.hidden = false;
    hierarchyMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  function _reparent(childId: string, parentId: string): void {
    const scene = document.value;
    const childIndex = scene.nodes.findIndex((node) => node.id === childId);
    const parentIndex = scene.nodes.findIndex((node) => node.id === parentId);
    if (childIndex < 0 || parentIndex < 0) return;
    const child = scene.nodes[childIndex];
    const parent = scene.nodes[parentIndex];
    if (child.parentId === parentId || isDescendant(scene.nodes, childId, parentId)) return;

    execute('Reparent node', () => {
      const patch: ScenePatch = [];
      if (child.parentId) {
        const oldParentIndex = scene.nodes.findIndex((node) => node.id === child.parentId);
        if (oldParentIndex >= 0) {
          patch.push({
            op: 'replace',
            path: `/nodes/${oldParentIndex}/children`,
            value: scene.nodes[oldParentIndex].children.filter((id) => id !== childId),
          });
        }
      }
      patch.push(
        {
          op: 'replace',
          path: `/nodes/${parentIndex}/children`,
          value: [...new Set([...parent.children, childId])],
        },
        { op: 'replace', path: `/nodes/${childIndex}/parentId`, value: parentId },
      );
      return patch;
    });
  }

  function duplicateSelected(): void {
    try {
      const roots = hierarchy.duplicate(session.selection.selected);
      if (roots.length) session.selection.select(roots);
    } catch (error) {
      showNotice(errorMessage(error), true);
    }
  }

  function isolateSelected(): void {
    hierarchy.isolate(session.selection.selected);
  }

  function deleteSelected(): void {
    hierarchy.remove(session.selection.selected);
    session.selection.clear();
  }

  function renderInspector(): void {
    shell.inspector.replaceChildren();
    const scene = document.value;
    const selectedNodes = session.selection.selected
      .map((id) => scene.nodes.find((node) => node.id === id))
      .filter((node): node is SceneNode => Boolean(node));

    renderSchemaInspector(scene, selectedNodes);
    renderMaterialVariantInspector(scene);
    renderAnimationInspector(scene);
    if (!canEdit) {
      shell.inspector.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input,select,textarea,button',
      ).forEach((control) => { control.disabled = true });
    }
  }

  function renderSchemaInspector(scene: KyxosSceneContract, nodes: SceneNode[]): void {
    const context = { scene, nodeIds: nodes.map((node) => node.id) };
    for (const schema of inspectorModel.registry.sections(context)) {
      const section = inspectorSection(schema.title, schema.order <= 40);
      section.dataset.schemaSection = schema.id;
      for (const field of schema.fields(context)) {
        const value = inspectorModel.read(field, context);
        if (!value.paths.length) continue;
        const control = createSchemaControl(field, value.value, value.mixed);
        if (!canEdit && (control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
          control.disabled = true;
        }
        const fieldRow = element('div', { className: 'schema-field' });
        const label = element('label', { className: 'schema-field-label', text: field.label });
        if ('id' in control && control.id) label.htmlFor = control.id;
        if (field.tooltip) {
          label.title = field.tooltip;
          label.append(element('span', { className: 'field-tooltip', text: ' ?' }));
        }
        const valueWrap = element('div', { className: 'schema-field-value' });
        valueWrap.append(control);
        if (field.unit) valueWrap.append(element('span', { className: 'field-unit', text: field.unit }));
        if (value.mixed) valueWrap.append(element('span', { className: 'mixed-value', text: 'Mixed' }));
        if (value.overridden) valueWrap.append(element('span', { className: 'override-value', text: 'Override' }));
        const actions = element('div', { className: 'schema-field-actions' });
        const reset = button('Reset', () => applyInspectorPatch(`Reset ${field.label}`, inspectorModel.reset(field, { ...context, scene: document.value })), 'mini');
        reset.disabled = !canEdit;
        reset.title = `Reset to ${String(field.defaultValue ?? 'unset')}`;
        const restore = button('Restore', () => applyInspectorPatch(`Restore ${field.label}`, inspectorModel.restore(field, { ...context, scene: document.value })), 'mini');
        restore.disabled = !canEdit || !value.overridden;
        restore.title = 'Restore the value imported from the source asset.';
        actions.append(reset, restore);
        fieldRow.append(label, valueWrap, actions);
        if (value.validationError) fieldRow.append(element('span', { className: 'field-error', text: value.validationError }));
        section.append(fieldRow);
      }
      shell.inspector.append(section);
    }
  }

  function createSchemaControl(
    field: InspectorFieldSchema,
    rawValue: unknown,
    mixed: boolean,
  ): HTMLElement {
    const id = `inspector-${field.id.replace(/[^a-z0-9]+/gi, '-')}`;
    const currentValue = mixed || rawValue === MIXED_VALUE ? undefined : rawValue;
    const commit = (input: unknown) => {
      const scene = document.value;
      const context = { scene, nodeIds: session.selection.selected };
      try {
        if (field.id === 'node.parent') {
          if (!input) hierarchy.moveToRoot(session.selection.selected);
          else hierarchy.move(session.selection.selected, String(input), 'inside');
          return;
        }
        const patch = input === undefined
          ? inspectorModel.clear(field, context)
          : inspectorModel.update(field, context, input);
        applyInspectorPatch(`Change ${field.label}`, patch, `schema:${field.id}:${session.selection.selected.join(',')}`);
      } catch (error) {
        showNotice(errorMessage(error), true);
        renderInspector();
      }
    };

    if (field.type === 'boolean') {
      const input = element('input', { attrs: { id, type: 'checkbox' } });
      input.checked = Boolean(currentValue);
      input.indeterminate = mixed;
      input.addEventListener('change', () => commit(input.checked));
      return input;
    }
    if (field.type === 'select') {
      const select = element('select', { attrs: { id } });
      if (mixed) select.append(new Option('— Mixed —', ''));
      for (const option of field.options ?? []) select.append(new Option(option.label, option.value));
      select.value = currentValue == null ? '' : String(currentValue);
      select.addEventListener('change', () => commit(select.value));
      return select;
    }
    if (field.type === 'asset') {
      const select = element('select', { attrs: { id, 'data-picker': 'asset' } });
      select.append(new Option(mixed ? '— Mixed —' : 'None', ''));
      const allowed = new Set(field.assetKinds ?? []);
      for (const asset of Object.values(document.value.assets).filter((entry) => !allowed.size || allowed.has(entry.kind))) {
        select.append(new Option(`${asset.name ?? asset.id} · ${asset.kind}`, asset.id));
      }
      const assetId = currentValue && typeof currentValue === 'object'
        ? (currentValue as { assetId?: string }).assetId
        : typeof currentValue === 'string' ? currentValue : '';
      select.value = assetId ?? '';
      select.addEventListener('change', () => {
        if (!select.value) commit(undefined);
        else if (field.id.startsWith('material.')) {
          const srgb = /baseColor|emissive/i.test(field.id);
          commit({
            assetId: select.value,
            colorSpace: srgb ? 'srgb' : 'linear',
            offset: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            wrapS: 'repeat',
            wrapT: 'repeat',
          });
        } else commit(select.value);
      });
      return select;
    }
    if (field.type === 'entity') {
      const select = element('select', { attrs: { id, 'data-picker': 'entity' } });
      select.append(new Option(mixed ? '— Mixed —' : 'None / Root', ''));
      const selected = new Set(session.selection.selected);
      for (const node of document.value.nodes.filter((entry) => !selected.has(entry.id))) {
        select.append(new Option(node.name, node.id));
      }
      select.value = typeof currentValue === 'string' ? currentValue : '';
      select.addEventListener('change', () => commit(select.value || null));
      return select;
    }
    if (field.type === 'color') {
      const input = element('input', {
        attrs: { id, type: 'color', value: inspectorColor(currentValue) },
      });
      input.addEventListener('input', () => {
        if (typeof currentValue === 'string' || currentValue == null) commit(input.value);
        else {
          const [x, y, z] = hexRgb(input.value);
          commit({ x, y, z, ...('w' in (currentValue as object) ? { w: (currentValue as any).w ?? 1 } : {}) });
        }
      });
      return input;
    }
    if (field.type === 'readonly') return element('output', { attrs: { id }, text: String(currentValue ?? '—') });

    const input = element('input', {
      attrs: {
        id,
        type: field.type === 'number' ? 'number' : 'text',
        ...(field.minimum == null ? {} : { min: String(field.minimum) }),
        ...(field.maximum == null ? {} : { max: String(field.maximum) }),
        ...(field.step == null ? {} : { step: String(field.step) }),
        ...(mixed ? { placeholder: '— Mixed —' } : { value: String(currentValue ?? '') }),
      },
    });
    const eventName = field.type === 'number' ? 'input' : 'change';
    input.addEventListener(eventName, () => commit(field.type === 'number' ? Number(input.value) : input.value));
    return input;
  }

  function applyInspectorPatch(label: string, patch: ScenePatch, mergeKey?: string): void {
    if (!patch.length) return;
    execute(label, () => patch, mergeKey);
  }

  function inspectorColor(value: unknown): string {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
    if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
      return rgbHex(value as { x: number; y: number; z: number });
    }
    return '#ffffff';
  }

  function renderMaterialVariantInspector(scene: KyxosSceneContract): void {
    if (!scene.materialVariants?.length) return;
    const section = inspectorSection('Material Variants', true);
    const select = element('select', { attrs: { 'aria-label': 'Material variant' } });
    select.append(new Option('Default', ''));
    for (const variant of scene.materialVariants) select.append(new Option(variant.name, variant.id));
    select.value = scene.activeMaterialVariantId ?? '';
    select.addEventListener('change', () => {
      const current = document.value;
      const exists = current.activeMaterialVariantId != null;
      applyInspectorPatch('Material variant', select.value
        ? [{ op: exists ? 'replace' : 'add', path: '/activeMaterialVariantId', value: select.value }]
        : exists ? [{ op: 'remove', path: '/activeMaterialVariantId' }] : []);
    });
    appendField(section, 'Variant', select);
    shell.inspector.append(section);
  }

  function _renderTransformInspector(
    scene: KyxosSceneContract,
    nodes: SceneNode[],
  ): void {
    const section = inspectorSection('Transform', true);
    if (nodes.length === 1) {
      const index = scene.nodes.findIndex((node) => node.id === nodes[0].id);
      const name = element('input', { attrs: { value: nodes[0].name } });
      name.addEventListener('change', () =>
        execute('Rename node', () => [
          { op: 'replace', path: `/nodes/${index}/name`, value: name.value },
        ]),
      );
      appendField(section, 'Name', name);
    } else {
      section.append(element('p', { className: 'muted', text: `${nodes.length} nodes selected` }));
    }

    for (const property of ['position', 'rotation', 'scale'] as const) {
      const vector = element('fieldset', { className: 'vector-field' });
      vector.append(
        element('legend', {
          text: property[0].toUpperCase() + property.slice(1),
        }),
      );
      for (const axis of ['x', 'y', 'z'] as const) {
        const input = element('input', {
          attrs: {
            type: 'number',
            step: property === 'rotation' ? '0.01' : '0.1',
            value: String(nodes[0].transform[property][axis]),
            'aria-label': `${property} ${axis}`,
          },
        });
        input.addEventListener('input', () =>
          execute(
            `Change ${property}`,
            (current) =>
              nodes.flatMap((node) => {
                const index = current.nodes.findIndex((entry) => entry.id === node.id);
                return index < 0 || current.nodes[index].locked
                  ? []
                  : [
                      {
                        op: 'replace' as const,
                        path: `/nodes/${index}/transform/${property}/${axis}`,
                        value: Number(input.value),
                      },
                    ];
              }),
            `inspector:${nodes.map((node) => node.id).join(',')}:${property}:${axis}`,
          ),
        );
        vector.append(element('span', { text: axis.toUpperCase() }), input);
      }
      section.append(vector);
    }

    const actions = element('div', { className: 'inline-actions' });
    actions.append(
      button(
        'Reset',
        () =>
          execute('Reset transform', (current) =>
            nodes.flatMap((node) => {
              const index = current.nodes.findIndex((entry) => entry.id === node.id);
              return index < 0
                ? []
                : [
                    {
                      op: 'replace' as const,
                      path: `/nodes/${index}/transform`,
                      value: identityTransform(),
                    },
                  ];
            }),
          ),
        'mini',
      ),
      button(
        'Copy',
        () => session.clipboard.copy(nodes[0].transform),
        'mini',
      ),
      button(
        'Paste',
        () => {
          const transform = session.clipboard.paste<Transform>();
          if (!transform) return;
          execute('Paste transform', (current) =>
            nodes.flatMap((node) => {
              const index = current.nodes.findIndex((entry) => entry.id === node.id);
              return index < 0
                ? []
                : [
                    {
                      op: 'replace' as const,
                      path: `/nodes/${index}/transform`,
                      value: transform,
                    },
                  ];
            }),
          );
        },
        'mini',
      ),
    );
    section.append(actions);
    shell.inspector.append(section);
  }

  function _renderMaterialInspector(
    scene: KyxosSceneContract,
    node: SceneNode,
  ): void {
    if (!node.materialSlots?.length) return;
    selectedMaterialSlot = Math.min(selectedMaterialSlot, node.materialSlots.length - 1);
    const materialId = node.materialSlots[selectedMaterialSlot];
    const material = scene.materials[materialId];
    if (!material) return;
    const path = `/materials/${escapePointer(materialId)}`;
    const section = inspectorSection('Material', true);

    if (node.materialSlots.length > 1) {
      const slots = element('select', { attrs: { 'aria-label': 'Material slot' } });
      node.materialSlots.forEach((id, index) =>
        slots.append(new Option(scene.materials[id]?.name ?? `Slot ${index + 1}`, String(index))),
      );
      slots.value = String(selectedMaterialSlot);
      slots.addEventListener('change', () => {
        selectedMaterialSlot = Number(slots.value);
        renderInspector();
      });
      appendField(section, 'Slot', slots);
    }

    const color = element('input', {
      attrs: { type: 'color', value: rgbHex(material.baseColor) },
    });
    color.addEventListener('input', () => {
      const [x, y, z] = hexRgb(color.value);
      execute(
        'Base color',
        () => [
          {
            op: 'replace',
            path: `${path}/baseColor`,
            value: { x, y, z, w: material.baseColor.w },
          },
        ],
        `${materialId}:baseColor`,
      );
    });
    appendField(section, 'Base Color', color);

    for (const key of ['metalness', 'roughness', 'opacity', 'normalScale'] as const) {
      const current = key === 'normalScale' ? material.normalScale ?? 1 : material[key];
      const range = element('input', {
        attrs: {
          type: 'range',
          min: key === 'normalScale' ? '0' : '0',
          max: key === 'normalScale' ? '4' : '1',
          step: '0.01',
          value: String(current),
        },
      });
      range.addEventListener('input', () =>
        execute(
          `Change ${key}`,
          () => [
            {
              op: material[key] == null ? 'add' : 'replace',
              path: `${path}/${key}`,
              value: Number(range.value),
            },
          ],
          `${materialId}:${key}`,
        ),
      );
      appendField(section, key, range);
    }

    const alpha = element('select', { attrs: { 'aria-label': 'Alpha mode' } });
    alpha.append(
      new Option('Opaque', 'opaque'),
      new Option('Mask', 'mask'),
      new Option('Blend', 'blend'),
    );
    alpha.value = material.alphaMode;
    alpha.addEventListener('change', () =>
      execute('Alpha mode', () => [
        { op: 'replace', path: `${path}/alphaMode`, value: alpha.value },
      ]),
    );
    appendField(section, 'Alpha Mode', alpha);

    const doubleSided = element('input', { attrs: { type: 'checkbox' } });
    doubleSided.checked = material.doubleSided;
    doubleSided.addEventListener('change', () =>
      execute('Double sided', () => [
        { op: 'replace', path: `${path}/doubleSided`, value: doubleSided.checked },
      ]),
    );
    appendField(section, 'Double Sided', doubleSided);

    const textureAssets = Object.values(scene.assets).filter(
      (asset) => asset.kind === 'texture',
    );
    for (const [label, key] of [
      ['Base Texture', 'baseColorTexture'],
      ['Normal Texture', 'normalTexture'],
      ['Roughness Texture', 'roughnessTexture'],
      ['Metalness Texture', 'metalnessTexture'],
      ['Emissive Texture', 'emissiveTexture'],
      ['AO Texture', 'aoTexture'],
    ] as const) {
      const select = element('select', { attrs: { 'aria-label': label } });
      select.append(new Option('None', ''));
      for (const asset of textureAssets) {
        select.append(new Option(asset.name ?? asset.contentHash.slice(0, 10), asset.id));
      }
      select.value = material[key]?.assetId ?? '';
      select.addEventListener('change', () => {
        const existing = material[key];
        if (!select.value && existing) {
          execute(`Remove ${label}`, () => [{ op: 'remove', path: `${path}/${key}` }]);
        } else if (select.value) {
          execute(`Set ${label}`, () => [
            {
              op: existing ? 'replace' : 'add',
              path: `${path}/${key}`,
              value: {
                assetId: select.value,
                colorSpace: key === 'baseColorTexture' || key === 'emissiveTexture' ? 'srgb' : 'linear',
                offset: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
              },
            },
          ]);
        }
      });
      appendField(section, label, select);
    }

    const baseTexture = material.baseColorTexture;
    if (baseTexture) {
      const uv = element('fieldset', { className: 'vector-field uv-field' });
      uv.append(element('legend', { text: 'Base UV Offset / Scale' }));
      for (const [group, component] of [
        ['offset', 'x'],
        ['offset', 'y'],
        ['scale', 'x'],
        ['scale', 'y'],
      ] as const) {
        const input = element('input', {
          attrs: {
            type: 'number',
            step: '0.01',
            value: String(baseTexture[group]?.[component] ?? (group === 'scale' ? 1 : 0)),
          },
        });
        input.addEventListener('input', () =>
          execute(
            'Texture UV transform',
            () => [
              {
                op: 'replace',
                path: `${path}/baseColorTexture/${group}/${component}`,
                value: Number(input.value),
              },
            ],
            `${materialId}:uv:${group}:${component}`,
          ),
        );
        uv.append(element('span', { text: `${group[0].toUpperCase()}${component.toUpperCase()}` }), input);
      }
      section.append(uv);
    }

    const restore = button(
      'Restore imported material',
      () => {
        const original = material.metadata?.original;
        if (original && typeof original === 'object') {
          execute('Restore material', () => [
            {
              op: 'replace',
              path,
              value: { ...structuredClone(original), id: material.id, name: material.name, metadata: material.metadata },
            },
          ]);
        }
      },
      'secondary',
    );
    restore.disabled = !material.metadata?.original;
    section.append(restore);
    shell.inspector.append(section);
  }

  function renderAnimationInspector(scene: KyxosSceneContract): void {
    if (!scene.animations.length) return;
    const section = inspectorSection('Animation', false);
    const select = element('select', { attrs: { 'aria-label': 'Animation clip' } });
    for (const animation of scene.animations) {
      select.append(new Option(animation.name, animation.id));
    }
    activeAnimationId ??= scene.animations[0].id;
    select.value = activeAnimationId;
    select.addEventListener('change', () => {
      activeAnimationId = select.value;
      animationPlaying = false;
      playAnimation(false, 0);
      renderInspector();
    });
    appendField(section, 'Clip', select);

    const animation = scene.animations.find((entry) => entry.id === activeAnimationId)!;
    const controls = element('div', { className: 'inline-actions' });
    controls.append(
      button('Play', () => playAnimation(true), 'mini'),
      button('Pause', () => playAnimation(false), 'mini'),
      button('Stop', () => playAnimation(false, 0), 'mini'),
    );
    section.append(controls);

    const loop = element('input', { attrs: { type: 'checkbox' } });
    loop.checked = animation.loop;
    loop.addEventListener('change', () => updateAnimation(animation.id, 'loop', loop.checked));
    appendField(section, 'Loop', loop);

    const speed = element('input', {
      attrs: { type: 'number', min: '0', max: '8', step: '0.05', value: String(animation.speed) },
    });
    speed.addEventListener('change', () => updateAnimation(animation.id, 'speed', Number(speed.value)));
    appendField(section, 'Speed', speed);

    const defaultClip = element('input', { attrs: { type: 'checkbox' } });
    defaultClip.checked = Boolean(animation.autoplay);
    defaultClip.addEventListener('change', () => {
      execute('Set default animation', (current) =>
        current.animations.map((entry, index) => ({
          op: entry.autoplay == null ? 'add' : 'replace',
          path: `/animations/${index}/autoplay`,
          value: defaultClip.checked && entry.id === animation.id,
        })),
      );
    });
    appendField(section, 'Default / Autoplay', defaultClip);

    const runtime = adapter.getAnimationState();
    const duration = runtime?.duration || animation.duration || 0;
    const time = element('input', {
      attrs: {
        type: 'range',
        min: '0',
        max: String(Math.max(duration, 0.01)),
        step: '0.01',
        value: String(runtime?.time ?? 0),
      },
    });
    time.addEventListener('input', () => playAnimation(animationPlaying, Number(time.value)));
    appendField(section, `Time · ${duration.toFixed(2)}s`, time);
    shell.inspector.append(section);
  }

  function updateAnimation(
    animationId: string,
    key: 'loop' | 'speed',
    value: boolean | number,
  ): void {
    const scene = document.value;
    const index = scene.animations.findIndex((entry) => entry.id === animationId);
    if (index < 0) return;
    execute(`Animation ${key}`, () => [
      { op: 'replace', path: `/animations/${index}/${key}`, value },
    ]);
    queueMicrotask(() => playAnimation(animationPlaying));
  }

  function playAnimation(playing: boolean, time?: number): void {
    const animation = document.value.animations.find((entry) => entry.id === activeAnimationId);
    if (!animation) return;
    animationPlaying = playing;
    adapter.setAnimationState({
      clipId: animation.id,
      playing,
      loop: animation.loop,
      speed: animation.speed,
      time,
    });
  }

  function _renderEnvironmentInspector(scene: KyxosSceneContract): void {
    const section = inspectorSection('Environment', false);
    const environments = Object.values(scene.assets).filter(
      (asset) => asset.kind === 'environment',
    );
    const select = element('select', { attrs: { 'aria-label': 'HDR environment' } });
    select.append(new Option('Default studio environment', ''));
    for (const asset of environments) {
      select.append(new Option(asset.name ?? asset.contentHash.slice(0, 10), asset.id));
    }
    select.value = scene.environment.assetId ?? '';
    select.addEventListener('change', async () => {
      const operation: JsonPatchOperation = select.value
        ? {
            op: scene.environment.assetId ? 'replace' : 'add',
            path: '/environment/assetId',
            value: select.value,
          }
        : { op: 'remove', path: '/environment/assetId' };
      execute('Change environment', () => [operation]);
      await adapter.loadEnvironmentAsset(select.value || undefined);
    });
    appendField(section, 'HDR / EXR', select);

    for (const [label, key, min, max, step] of [
      ['Rotation', 'rotation', -Math.PI, Math.PI, 0.01],
      ['Environment Intensity', 'intensity', 0, 8, 0.05],
      ['Background Intensity', 'backgroundIntensity', 0, 8, 0.05],
      ['Background Blur', 'backgroundBlur', 0, 1, 0.01],
    ] as const) {
      const input = element('input', {
        attrs: {
          type: 'range',
          min: String(min),
          max: String(max),
          step: String(step),
          value: String(scene.environment[key]),
        },
      });
      input.addEventListener('input', () =>
        execute(
          label,
          () => [
            { op: 'replace', path: `/environment/${key}`, value: Number(input.value) },
          ],
          `environment:${key}`,
        ),
      );
      appendField(section, label, input);
    }

    const color = element('input', {
      attrs: { type: 'color', value: scene.environment.backgroundColor },
    });
    color.addEventListener('input', () =>
      execute('Background color', () => [
        { op: 'replace', path: '/environment/backgroundColor', value: color.value },
      ]),
    );
    appendField(section, 'Background Color', color);

    const transparent = element('input', { attrs: { type: 'checkbox' } });
    transparent.checked = scene.environment.transparentBackground;
    transparent.addEventListener('change', () =>
      execute('Transparent background', () => [
        {
          op: 'replace',
          path: '/environment/transparentBackground',
          value: transparent.checked,
        },
      ]),
    );
    appendField(section, 'Transparent', transparent);
    shell.inspector.append(section);
  }

  function _renderLightingInspector(scene: KyxosSceneContract): void {
    const section = inspectorSection('Lighting', false);
    const lights = scene.lights ?? [];
    for (const [index, light] of lights.entries()) {
      const card = element('div', { className: 'sub-card' });
      card.append(element('strong', { text: light.name }));
      const color = element('input', { attrs: { type: 'color', value: light.color } });
      color.addEventListener('input', () =>
        execute('Light color', () => [
          { op: 'replace', path: `/lights/${index}/color`, value: color.value },
        ]),
      );
      appendField(card, 'Color', color);
      const intensity = element('input', {
        attrs: { type: 'range', min: '0', max: '20', step: '0.05', value: String(light.intensity) },
      });
      intensity.addEventListener('input', () =>
        execute(
          'Light intensity',
          () => [
            {
              op: 'replace',
              path: `/lights/${index}/intensity`,
              value: Number(intensity.value),
            },
          ],
          `light:${light.id}:intensity`,
        ),
      );
      appendField(card, 'Intensity', intensity);
      const shadows = element('input', { attrs: { type: 'checkbox' } });
      shadows.checked = light.castShadow;
      shadows.addEventListener('change', () =>
        execute('Light shadow', () => [
          {
            op: 'replace',
            path: `/lights/${index}/castShadow`,
            value: shadows.checked,
          },
        ]),
      );
      appendField(card, 'Cast Shadow', shadows);
      for (const axis of ['x', 'y', 'z'] as const) {
        const position = element('input', {
          attrs: {
            type: 'number',
            step: '0.1',
            value: String(light.transform.position[axis]),
          },
        });
        position.addEventListener('input', () =>
          execute(
            'Light position',
            () => [
              {
                op: 'replace',
                path: `/lights/${index}/transform/position/${axis}`,
                value: Number(position.value),
              },
            ],
            `light:${light.id}:position:${axis}`,
          ),
        );
        appendField(card, `Position ${axis.toUpperCase()}`, position);
      }
      if (index > 0) {
        card.append(
          button(
            'Remove light',
            () => execute('Remove light', () => [{ op: 'remove', path: `/lights/${index}` }]),
            'secondary',
          ),
        );
      }
      section.append(card);
    }
    section.append(
      button(
        'Add auxiliary light',
        () =>
          execute('Add light', () => [
            { op: 'add', path: '/lights/-', value: createAuxiliaryLight() },
          ]),
        'secondary',
      ),
    );
    shell.inspector.append(section);
  }

  function _renderCameraInspector(scene: KyxosSceneContract): void {
    const section = inspectorSection('Camera', false);
    const select = element('select', { attrs: { 'aria-label': 'Publish camera' } });
    for (const camera of scene.cameras) select.append(new Option(camera.name, camera.id));
    select.value = scene.activeCameraId;
    select.addEventListener('change', () =>
      execute('Set publish camera', () => [
        { op: 'replace', path: '/activeCameraId', value: select.value },
      ]),
    );
    appendField(section, 'Publish Camera', select);
    const cameraIndex = Math.max(
      0,
      scene.cameras.findIndex((entry) => entry.id === scene.activeCameraId),
    );
    const camera = scene.cameras[cameraIndex];
    if (camera) {
      for (const [label, key, min, max, step] of [
        ['FOV', 'fov', 1, 160, 1],
        ['Near', 'near', 0.001, 100, 0.01],
        ['Far', 'far', 1, 100000, 1],
      ] as const) {
        const input = element('input', {
          attrs: {
            type: 'number',
            min: String(min),
            max: String(max),
            step: String(step),
            value: String(camera[key]),
          },
        });
        input.addEventListener('input', () =>
          execute(
            `Camera ${key}`,
            () => [
              {
                op: 'replace',
                path: `/cameras/${cameraIndex}/${key}`,
                value: Number(input.value),
              },
            ],
            `camera:${camera.id}:${key}`,
          ),
        );
        appendField(section, label, input);
      }
      const autoRotate = element('input', { attrs: { type: 'checkbox' } });
      autoRotate.checked = Boolean(camera.autoRotate);
      autoRotate.addEventListener('change', () =>
        execute('Camera auto rotate', () => [
          {
            op: camera.autoRotate == null ? 'add' : 'replace',
            path: `/cameras/${cameraIndex}/autoRotate`,
            value: autoRotate.checked,
          },
        ]),
      );
      appendField(section, 'Auto Rotate', autoRotate);
    }
    const actions = element('div', { className: 'inline-actions' });
    actions.append(
      button('Reset View', () => adapter.resetCamera(), 'mini'),
      button(
        'Create Camera',
        () => {
          const newCamera = createCamera(`Camera ${scene.cameras.length + 1}`);
          execute('Create camera', () => [
            { op: 'add', path: '/cameras/-', value: newCamera },
            { op: 'replace', path: '/activeCameraId', value: newCamera.id },
          ]);
        },
        'mini',
      ),
      button(
        'Delete Camera',
        () => {
          if (scene.cameras.length <= 1) return;
          const replacement = scene.cameras.find((_, index) => index !== cameraIndex)!;
          execute('Delete camera', () => [
            { op: 'replace', path: '/activeCameraId', value: replacement.id },
            { op: 'remove', path: `/cameras/${cameraIndex}` },
          ]);
        },
        'mini',
      ),
    );
    section.append(actions);
    shell.inspector.append(section);
  }

  function _renderRenderInspector(scene: KyxosSceneContract): void {
    const section = inspectorSection('Render Settings', false);
    const quality = element('select', { attrs: { 'aria-label': 'Quality preset' } });
    for (const value of ['low', 'medium', 'high', 'cinematic', 'ultra', 'capture']) {
      quality.append(new Option(value[0].toUpperCase() + value.slice(1), value));
    }
    quality.value = scene.renderSettings.qualityPreset;
    quality.addEventListener('change', () => {
      execute('Quality preset', () => [
        {
          op: 'replace',
          path: '/renderSettings/qualityPreset',
          value: quality.value,
        },
      ]);
      adapter.setQualityPreset(
        quality.value as Parameters<BrowserKyxosViewportAdapter['setQualityPreset']>[0],
      );
    });
    appendField(section, 'Quality', quality);

    const backend = element('select', { attrs: { 'aria-label': 'Backend' } });
    backend.append(
      new Option('Auto', 'auto'),
      new Option('WebGPU', 'webgpu'),
      new Option('WebGL 2', 'webgl2'),
    );
    backend.value = scene.renderSettings.backend;
    backend.addEventListener('change', () => {
      execute('Backend', () => [
        { op: 'replace', path: '/renderSettings/backend', value: backend.value },
      ]);
      shell.status.textContent = 'Backend preference saved. It is applied when the scene is reopened or published.';
    });
    appendField(section, 'Backend', backend);

    const exposure = element('input', {
      attrs: { type: 'range', min: '0', max: '8', step: '0.01', value: String(scene.renderSettings.exposure) },
    });
    exposure.addEventListener('input', () =>
      execute(
        'Exposure',
        () => [
          {
            op: 'replace',
            path: '/renderSettings/exposure',
            value: Number(exposure.value),
          },
        ],
        'render:exposure',
      ),
    );
    appendField(section, 'Exposure', exposure);

    const capabilities = adapter.getCapabilities();
    for (const [effect, capability] of Object.entries(capabilities?.effects ?? {})) {
      const current = scene.renderSettings.effects[effect as keyof typeof scene.renderSettings.effects];
      const defaults = capability.parameters ?? {};
      const card = element('details', { className: 'effect-card' });
      const summary = element('summary');
      const enabled = element('input', { attrs: { type: 'checkbox' } });
      enabled.checked = current?.enabled ?? Boolean(defaults.enabled);
      enabled.disabled = !capability.available;
      enabled.addEventListener('click', (event) => event.stopPropagation());
      enabled.addEventListener('change', () =>
        execute(`Toggle ${effect}`, () => [
          {
            op: current ? 'replace' : 'add',
            path: `/renderSettings/effects/${escapePointer(effect)}`,
            value: { ...defaults, ...(current ?? {}), enabled: enabled.checked },
          },
        ]),
      );
      summary.append(enabled, element('span', { text: effect }));
      card.append(summary);
      const settings = { ...defaults, ...(current ?? {}) } as Record<string, unknown>;
      for (const [parameter, value] of Object.entries(settings)) {
        if (parameter === 'enabled') continue;
        if (typeof value === 'number') {
          const input = element('input', {
            attrs: { type: 'number', step: '0.01', value: String(value) },
          });
          input.addEventListener('input', () =>
            execute(
              `${effect} ${parameter}`,
              () => [
                {
                  op: current ? 'replace' : 'add',
                  path: `/renderSettings/effects/${escapePointer(effect)}`,
                  value: {
                    ...defaults,
                    ...(current ?? {}),
                    enabled: enabled.checked,
                    [parameter]: Number(input.value),
                  },
                },
              ],
              `effect:${effect}:${parameter}`,
            ),
          );
          appendField(card, parameter, input);
        } else if (typeof value === 'boolean') {
          const input = element('input', { attrs: { type: 'checkbox' } });
          input.checked = value;
          input.addEventListener('change', () =>
            execute(`${effect} ${parameter}`, () => [
              {
                op: current ? 'replace' : 'add',
                path: `/renderSettings/effects/${escapePointer(effect)}`,
                value: {
                  ...defaults,
                  ...(current ?? {}),
                  enabled: enabled.checked,
                  [parameter]: input.checked,
                },
              },
            ]),
          );
          appendField(card, parameter, input);
        }
      }
      if (!capability.available) {
        card.append(element('p', { className: 'warning', text: capability.reason ?? 'Unavailable on this backend.' }));
      }
      section.append(card);
    }
    shell.inspector.append(section);
  }

  function renderAssets(): void {
    shell.assets.replaceChildren();
    const editButton = (label: string, action: () => void, className?: string) => {
      const control = button(label, action, className);
      control.disabled = !canEdit;
      return control;
    };
    const scene = document.value;
    const toolbar = element('div', { className: 'asset-workspace-toolbar' });
    const folders = assetWorkspace.folders();
    const folderSelect = element('select', { attrs: { 'aria-label': 'Asset folder' } });
    folderSelect.append(new Option('All Assets', '__all__'), new Option('Root', '__root__'));
    for (const folder of folders) {
      const depth = assetFolderDepth(folders, folder.id);
      folderSelect.append(new Option(`${'  '.repeat(depth)}${folder.name}`, folder.id));
    }
    folderSelect.value = activeAssetFolderId === undefined ? '__all__' : activeAssetFolderId === null ? '__root__' : activeAssetFolderId;
    folderSelect.addEventListener('change', () => {
      activeAssetFolderId = folderSelect.value === '__all__' ? undefined : folderSelect.value === '__root__' ? null : folderSelect.value;
      renderAssets();
    });
    const search = element('input', { attrs: { id: 'asset-workspace-search', type: 'search', placeholder: 'Search assets', value: assetQuery } });
    search.addEventListener('input', () => {
      assetQuery = search.value;
      if (assetSearchTimer != null) window.clearTimeout(assetSearchTimer);
      assetSearchTimer = window.setTimeout(() => {
        const cursor = search.selectionStart ?? assetQuery.length;
        renderAssets();
        requestAnimationFrame(() => {
          const next = shell.assets.querySelector<HTMLInputElement>('#asset-workspace-search');
          next?.focus();
          next?.setSelectionRange(cursor, cursor);
        });
      }, 160);
    });
    const kind = element('select', { attrs: { 'aria-label': 'Asset type filter' } });
    kind.append(new Option('All types', ''));
    for (const value of ['model', 'texture', 'environment', 'animation', 'material', 'script', 'other']) {
      kind.append(new Option(value, value));
    }
    kind.value = assetKindFilter;
    kind.addEventListener('change', () => { assetKindFilter = kind.value; renderAssets() });
    const view = button(assetWorkspace.viewMode === 'grid' ? 'List' : 'Grid', () => {
      assetWorkspace.setViewMode(assetWorkspace.viewMode === 'grid' ? 'list' : 'grid');
      renderAssets();
    }, 'mini');
    const trash = button(showDeletedAssets ? 'Assets' : 'Trash', () => { showDeletedAssets = !showDeletedAssets; renderAssets() }, 'mini');
    toolbar.append(
      folderSelect,
      editButton('New Folder', () => {
        const name = prompt('Folder name', 'New Folder');
        if (name) { activeAssetFolderId = assetWorkspace.createFolder(name, typeof activeAssetFolderId === 'string' ? activeAssetFolderId : null); renderAssets() }
      }, 'mini'),
      editButton('Rename Folder', () => {
        if (typeof activeAssetFolderId !== 'string') return;
        const current = folders.find((entry) => entry.id === activeAssetFolderId);
        const name = prompt('Folder name', current?.name ?? 'Folder');
        if (name) assetWorkspace.renameFolder(activeAssetFolderId, name);
      }, 'mini'),
      editButton('Delete Folder', () => {
        if (typeof activeAssetFolderId !== 'string' || !confirm('Delete this folder and its subfolders? Assets will move to Root.')) return;
        assetWorkspace.deleteFolder(activeAssetFolderId);
        activeAssetFolderId = null;
        renderAssets();
      }, 'mini'),
      search,
      kind,
      view,
      trash,
      element('span', { text: `${Object.keys(scene.assets).length} assets · ${scene.animations.length} clips` }),
    );
    shell.assets.append(toolbar);

    const tasks = importQueue.list();
    if (tasks.length) {
      const taskStrip = element('div', { className: 'import-task-strip' });
      for (const task of tasks) {
        const taskRow = element('div', { className: `import-task ${task.stage}` });
        const progress = element('progress', { attrs: { max: '1', value: String(task.progress) } });
        taskRow.append(
          element('span', { text: `${task.name} · ${task.stage}${task.error ? ` · ${task.error}` : ''}` }),
          progress,
        );
        if (task.stage === 'failed' || task.stage === 'cancelled') taskRow.append(editButton('Retry', () => importQueue.retry(task.id), 'mini'));
        if (!['complete', 'failed', 'cancelled'].includes(task.stage)) taskRow.append(editButton('Cancel', () => importQueue.cancel(task.id), 'mini'));
        if (['complete', 'failed', 'cancelled'].includes(task.stage)) taskRow.append(button('Dismiss', () => importQueue.remove(task.id), 'mini'));
        taskStrip.append(taskRow);
      }
      shell.assets.append(taskStrip);
    }

    const items = assetWorkspace.list({
      folderId: activeAssetFolderId,
      query: assetQuery,
      kinds: assetKindFilter ? [assetKindFilter as any] : undefined,
      includeDeleted: showDeletedAssets,
    }).filter((entry) => showDeletedAssets ? entry.deleted : !entry.deleted);
    const grid = element('div', { className: `asset-workspace-items ${assetWorkspace.viewMode}` });
    for (const item of items) {
      const card = element('article', { className: 'asset-workspace-item', attrs: { draggable: String(canEdit), 'data-asset-id': item.asset.id } });
      const generatedThumbnail = typeof item.asset.metadata?.thumbnailDataUrl === 'string'
        ? item.asset.metadata.thumbnailDataUrl
        : undefined;
      const thumbnailUrl = generatedThumbnail ?? manifest.assets[item.asset.uri];
      if (thumbnailUrl && (generatedThumbnail || item.asset.kind === 'texture' || item.asset.kind === 'environment')) {
        card.append(element('img', { className: 'asset-thumbnail', attrs: { src: thumbnailUrl, alt: '' } }));
      } else card.append(element('div', { className: 'asset-thumbnail asset-placeholder', text: item.asset.kind.slice(0, 3).toUpperCase() }));
      const copy = element('div', { className: 'asset-item-copy' });
      const name = element('strong', { text: item.asset.name ?? item.asset.id });
      name.addEventListener('dblclick', () => {
        if (!canEdit) return;
        const next = prompt('Asset name', item.asset.name ?? 'Asset');
        if (next) assetWorkspace.rename(item.asset.id, next);
      });
      copy.append(
        name,
        element('span', { text: `${item.asset.kind} · ${formatBytes(item.asset.byteSize ?? 0)}` }),
      );
      const references = element('details', { className: 'asset-references' });
      references.append(
        element('summary', { text: `${item.dependencies.length} dependencies · ${item.reverseReferences.length} references` }),
        element('p', { text: item.dependencies.length ? `Depends on: ${item.dependencies.join(', ')}` : 'No asset dependencies.' }),
        element('p', { text: item.reverseReferences.length ? `Used by: ${item.reverseReferences.map((entry) => entry.label).join(', ')}` : 'No reverse references.' }),
      );
      copy.append(references);
      const actions = element('div', { className: 'asset-item-actions' });
      if (item.asset.kind === 'environment' && !item.deleted) {
        actions.append(editButton('Use', () => {
          const exists = Boolean(document.value.environment.assetId);
          applyInspectorPatch('Use environment', [{ op: exists ? 'replace' : 'add', path: '/environment/assetId', value: item.asset.id }]);
        }, 'mini'));
      }
      if (item.asset.kind === 'model' && !item.deleted) {
        actions.append(editButton('Reimport', () => {
          pendingReimportAssetId = item.asset.id;
          reimportInput.click();
        }, 'mini'));
      }
      if (!item.deleted) {
        const move = element('select', { attrs: { 'aria-label': `Move ${item.asset.name ?? item.asset.id}` } });
        move.append(new Option('Move…', ''), new Option('Root', '__root__'));
        for (const folder of folders) move.append(new Option(folder.name, folder.id));
        move.disabled = !canEdit;
        move.addEventListener('change', () => {
          if (move.value) assetWorkspace.move([item.asset.id], move.value === '__root__' ? null : move.value);
        });
        actions.append(
          move,
          editButton('Duplicate', () => assetWorkspace.duplicate(item.asset.id), 'mini'),
          editButton('Delete', () => assetWorkspace.remove([item.asset.id]), 'mini'),
        );
      } else {
        actions.append(
          editButton('Restore', () => assetWorkspace.restore([item.asset.id]), 'mini'),
          editButton('Delete forever', () => {
            if (confirm('Permanently delete this unreferenced asset?')) assetWorkspace.purge([item.asset.id]);
          }, 'mini danger'),
        );
      }
      card.append(copy, actions);
      card.addEventListener('dragstart', (event) => event.dataTransfer?.setData('application/x-kyxos-asset', item.asset.id));
      grid.append(card);
    }
    if (!items.length) grid.append(element('p', { className: 'muted', text: showDeletedAssets ? 'Trash is empty.' : 'No assets match this view.' }));
    shell.assets.append(grid);

    const animationStrip = element('div', { className: 'animation-strip' });
    for (const animation of scene.animations) {
      const row = element('div', { className: 'animation-chip' });
      row.append(
        button('Play', () => {
          activeAnimationId = animation.id;
          playAnimation(true, 0);
        }),
        element('span', { text: `${animation.name} · ${animation.duration.toFixed(2)}s` }),
      );
      animationStrip.append(row);
    }
    if (scene.animations.length) shell.assets.append(animationStrip);
  }

  async function importFiles(files: File[]): Promise<void> {
    const gltf = files.find((file) => file.name.toLowerCase().endsWith('.gltf'));
    if (gltf) {
      importQueue.enqueue(gltf.name, async (context) => {
        context.report('parsing', 0.1);
        const bundle = await bundleExternalGltf(files, gltf.name);
        context.report('uploading', 0.25);
        await importAsset(bundle.file, bundle);
        context.report('building', 0.95);
      });
      return;
    }
    for (const file of files.filter((entry) => !entry.name.toLowerCase().endsWith('.bin'))) {
      importQueue.enqueue(file.name, async (context) => {
        context.report('uploading', 0.15);
        await importAsset(file);
        context.report('building', 0.95);
      });
    }
  }

  async function importAsset(
    file: File,
    externalBundle?: ExternalGltfBundleResult,
    reimport?: { assetId: string; mode: 'replace' | 'keep-overrides' | 'reset-overrides' },
  ): Promise<void> {
    if (!canEdit) {
      showNotice('Viewer members cannot import or reimport assets.', true);
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const allowed = ['glb', 'hdr', 'exr', 'png', 'jpg', 'jpeg', 'webp', 'ktx2'];
    if (!allowed.includes(extension)) {
      showNotice('Unsupported file type.', true);
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      showNotice('File exceeds the configured 512 MB upload limit.', true);
      return;
    }

    try {
      showNotice(`Hashing ${file.name}…`);
      const hash = await hashBlob(file);
      const ticket = await client.assets.createUpload({
        hash,
        name: file.name,
        mimeType: file.type || mimeFor(extension),
        byteSize: file.size,
      });
      await client.assets.upload(ticket, file);
      await client.assets.completeUpload(ticket.assetId, {
        originalName: file.name,
        extension,
      });
      const freshManifest = await client.assets.getManifest([
        ...new Set([...Object.keys(document.value.assets), ticket.assetId]),
      ]);
      manifest = {
        assets: { ...manifest.assets, ...freshManifest.assets },
      };

      if (extension === 'glb') {
        showNotice('Parsing GLB in a worker…');
        const report = await parseGlb(file);
        const imported = contractFromGlb(
          project.name,
          ticket.assetId,
          hash,
          file,
          report,
        );
        if (externalBundle) {
          imported.metadata.source = {
            ...(imported.metadata.source ?? {}),
            originalFilename: externalBundle.sourceName,
          };
          imported.assets[ticket.assetId].metadata = {
            ...(imported.assets[ticket.assetId].metadata ?? {}),
            externalResources: externalBundle.resourceNames,
            packedFromExternalGltf: true,
          };
        }
        if (reimport) {
          imported.assets[ticket.assetId].metadata = {
            ...(imported.assets[ticket.assetId].metadata ?? {}),
            reimportedFromAssetId: reimport.assetId,
            reimportMode: reimport.mode,
          };
        }
        for (const asset of Object.values(document.value.assets)) {
          if (asset.kind !== 'model') imported.assets[asset.id] = asset;
        }
        if (document.value.environment.assetId) {
          imported.environment = structuredClone(document.value.environment);
        }
        imported.lights = document.value.lights?.length
          ? structuredClone(document.value.lights)
          : createDefaultLights();
        document.replace(
          reimport
            ? mergeReimportedScene(document.value, imported, reimport.mode)
            : imported,
          'import-glb',
        );
        await adapter.loadDocument(document);
        try {
          const thumbnailDataUrl = await createAssetThumbnailDataUrl(await adapter.captureThumbnail());
          const scene = document.value;
          const importedAsset = scene.assets[ticket.assetId];
          if (importedAsset) {
            importedAsset.metadata = { ...(importedAsset.metadata ?? {}), thumbnailDataUrl };
            document.replace(scene, 'asset-thumbnail');
          }
        } catch (error) {
          diagnosticConsole.log('warn', `Could not generate a thumbnail for ${file.name}.`, error, 'assets');
        }
        showNotice(
          report.warnings.length
            ? `Import complete · ${report.warnings.join(' · ')}`
            : `Import complete · ${report.nodes.length} nodes · ${report.materials.length} materials · ${report.animations.length} animations`,
        );
      } else {
        const scene = document.value;
        const kind = ['hdr', 'exr'].includes(extension) ? 'environment' : 'texture';
        scene.assets[ticket.assetId] = {
          id: ticket.assetId,
          uri: `asset://${hash}`,
          contentHash: hash,
          kind,
          mimeType: file.type || mimeFor(extension),
          byteSize: file.size,
          name: file.name,
        };
        if (kind === 'environment') scene.environment.assetId = ticket.assetId;
        document.replace(scene, 'import-asset');
        if (kind === 'environment') await adapter.loadEnvironmentAsset(ticket.assetId);
        showNotice(ticket.alreadyExists ? 'Existing content-hash asset reused.' : 'Asset uploaded.');
      }
      await autosave.flush();
    } catch (error) {
      showNotice(errorMessage(error), true);
    }
  }

  async function publish(): Promise<void> {
    if (!roleCan(currentRole, 'project:publish')) {
      showNotice('Your project role cannot publish releases.', true);
      return;
    }
    try {
      showNotice('Saving and publishing…');
      await autosave.flush();
      const thumbnail = await adapter.captureThumbnail();
      const release = await client.releases.publish(
        project.id,
        document.value,
        autosave.revision,
        thumbnail,
      );
      showPublishedNotice(release);
    } catch (error) {
      showNotice(errorMessage(error), true);
    }
  }

  async function loadWorkspaceScene(sceneId: string): Promise<void> {
    const scene = workspace.select(sceneId);
    session.selection.clear();
    session.history.clear();
    document.replace(scene.document, 'workspace-scene-switch');
    manifest = await client.assets.getManifest(Object.keys(scene.document.assets));
    await adapter.loadDocument(document);
    title.textContent = `${project.name} / ${scene.name}`;
    activeAnimationId = scene.document.animations.find((entry) => entry.autoplay)?.id
      ?? scene.document.animations[0]?.id;
    animationPlaying = false;
    scheduleWorkspaceSave();
    collaborationRevision = 0;
    await connectCollaboration();
  }

  async function reloadActiveWorkspaceScene(source: string): Promise<void> {
    const scene = workspace.activeScene;
    document.replace(scene.document, source);
    manifest = await client.assets.getManifest(Object.keys(scene.document.assets));
    await adapter.loadDocument(document);
    title.textContent = `${project.name} / ${scene.name}`;
  }

  async function showSceneManager(): Promise<void> {
    releaseDialog.replaceChildren();
    const workspaceEditButton = (label: string, action: () => void, className?: string) => {
      const control = button(label, action, className);
      control.disabled = !canEdit;
      return control;
    };
    const header = element('header', { className: 'dialog-header' });
    header.append(
      element('h2', { text: 'Scenes & Templates' }),
      button('Close', () => releaseDialog.close(), 'secondary'),
    );
    releaseDialog.append(header);

    const sceneToolbar = element('div', { className: 'dialog-toolbar' });
    sceneToolbar.append(
      workspaceEditButton('New Scene', async () => {
        const name = prompt('Scene name', `Scene ${workspace.value.scenes.length + 1}`);
        if (!name) return;
        const created = workspace.createScene(name);
        await loadWorkspaceScene(created.id);
        await showSceneManager();
      }),
      workspaceEditButton('Duplicate Active', async () => {
        const created = workspace.duplicateScene(workspace.activeScene.id);
        await loadWorkspaceScene(created.id);
        await showSceneManager();
      }, 'secondary'),
    );
    releaseDialog.append(sceneToolbar, element('h3', { className: 'dialog-section-title', text: 'Scenes' }));

    for (const scene of workspace.value.scenes) {
      const active = scene.id === workspace.activeScene.id;
      const card = element('article', { className: `workspace-card${active ? ' active' : ''}` });
      card.append(
        element('div', { className: 'workspace-card-copy' }),
      );
      card.querySelector<HTMLElement>('.workspace-card-copy')!.append(
        element('strong', { text: scene.name }),
        element('span', { text: `${scene.document.nodes.length} nodes · updated ${new Date(scene.updatedAt).toLocaleString()}` }),
      );
      const actions = element('div', { className: 'inline-actions' });
      actions.append(
        button(active ? 'Active' : 'Open', async () => {
          if (!active) await loadWorkspaceScene(scene.id);
          await showSceneManager();
        }, active ? 'active mini' : 'mini'),
        workspaceEditButton('Rename', async () => {
          const name = prompt('Scene name', scene.name);
          if (!name) return;
          workspace.renameScene(scene.id, name);
          if (active) await reloadActiveWorkspaceScene('workspace-scene-rename');
          await showSceneManager();
        }, 'mini'),
        workspaceEditButton('Duplicate', async () => {
          const created = workspace.duplicateScene(scene.id);
          await loadWorkspaceScene(created.id);
          await showSceneManager();
        }, 'mini'),
        workspaceEditButton('Delete', async () => {
          if (!confirm(`Delete scene “${scene.name}”?`)) return;
          try {
            workspace.deleteScene(scene.id);
            if (active) await reloadActiveWorkspaceScene('workspace-scene-delete');
            await showSceneManager();
          } catch (error) {
            showNotice(errorMessage(error), true);
          }
        }, 'mini danger'),
      );
      card.append(actions);
      releaseDialog.append(card);
    }

    const templateToolbar = element('div', { className: 'dialog-toolbar' });
    templateToolbar.append(
      workspaceEditButton('Create from Selection', async () => {
        const name = prompt('Template name', 'Template');
        if (!name) return;
        try {
          workspace.createTemplate(workspace.activeScene.id, session.selection.selected, name);
          await showSceneManager();
        } catch (error) {
          showNotice(errorMessage(error), true);
        }
      }),
    );
    releaseDialog.append(
      element('h3', { className: 'dialog-section-title', text: 'Templates / Prefabs' }),
      templateToolbar,
    );

    for (const template of workspace.value.templates) {
      const card = element('article', { className: 'workspace-card' });
      const copy = element('div', { className: 'workspace-card-copy' });
      copy.append(
        element('strong', { text: `${template.name} · r${template.revision}` }),
        element('span', { text: `${template.snapshot.nodes.length} nodes · ${template.snapshot.roots.length} roots` }),
      );
      const actions = element('div', { className: 'inline-actions' });
      actions.append(
        workspaceEditButton('Instantiate', async () => {
          try {
            const roots = workspace.instantiate(
              template.id,
              workspace.activeScene.id,
              session.selection.selected.length === 1 ? session.selection.selected[0] : null,
            );
            await reloadActiveWorkspaceScene('template-instantiate');
            session.selection.select(roots);
            await showSceneManager();
          } catch (error) {
            showNotice(errorMessage(error), true);
          }
        }, 'mini'),
        workspaceEditButton('Rename', async () => {
          const name = prompt('Template name', template.name);
          if (name) workspace.renameTemplate(template.id, name);
          await showSceneManager();
        }, 'mini'),
        workspaceEditButton('Delete', async () => {
          try {
            if (confirm(`Delete template “${template.name}”?`)) workspace.deleteTemplate(template.id);
            await showSceneManager();
          } catch (error) {
            showNotice(errorMessage(error), true);
          }
        }, 'mini danger'),
      );
      card.append(copy, actions);
      releaseDialog.append(card);
    }
    if (!workspace.value.templates.length) {
      releaseDialog.append(element('p', { className: 'muted dialog-empty', text: 'Select one or more hierarchy roots to create a reusable template.' }));
    }

    const selectedNode = document.value.nodes.find((node) => node.id === session.selection.selected[0]);
    const instanceId = selectedNode?.template?.instanceId;
    if (instanceId) {
      const overrides = workspace.overrides(workspace.activeScene.id, instanceId);
      releaseDialog.append(element('h3', { className: 'dialog-section-title', text: `Instance Overrides · ${overrides.length}` }));
      const instanceActions = element('div', { className: 'dialog-toolbar' });
      instanceActions.append(
        workspaceEditButton('Apply All to Template', async () => {
          workspace.applyOverrides(workspace.activeScene.id, instanceId);
          await reloadActiveWorkspaceScene('template-apply-overrides');
          await showSceneManager();
        }),
        workspaceEditButton('Reset All', async () => {
          workspace.resetOverrides(workspace.activeScene.id, instanceId);
          await reloadActiveWorkspaceScene('template-reset-overrides');
          await showSceneManager();
        }, 'secondary'),
        workspaceEditButton('Unpack', async () => {
          workspace.unpackInstance(workspace.activeScene.id, instanceId);
          await reloadActiveWorkspaceScene('template-unpack');
          await showSceneManager();
        }, 'secondary danger'),
      );
      releaseDialog.append(instanceActions);
      for (const override of overrides) {
        const row = element('div', { className: 'override-row' });
        row.append(
          element('code', { text: override.path }),
          element('span', { text: `${formatCompactValue(override.templateValue)} → ${formatCompactValue(override.instanceValue)}` }),
          workspaceEditButton('Apply', async () => {
            workspace.applyOverrides(workspace.activeScene.id, instanceId, [override.path]);
            await reloadActiveWorkspaceScene('template-apply-override');
            await showSceneManager();
          }, 'mini'),
          workspaceEditButton('Reset', async () => {
            workspace.resetOverrides(workspace.activeScene.id, instanceId, [override.path]);
            await reloadActiveWorkspaceScene('template-reset-override');
            await showSceneManager();
          }, 'mini'),
        );
        releaseDialog.append(row);
      }
    }
    if (!releaseDialog.open) releaseDialog.showModal();
  }

  async function showAnimationGraphEditor(): Promise<void> {
    if (!canEdit) {
      showNotice('Viewer members can inspect the project but cannot edit the state graph.', true);
      return;
    }
    disposeAnimationGraph?.();
    disposeAnimationGraph = null;
    const graph = document.value.animationStateGraph ?? createAnimationStateGraph();
    disposeAnimationGraph = await mountAnimationGraphEditor({
      dialog: animationGraphDialog,
      graph,
      clips: document.value.animations,
      onCommit: (next) => {
        const exists = document.value.animationStateGraph != null;
        execute('Edit animation state graph', () => [{
          op: exists ? 'replace' : 'add',
          path: '/animationStateGraph',
          value: next,
        }], 'animation-state-graph');
      },
      onError: (error) => showNotice(errorMessage(error), true),
    });
  }

  async function showCodeEditor(): Promise<void> {
    disposeCodeEditor?.();
    disposeCodeEditor = null;
    try {
      disposeCodeEditor = await mountCodeEditor({
        dialog: codeDialog,
        client,
        projectId: project.id,
        canEdit,
        onLog: (level, message, data) => diagnosticConsole.log(level, message, data, 'code'),
      });
    } catch (error) {
      showNotice(`Code editor failed to open: ${errorMessage(error)}`, true);
    }
  }

  function showAdvancedTools(): void {
    disposeAdvancedTools?.();
    disposeAdvancedTools = mountAdvancedTools({
      dialog: advancedDialog,
      console: diagnosticConsole,
      api: studioApi,
      plugins: pluginRegistry,
      mcp: mcpBridge,
      canEdit,
      onError: (error) => showNotice(errorMessage(error), true),
    });
  }

  async function showCollaborationManager(): Promise<void> {
    try {
      projectMembers = await client.members.list(project.id);
    } catch (error) {
      showNotice(errorMessage(error), true);
    }
    releaseDialog.replaceChildren();
    const header = element('header', { className: 'dialog-header' });
    header.append(
      element('h2', { text: 'Collaboration' }),
      button('Close', () => releaseDialog.close(), 'secondary'),
    );
    releaseDialog.append(header);
    const summary = element('div', { className: 'collaboration-summary' });
    summary.append(
      element('strong', { text: `${currentRole.toUpperCase()} access` }),
      element('span', { text: `${collaborationPresence.length} online · ${collaborationConflicts.length} unresolved realtime conflicts` }),
    );
    releaseDialog.append(summary, element('h3', { className: 'dialog-section-title', text: 'Members' }));

    if (canManageMembers) {
      const invite = element('form', { className: 'member-invite-form' });
      const email = element('input', { attrs: { type: 'email', required: '', placeholder: 'teammate@example.com', 'aria-label': 'Member email' } });
      const role = element('select', { attrs: { 'aria-label': 'Member role' } });
      role.append(new Option('Editor', 'editor'), new Option('Viewer', 'viewer'));
      invite.append(email, role, element('button', { text: 'Invite', attrs: { type: 'submit' } }));
      invite.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await client.members.invite(project.id, email.value, role.value as 'editor' | 'viewer');
          await showCollaborationManager();
        } catch (error) { showNotice(errorMessage(error), true); }
      });
      releaseDialog.append(invite);
    }

    for (const member of projectMembers) {
      const row = element('article', { className: 'member-row' });
      const copy = element('div');
      copy.append(
        element('strong', { text: member.email ?? member.userId }),
        element('span', { text: member.userId === authSession.userId ? 'You' : member.userId }),
      );
      const role = element('select', { attrs: { 'aria-label': `Role for ${member.email ?? member.userId}` } });
      role.append(new Option('Owner', 'owner'), new Option('Editor', 'editor'), new Option('Viewer', 'viewer'));
      role.value = member.role;
      role.disabled = !canManageMembers || member.role === 'owner';
      role.addEventListener('change', async () => {
        try {
          await client.members.setRole(project.id, member.userId, role.value as 'editor' | 'viewer');
          await showCollaborationManager();
        } catch (error) { showNotice(errorMessage(error), true); }
      });
      const remove = button('Remove', async () => {
        if (!confirm(`Remove ${member.email ?? member.userId} from this project?`)) return;
        try {
          await client.members.remove(project.id, member.userId);
          await showCollaborationManager();
        } catch (error) { showNotice(errorMessage(error), true); }
      }, 'mini danger');
      remove.disabled = !canManageMembers || member.role === 'owner';
      row.append(copy, role, remove);
      releaseDialog.append(row);
    }

    releaseDialog.append(element('h3', { className: 'dialog-section-title', text: 'Presence' }));
    const presenceList = element('div', { className: 'presence-list' });
    for (const presence of collaborationPresence) {
      const row = element('div', { className: 'presence-row' });
      const dot = element('span', { className: 'presence-dot' });
      dot.style.background = presence.color;
      row.append(
        dot,
        element('strong', { text: presence.displayName }),
        element('span', { text: presence.sceneId === workspace.activeScene.id ? `${presence.selection.length} selected in active scene` : 'Editing another scene' }),
      );
      presenceList.append(row);
    }
    if (!collaborationPresence.length) presenceList.append(element('p', { className: 'muted', text: 'No other live sessions are visible.' }));
    releaseDialog.append(presenceList);

    if (collaborationConflicts.length) {
      releaseDialog.append(element('h3', { className: 'dialog-section-title', text: 'Realtime Conflicts' }));
      collaborationConflicts.forEach((operation, index) => {
        const row = element('article', { className: 'conflict-row' });
        row.append(
          element('div', { text: `${operation.userId} changed ${(operation.patch as ScenePatch).map((entry) => entry.path).join(', ')}` }),
          button('Keep Ours', async () => {
            collaborationConflicts.splice(index, 1);
            await showCollaborationManager();
          }, 'mini'),
          button('Apply Theirs', async () => {
            try {
              document.apply(operation.patch as ScenePatch, 'realtime-conflict-resolution');
              collaborationConflicts.splice(index, 1);
              await showCollaborationManager();
            } catch (error) { showNotice(errorMessage(error), true); }
          }, 'mini'),
        );
        releaseDialog.append(row);
      });
    }
    if (!releaseDialog.open) releaseDialog.showModal();
  }

  async function showVersionControl(): Promise<void> {
    const [branches, checkpoints] = await Promise.all([
      client.versions.listBranches(project.id),
      client.versions.listCheckpoints(project.id),
    ]);
    releaseDialog.replaceChildren();
    const header = element('header', { className: 'dialog-header' });
    header.append(
      element('h2', { text: 'Branches & Checkpoints' }),
      button('Close', () => releaseDialog.close(), 'secondary'),
    );
    releaseDialog.append(header);
    const toolbar = element('div', { className: 'dialog-toolbar' });
    const newBranch = button('New Branch', async () => {
      const name = prompt('Branch name', branches.length ? `branch-${branches.length + 1}` : 'main');
      if (!name) return;
      const base = checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id ?? null;
      try {
        await client.versions.createBranch(project.id, name, base);
        await showVersionControl();
      } catch (error) { showNotice(errorMessage(error), true); }
    });
    newBranch.disabled = !canEdit;
    toolbar.append(newBranch, element('span', { className: 'muted', text: `${branches.length} branches · ${checkpoints.length} checkpoints` }));
    releaseDialog.append(toolbar);

    for (const branch of branches) {
      const card = element('article', { className: 'branch-card' });
      const heading = element('div', { className: 'branch-heading' });
      heading.append(
        element('strong', { text: branch.name }),
        element('span', { text: branch.headCheckpointId ? `head ${branch.headCheckpointId.slice(0, 8)}` : 'No checkpoints' }),
      );
      const checkpointButton = button('Create Checkpoint', async () => {
        const label = prompt('Checkpoint label', 'Manual checkpoint');
        if (!label) return;
        try {
          await client.versions.createCheckpoint(project.id, branch.id, label, document.value);
          await showVersionControl();
        } catch (error) { showNotice(errorMessage(error), true); }
      }, 'mini');
      checkpointButton.disabled = !canEdit;
      heading.append(checkpointButton);
      card.append(heading);
      const branchCheckpoints = checkpoints
        .filter((entry) => entry.branchId === branch.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      for (const checkpoint of branchCheckpoints) {
        const row = element('div', { className: 'checkpoint-row' });
        const copy = element('div');
        copy.append(
          element('strong', { text: `${checkpoint.label}${checkpoint.id === branch.headCheckpointId ? ' · HEAD' : ''}` }),
          element('span', { text: `${new Date(checkpoint.createdAt).toLocaleString()} · ${checkpoint.createdBy}` }),
        );
        const restore = button('Restore', async () => {
          if (!canEdit || !confirm(`Restore checkpoint “${checkpoint.label}” into the active scene?`)) return;
          document.replace(checkpoint.snapshot, 'checkpoint-restore');
          await adapter.loadDocument(document);
          showNotice(`Restored checkpoint ${checkpoint.label}.`);
        }, 'mini');
        restore.disabled = !canEdit;
        row.append(copy, restore);
        card.append(row);
      }
      if (!branchCheckpoints.length) card.append(element('p', { className: 'muted', text: 'This branch has no checkpoints.' }));
      releaseDialog.append(card);
    }
    if (!branches.length) releaseDialog.append(element('p', { className: 'dialog-empty muted', text: 'Create a branch before recording checkpoints.' }));

    if (checkpoints.length >= 2) renderVersionDiffControls(branches, checkpoints);
    if (branches.length >= 2) renderMergeControls(branches, checkpoints);
    if (!releaseDialog.open) releaseDialog.showModal();
  }

  function renderVersionDiffControls(branches: BranchRecord[], checkpoints: CheckpointRecord[]): void {
    releaseDialog.append(element('h3', { className: 'dialog-section-title', text: 'Diff' }));
    const controls = element('div', { className: 'version-controls' });
    const left = checkpointSelect(branches, checkpoints);
    const right = checkpointSelect(branches, checkpoints);
    left.value = checkpoints.at(-2)?.id ?? checkpoints[0].id;
    right.value = checkpoints.at(-1)?.id ?? checkpoints[0].id;
    const output = element('div', { className: 'version-diff-output' });
    controls.append(left, right, button('Compare', () => {
      const before = checkpoints.find((entry) => entry.id === left.value);
      const after = checkpoints.find((entry) => entry.id === right.value);
      output.replaceChildren();
      if (!before || !after) return;
      const changes = diffValues(before.snapshot, after.snapshot);
      output.append(element('strong', { text: `${changes.length} changes` }));
      for (const change of changes.slice(0, 250)) {
        const row = element('div', { className: `diff-row ${change.kind}` });
        row.append(
          element('code', { text: change.path }),
          element('span', { text: formatCompactValue(change.before) }),
          element('span', { text: formatCompactValue(change.after) }),
        );
        output.append(row);
      }
    }));
    releaseDialog.append(controls, output);
  }

  function renderMergeControls(branches: BranchRecord[], checkpoints: CheckpointRecord[]): void {
    releaseDialog.append(element('h3', { className: 'dialog-section-title', text: 'Merge' }));
    const controls = element('div', { className: 'version-controls' });
    const source = branchSelect(branches);
    const target = branchSelect(branches);
    target.value = branches[1]?.id ?? branches[0].id;
    const merge = button('Merge Source into Target', async () => {
      const sourceBranch = branches.find((entry) => entry.id === source.value);
      const targetBranch = branches.find((entry) => entry.id === target.value);
      if (!sourceBranch || !targetBranch || sourceBranch.id === targetBranch.id) {
        showNotice('Choose two different branches.', true);
        return;
      }
      const sourceHead = checkpoints.find((entry) => entry.id === sourceBranch.headCheckpointId);
      const targetHead = checkpoints.find((entry) => entry.id === targetBranch.headCheckpointId);
      if (!sourceHead || !targetHead) {
        showNotice('Both branches need a checkpoint before merging.', true);
        return;
      }
      const baseId = sourceBranch.baseCheckpointId ?? targetBranch.baseCheckpointId;
      const base = checkpoints.find((entry) => entry.id === baseId)?.snapshot ?? targetHead.snapshot;
      const result = threeWayMerge(base, targetHead.snapshot, sourceHead.snapshot);
      await showMergeResolver(sourceBranch, targetBranch, result);
    });
    merge.disabled = !canEdit;
    controls.append(source, target, merge);
    releaseDialog.append(controls);
  }

  async function showMergeResolver(
    source: BranchRecord,
    target: BranchRecord,
    merge: ReturnType<typeof threeWayMerge<KyxosSceneContract>>,
  ): Promise<void> {
    releaseDialog.replaceChildren();
    const header = element('header', { className: 'dialog-header' });
    header.append(
      element('h2', { text: `Merge ${source.name} → ${target.name}` }),
      button('Back', () => void showVersionControl(), 'secondary'),
    );
    releaseDialog.append(header, element('p', {
      className: 'dialog-empty',
      text: merge.conflicts.length
        ? `${merge.conflicts.length} conflicts require a resolution.`
        : 'No conflicts detected. The merged snapshot is ready.',
    }));
    const resolutions: Record<string, 'ours' | 'theirs'> = {};
    for (const conflict of merge.conflicts) {
      const row = element('div', { className: 'merge-conflict-row' });
      const choice = element('select', { attrs: { 'aria-label': `Resolve ${conflict.path}` } });
      choice.append(new Option('Keep target (ours)', 'ours'), new Option('Use source (theirs)', 'theirs'));
      resolutions[conflict.path] = 'ours';
      choice.addEventListener('change', () => { resolutions[conflict.path] = choice.value as 'ours' | 'theirs' });
      row.append(
        element('code', { text: conflict.path }),
        element('span', { text: `Base: ${formatCompactValue(conflict.base)}` }),
        element('span', { text: `Target: ${formatCompactValue(conflict.ours)}` }),
        element('span', { text: `Source: ${formatCompactValue(conflict.theirs)}` }),
        choice,
      );
      releaseDialog.append(row);
    }
    releaseDialog.append(button('Complete Merge Checkpoint', async () => {
      try {
        const snapshot = resolveMergeConflicts(merge, resolutions);
        await client.versions.createCheckpoint(
          project.id,
          target.id,
          `Merge ${source.name} into ${target.name}`,
          snapshot,
        );
        await showVersionControl();
      } catch (error) { showNotice(errorMessage(error), true); }
    }, 'primary merge-complete'));
  }

  async function showReleaseManager(): Promise<void> {
    const releases = await client.releases.list(project.id);
    releaseDialog.replaceChildren();
    const header = element('header', { className: 'dialog-header' });
    header.append(
      element('h2', { text: 'Published Versions' }),
      button('Close', () => releaseDialog.close(), 'secondary'),
    );
    releaseDialog.append(header);
    if (!releases.length) {
      releaseDialog.append(element('p', { text: 'No versions have been published.' }));
    }
    for (const release of releases) {
      const card = element('article', { className: 'release-card' });
      card.append(
        element('strong', {
          text: `v${release.versionNumber}${release.isCurrent ? ' · current' : ''}`,
        }),
        element('span', { text: new Date(release.createdAt).toLocaleString() }),
      );
      const actions = element('div', { className: 'inline-actions' });
      const links = releaseLinks(release);
      actions.append(
        button('Open fixed', () => window.open(links.fixed, '_blank', 'noopener'), 'mini'),
        button('Copy fixed', () => void navigator.clipboard.writeText(links.fixed), 'mini'),
        button('Copy current', () => void navigator.clipboard.writeText(links.current), 'mini'),
        button('Copy embed', () => void navigator.clipboard.writeText(links.embedCode), 'mini'),
      );
      if (!release.isCurrent) {
        actions.append(
          button(
            'Set current',
            async () => {
              await client.releases.setCurrent(project.id, release.id);
              await showReleaseManager();
            },
            'mini',
          ),
        );
      }
      card.append(actions);
      releaseDialog.append(card);
    }
    releaseDialog.append(
      button(
        'Disable public access',
        async () => {
          await client.releases.disablePublic(project.id);
          releaseDialog.close();
          showNotice('Public access disabled.');
        },
        'secondary danger',
      ),
    );
    if (!releaseDialog.open) releaseDialog.showModal();
  }

  function showPublishedNotice(release: ReleaseRecord): void {
    const links = releaseLinks(release);
    viewportNotice.replaceChildren(
      documentGlobal.createTextNode(`Published v${release.versionNumber} · `),
      linkElement('Open', links.fixed),
      documentGlobal.createTextNode(' · '),
      button('Copy current', () => void navigator.clipboard.writeText(links.current), 'mini'),
      button('Copy embed', () => void navigator.clipboard.writeText(links.embedCode), 'mini'),
    );
  }

  function releaseLinks(release: ReleaseRecord): {
    current: string;
    fixed: string;
    embed: string;
    embedCode: string;
  } {
    const current = new URL(`../public/?slug=${encodeURIComponent(release.slug)}`, location.href).href;
    const fixed = new URL(`../public/?release=${encodeURIComponent(release.id)}`, location.href).href;
    const embed = new URL(
      `../embed/?release=${encodeURIComponent(release.id)}&ui=0`,
      location.href,
    ).href;
    return {
      current,
      fixed,
      embed,
      embedCode: `<iframe src="${embed}" allow="fullscreen" loading="lazy"></iframe>`,
    };
  }

  function showNotice(message: string, error = false): void {
    diagnosticConsole.log(error ? 'error' : 'info', message, undefined, 'studio');
    viewportNotice.replaceChildren(element('span', { text: message }));
    viewportNotice.classList.toggle('error-notice', error);
    if (!error) {
      window.setTimeout(() => {
        if (viewportNotice.textContent === message) viewportNotice.replaceChildren();
      }, 5000);
    }
  }
}

function inspectorSection(title: string, open: boolean): HTMLDetailsElement {
  const section = element('details', { className: 'inspector-section' });
  section.open = open;
  section.append(element('summary', { text: title }));
  return section;
}

function appendField(container: HTMLElement, label: string, control: HTMLElement): void {
  const row = element('label', { className: 'field-row' });
  row.append(element('span', { text: label }), control);
  container.append(row);
}

function linkElement(label: string, href: string): HTMLAnchorElement {
  const link = element('a', { text: label, attrs: { href, target: '_blank', rel: 'noopener' } });
  return link;
}

function nodeIcon(node: SceneNode): HTMLElement {
  const type = node.cameraId
    ? 'C'
    : node.lightId
      ? 'L'
      : node.meshAssetId
        ? 'M'
        : '◇';
  return element('span', { className: 'node-icon', text: type });
}

function _nodeDepth(nodes: SceneNode[], node: SceneNode): number {
  let count = 0;
  let current = node;
  while (current.parentId && count < 64) {
    const parent = nodes.find((entry) => entry.id === current.parentId);
    if (!parent) break;
    count += 1;
    current = parent;
  }
  return count;
}

function assetFolderDepth(
  folders: Array<{ id: string; parentId: string | null }>,
  folderId: string,
): number {
  let depth = 0;
  let current = folders.find((folder) => folder.id === folderId);
  const visited = new Set<string>();
  while (current?.parentId && depth < 32 && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return depth;
}

function formatBytes(value: number): string {
  if (!value) return 'size unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatCompactValue(value: unknown): string {
  if (value === undefined) return 'unset';
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length > 72 ? `${serialized.slice(0, 69)}…` : serialized;
}

function branchSelect(branches: BranchRecord[]): HTMLSelectElement {
  const select = element('select', { attrs: { 'aria-label': 'Version branch' } });
  branches.forEach((branch) => select.append(new Option(branch.name, branch.id)));
  return select;
}

function checkpointSelect(
  branches: BranchRecord[],
  checkpoints: CheckpointRecord[],
): HTMLSelectElement {
  const select = element('select', { attrs: { 'aria-label': 'Checkpoint' } });
  for (const checkpoint of checkpoints) {
    const branch = branches.find((entry) => entry.id === checkpoint.branchId);
    select.append(new Option(`${branch?.name ?? 'branch'} / ${checkpoint.label}`, checkpoint.id));
  }
  return select;
}

function userColor(value: string): string {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 72% 62%)`;
}

function downloadText(name: string, content: string, mimeType = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = element('a', { attrs: { href: url, download: name } });
  anchor.click();
  URL.revokeObjectURL(url);
}

async function createAssetThumbnailDataUrl(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 144;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    context.fillStyle = '#11151d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = Math.max(1, bitmap.width * scale);
    const height = Math.max(1, bitmap.height * scale);
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL('image/webp', 0.82);
  } finally {
    bitmap.close();
  }
}

function isDescendant(nodes: SceneNode[], ancestorId: string, candidateId: string): boolean {
  let current = nodes.find((node) => node.id === candidateId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = nodes.find((node) => node.id === current?.parentId);
  }
  return false;
}

function _collectNodeDescendants(nodes: SceneNode[], roots: string[]): Set<string> {
  const result = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function createDefaultLights(): SceneLight[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'Main Light',
      type: 'directional',
      color: '#fff4e6',
      intensity: 3.2,
      transform: {
        position: { x: 4, y: 6, z: 4 },
        rotation: { x: -0.7, y: 0.6, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      castShadow: true,
      shadow: { mapSize: 2048, bias: -0.0002, normalBias: 0.02, radius: 1 },
    },
    createAuxiliaryLight(),
  ];
}

function createAuxiliaryLight(): SceneLight {
  return {
    id: crypto.randomUUID(),
    name: 'Auxiliary Light',
    type: 'directional',
    color: '#b9d7ff',
    intensity: 1.1,
    transform: {
      position: { x: -4, y: 3, z: -2 },
      rotation: { x: -0.2, y: -0.8, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    castShadow: false,
  };
}

function createCamera(name: string): SceneCamera {
  return {
    id: crypto.randomUUID(),
    name,
    transform: {
      position: { x: 3.4, y: 2.4, z: 4.8 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    target: { x: 0, y: 0.9, z: 0 },
    fov: 45,
    near: 0.01,
    far: 1000,
    autoRotate: false,
  };
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function rgbHex(color: { x: number; y: number; z: number }): string {
  return `#${[color.x, color.y, color.z]
    .map((value) =>
      Math.round(Math.max(0, Math.min(1, value)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function hexRgb(value: string): [number, number, number] {
  return [
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function mimeFor(extension: string): string {
  return (
    {
      glb: 'model/gltf-binary',
      hdr: 'image/vnd.radiance',
      exr: 'image/x-exr',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      ktx2: 'image/ktx2',
    } as Record<string, string>
  )[extension] ?? 'application/octet-stream';
}

function parseGlb(file: File): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const worker = new Worker(new URL('./importWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      worker.terminate();
      event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ name: file.name, buffer: await file.arrayBuffer() });
  });
}

function contractFromGlb(
  projectName: string,
  assetId: string,
  hash: string,
  file: File,
  report: any,
): KyxosSceneContract {
  const contract = createEmptySceneContract(projectName);
  contract.metadata.source = {
    generator: 'Kyxos Studio GLB Importer',
    originalFilename: file.name,
  };
  contract.assets[assetId] = {
    id: assetId,
    uri: `asset://${hash}`,
    contentHash: hash,
    kind: 'model',
    mimeType: file.type || 'model/gltf-binary',
    byteSize: file.size,
    name: file.name,
    metadata: {
      extensionsUsed: report.extensionsUsed,
      warnings: report.warnings,
      embeddedImages: report.images,
      textures: report.textures,
    },
  };

  const nodeIds = report.nodes.map(() => crypto.randomUUID());
  const materialIds = report.materials.map(() => crypto.randomUUID());
  const animationIds = report.animations.map(() => crypto.randomUUID());
  const variantIds = (report.materialVariants ?? []).map(() => crypto.randomUUID());
  const cameraIds = new Map<number, string>();
  const lightIds = new Map<number, string>();
  for (const source of report.nodes) {
    if (source.camera != null) cameraIds.set(source.camera, crypto.randomUUID());
    const lightIndex = source.extensions?.KHR_lights_punctual?.light;
    if (typeof lightIndex === 'number' && !lightIds.has(lightIndex)) {
      lightIds.set(lightIndex, crypto.randomUUID());
    }
  }

  contract.materials = Object.fromEntries(
    report.materials.map((source: any, index: number) => {
      const pbr = source.pbr ?? {};
      const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
      const extensions = source.extensions ?? {};
      const clearcoat = extensions.KHR_materials_clearcoat ?? {};
      const transmission = extensions.KHR_materials_transmission ?? {};
      const volume = extensions.KHR_materials_volume ?? {};
      const sheen = extensions.KHR_materials_sheen ?? {};
      const specular = extensions.KHR_materials_specular ?? {};
      const original: SceneMaterial = {
        id: materialIds[index],
        name: source.name,
        baseColor: { x: factor[0], y: factor[1], z: factor[2], w: factor[3] },
        metalness: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        normalScale: source.normalTexture?.scale ?? 1,
        emissive: {
          x: source.emissiveFactor?.[0] ?? 0,
          y: source.emissiveFactor?.[1] ?? 0,
          z: source.emissiveFactor?.[2] ?? 0,
        },
        opacity: factor[3],
        alphaMode: normalizeAlphaMode(source.alphaMode),
        alphaCutoff: source.alphaCutoff ?? 0.5,
        doubleSided: source.doubleSided ?? false,
        clearcoat: clearcoat.clearcoatFactor,
        clearcoatRoughness: clearcoat.clearcoatRoughnessFactor,
        transmission: transmission.transmissionFactor,
        thickness: volume.thicknessFactor,
        attenuationColor: volume.attenuationColor
          ? { x: volume.attenuationColor[0], y: volume.attenuationColor[1], z: volume.attenuationColor[2] }
          : undefined,
        attenuationDistance: volume.attenuationDistance,
        ior: extensions.KHR_materials_ior?.ior,
        sheenColor: sheen.sheenColorFactor
          ? { x: sheen.sheenColorFactor[0], y: sheen.sheenColorFactor[1], z: sheen.sheenColorFactor[2] }
          : undefined,
        sheenRoughness: sheen.sheenRoughnessFactor,
        specularIntensity: specular.specularFactor,
        specularColor: specular.specularColorFactor
          ? { x: specular.specularColorFactor[0], y: specular.specularColorFactor[1], z: specular.specularColorFactor[2] }
          : undefined,
        emissiveIntensity: extensions.KHR_materials_emissive_strength?.emissiveStrength,
        metadata: {
          gltfMaterialIndex: source.index,
          gltfTextures: {
            baseColor: pbr.baseColorTexture,
            metallicRoughness: pbr.metallicRoughnessTexture,
            normal: source.normalTexture,
            emissive: source.emissiveTexture,
            occlusion: source.occlusionTexture,
          },
          gltfExtensions: extensions,
        },
      };
      original.metadata!.original = structuredClone({
        ...original,
        metadata: undefined,
      });
      return [original.id, original];
    }),
  );
  let fallbackMaterialId: string | null = null;
  const fallbackMaterial = (): string => {
    if (fallbackMaterialId) return fallbackMaterialId;
    const id = crypto.randomUUID();
    contract.materials[id] = {
      id,
      name: 'glTF Default Material',
      baseColor: { x: 1, y: 1, z: 1, w: 1 },
      metalness: 1,
      roughness: 1,
      emissive: { x: 0, y: 0, z: 0 },
      opacity: 1,
      alphaMode: 'opaque',
      doubleSided: false,
      metadata: { generatedForUnassignedGltfPrimitive: true },
    };
    fallbackMaterialId = id;
    return id;
  };

  contract.nodes = report.nodes.map((source: any, index: number) => {
    const mesh = source.mesh != null ? report.meshes[source.mesh] : null;
    const primitives = mesh?.primitives ?? [];
    const slots = primitives.map((primitive: any) =>
      primitive.material != null && materialIds[primitive.material]
        ? materialIds[primitive.material]
        : fallbackMaterial(),
    );
    const rotation = quaternionToEuler(source.rotation);
    const skinSource = source.skin == null ? null : report.skins?.[source.skin];
    const lightIndex = source.extensions?.KHR_lights_punctual?.light;
    const materialVariantBindings: Record<string, string[]> = {};
    for (const [variantIndex, variantId] of variantIds.entries()) {
      const variantSlots = [...slots];
      primitives.forEach((primitive: any, primitiveIndex: number) => {
        const mappings = primitive.extensions?.KHR_materials_variants?.mappings ?? [];
        const mapping = mappings.find((entry: any) => entry.variants?.includes(variantIndex));
        if (mapping?.material != null && materialIds[mapping.material]) {
          variantSlots[primitiveIndex] = materialIds[mapping.material];
        }
      });
      if (JSON.stringify(variantSlots) !== JSON.stringify(slots)) {
        materialVariantBindings[variantId] = variantSlots;
      }
    }
    const nodeAnimationIds = report.animations.flatMap((animation: any, animationIndex: number) =>
      animation.channels?.some((channel: any) => channel.target?.node === source.index)
        ? [animationIds[animationIndex]]
        : [],
    );
    const morphWeights = source.weights?.length ? source.weights : mesh?.weights ?? [];
    return {
      id: nodeIds[index],
      name: source.name,
      parentId: source.parent == null ? null : nodeIds[source.parent],
      children: source.children.map((child: number) => nodeIds[child]),
      transform: {
        position: {
          x: source.translation[0],
          y: source.translation[1],
          z: source.translation[2],
        },
        rotation,
        scale: {
          x: source.scale[0],
          y: source.scale[1],
          z: source.scale[2],
        },
      },
      visible: true,
      meshAssetId: source.mesh == null ? undefined : assetId,
      meshIndex: source.mesh,
      materialSlots: slots,
      cameraId: source.camera == null ? undefined : cameraIds.get(source.camera),
      lightId: typeof lightIndex === 'number' ? lightIds.get(lightIndex) : undefined,
      animationIds: nodeAnimationIds,
      skin: skinSource
        ? {
            skinIndex: source.skin,
            joints: (skinSource.joints ?? []).map((joint: number) => nodeIds[joint]).filter(Boolean),
            skeletonNodeId: skinSource.skeleton == null ? undefined : nodeIds[skinSource.skeleton],
            inverseBindMatricesAccessor: skinSource.inverseBindMatrices,
          }
        : undefined,
      morphWeights: morphWeights.length ? morphWeights : undefined,
      morphTargetNames: mesh?.extras?.targetNames?.length
        ? mesh.extras.targetNames
        : morphWeights.map((_: number, targetIndex: number) => `Target ${targetIndex + 1}`),
      materialVariantBindings:
        Object.keys(materialVariantBindings).length ? materialVariantBindings : undefined,
      metadata: {
        gltfNodeIndex: source.index,
        sourceQuaternion: source.rotation,
        gltfExtensions: source.extensions,
      },
    } satisfies SceneNode;
  });

  const importedCameras: SceneCamera[] = [];
  for (const source of report.nodes) {
    if (source.camera == null) continue;
    const cameraSource = report.cameras[source.camera] ?? {};
    const perspective = cameraSource.perspective ?? {};
    const orthographic = cameraSource.orthographic ?? {};
    const isOrthographic = cameraSource.type === 'orthographic';
    importedCameras.push({
      id: cameraIds.get(source.camera)!,
      name: source.name || `Camera ${source.camera + 1}`,
      transform: {
        position: {
          x: source.translation[0],
          y: source.translation[1],
          z: source.translation[2],
        },
        rotation: quaternionToEuler(source.rotation),
        scale: { x: 1, y: 1, z: 1 },
      },
      target: { x: 0, y: 0.9, z: 0 },
      fov: perspective.yfov ? (perspective.yfov * 180) / Math.PI : 45,
      near: isOrthographic ? orthographic.znear ?? 0.01 : perspective.znear ?? 0.01,
      far: isOrthographic ? orthographic.zfar ?? 1000 : perspective.zfar ?? 1000,
      projection: isOrthographic ? 'orthographic' : 'perspective',
      orthographicSize: isOrthographic ? orthographic.ymag ?? 1 : undefined,
    });
  }
  if (importedCameras.length) {
    contract.cameras.push(...importedCameras);
  }

  contract.animations = report.animations.map((source: any, index: number) => ({
    id: animationIds[index],
    name: source.name,
    clipIndex: source.index,
    duration: source.duration ?? 0,
    loop: true,
    speed: 1,
    autoplay: source.index === 0,
  } satisfies SceneAnimation));
  contract.materialVariants = (report.materialVariants ?? []).map((source: any, index: number) => ({
    id: variantIds[index],
    name: source.name || `Variant ${index + 1}`,
  }));
  const importedLights: SceneLight[] = [];
  for (const sourceNode of report.nodes) {
    const lightIndex = sourceNode.extensions?.KHR_lights_punctual?.light;
    if (typeof lightIndex !== 'number' || !lightIds.has(lightIndex)) continue;
    const source = report.lights?.[lightIndex] ?? {};
    const spot = source.spot ?? {};
    importedLights.push({
      id: lightIds.get(lightIndex)!,
      name: source.name || sourceNode.name || `Light ${lightIndex + 1}`,
      type: source.type === 'point' || source.type === 'spot' ? source.type : 'directional',
      color: linearRgbHex(source.color ?? [1, 1, 1]),
      intensity: source.intensity ?? 1,
      transform: {
        position: { x: sourceNode.translation[0], y: sourceNode.translation[1], z: sourceNode.translation[2] },
        rotation: quaternionToEuler(sourceNode.rotation),
        scale: { x: 1, y: 1, z: 1 },
      },
      castShadow: true,
      range: source.range,
      decay: source.type === 'directional' ? undefined : 2,
      innerConeAngle: source.type === 'spot' ? spot.innerConeAngle ?? 0 : undefined,
      outerConeAngle: source.type === 'spot' ? spot.outerConeAngle ?? Math.PI / 4 : undefined,
    });
  }
  contract.lights = importedLights.slice(0, 4);
  if (!contract.lights.length) contract.lights = createDefaultLights();
  return contract;
}

function linearRgbHex(value: number[]): string {
  return `#${value.slice(0, 3).map((component) =>
    Math.round(Math.max(0, Math.min(1, component)) * 255).toString(16).padStart(2, '0'),
  ).join('')}`;
}

function normalizeAlphaMode(value: unknown): SceneMaterial['alphaMode'] {
  const normalized = String(value ?? 'OPAQUE').toLowerCase();
  return normalized === 'mask' || normalized === 'blend' ? normalized : 'opaque';
}

function quaternionToEuler(value: number[] = [0, 0, 0, 1]): {
  x: number;
  y: number;
  z: number;
} {
  const [x, y, z, w] = value;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  return { x: roll, y: pitch, z: yaw };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createIndexedDbDraftStore(): OfflineDraftStore {
  const databaseName = 'kyxos-studio-offline';
  const storeName = 'drafts';
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  return {
    async put(projectId, draft) {
      const database = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(structuredClone(draft), projectId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    async get(projectId) {
      const database = await open();
      const value = await new Promise<any>((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(projectId);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return value;
    },
    async delete(projectId) {
      const database = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(projectId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
  };
}
