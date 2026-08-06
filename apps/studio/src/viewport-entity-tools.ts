import './viewport-entity-tools.css';

import type {
  KyxosSceneContract,
  SceneCamera,
  SceneLight,
  SceneNode,
  ScenePatch,
  Transform,
  Vec3,
} from '@kyxos/scene-contract';

type EntityFilter = 'all' | 'camera' | 'light';

interface StudioApiLike {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: ScenePatch): void;
  getSelection(): string[];
  setSelection(ids: string[]): void;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

interface UiState {
  open: boolean;
  collapsed: boolean;
  filter: EntityFilter;
  query: string;
  left: number;
  top: number;
}

interface EntityRecord {
  node: SceneNode;
  kind: EntityFilter;
  camera?: SceneCamera;
  light?: SceneLight;
}

interface CameraBookmarkResponse {
  requestId: string;
  state: { camera: SceneCamera; up: Vec3; preset?: string };
}

const STORAGE_KEY = 'kyxos-studio-viewport-entity-tools-v1';
const mountedShells = new WeakSet<HTMLElement>();
let activePanel: HTMLElement | null = null;
let activeCanvas: HTMLCanvasElement | null = null;
let activeApi: StudioApiLike | null = null;
let renderTimer = 0;
let uiState = readUiState();

function readUiState(): UiState {
  const fallback: UiState = {
    open: true,
    collapsed: false,
    filter: 'all',
    query: '',
    left: Math.max(16, window.innerWidth - 356),
    top: 116,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<UiState>;
    return {
      open: stored.open !== false,
      collapsed: Boolean(stored.collapsed),
      filter: stored.filter === 'camera' || stored.filter === 'light' ? stored.filter : 'all',
      query: typeof stored.query === 'string' ? stored.query : '',
      left: finite(stored.left, fallback.left),
      top: finite(stored.top, fallback.top),
    };
  } catch {
    return fallback;
  }
}

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function saveUiState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uiState));
  } catch {
    // The live editor remains functional without local persistence.
  }
}

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function entityRecords(scene: KyxosSceneContract): EntityRecord[] {
  const cameras = new Map(scene.cameras.map((camera) => [camera.id, camera]));
  const lights = new Map((scene.lights ?? []).map((light) => [light.id, light]));
  return scene.nodes.map((node) => {
    const camera = node.cameraId ? cameras.get(node.cameraId) : undefined;
    const light = node.lightId ? lights.get(node.lightId) : undefined;
    return {
      node,
      kind: camera ? 'camera' : light ? 'light' : 'all',
      camera,
      light,
    };
  });
}

function filteredRecords(scene: KyxosSceneContract): EntityRecord[] {
  const query = uiState.query.trim().toLocaleLowerCase();
  return entityRecords(scene)
    .filter((record) => uiState.filter === 'all' || record.kind === uiState.filter)
    .filter((record) => !query || record.node.name.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const rank = (record: EntityRecord) => record.kind === 'camera' ? 0 : record.kind === 'light' ? 1 : 2;
      return rank(left) - rank(right) || left.node.name.localeCompare(right.node.name);
    });
}

function patch(label: string, operations: ScenePatch): void {
  if (!operations.length) return;
  activeApi?.applyPatch(label, operations);
  scheduleRender();
}

function replace(label: string, path: string, value: unknown): void {
  patch(label, [{ op: 'replace', path, value }]);
}

function setOptional(
  label: string,
  path: string,
  value: unknown,
  exists: boolean,
): void {
  patch(label, [{ op: exists ? 'replace' : 'add', path, value }]);
}

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.className = className;
  control.addEventListener('click', action);
  return control;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const row = document.createElement('label');
  row.className = 'kx-entity-field';
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = label;
  copy.append(title);
  if (hint) {
    const help = document.createElement('small');
    help.textContent = hint;
    copy.append(help);
  }
  row.append(copy, control);
  return row;
}

