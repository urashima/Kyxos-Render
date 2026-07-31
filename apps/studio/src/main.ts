import './styles.css';
import {
  createApiClient,
  hashBlob,
  type AssetManifest,
  type ProjectSummary,
  type ReleaseRecord,
} from '@kyxos/api-client';
import {
  AutosaveController,
  ProjectSession,
  SceneDocument,
  type OfflineDraftStore,
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
    '<small>Without Supabase variables, this preview uses the local owner-only provider.</small>',
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
  const draft = await client.drafts.load(project.id);
  const initial = structuredClone(draft?.contract ?? createEmptySceneContract(project.name));
  if (!initial.lights?.length) initial.lights = createDefaultLights();
  const document = new SceneDocument(initial);
  const session = new ProjectSession(project.id, document);
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
  shell.root.append(releaseDialog);

  const adapter = new BrowserKyxosViewportAdapter(resolver, {
    backend: initial.renderSettings.backend,
    quality: initial.renderSettings.qualityPreset,
  });
  await adapter.mount(canvas);
  await adapter.loadDocument(document);
  const unbindAdapter = adapter.bindSession(session);

  const autosave = new AutosaveController(
    project.id,
    document,
    {
      save: (id, contract, revision) => client.drafts.save(id, contract, revision),
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
      await autosave.flush();
      cleanup();
      await renderProjects();
    },
    'secondary',
  );
  const title = element('strong', { text: project.name });
  shell.topbar.append(projectButton, title, saveBadge);

  const toolGroup = element('div', { className: 'tool-group' });
  const toolButtons = new Map<EditorTool, HTMLButtonElement>();
  for (const [label, tool] of [
    ['Select', 'select'],
    ['Move', 'translate'],
    ['Rotate', 'rotate'],
    ['Scale', 'scale'],
  ] as const) {
    const control = button(label, () => setTool(tool), tool === 'select' ? 'active' : '');
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
  const snapButton = button('Snap off', () => {
    snap = { ...snap, enabled: !snap.enabled };
    adapter.setSnap(snap);
    snapButton.textContent = snap.enabled ? 'Snap on' : 'Snap off';
    snapButton.classList.toggle('active', snap.enabled);
  });
  shell.topbar.append(coordinateSelect, snapButton);

  const undoButton = button('Undo', () => session.history.undo());
  const redoButton = button('Redo', () => session.history.redo());
  const refreshHistoryButtons = () => {
    undoButton.disabled = !session.history.canUndo;
    redoButton.disabled = !session.history.canRedo;
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
      accept: '.glb,.hdr,.exr,.png,.jpg,.jpeg,.webp,.ktx2',
      hidden: '',
    },
  });
  uploadInput.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    uploadInput.value = '';
    if (file) void importAsset(file);
  });
  shell.topbar.append(
    uploadInput,
    button('Upload', () => uploadInput.click()),
    button('Versions', () => void showReleaseManager(), 'secondary'),
    button('Publish', () => void publish(), 'primary'),
  );

  const hierarchyToolbar = element('div', { className: 'panel-toolbar' });
  const hierarchySearch = element('input', {
    attrs: { type: 'search', placeholder: 'Search hierarchy' },
  });
  hierarchyToolbar.append(
    hierarchySearch,
    button('Frame', () => adapter.frame(session.selection.selected), 'mini'),
    button('Duplicate', duplicateSelected, 'mini'),
    button('Isolate', isolateSelected, 'mini'),
    button('Delete', deleteSelected, 'mini'),
  );
  const tree = element('div', { className: 'hierarchy-tree' });
  shell.hierarchy.append(hierarchyToolbar, tree);
  hierarchySearch.addEventListener('input', () => renderHierarchy());

  session.selection.addEventListener('change', () => {
    renderHierarchy();
    renderInspector();
  });
  session.document.addEventListener('change', () => {
    renderHierarchy();
    renderInspector();
    renderAssets();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.matches('input,textarea,select') && event.key !== 'Escape') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? session.history.redo() : session.history.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      session.history.redo();
    } else if (event.key.toLowerCase() === 'f') {
      adapter.frame(session.selection.selected);
    } else if (event.key.toLowerCase() === 'w') {
      setTool('translate');
    } else if (event.key.toLowerCase() === 'e') {
      setTool('rotate');
    } else if (event.key.toLowerCase() === 'r') {
      setTool('scale');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelected();
    } else if (event.key === 'Escape' && previewMode) {
      previewButton.click();
    }
  };
  const onPageHide = () => void autosave.flush();
  const onVisibility = () => {
    if (documentGlobal.hidden) void autosave.flush();
  };
  const documentGlobal = globalThis.document;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', onPageHide);
  documentGlobal.addEventListener('visibilitychange', onVisibility);

  disposeCurrentScreen = cleanup;
  renderHierarchy();
  renderInspector();
  renderAssets();
  shell.status.textContent = `Viewer ${adapter.getCapabilities()?.viewerApiVersion ?? 'starting'} · ${adapter.getCapabilities()?.backend ?? 'unknown backend'}`;

  function cleanup(): void {
    if (disposeCurrentScreen !== cleanup && !shell.root.isConnected) return;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', onPageHide);
    documentGlobal.removeEventListener('visibilitychange', onVisibility);
    unbindAdapter();
    adapter.dispose();
    autosave.dispose();
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
    session.commands.execute({
      id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${crypto.randomUUID()}`,
      label,
      mergeKey,
      patch,
    });
  }

  function renderHierarchy(): void {
    tree.replaceChildren();
    const scene = document.value;
    const query = hierarchySearch.value.trim().toLowerCase();
    for (const node of scene.nodes) {
      if (query && !node.name.toLowerCase().includes(query)) continue;
      const index = scene.nodes.findIndex((entry) => entry.id === node.id);
      const row = element('div', {
        className: 'hierarchy-row',
        attrs: { draggable: 'true', 'data-node': node.id },
      });
      row.style.paddingLeft = `${8 + nodeDepth(scene.nodes, node) * 14}px`;
      row.classList.toggle('selected', session.selection.selected.includes(node.id));
      row.classList.toggle('locked', Boolean(node.locked));

      const visibility = button(
        node.visible ? '◉' : '○',
        () =>
          execute('Toggle visibility', () => [
            { op: 'replace', path: `/nodes/${index}/visible`, value: !node.visible },
          ]),
        'mini',
      );
      const name = element('span', { text: node.name });
      name.addEventListener('dblclick', () => {
        const next = prompt('Node name', node.name);
        if (next) {
          execute('Rename node', () => [
            { op: 'replace', path: `/nodes/${index}/name`, value: next },
          ]);
        }
      });
      const lock = button(
        node.locked ? '🔒' : '◇',
        () =>
          execute('Lock node', () => [
            { op: node.locked == null ? 'add' : 'replace', path: `/nodes/${index}/locked`, value: !node.locked },
          ]),
        'mini',
      );
      row.append(visibility, nodeIcon(node), name, lock);
      row.addEventListener('click', (event) =>
        session.selection.select(
          [node.id],
          event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
        ),
      );
      row.addEventListener('dragstart', (event) =>
        event.dataTransfer?.setData('text/kyxos-node', node.id),
      );
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const childId = event.dataTransfer?.getData('text/kyxos-node');
        if (childId && childId !== node.id) reparent(childId, node.id);
      });
      tree.append(row);
    }
  }

  function reparent(childId: string, parentId: string): void {
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
    const scene = document.value;
    const selected = new Set(session.selection.selected);
    if (!selected.size) return;
    const duplicates = scene.nodes
      .filter((node) => selected.has(node.id))
      .map((node) => ({ ...structuredClone(node), id: crypto.randomUUID(), name: `${node.name} Copy`, children: [] }));
    execute('Duplicate nodes', () =>
      duplicates.map((node) => ({ op: 'add', path: '/nodes/-', value: node })),
    );
    queueMicrotask(() => session.selection.select(duplicates.map((node) => node.id)));
  }

  function isolateSelected(): void {
    const selected = new Set(session.selection.selected);
    if (!selected.size) return;
    const scene = document.value;
    execute('Isolate nodes', () =>
      scene.nodes.map((node, index) => ({
        op: 'replace' as const,
        path: `/nodes/${index}/visible`,
        value: selected.has(node.id),
      })),
    );
  }

  function deleteSelected(): void {
    const scene = document.value;
    const deleting = collectNodeDescendants(scene.nodes, session.selection.selected);
    if (!deleting.size) return;
    execute('Delete nodes', () => {
      const patch: ScenePatch = [];
      for (const [index, node] of scene.nodes.entries()) {
        if (deleting.has(node.id)) continue;
        const children = node.children.filter((id) => !deleting.has(id));
        if (children.length !== node.children.length) {
          patch.push({ op: 'replace', path: `/nodes/${index}/children`, value: children });
        }
      }
      const indexes = scene.nodes
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => deleting.has(node.id))
        .map(({ index }) => index)
        .sort((a, b) => b - a);
      for (const index of indexes) patch.push({ op: 'remove', path: `/nodes/${index}` });
      return patch;
    });
    session.selection.clear();
  }

  function renderInspector(): void {
    shell.inspector.replaceChildren();
    const scene = document.value;
    const selectedNodes = session.selection.selected
      .map((id) => scene.nodes.find((node) => node.id === id))
      .filter((node): node is SceneNode => Boolean(node));

    if (selectedNodes.length) renderTransformInspector(scene, selectedNodes);
    if (selectedNodes.length === 1) renderMaterialInspector(scene, selectedNodes[0]);
    renderAnimationInspector(scene);
    renderEnvironmentInspector(scene);
    renderLightingInspector(scene);
    renderCameraInspector(scene);
    renderRenderInspector(scene);
  }

  function renderTransformInspector(
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

  function renderMaterialInspector(
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

  function renderEnvironmentInspector(scene: KyxosSceneContract): void {
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

  function renderLightingInspector(scene: KyxosSceneContract): void {
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

  function renderCameraInspector(scene: KyxosSceneContract): void {
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

  function renderRenderInspector(scene: KyxosSceneContract): void {
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
    const scene = document.value;
    const tabs = element('div', { className: 'asset-tabs' });
    tabs.append(
      element('strong', { text: 'Assets' }),
      element('span', { text: `${Object.keys(scene.assets).length} files` }),
      element('strong', { text: 'Animation' }),
      element('span', { text: `${scene.animations.length} clips` }),
    );
    shell.assets.append(tabs);
    for (const asset of Object.values(scene.assets)) {
      const chip = element('button', {
        className: 'asset-chip',
        text: `${asset.kind} · ${asset.name ?? asset.contentHash.slice(0, 8)}`,
        attrs: { type: 'button' },
      });
      if (asset.kind === 'environment') {
        chip.addEventListener('click', async () => {
          const hasAsset = Boolean(document.value.environment.assetId);
          execute('Use environment', () => [
            {
              op: hasAsset ? 'replace' : 'add',
              path: '/environment/assetId',
              value: asset.id,
            },
          ]);
          await adapter.loadEnvironmentAsset(asset.id);
        });
      }
      shell.assets.append(chip);
    }
    for (const animation of scene.animations) {
      const row = element('div', { className: 'animation-chip' });
      row.append(
        button('Play', () => {
          activeAnimationId = animation.id;
          playAnimation(true, 0);
        }),
        element('span', { text: `${animation.name} · ${animation.duration.toFixed(2)}s` }),
      );
      shell.assets.append(row);
    }
  }

  async function importAsset(file: File): Promise<void> {
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
        for (const asset of Object.values(document.value.assets)) {
          if (asset.kind !== 'model') imported.assets[asset.id] = asset;
        }
        if (document.value.environment.assetId) {
          imported.environment = structuredClone(document.value.environment);
        }
        imported.lights = document.value.lights?.length
          ? structuredClone(document.value.lights)
          : createDefaultLights();
        document.replace(imported, 'import-glb');
        await adapter.loadDocument(document);
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

function nodeDepth(nodes: SceneNode[], node: SceneNode): number {
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

function isDescendant(nodes: SceneNode[], ancestorId: string, candidateId: string): boolean {
  let current = nodes.find((node) => node.id === candidateId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = nodes.find((node) => node.id === current?.parentId);
  }
  return false;
}

function collectNodeDescendants(nodes: SceneNode[], roots: string[]): Set<string> {
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
  const cameraIds = new Map<number, string>();
  for (const source of report.nodes) {
    if (source.camera != null) cameraIds.set(source.camera, crypto.randomUUID());
  }

  contract.materials = Object.fromEntries(
    report.materials.map((source: any, index: number) => {
      const pbr = source.pbr ?? {};
      const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
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
        metadata: {
          gltfMaterialIndex: source.index,
          gltfTextures: {
            baseColor: pbr.baseColorTexture,
            metallicRoughness: pbr.metallicRoughnessTexture,
            normal: source.normalTexture,
            emissive: source.emissiveTexture,
            occlusion: source.occlusionTexture,
          },
        },
      };
      original.metadata!.original = structuredClone({
        ...original,
        metadata: undefined,
      });
      return [original.id, original];
    }),
  );

  contract.nodes = report.nodes.map((source: any, index: number) => {
    const primitive = source.mesh != null ? report.meshes[source.mesh]?.primitives?.[0] : null;
    const materialId = primitive?.material != null ? materialIds[primitive.material] : undefined;
    const rotation = quaternionToEuler(source.rotation);
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
      materialSlots: materialId ? [materialId] : [],
      cameraId: source.camera == null ? undefined : cameraIds.get(source.camera),
      metadata: {
        gltfNodeIndex: source.index,
        sourceQuaternion: source.rotation,
      },
    } satisfies SceneNode;
  });

  const importedCameras: SceneCamera[] = [];
  for (const source of report.nodes) {
    if (source.camera == null) continue;
    const cameraSource = report.cameras[source.camera] ?? {};
    const perspective = cameraSource.perspective ?? {};
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
      near: perspective.znear ?? 0.01,
      far: perspective.zfar ?? 1000,
    });
  }
  if (importedCameras.length) {
    contract.cameras.push(...importedCameras);
  }

  contract.animations = report.animations.map((source: any) => ({
    id: crypto.randomUUID(),
    name: source.name,
    clipIndex: source.index,
    duration: source.duration ?? 0,
    loop: true,
    speed: 1,
    autoplay: source.index === 0,
  } satisfies SceneAnimation));
  contract.lights = createDefaultLights();
  return contract;
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
