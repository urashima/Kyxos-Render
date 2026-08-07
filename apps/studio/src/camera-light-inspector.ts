import type { ProjectSession } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneCamera,
  SceneLight,
  ScenePatch,
  Transform,
} from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

type ComponentKind = 'camera' | 'light';

type WorkspacePreferences = {
  viewportMultiSelect: boolean;
  doubleClickFrame: boolean;
};

interface AdapterPrototype {
  bindSession(session: ProjectSession): () => void;
  __kyxosCameraLightParityInstalled?: boolean;
}

interface SelectionPointerState {
  before: string[];
  shift: boolean;
  toggle: boolean;
}

const PREFS_KEY = 'kyxos-studio-workspace-preferences-v1';

function readPreferences(): WorkspacePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<WorkspacePreferences>;
    return {
      viewportMultiSelect: stored.viewportMultiSelect !== false,
      doubleClickFrame: stored.doubleClickFrame !== false,
    };
  } catch {
    return { viewportMultiSelect: true, doubleClickFrame: true };
  }
}

function button(label: string, action: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'mini';
  control.textContent = label;
  control.addEventListener('click', action);
  return control;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-component-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  row.append(caption, control);
  return row;
}

function textInput(value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value.trim()));
  return input;
}

function numberInput(
  value: number,
  onInput: (value: number) => void,
  options: { min?: number; max?: number; step?: number } = {},
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = Number.isFinite(value) ? String(value) : '0';
  if (options.min != null) input.min = String(options.min);
  if (options.max != null) input.max = String(options.max);
  input.step = String(options.step ?? 0.01);
  input.addEventListener('input', () => {
    const numeric = Number(input.value);
    if (Number.isFinite(numeric)) onInput(numeric);
  });
  return input;
}

