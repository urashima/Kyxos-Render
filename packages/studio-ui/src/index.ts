import type { KyxosApiClient, KyxosProjectRecord } from '@kyxos/api-client';
import {
  AutosaveController,
  EditorSession,
  addAnnotationCommand,
  addLightCommand,
  createIndexedDbBackup,
  sanitizeAnnotation,
  setCameraCommand,
  setEffectCommand,
  setEnvironmentCommand,
  setMaterialCommand,
  setTransformCommand,
  type EditorSnapshot,
} from '@kyxos/editor-core';
import {
  createDefaultSceneDocument,
  fail,
  ok,
  type Annotation,
  type CameraState,
  type EnvironmentState,
  type KyxosSceneDocument,
  type MaterialOverride,
  type RuntimeMaterial,
  type SceneGraphNode,
  type SceneLight,
  type TransformState,
} from '@kyxos/scene-contract';

export interface StudioViewerAdapter extends EventTarget {
  loadAsset: (asset: NonNullable<KyxosSceneDocument['asset']>) => Promise<unknown>;
  loadModel: (url: string) => Promise<void>;
  applySceneDocument: (document: KyxosSceneDocument) => Promise<unknown>;
  exportSceneDocument: () => KyxosSceneDocument;
  getSceneGraph: () => SceneGraphNode[];
  getMaterials: () => RuntimeMaterial[];
  getCameraState: () => CameraState;
  getEnvironmentState: () => EnvironmentState;
  getLights: () => SceneLight[];
  getAnimations: () => Array<{ id: string; name: string; duration: number }>;
  setObjectVisibility: (objectId: string, visible: boolean) => unknown;
  setObjectTransform: (objectId: string, transform: TransformState) => unknown;
  updateMaterial: (materialId: string, patch: Partial<MaterialOverride>) => unknown;
  setCameraState: (state: CameraState) => unknown;
  setEnvironmentState: (state: EnvironmentState) => Promise<unknown>;
  addLight: (light: SceneLight) => unknown;
  playAnimation: (clipId?: string) => unknown;
  pauseAnimation: () => unknown;
  seekAnimation: (time: number) => unknown;
  setAnimationLoop: (mode: 'once' | 'repeat' | 'pingpong') => unknown;
  setAnimationSpeed: (speed: number) => unknown;
  addAnnotation: (annotation: Annotation) => unknown;
  captureThumbnail: () => Promise<{ ok: boolean; data?: string }>;
  dispose: () => void;
}

export interface StudioMountOptions {
  root: HTMLElement;
  apiClient: KyxosApiClient;
  createViewer: (canvas: HTMLCanvasElement) => Promise<StudioViewerAdapter>;
  publicBaseUrl?: string;
}

const styles = `
  :root {
    color-scheme: dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #101318;
    color: #edf2f7;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #101318; }
  button, input, select, textarea { font: inherit; }
  .kx-shell {
    display: grid;
    grid-template-rows: 48px minmax(0, 1fr) 72px;
    min-height: 100vh;
    background: #101318;
  }
  .kx-topbar {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto auto auto auto auto auto;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid #2c3440;
    background: #151a21;
  }
  .kx-title {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }
  .kx-mark {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: #33d6a6;
    color: #07120f;
    font-weight: 800;
  }
  .kx-project-select, .kx-field, .kx-textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid #34404e;
    border-radius: 6px;
    background: #0f1319;
    color: #edf2f7;
    padding: 8px;
  }
  .kx-btn {
    min-height: 32px;
    border: 1px solid #34404e;
    border-radius: 6px;
    background: #202834;
    color: #edf2f7;
    padding: 6px 10px;
    cursor: pointer;
  }
  .kx-btn.primary { background: #33d6a6; color: #07120f; border-color: #33d6a6; font-weight: 700; }
  .kx-btn.danger { color: #fecaca; border-color: #66363a; background: #2a171a; }
  .kx-btn:disabled { opacity: 0.48; cursor: not-allowed; }
  .kx-main {
    min-height: 0;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 320px;
  }
  .kx-left, .kx-right {
    min-height: 0;
    overflow: auto;
    border-color: #2c3440;
    background: #141920;
  }
  .kx-left { border-right: 1px solid #2c3440; }
  .kx-right { border-left: 1px solid #2c3440; }
  .kx-viewport {
    position: relative;
    min-width: 0;
    min-height: 0;
    background: #07090d;
  }
  .kx-viewport canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .kx-panel { padding: 12px; border-bottom: 1px solid #252d38; }
  .kx-panel h2 {
    margin: 0 0 10px;
    font-size: 12px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0;
  }
  .kx-tree { display: grid; gap: 4px; }
  .kx-tree-row {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) 24px;
    gap: 6px;
    align-items: center;
    min-height: 30px;
    padding: 2px 4px;
    border-radius: 6px;
    color: #dce7f3;
  }
  .kx-tree-row.active { background: #22303a; }
  .kx-tree-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .kx-stack { display: grid; gap: 8px; }
  .kx-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .kx-row { display: grid; gap: 4px; }
  .kx-label { font-size: 12px; color: #9aa7b7; }
  .kx-bottom {
    display: grid;
    grid-template-columns: 1fr auto auto auto auto;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border-top: 1px solid #2c3440;
    background: #151a21;
  }
  .kx-timeline {
    width: 100%;
    accent-color: #33d6a6;
  }
  .kx-status {
    min-width: 120px;
    color: #a7f3d0;
    font-size: 12px;
  }
  .kx-drop {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px dashed #475569;
    border-radius: 8px;
    background: #101820;
  }
  .kx-report { margin: 0; padding-left: 18px; color: #cbd5e1; font-size: 12px; }
  @media (max-width: 900px) {
    .kx-shell { grid-template-rows: auto minmax(0, 1fr) auto; }
    .kx-topbar { grid-template-columns: 1fr 1fr 1fr; }
    .kx-main { grid-template-columns: 1fr; grid-template-rows: 210px minmax(340px, 1fr) 320px; }
    .kx-left { border-right: 0; border-bottom: 1px solid #2c3440; }
    .kx-right { border-left: 0; border-top: 1px solid #2c3440; }
  }
`;