function numberInput(value: number, options: {
  min?: number;
  max?: number;
  step?: number;
  label: string;
  commit(value: number): void;
}): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(Number.isFinite(value) ? value : 0);
  input.step = String(options.step ?? 0.01);
  input.setAttribute('aria-label', options.label);
  if (options.min != null) input.min = String(options.min);
  if (options.max != null) input.max = String(options.max);
  input.addEventListener('change', () => options.commit(Number(input.value)));
  return input;
}

function selectInput(
  value: string,
  label: string,
  options: Array<[string, string]>,
  commit: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  for (const [optionLabel, optionValue] of options) select.append(new Option(optionLabel, optionValue));
  select.value = value;
  select.addEventListener('change', () => commit(select.value));
  return select;
}

function checkboxInput(value: boolean, label: string, commit: (value: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => commit(input.checked));
  return input;
}

function vectorEditor(
  label: string,
  value: Vec3,
  commit: (axis: keyof Vec3, value: number) => void,
  step = 0.1,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-entity-vector-row';
  const title = document.createElement('span');
  title.textContent = label;
  row.append(title);
  for (const axis of ['x', 'y', 'z'] as const) {
    const wrap = document.createElement('label');
    wrap.dataset.axis = axis;
    const axisLabel = document.createElement('span');
    axisLabel.textContent = axis.toUpperCase();
    const input = numberInput(value[axis], {
      step,
      label: `${label} ${axis}`,
      commit: (next) => commit(axis, next),
    });
    wrap.append(axisLabel, input);
    row.append(wrap);
  }
  return row;
}

function section(title: string, open = true): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'kx-entity-section';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.append(summary);
  return details;
}

function ensureHelper(label: 'Camera helpers' | 'Light helpers'): void {
  const control = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (control && !control.checked) control.click();
}

function frameSelection(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
}

function setTool(label: 'Select' | 'Move' | 'Rotate' | 'Scale'): void {
  const shell = activePanel?.closest<HTMLElement>('.kyxos-studio-shell');
  const control = Array.from(shell?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    .find((entry) => entry.textContent?.trim() === label);
  control?.click();
}

function selectRecord(record: EntityRecord, mode: 'replace' | 'toggle' = 'replace'): void {
  if (!activeApi) return;
  const current = activeApi.getSelection();
  if (mode === 'toggle') {
    activeApi.setSelection(current.includes(record.node.id)
      ? current.filter((id) => id !== record.node.id)
      : [...current, record.node.id]);
  } else {
    activeApi.setSelection([record.node.id]);
  }
  if (record.kind === 'camera') ensureHelper('Camera helpers');
  if (record.kind === 'light') ensureHelper('Light helpers');
  scheduleRender();
}

function requestEditorCameraState(canvas: HTMLCanvasElement): Promise<CameraBookmarkResponse['state']> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
      reject(new Error('Editor camera capture timed out.'));
    }, 2_000);
    const onState: EventListener = (event) => {
      const detail = (event as CustomEvent<CameraBookmarkResponse>).detail;
      if (detail.requestId !== requestId) return;
      window.clearTimeout(timeout);
      canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
      resolve(detail.state);
    };
    canvas.addEventListener('kyxos:editor-camera-bookmark-state', onState);
    canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
      detail: { command: 'capture-bookmark', requestId },
    }));
  });
}

function lookThroughCamera(camera: SceneCamera): void {
  activeCanvas?.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
    detail: {
      command: 'restore-bookmark',
      state: {
        camera: structuredClone(camera),
        up: { x: 0, y: 1, z: 0 },
      },
    },
  }));
}