function checkbox(value: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function selectInput<T extends string>(
  value: T,
  values: readonly T[],
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  for (const optionValue of values) select.append(new Option(optionValue, optionValue));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

function vectorInput(
  value: { x: number; y: number; z: number },
  onInput: (axis: 'x' | 'y' | 'z', value: number) => void,
  step = 0.01,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'kx-component-vector';
  for (const axis of ['x', 'y', 'z'] as const) {
    const label = document.createElement('label');
    const marker = document.createElement('span');
    marker.textContent = axis.toUpperCase();
    const input = numberInput(value[axis], (next) => onInput(axis, next), { step });
    input.setAttribute('aria-label', axis.toUpperCase());
    label.append(marker, input);
    root.append(label);
  }
  return root;
}

function execute(
  session: ProjectSession,
  id: string,
  label: string,
  patch: (scene: KyxosSceneContract) => ScenePatch,
  mergeKey?: string,
): void {
  session.commands.execute({ id, label, patch, mergeKey });
}

function setPath(
  scene: KyxosSceneContract,
  path: string,
  current: unknown,
  value: unknown,
): ScenePatch[number] {
  void scene;
  return current == null
    ? { op: 'add', path, value }
    : { op: 'replace', path, value };
}

function syncNodeTransformPatch(
  nodeIndex: number,
  componentBase: string,
  axisGroup: 'position' | 'rotation',
  axis: 'x' | 'y' | 'z',
  value: number,
): ScenePatch {
  return [
    { op: 'replace', path: `${componentBase}/transform/${axisGroup}/${axis}`, value },
    { op: 'replace', path: `/nodes/${nodeIndex}/transform/${axisGroup}/${axis}`, value },
  ];
}

function buildCameraInspector(
  adapter: BrowserKyxosViewportAdapter,
  session: ProjectSession,
  scene: KyxosSceneContract,
  nodeIndex: number,
  cameraIndex: number,
  camera: SceneCamera,
): HTMLDetailsElement {
  const node = scene.nodes[nodeIndex];
  const base = `/cameras/${cameraIndex}`;
  const details = document.createElement('details');
  details.className = 'kx-component-inspector';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = `Camera · ${camera.name}`;
  details.append(summary);

  const grid = document.createElement('div');
  grid.className = 'kx-component-inspector-grid';

  grid.append(
    field('Name', textInput(camera.name, (value) => {
      if (!value) return;
      execute(session, 'camera-name', 'Rename camera', () => [
        { op: 'replace', path: `${base}/name`, value },
        { op: 'replace', path: `/nodes/${nodeIndex}/name`, value },
      ]);
    })),
    field('Projection', selectInput(
      camera.projection ?? 'perspective',
      ['perspective', 'orthographic'] as const,
      (value) => execute(session, 'camera-projection', 'Camera projection', (current) => [
        setPath(current, `${base}/projection`, camera.projection, value),
      ]),
    )),
  );

  if ((camera.projection ?? 'perspective') === 'orthographic') {
    grid.append(field('Ortho Size', numberInput(
      camera.orthographicSize ?? 1,
      (value) => execute(session, 'camera-ortho-size', 'Camera orthographic size', (current) => [
        setPath(current, `${base}/orthographicSize`, camera.orthographicSize, Math.max(0.001, value)),
      ], 'camera:ortho-size'),
      { min: 0.001, step: 0.01 },
    )));
  } else {
    grid.append(field('FOV', numberInput(
      camera.fov,
      (value) => execute(session, 'camera-fov', 'Camera field of view', () => [
        { op: 'replace', path: `${base}/fov`, value: Math.min(179, Math.max(1, value)) },
      ], 'camera:fov'),
      { min: 1, max: 179, step: 0.1 },
    )));
  }

  grid.append(
    field('Near', numberInput(camera.near, (value) => execute(
      session,
      'camera-near',
      'Camera near clip',
      () => [{ op: 'replace', path: `${base}/near`, value: Math.max(0.0001, value) }],
      'camera:near',
    ), { min: 0.0001, step: 0.01 })),
    field('Far', numberInput(camera.far, (value) => execute(
      session,
      'camera-far',
      'Camera far clip',
      () => [{ op: 'replace', path: `${base}/far`, value: Math.max(camera.near + 0.001, value) }],
      'camera:far',
    ), { min: 0.001, step: 1 })),
    field('Position', vectorInput(camera.transform.position, (axis, value) => execute(
      session,
      `camera-position-${axis}`,
      'Move camera',
      () => syncNodeTransformPatch(nodeIndex, base, 'position', axis, value),
      `camera:position:${axis}`,
    ))),
    field('Rotation', vectorInput(camera.transform.rotation, (axis, value) => execute(
      session,
      `camera-rotation-${axis}`,
      'Rotate camera',
      () => syncNodeTransformPatch(nodeIndex, base, 'rotation', axis, value),
      `camera:rotation:${axis}`,
    ), 0.1)),
    field('Target', vectorInput(camera.target, (axis, value) => execute(
      session,
      `camera-target-${axis}`,
      'Camera target',
      () => [{ op: 'replace', path: `${base}/target/${axis}`, value }],
      `camera:target:${axis}`,
    ))),
    field('Auto Rotate', checkbox(Boolean(camera.autoRotate), (value) => execute(
      session,
      'camera-auto-rotate',
      'Camera auto rotate',
      (current) => [setPath(current, `${base}/autoRotate`, camera.autoRotate, value)],
    ))),
  );

  details.append(grid);
  const actions = document.createElement('div');
  actions.className = 'kx-component-actions';
  const active = scene.activeCameraId === camera.id;
  const activeButton = button(active ? 'Active Camera' : 'Set Active', () => {
    if (active) return;
    execute(session, 'active-camera', 'Set active camera', () => [
      { op: 'replace', path: '/activeCameraId', value: camera.id },
    ]);
  });
  activeButton.disabled = active;
  actions.append(
    activeButton,
    button('Frame', () => adapter.frame([node.id])),
    button('Reset View', () => adapter.resetCamera()),
  );
  details.append(actions);
  return details;
}

function buildLightInspector(
  adapter: BrowserKyxosViewportAdapter,
  session: ProjectSession,
  scene: KyxosSceneContract,
  nodeIndex: number,
  lightIndex: number,
  light: SceneLight,
): HTMLDetailsElement {
  const node = scene.nodes[nodeIndex];
  const base = `/lights/${lightIndex}`;
  const details = document.createElement('details');
  details.className = 'kx-component-inspector';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = `Light · ${light.name}`;
  details.append(summary);

  const grid = document.createElement('div');
  grid.className = 'kx-component-inspector-grid';
  const color = document.createElement('input');
  color.type = 'color';
  color.value = /^#[0-9a-f]{6}$/i.test(light.color) ? light.color : '#ffffff';
  color.addEventListener('input', () => execute(
    session,
    'light-color',
    'Light color',
    () => [{ op: 'replace', path: `${base}/color`, value: color.value }],
    'light:color',
  ));

  grid.append(
    field('Name', textInput(light.name, (value) => {
      if (!value) return;
      execute(session, 'light-name', 'Rename light', () => [
        { op: 'replace', path: `${base}/name`, value },
        { op: 'replace', path: `/nodes/${nodeIndex}/name`, value },
      ]);
    })),
    field('Type', selectInput(
      light.type,
      ['directional', 'point', 'spot', 'ambient'] as const,
      (value) => execute(session, 'light-type', 'Light type', () => [
        { op: 'replace', path: `${base}/type`, value },
      ]),
    )),
    field('Color', color),
    field('Intensity', numberInput(light.intensity, (value) => execute(
      session,
      'light-intensity',
      'Light intensity',
      () => [{ op: 'replace', path: `${base}/intensity`, value: Math.max(0, value) }],
      'light:intensity',
    ), { min: 0, step: 0.05 })),
    field('Position', vectorInput(light.transform.position, (axis, value) => execute(
      session,
      `light-position-${axis}`,
      'Move light',
      () => syncNodeTransformPatch(nodeIndex, base, 'position', axis, value),
      `light:position:${axis}`,
    ))),
    field('Rotation', vectorInput(light.transform.rotation, (axis, value) => execute(
      session,
      `light-rotation-${axis}`,
      'Rotate light',
      () => syncNodeTransformPatch(nodeIndex, base, 'rotation', axis, value),
      `light:rotation:${axis}`,
    ), 0.1)),
    field('Cast Shadow', checkbox(light.castShadow, (value) => execute(
      session,
      'light-shadow',
      'Light shadow',
      () => [{ op: 'replace', path: `${base}/castShadow`, value }],
    ))),
  );

  if (light.type === 'point' || light.type === 'spot') {
    grid.append(
      field('Range', numberInput(light.range ?? 10, (value) => execute(
        session,
        'light-range',
        'Light range',
        (current) => [setPath(current, `${base}/range`, light.range, Math.max(0, value))],
        'light:range',
      ), { min: 0, step: 0.1 })),
      field('Decay', numberInput(light.decay ?? 2, (value) => execute(
        session,
        'light-decay',
        'Light decay',
        (current) => [setPath(current, `${base}/decay`, light.decay, Math.max(0, value))],
        'light:decay',
      ), { min: 0, step: 0.1 })),
    );
  }

  if (light.type === 'spot') {
    const toDegrees = (radians: number | undefined, fallback: number) => (radians ?? fallback) * 180 / Math.PI;
    grid.append(
      field('Inner Cone °', numberInput(toDegrees(light.innerConeAngle, 0), (degrees) => execute(
        session,
        'light-inner-cone',
        'Light inner cone',
        (current) => [setPath(current, `${base}/innerConeAngle`, light.innerConeAngle, degrees * Math.PI / 180)],
        'light:inner-cone',
      ), { min: 0, max: 89.9, step: 0.1 })),
      field('Outer Cone °', numberInput(toDegrees(light.outerConeAngle, Math.PI / 4), (degrees) => execute(
        session,
        'light-outer-cone',
        'Light outer cone',
        (current) => [setPath(current, `${base}/outerConeAngle`, light.outerConeAngle, degrees * Math.PI / 180)],
        'light:outer-cone',
      ), { min: 0.1, max: 90, step: 0.1 })),
    );
  }

  if (light.castShadow) {
    const shadow = light.shadow ?? {};
    const shadowNumber = (label: string, key: string, fallback: number, step: number) => {
      grid.append(field(label, numberInput(Number(shadow[key] ?? fallback), (value) => execute(
        session,
        `light-shadow-${key}`,
        `Light shadow ${key}`,
        () => [{
          op: light.shadow == null ? 'add' : 'replace',
          path: `${base}/shadow`,
          value: { ...(light.shadow ?? {}), [key]: value },
        }],
        `light:shadow:${key}`,
      ), { step })));
    };
    shadowNumber('Shadow Bias', 'bias', 0, 0.0001);
    shadowNumber('Normal Bias', 'normalBias', 0, 0.001);
    shadowNumber('Shadow Radius', 'radius', 1, 0.1);
    shadowNumber('Shadow Map', 'mapSize', 1024, 1);
  }

  details.append(grid);
  const actions = document.createElement('div');
  actions.className = 'kx-component-actions';
  actions.append(button('Frame', () => adapter.frame([node.id])));
  details.append(actions);
  return details;
}

function installComponentInspector(
  adapter: BrowserKyxosViewportAdapter,
  session: ProjectSession,
): () => void {
  let frame = 0;
  let pointerState: SelectionPointerState | null = null;
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');

  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const inspector = document.querySelector<HTMLElement>('.kyxos-studio-shell .inspector-content');
      if (!inspector) return;
      inspector.querySelector('.kx-component-inspector')?.remove();
      const scene = session.document.value;
      const selected = session.selection.selected;
      if (selected.length !== 1) {
        refreshHierarchyBadges(scene);
        return;
      }
      const nodeIndex = scene.nodes.findIndex((entry) => entry.id === selected[0]);
      if (nodeIndex < 0) return;
      const node = scene.nodes[nodeIndex];
      let component: HTMLDetailsElement | null = null;
      if (node.cameraId) {
        const cameraIndex = scene.cameras.findIndex((entry) => entry.id === node.cameraId);
        if (cameraIndex >= 0) component = buildCameraInspector(adapter, session, scene, nodeIndex, cameraIndex, scene.cameras[cameraIndex]);
      } else if (node.lightId) {
        const lightIndex = (scene.lights ?? []).findIndex((entry) => entry.id === node.lightId);
        if (lightIndex >= 0) component = buildLightInspector(adapter, session, scene, nodeIndex, lightIndex, scene.lights[lightIndex]);
      }
      if (component) inspector.prepend(component);
      refreshHierarchyBadges(scene);
    });
  };

  const refreshHierarchyBadges = (scene: KyxosSceneContract) => {
    const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
    document.querySelectorAll<HTMLElement>('.hierarchy-row[data-node]').forEach((row) => {
      const node = nodes.get(row.dataset.node ?? '');
      const kind: ComponentKind | null = node?.cameraId ? 'camera' : node?.lightId ? 'light' : null;
      const existing = row.querySelector<HTMLElement>('.kx-component-badge');
      if (!kind) {
        existing?.remove();
        return;
      }
      const badge = existing ?? document.createElement('span');
      badge.className = 'kx-component-badge';
      badge.textContent = kind === 'camera' ? 'CAM' : 'LGT';
      badge.title = kind === 'camera' ? 'Camera component' : 'Light component';
      if (!existing) row.append(badge);
    });
  };

  const onSelection = () => render();
  const onDocument = () => render();
  session.selection.addEventListener('change', onSelection);
  session.document.addEventListener('change', onDocument);

  const onCanvasPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerState = {
      before: session.selection.selected,
      shift: event.shiftKey,
      toggle: event.ctrlKey || event.metaKey,
    };
  };
  canvas?.addEventListener('pointerdown', onCanvasPointerDown, true);

  const onViewportSelection = (event: Event) => {
    const state = pointerState;
    pointerState = null;
    if (!state || !readPreferences().viewportMultiSelect || (!state.shift && !state.toggle)) return;
    const nodeIds = (event as CustomEvent<{ nodeIds: string[] }>).detail.nodeIds;
    session.selection.select(state.before, 'replace');
    if (nodeIds.length) session.selection.select(nodeIds, state.toggle ? 'toggle' : 'add');
  };
  adapter.addEventListener('selection', onViewportSelection);

  const onDoubleClick = (event: MouseEvent) => {
    if (event.button !== 0 || !readPreferences().doubleClickFrame) return;
    const selected = session.selection.selected;
    if (selected.length) adapter.frame(selected);
  };
  canvas?.addEventListener('dblclick', onDoubleClick);

  const onPreferenceChange = () => render();
  window.addEventListener('kyxos:workspace-preferences-change', onPreferenceChange);

  render();
  requestAnimationFrame(render);
  return () => {
    cancelAnimationFrame(frame);
    session.selection.removeEventListener('change', onSelection);
    session.document.removeEventListener('change', onDocument);
    canvas?.removeEventListener('pointerdown', onCanvasPointerDown, true);
    canvas?.removeEventListener('dblclick', onDoubleClick);
    adapter.removeEventListener('selection', onViewportSelection);
    window.removeEventListener('kyxos:workspace-preferences-change', onPreferenceChange);
  };
}

export function installCameraLightInspectorParity(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype.__kyxosCameraLightParityInstalled) return;
  const originalBindSession = prototype.bindSession;

  prototype.bindSession = function bindSessionWithComponentParity(session: ProjectSession): () => void {
    const unbind = originalBindSession.call(this, session);
    const disposeInspector = installComponentInspector(this as unknown as BrowserKyxosViewportAdapter, session);
    return () => {
      disposeInspector();
      unbind();
    };
  };

  prototype.__kyxosCameraLightParityInstalled = true;
}

installCameraLightInspectorParity();