function ensureStyles() {
  if (document.querySelector('[data-kyxos-studio-styles]')) return;
  const element = document.createElement('style');
  element.dataset.kyxosStudioStyles = 'true';
  element.textContent = styles;
  document.head.append(element);
}

function inputValue(root: HTMLElement, selector: string, fallback = '') {
  return (
    root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)?.value ??
    fallback
  );
}

function numberInput(root: HTMLElement, selector: string, fallback = 0) {
  const value = Number(inputValue(root, selector, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function renderMetricList(document: KyxosSceneDocument) {
  const manifest = document.assetManifest;
  if (!manifest) return '<li>No asset report yet</li>';
  return [
    `Meshes: ${manifest.meshCount}`,
    `Triangles: ${manifest.triangleCount.toLocaleString()}`,
    `Draw calls: ${manifest.drawCallEstimate}`,
    `Materials: ${manifest.materialCount}`,
    `Textures: ${manifest.textureCount}`,
    `Animations: ${manifest.animationCount}`,
    `Warnings: ${manifest.warnings.length}`,
  ]
    .map((item) => `<li>${item}</li>`)
    .join('');
}

function createAnnotation(snapshot: EditorSnapshot, viewer: StudioViewerAdapter): Annotation {
  const camera = viewer.getCameraState();
  return sanitizeAnnotation({
    id: `annotation-${Date.now()}`,
    position: [0, 1, 0],
    surfaceNormal: [0, 1, 0],
    title: 'Annotation',
    markdown: 'Material note',
    cameraPosition: camera.position,
    cameraTarget: camera.target,
    sortOrder: snapshot.document.annotations.length,
    visible: true,
  });
}

export async function mountStudioApp(options: StudioMountOptions) {
  ensureStyles();
  const { root, apiClient } = options;
  root.innerHTML = `
    <main class="kx-shell">
      <header class="kx-topbar">
        <div class="kx-title"><div class="kx-mark">K</div><select class="kx-project-select" id="project-select"></select></div>
        <button class="kx-btn" id="new-project" title="Create project">+</button>
        <button class="kx-btn" id="duplicate-project" title="Duplicate project">Copy</button>
        <button class="kx-btn danger" id="delete-project" title="Delete project">Delete</button>
        <span class="kx-status" id="save-state">Saved</span>
        <button class="kx-btn" id="undo-button" title="Undo">Undo</button>
        <button class="kx-btn" id="redo-button" title="Redo">Redo</button>
        <button class="kx-btn primary" id="publish-button" title="Publish">Publish</button>
      </header>
      <section class="kx-main">
        <aside class="kx-left">
          <section class="kx-panel">
            <h2>Scene Tree</h2>
            <input class="kx-field" id="tree-search" placeholder="Search" />
            <div class="kx-tree" id="scene-tree"></div>
          </section>
          <section class="kx-panel">
            <h2>Assets</h2>
            <label class="kx-drop">
              <input id="asset-input" type="file" accept=".glb,.zip,.hdr,.exr,image/png,image/jpeg,image/webp,.ktx2,video/mp4,video/webm" />
              <span id="upload-state">Selecting</span>
            </label>
            <ul class="kx-report" id="asset-report"></ul>
          </section>
        </aside>
        <section class="kx-viewport"><canvas id="studio-canvas" tabindex="0"></canvas></section>
        <aside class="kx-right">
          <section class="kx-panel kx-stack">
            <h2>Transform</h2>
            <div class="kx-grid2">
              <label class="kx-row"><span class="kx-label">X</span><input class="kx-field" id="pos-x" type="number" step="0.1" /></label>
              <label class="kx-row"><span class="kx-label">Y</span><input class="kx-field" id="pos-y" type="number" step="0.1" /></label>
              <label class="kx-row"><span class="kx-label">Z</span><input class="kx-field" id="pos-z" type="number" step="0.1" /></label>
              <label class="kx-row"><span class="kx-label">Scale</span><input class="kx-field" id="scale-all" type="number" min="0.01" step="0.05" /></label>
            </div>
            <button class="kx-btn" id="apply-transform">Apply</button>
            <button class="kx-btn" id="fit-camera">Fit Camera</button>
          </section>
          <section class="kx-panel kx-stack">
            <h2>Material</h2>
            <select class="kx-field" id="material-select"></select>
            <label class="kx-row"><span class="kx-label">Base Color</span><input class="kx-field" id="base-color" type="color" value="#cbd5e1" /></label>
            <div class="kx-grid2">
              <label class="kx-row"><span class="kx-label">Metalness</span><input class="kx-field" id="metalness" type="number" min="0" max="1" step="0.05" /></label>
              <label class="kx-row"><span class="kx-label">Roughness</span><input class="kx-field" id="roughness" type="number" min="0" max="1" step="0.05" /></label>
            </div>
            <button class="kx-btn" id="apply-material">Apply</button>
          </section>
          <section class="kx-panel kx-stack">
            <h2>Lighting</h2>
            <label class="kx-row"><span class="kx-label">Environment Intensity</span><input class="kx-field" id="env-intensity" type="number" min="0" step="0.1" /></label>
            <button class="kx-btn" id="add-light">Add Light</button>
            <button class="kx-btn" id="apply-env">Apply Environment</button>
          </section>
          <section class="kx-panel kx-stack">
            <h2>Camera / Effects</h2>
            <select class="kx-field" id="quality-select"><option>low</option><option>medium</option><option selected>high</option><option>cinematic</option><option>capture</option></select>
            <button class="kx-btn" id="save-camera">Save Camera</button>
            <button class="kx-btn" id="add-annotation">Add Annotation</button>
          </section>
        </aside>
      </section>
      <footer class="kx-bottom">
        <input class="kx-timeline" id="timeline" type="range" min="0" max="1" step="0.01" value="0" />
        <select class="kx-field" id="clip-select"></select>
        <button class="kx-btn" id="play-button">Play</button>
        <button class="kx-btn" id="pause-button">Pause</button>
        <select class="kx-field" id="loop-select"><option value="repeat">Loop</option><option value="once">Once</option><option value="pingpong">Ping Pong</option></select>
      </footer>
    </main>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>('#studio-canvas');
  if (!canvas) throw new Error('Studio canvas was not created.');
  const viewer = await options.createViewer(canvas);
  await viewer.loadModel('procedural:material-study');

  let projects: KyxosProjectRecord[] = [];
  let activeProject: KyxosProjectRecord;
  let selectedObjectId = 'presentation-root';
  let session = new EditorSession(createDefaultSceneDocument());
  let autosave = new AutosaveController(session, {
    save: async (draft) => ok(draft, 'No project selected.'),
  });

  const render = (snapshot: EditorSnapshot) => {
    root.querySelector('#save-state')!.textContent = snapshot.saveState;
    const projectSelect = root.querySelector<HTMLSelectElement>('#project-select');
    if (projectSelect) {
      projectSelect.innerHTML = projects
        .map(
          (project) =>
            `<option value="${project.metadata.id}" ${project.metadata.id === activeProject?.metadata.id ? 'selected' : ''}>${project.metadata.title}</option>`,
        )
        .join('');
    }
    const graph = viewer
      .getSceneGraph()
      .filter((node) => node.name.toLowerCase().includes(inputValue(root, '#tree-search').toLowerCase()));
    root.querySelector('#scene-tree')!.innerHTML = graph
      .map(
        (node) => `
          <button class="kx-tree-row ${node.id === selectedObjectId ? 'active' : ''}" data-object-id="${node.id}">
            <span>${node.visible ? 'o' : '-'}</span><span class="kx-tree-name">${node.name}</span><span>${node.type === 'mesh' ? 'M' : node.type === 'light' ? 'L' : node.type === 'annotation' ? 'A' : ''}</span>
          </button>`,
      )
      .join('');
    const materials = viewer.getMaterials();
    root.querySelector('#material-select')!.innerHTML = materials
      .map((material) => `<option value="${material.id}">${material.name}</option>`)
      .join('');
    const animations = viewer.getAnimations();
    root.querySelector('#clip-select')!.innerHTML = animations.length
      ? animations.map((clip) => `<option value="${clip.id}">${clip.name}</option>`).join('')
      : '<option value="">No clips</option>';
    root.querySelector('#asset-report')!.innerHTML = renderMetricList(snapshot.document);
    const transform = snapshot.document.model.transform;
    root.querySelector<HTMLInputElement>('#pos-x')!.value = String(transform.position[0]);
    root.querySelector<HTMLInputElement>('#pos-y')!.value = String(transform.position[1]);
    root.querySelector<HTMLInputElement>('#pos-z')!.value = String(transform.position[2]);
    root.querySelector<HTMLInputElement>('#scale-all')!.value = String(transform.scale[0]);
    root.querySelector<HTMLInputElement>('#env-intensity')!.value = String(
      snapshot.document.environment.intensity,
    );
  };

  const bindAutosave = () => {
    autosave = new AutosaveController(
      session,
      {
        save: async (draft) => {
          const result = await apiClient.saveDraft(activeProject.metadata.id, draft.document, draft.revision);
          if (!result.ok || !result.data)
            return fail(result.code, result.message ?? 'Draft save failed.', result.details);
          activeProject = result.data;
          projects = projects.map((project) =>
            project.metadata.id === activeProject.metadata.id ? activeProject : project,
          );
          return ok(
            {
              document: activeProject.draft,
              revision: activeProject.draftRevision,
              savedAt: new Date().toISOString(),
            },
            'Draft saved.',
          );
        },
        ...createIndexedDbBackup(),
      },
      800,
    );
  };

  const loadProject = async (project: KyxosProjectRecord) => {
    activeProject = project;
    session = new EditorSession(project.draft, project.draftRevision);
    bindAutosave();
    session.subscribe(render);
    await viewer.applySceneDocument(project.draft);
    render(session.snapshot());
  };

  const projectsResult = await apiClient.listProjects();
  projects = projectsResult.data ?? [];
  if (projects.length === 0) {
    const created = await apiClient.createProject('Kyxos Acceptance Scene');
    projects = created.data ? [created.data] : [];
  }
  activeProject = projects[0];
  await loadProject(activeProject);

  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const treeRow = target.closest<HTMLElement>('[data-object-id]');
    if (treeRow) {
      selectedObjectId = treeRow.dataset.objectId ?? selectedObjectId;
      render(session.snapshot());
      return;
    }
    if (target.id === 'undo-button') {
      const result = session.undo();
      if (result.ok && result.data) {
        await viewer.applySceneDocument(result.data.document);
        autosave.schedule();
      }
    }
    if (target.id === 'redo-button') {
      const result = session.redo();
      if (result.ok && result.data) {
        await viewer.applySceneDocument(result.data.document);
        autosave.schedule();
      }
    }
    if (target.id === 'new-project') {
      const created = await apiClient.createProject('Untitled Kyxos Scene');
      if (created.data) {
        projects.unshift(created.data);
        await loadProject(created.data);
      }
    }
    if (target.id === 'duplicate-project') {
      const duplicated = await apiClient.duplicateProject(activeProject.metadata.id);
      if (duplicated.data) {
        projects.unshift(duplicated.data);
        await loadProject(duplicated.data);
      }
    }
    if (target.id === 'delete-project') {
      await apiClient.deleteProject(activeProject.metadata.id);
      projects = projects.filter((project) => project.metadata.id !== activeProject.metadata.id);
      if (projects[0]) await loadProject(projects[0]);
    }
    if (target.id === 'apply-transform') {
      const before = session.snapshot().document.model.transform;
      const after: TransformState = {
        position: [numberInput(root, '#pos-x'), numberInput(root, '#pos-y'), numberInput(root, '#pos-z')],
        rotation: before.rotation,
        scale: [
          numberInput(root, '#scale-all', 1),
          numberInput(root, '#scale-all', 1),
          numberInput(root, '#scale-all', 1),
        ],
      };
      viewer.setObjectTransform(selectedObjectId, after);
      session.dispatch(setTransformCommand(before, viewer.exportSceneDocument().model.transform));
      autosave.schedule();
    }
    if (target.id === 'fit-camera') {
      const before = viewer.getCameraState();
      (viewer as unknown as { fitCamera?: () => unknown }).fitCamera?.();
      const after = viewer.getCameraState();
      session.dispatch(setCameraCommand(before, after));
      autosave.schedule();
    }
    if (target.id === 'apply-material') {
      const materialId = inputValue(root, '#material-select');
      const material: MaterialOverride = {
        materialId,
        baseColorFactor: hexToColor4(inputValue(root, '#base-color', '#cbd5e1')),
        metalness: numberInput(root, '#metalness', 0.5),
        roughness: numberInput(root, '#roughness', 0.5),
      };
      const before = session.snapshot().document.materials[materialId] ?? null;
      viewer.updateMaterial(materialId, material);
      session.dispatch(setMaterialCommand(materialId, before, material));
      autosave.schedule();
    }
    if (target.id === 'apply-env') {
      const before = viewer.getEnvironmentState();
      const after = { ...before, intensity: numberInput(root, '#env-intensity', before.intensity) };
      await viewer.setEnvironmentState(after);
      session.dispatch(setEnvironmentCommand(before, after));
      autosave.schedule();
    }
    if (target.id === 'add-light') {
      const light: SceneLight = {
        id: `light-${Date.now()}`,
        type: 'directional',
        name: 'Key Light',
        color: '#fff2df',
        intensity: 3,
        position: [3, 5, 4],
        rotation: [0, 0, 0],
        castShadow: true,
        shadowResolution: 1024,
        shadowBias: -0.0001,
      };
      viewer.addLight(light);
      session.dispatch(addLightCommand(light));
      autosave.schedule();
    }
    if (target.id === 'save-camera') {
      const before = session.snapshot().document.camera;
      const after = viewer.getCameraState();
      session.dispatch(setCameraCommand(before, after));
      autosave.schedule();
    }
    if (target.id === 'add-annotation') {
      const annotation = createAnnotation(session.snapshot(), viewer);
      viewer.addAnnotation(annotation);
      session.dispatch(addAnnotationCommand(annotation));
      autosave.schedule();
    }
    if (target.id === 'publish-button') {
      await autosave.flush();
      const published = await apiClient.publishProject(activeProject.metadata.id, 'unlisted');
      if (published.ok && published.data) {
        const link = await apiClient.copyPublicLink(published.data.slug, options.publicBaseUrl);
        root.querySelector('#save-state')!.textContent = link.data ?? 'Published';
      }
    }
    if (target.id === 'play-button') viewer.playAnimation(inputValue(root, '#clip-select') || undefined);
    if (target.id === 'pause-button') viewer.pauseAnimation();
  });

  root.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'project-select') {
      const project = projects.find((item) => item.metadata.id === target.value);
      if (project) await loadProject(project);
    }
    if (target.id === 'asset-input' && target instanceof HTMLInputElement) {
      const file = target.files?.[0];
      if (!file) return;
      root.querySelector('#upload-state')!.textContent = 'Validating';
      const result = await apiClient.uploadAsset(activeProject.metadata.id, file, {
        fileName: file.name,
        mimeType: file.type,
      });
      if (result.ok && result.data) {
        root.querySelector('#upload-state')!.textContent = 'Ready';
        await viewer.loadAsset(result.data.manifest.source);
        const document = viewer.exportSceneDocument();
        document.asset = result.data.manifest.source;
        document.assetManifest = result.data.manifest;
        session.replaceDocument(document, activeProject.draftRevision + 1);
        autosave.schedule();
      } else {
        root.querySelector('#upload-state')!.textContent = 'Failed';
      }
    }
    if (target.id === 'quality-select') {
      const before = session.snapshot().document.effects;
      const after = { ...before, quality: target.value as KyxosSceneDocument['effects']['quality'] };
      session.dispatch(setEffectCommand(before, after));
      await viewer.applySceneDocument({ ...session.snapshot().document, effects: after });
      autosave.schedule();
    }
    if (target.id === 'loop-select') viewer.setAnimationLoop(target.value as 'once' | 'repeat' | 'pingpong');
  });

  root.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'timeline') viewer.seekAnimation(Number(target.value));
    if (target.id === 'tree-search') render(session.snapshot());
  });

  const beforeUnload = () => {
    void autosave.flush();
  };
  window.addEventListener('beforeunload', beforeUnload);

  return {
    dispose: () => {
      window.removeEventListener('beforeunload', beforeUnload);
      viewer.dispose();
    },
  };
}

function hexToColor4(hex: string): [number, number, number, number] {
  const value = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return [r, g, b, 1];
}