function renderEntityList(panel: HTMLElement, scene: KyxosSceneContract): void {
  const list = panel.querySelector<HTMLElement>('[data-kx-entity-list]');
  if (!list || !activeApi) return;
  list.replaceChildren();
  const selected = new Set(activeApi.getSelection());
  const records = filteredRecords(scene);
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'kx-entity-empty';
    empty.textContent = 'No matching scene objects.';
    list.append(empty);
    return;
  }
  for (const record of records) {
    const item = button('', () => selectRecord(record), 'kx-entity-list-item');
    item.dataset.nodeId = record.node.id;
    item.classList.toggle('selected', selected.has(record.node.id));
    item.setAttribute('aria-pressed', String(selected.has(record.node.id)));
    item.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) selectRecord(record, 'toggle');
    });
    const icon = document.createElement('span');
    icon.className = `kx-entity-kind ${record.kind}`;
    icon.textContent = record.kind === 'camera' ? 'CAM' : record.kind === 'light' ? 'LGT' : 'OBJ';
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = record.node.name;
    const meta = document.createElement('small');
    meta.textContent = record.camera
      ? `${record.camera.projection ?? 'perspective'} · ${record.camera.fov.toFixed(1)}°`
      : record.light
        ? `${record.light.type} · ${record.light.intensity.toFixed(2)}`
        : record.node.meshAssetId ? 'Mesh entity' : 'Empty entity';
    copy.append(name, meta);
    item.append(icon, copy);
    list.append(item);
  }
}

function nodeTransformSection(scene: KyxosSceneContract, record: EntityRecord): HTMLDetailsElement {
  const nodeIndex = scene.nodes.findIndex((node) => node.id === record.node.id);
  const details = section('Transform', true);
  for (const property of ['position', 'rotation', 'scale'] as const) {
    const step = property === 'rotation' ? 0.01 : 0.1;
    details.append(vectorEditor(
      property[0].toUpperCase() + property.slice(1),
      record.node.transform[property],
      (axis, value) => {
        const operations: ScenePatch = [{
          op: 'replace',
          path: `/nodes/${nodeIndex}/transform/${property}/${axis}`,
          value,
        }];
        if (record.camera) {
          const cameraIndex = scene.cameras.findIndex((camera) => camera.id === record.camera?.id);
          if (cameraIndex >= 0) operations.push({
            op: 'replace',
            path: `/cameras/${cameraIndex}/transform/${property}/${axis}`,
            value,
          });
        }
        if (record.light) {
          const lightIndex = (scene.lights ?? []).findIndex((light) => light.id === record.light?.id);
          if (lightIndex >= 0) operations.push({
            op: 'replace',
            path: `/lights/${lightIndex}/transform/${property}/${axis}`,
            value,
          });
        }
        patch(`Change ${record.node.name} ${property}`, operations);
      },
      step,
    ));
  }
  return details;
}

function cameraSection(scene: KyxosSceneContract, record: EntityRecord): HTMLDetailsElement | null {
  if (!record.camera) return null;
  const camera = record.camera;
  const cameraIndex = scene.cameras.findIndex((entry) => entry.id === camera.id);
  const nodeIndex = scene.nodes.findIndex((entry) => entry.id === record.node.id);
  if (cameraIndex < 0 || nodeIndex < 0) return null;
  const path = `/cameras/${cameraIndex}`;
  const details = section('Camera', true);

  details.append(field('Projection', selectInput(
    camera.projection ?? 'perspective',
    'Camera projection',
    [['Perspective', 'perspective'], ['Orthographic', 'orthographic']],
    (value) => setOptional('Change camera projection', `${path}/projection`, value, camera.projection != null),
  )));
  details.append(field('Field of view', numberInput(camera.fov, {
    min: 1,
    max: 179,
    step: 0.1,
    label: 'Camera field of view',
    commit: (value) => replace('Change camera field of view', `${path}/fov`, value),
  }), 'Vertical degrees'));
  details.append(field('Near clip', numberInput(camera.near, {
    min: 0.0001,
    step: 0.001,
    label: 'Camera near clip',
    commit: (value) => replace('Change camera near clip', `${path}/near`, Math.max(0.0001, value)),
  })));
  details.append(field('Far clip', numberInput(camera.far, {
    min: 0.001,
    step: 1,
    label: 'Camera far clip',
    commit: (value) => replace('Change camera far clip', `${path}/far`, Math.max(camera.near + 0.001, value)),
  })));
  details.append(field('Orthographic size', numberInput(camera.orthographicSize ?? 10, {
    min: 0.001,
    step: 0.1,
    label: 'Camera orthographic size',
    commit: (value) => setOptional('Change orthographic size', `${path}/orthographicSize`, Math.max(0.001, value), camera.orthographicSize != null),
  })));
  details.append(field('Auto rotate', checkboxInput(Boolean(camera.autoRotate), 'Camera auto rotate', (value) =>
    setOptional('Toggle camera auto rotate', `${path}/autoRotate`, value, camera.autoRotate != null),
  )));
  details.append(vectorEditor('Target', camera.target, (axis, value) =>
    replace('Change camera target', `${path}/target/${axis}`, value),
  ));

  const actions = document.createElement('div');
  actions.className = 'kx-entity-actions';
  const active = button(scene.activeCameraId === camera.id ? 'Active Camera' : 'Set Active', () =>
    replace('Set active camera', '/activeCameraId', camera.id),
  );
  active.classList.toggle('primary', scene.activeCameraId === camera.id);
  const look = button('Look Through', () => lookThroughCamera(camera));
  const capture = button('Match View', () => {
    if (!activeCanvas) return;
    void requestEditorCameraState(activeCanvas).then((state) => {
      const nextCamera: SceneCamera = {
        ...structuredClone(camera),
        transform: structuredClone(state.camera.transform),
        target: structuredClone(state.camera.target),
        fov: state.camera.fov,
        near: state.camera.near,
        far: state.camera.far,
        projection: state.camera.projection,
        orthographicSize: state.camera.orthographicSize,
      };
      patch('Match scene camera to editor view', [
        { op: 'replace', path, value: nextCamera },
        { op: 'replace', path: `/nodes/${nodeIndex}/transform`, value: structuredClone(state.camera.transform) },
      ]);
    }).catch(() => undefined);
  });
  actions.append(active, look, capture);
  details.append(actions);
  return details;
}

function lightSection(scene: KyxosSceneContract, record: EntityRecord): HTMLDetailsElement | null {
  if (!record.light) return null;
  const light = record.light;
  const lightIndex = (scene.lights ?? []).findIndex((entry) => entry.id === light.id);
  if (lightIndex < 0) return null;
  const path = `/lights/${lightIndex}`;
  const details = section('Light', true);

  details.append(field('Type', selectInput(light.type, 'Light type', [
    ['Directional', 'directional'],
    ['Point', 'point'],
    ['Spot', 'spot'],
    ['Ambient', 'ambient'],
  ], (value) => replace('Change light type', `${path}/type`, value))));
  const color = document.createElement('input');
  color.type = 'color';
  color.value = /^#[0-9a-f]{6}$/i.test(light.color) ? light.color : '#ffffff';
  color.setAttribute('aria-label', 'Light color');
  color.addEventListener('input', () => replace('Change light color', `${path}/color`, color.value));
  details.append(field('Color', color));
  details.append(field('Intensity', numberInput(light.intensity, {
    min: 0,
    step: 0.05,
    label: 'Light intensity',
    commit: (value) => replace('Change light intensity', `${path}/intensity`, Math.max(0, value)),
  })));
  details.append(field('Range', numberInput(light.range ?? 10, {
    min: 0,
    step: 0.1,
    label: 'Light range',
    commit: (value) => setOptional('Change light range', `${path}/range`, Math.max(0, value), light.range != null),
  })));
  details.append(field('Decay', numberInput(light.decay ?? 2, {
    min: 0,
    step: 0.05,
    label: 'Light decay',
    commit: (value) => setOptional('Change light decay', `${path}/decay`, Math.max(0, value), light.decay != null),
  })));
  details.append(field('Cast shadow', checkboxInput(light.castShadow, 'Light cast shadow', (value) =>
    replace('Toggle light shadow', `${path}/castShadow`, value),
  )));
  if (light.type === 'spot') {
    details.append(field('Inner cone', numberInput(light.innerConeAngle ?? 0, {
      min: 0,
      max: Math.PI / 2,
      step: 0.01,
      label: 'Spot light inner cone angle',
      commit: (value) => setOptional('Change spot inner cone', `${path}/innerConeAngle`, value, light.innerConeAngle != null),
    }), 'Radians'));
    details.append(field('Outer cone', numberInput(light.outerConeAngle ?? Math.PI / 4, {
      min: 0,
      max: Math.PI / 2,
      step: 0.01,
      label: 'Spot light outer cone angle',
      commit: (value) => setOptional('Change spot outer cone', `${path}/outerConeAngle`, value, light.outerConeAngle != null),
    }), 'Radians'));
  }

  const shadow = section('Shadow', false);
  const shadowValue = light.shadow ?? {};
  const shadowNumber = (name: string, fallback: number, min: number, step: number) => {
    const current = Number(shadowValue[name] ?? fallback);
    shadow.append(field(name, numberInput(current, {
      min,
      step,
      label: `Light shadow ${name}`,
      commit: (value) => {
        const next = { ...shadowValue, [name]: value };
        setOptional(`Change light shadow ${name}`, `${path}/shadow`, next, light.shadow != null);
      },
    })));
  };
  shadowNumber('mapSize', 1024, 128, 128);
  shadowNumber('bias', -0.0001, -1, 0.0001);
  shadowNumber('normalBias', 0.02, 0, 0.001);
  shadowNumber('radius', 1, 0, 0.1);
  details.append(shadow);

  const actions = document.createElement('div');
  actions.className = 'kx-entity-actions';
  actions.append(
    button('Show Helper', () => ensureHelper('Light helpers')),
    button('Frame', frameSelection),
    button('Isolate', () => {
      activeApi?.setSelection([record.node.id]);
      const control = Array.from(document.querySelectorAll<HTMLButtonElement>('.studio-hierarchy button'))
        .find((entry) => entry.textContent?.trim() === 'Isolate');
      control?.click();
    }),
  );
  details.append(actions);
  return details;
}

function renderDetails(panel: HTMLElement, scene: KyxosSceneContract): void {
  const host = panel.querySelector<HTMLElement>('[data-kx-entity-details]');
  if (!host || !activeApi) return;
  host.replaceChildren();
  const selectedId = activeApi.getSelection().at(-1);
  const record = entityRecords(scene).find((entry) => entry.node.id === selectedId);
  if (!record) {
    const empty = document.createElement('div');
    empty.className = 'kx-entity-detail-empty';
    empty.innerHTML = '<strong>No scene object selected</strong><span>Select a viewport or hierarchy entity to edit it here.</span>';
    host.append(empty);
    return;
  }

  const identity = section('Entity', true);
  const name = document.createElement('input');
  name.type = 'text';
  name.value = record.node.name;
  name.setAttribute('aria-label', 'Entity name');
  name.addEventListener('change', () => {
    const nodeIndex = scene.nodes.findIndex((node) => node.id === record.node.id);
    replace('Rename entity', `/nodes/${nodeIndex}/name`, name.value.trim() || record.node.name);
  });
  identity.append(field('Name', name));
  const nodeIndex = scene.nodes.findIndex((node) => node.id === record.node.id);
  identity.append(field('Visible', checkboxInput(record.node.visible, 'Entity visible', (value) =>
    replace('Toggle entity visibility', `/nodes/${nodeIndex}/visible`, value),
  )));
  identity.append(field('Locked', checkboxInput(Boolean(record.node.locked), 'Entity locked', (value) =>
    setOptional('Toggle entity lock', `/nodes/${nodeIndex}/locked`, value, record.node.locked != null),
  )));
  const badges = document.createElement('div');
  badges.className = 'kx-entity-badges';
  badges.innerHTML = `<span>${record.kind === 'all' ? 'Entity' : record.kind}</span><code>${record.node.id}</code>`;
  identity.append(badges);
  host.append(identity, nodeTransformSection(scene, record));
  const camera = cameraSection(scene, record);
  const light = lightSection(scene, record);
  if (camera) host.append(camera);
  if (light) host.append(light);
}

function renderPanel(panel: HTMLElement): void {
  if (!activeApi || !panel.isConnected) return;
  const scene = activeApi.getScene();
  panel.hidden = !uiState.open;
  panel.classList.toggle('collapsed', uiState.collapsed);
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 292, uiState.left))}px`;
  panel.style.top = `${Math.max(54, Math.min(window.innerHeight - 44, uiState.top))}px`;
  const search = panel.querySelector<HTMLInputElement>('[data-kx-entity-search]');
  const filter = panel.querySelector<HTMLSelectElement>('[data-kx-entity-filter]');
  if (search && search.value !== uiState.query) search.value = uiState.query;
  if (filter && filter.value !== uiState.filter) filter.value = uiState.filter;
  const collapse = panel.querySelector<HTMLButtonElement>('[data-kx-entity-collapse]');
  if (collapse) collapse.textContent = uiState.collapsed ? '+' : '−';
  const counts = panel.querySelector<HTMLElement>('[data-kx-entity-counts]');
  if (counts) {
    const records = entityRecords(scene);
    counts.textContent = `${records.length} objects · ${records.filter((entry) => entry.kind === 'camera').length} cameras · ${records.filter((entry) => entry.kind === 'light').length} lights`;
  }
  if (!uiState.collapsed) {
    renderEntityList(panel, scene);
    renderDetails(panel, scene);
  }
}

function scheduleRender(): void {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    if (activePanel) renderPanel(activePanel);
  }, 0);
}

function installDrag(panel: HTMLElement, header: HTMLElement): void {
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('button,input,select')) return;
    const start = { x: event.clientX, y: event.clientY, left: uiState.left, top: uiState.top };
    header.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      uiState.left = Math.max(8, Math.min(window.innerWidth - 292, start.left + moveEvent.clientX - start.x));
      uiState.top = Math.max(54, Math.min(window.innerHeight - 44, start.top + moveEvent.clientY - start.y));
      panel.style.left = `${uiState.left}px`;
      panel.style.top = `${uiState.top}px`;
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      header.releasePointerCapture(event.pointerId);
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      panel.classList.remove('dragging');
      saveUiState();
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  });
}

function createPanel(shell: HTMLElement, canvas: HTMLCanvasElement, api: StudioApiLike): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'kx-viewport-entity-tools';
  panel.setAttribute('aria-label', 'Viewport objects, cameras and lights');
  panel.innerHTML = `
    <header class="kx-entity-tools-header">
      <div><strong>Scene Objects</strong><small data-kx-entity-counts></small></div>
      <span class="kx-entity-header-actions">
        <button type="button" data-kx-entity-collapse aria-label="Collapse scene objects">−</button>
        <button type="button" data-kx-entity-close aria-label="Close scene objects">×</button>
      </span>
    </header>
    <div class="kx-entity-tools-content">
      <div class="kx-entity-toolbar">
        <input type="search" data-kx-entity-search placeholder="Search objects" aria-label="Search scene objects">
        <select data-kx-entity-filter aria-label="Scene object filter">
          <option value="all">All</option>
          <option value="camera">Cameras</option>
          <option value="light">Lights</option>
        </select>
        <button type="button" data-kx-entity-frame>Frame</button>
      </div>
      <div class="kx-entity-workspace">
        <div class="kx-entity-list" data-kx-entity-list></div>
        <div class="kx-entity-details" data-kx-entity-details></div>
      </div>
      <footer class="kx-entity-shortcuts">
        <span><b>LMB</b> Select</span><span><b>Alt + LMB</b> Orbit</span><span><b>MMB</b> Pan</span><span><b>Wheel</b> Dolly</span><span><b>Q/W/E/R</b> Tools</span><span><b>[ / ]</b> Cycle</span>
      </footer>
    </div>`;
  shell.append(panel);

  const header = panel.querySelector<HTMLElement>('.kx-entity-tools-header')!;
  installDrag(panel, header);
  panel.querySelector<HTMLButtonElement>('[data-kx-entity-collapse]')?.addEventListener('click', () => {
    uiState.collapsed = !uiState.collapsed;
    saveUiState();
    renderPanel(panel);
  });
  panel.querySelector<HTMLButtonElement>('[data-kx-entity-close]')?.addEventListener('click', () => {
    uiState.open = false;
    saveUiState();
    renderPanel(panel);
  });
  panel.querySelector<HTMLButtonElement>('[data-kx-entity-frame]')?.addEventListener('click', frameSelection);
  panel.querySelector<HTMLInputElement>('[data-kx-entity-search]')?.addEventListener('input', (event) => {
    uiState.query = (event.currentTarget as HTMLInputElement).value;
    saveUiState();
    renderPanel(panel);
  });
  panel.querySelector<HTMLSelectElement>('[data-kx-entity-filter]')?.addEventListener('change', (event) => {
    uiState.filter = (event.currentTarget as HTMLSelectElement).value as EntityFilter;
    saveUiState();
    renderPanel(panel);
  });

  const toggle = button('Objects', () => {
    uiState.open = !uiState.open;
    if (uiState.open) uiState.collapsed = false;
    saveUiState();
    renderPanel(panel);
  }, 'secondary kx-entity-tools-toggle');
  toggle.title = 'Scene objects, cameras and lights · Shift+C / Shift+L';
  toggle.setAttribute('aria-controls', 'kx-viewport-entity-tools');
  panel.id = 'kx-viewport-entity-tools';
  shell.querySelector<HTMLElement>('.studio-topbar-end')?.prepend(toggle);

  activePanel = panel;
  activeCanvas = canvas;
  activeApi = api;
  renderPanel(panel);
  return panel;
}

function enhanceShell(shell: HTMLElement): void {
  if (mountedShells.has(shell)) return;
  const canvas = shell.querySelector<HTMLCanvasElement>('#studio-canvas');
  const api = studioApi();
  if (!canvas || !api) return;
  mountedShells.add(shell);
  createPanel(shell, canvas, api);
  canvas.addEventListener('dblclick', (event) => {
    if (event.button === 0 && api.getSelection().length) frameSelection();
  });
}

function cycleSelection(direction: 1 | -1): void {
  if (!activeApi) return;
  const scene = activeApi.getScene();
  const records = filteredRecords(scene);
  if (!records.length) return;
  const selected = activeApi.getSelection().at(-1);
  const current = Math.max(0, records.findIndex((record) => record.node.id === selected));
  const next = (current + direction + records.length) % records.length;
  selectRecord(records[next]);
}

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input,textarea,select') || target?.closest('.monaco-editor')) return;
  if (!activePanel || !activeApi) return;
  if (event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    uiState.open = true;
    uiState.collapsed = false;
    uiState.filter = 'camera';
    ensureHelper('Camera helpers');
    saveUiState();
    renderPanel(activePanel);
    return;
  }
  if (event.shiftKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    uiState.open = true;
    uiState.collapsed = false;
    uiState.filter = 'light';
    ensureHelper('Light helpers');
    saveUiState();
    renderPanel(activePanel);
    return;
  }
  if (event.key === '[' || event.key === ']') {
    event.preventDefault();
    cycleSelection(event.key === ']' ? 1 : -1);
    return;
  }
  if (event.key === '.') {
    event.preventDefault();
    frameSelection();
    return;
  }
  const tool = ({ q: 'Select', w: 'Move', e: 'Rotate', r: 'Scale' } as const)[event.key.toLowerCase() as 'q' | 'w' | 'e' | 'r'];
  if (tool) {
    event.preventDefault();
    setTool(tool);
  }
});

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(enhanceShell);
  if (activePanel?.isConnected && activeApi) scheduleRender();
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
const poll = window.setInterval(() => {
  if (activePanel?.isConnected && activeApi) scheduleRender();
}, 350);
window.addEventListener('resize', () => {
  if (!activePanel) return;
  uiState.left = Math.max(8, Math.min(window.innerWidth - 292, uiState.left));
  uiState.top = Math.max(54, Math.min(window.innerHeight - 44, uiState.top));
  saveUiState();
  renderPanel(activePanel);
});
window.addEventListener('pagehide', () => {
  observer.disconnect();
  window.clearInterval(poll);
}, { once: true });
scan();
