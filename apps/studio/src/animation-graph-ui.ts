import {
  AnimationGraphService,
  animationGraphToPcuiData,
  validateAnimationStateGraph,
} from '@kyxos/editor-core';
import type {
  AnimationBlendTree,
  AnimationGraphCondition,
  AnimationGraphParameter,
  AnimationGraphState,
  AnimationGraphTransition,
  AnimationStateGraph,
  SceneAnimation,
} from '@kyxos/scene-contract';
import { button, element } from '@kyxos/shared-ui';

type GraphSelection = { type: 'node' | 'edge'; id: string } | null;
type PcuiGraph = InstanceType<(typeof import('@playcanvas/pcui-graph'))['default']>;

export interface AnimationGraphEditorOptions {
  dialog: HTMLDialogElement;
  graph: AnimationStateGraph;
  clips: SceneAnimation[];
  onCommit(graph: AnimationStateGraph): void;
  onError(error: unknown): void;
}

const NODE = { STATE: 0, DEFAULT: 1, START: 3, ANY: 4 } as const;
const EDGE = { INITIAL: 0, TRANSITION: 1, ANY: 3 } as const;

function graphSchema(actions: typeof import('@playcanvas/pcui-graph').default.GRAPH_ACTIONS) {
  const attributes = [
    { name: 'name', type: 'TEXT_INPUT' },
    { name: 'speed', type: 'NUMERIC_INPUT' },
    { name: 'loop', type: 'BOOLEAN_INPUT' },
  ];
  const transitionMenu = [{ text: 'Add transition', action: actions.ADD_EDGE, edgeType: EDGE.TRANSITION }];
  return {
    nodes: {
      [NODE.STATE]: {
        name: 'state', fill: 'rgba(54, 67, 70, .92)', stroke: '#20292b', icon: '◆', iconColor: '#fff',
        attributes,
        contextMenuItems: [...transitionMenu, { text: 'Delete state', action: actions.DELETE_NODE }],
      },
      [NODE.DEFAULT]: {
        name: 'initial state', fill: 'rgba(54, 67, 70, .92)', stroke: '#41d37b', icon: '◆', iconColor: '#41d37b',
        attributes,
        contextMenuItems: transitionMenu,
      },
      [NODE.START]: {
        name: 'start', fill: 'rgba(54, 67, 70, .92)', stroke: '#20292b', icon: '▶', iconColor: '#41d37b',
        contextMenuItems: [],
      },
      [NODE.ANY]: {
        name: 'any', fill: 'rgba(54, 67, 70, .92)', stroke: '#20292b', icon: '✦', iconColor: '#eae113',
        contextMenuItems: [{ text: 'Add transition', action: actions.ADD_EDGE, edgeType: EDGE.ANY }],
      },
    },
    edges: {
      [EDGE.INITIAL]: {
        stroke: '#41d37b', strokeWidth: 2, targetMarker: true,
        from: [NODE.START], to: [NODE.STATE, NODE.DEFAULT], contextMenuItems: [],
      },
      [EDGE.TRANSITION]: {
        stroke: '#3498db', strokeWidth: 2, targetMarker: true, targetMarkerStroke: '#3498db',
        from: [NODE.STATE, NODE.DEFAULT], to: [NODE.STATE, NODE.DEFAULT],
        contextMenuItems: [{ text: 'Delete transition', action: actions.DELETE_EDGE }],
      },
      [EDGE.ANY]: {
        stroke: '#eae113', strokeWidth: 2, targetMarker: true, targetMarkerStroke: '#eae113',
        from: [NODE.ANY], to: [NODE.STATE, NODE.DEFAULT],
        contextMenuItems: [{ text: 'Delete transition', action: actions.DELETE_EDGE }],
      },
    },
  };
}

export async function mountAnimationGraphEditor(
  options: AnimationGraphEditorOptions,
): Promise<() => void> {
  await import('@playcanvas/pcui-graph/styles');
  const { default: Graph } = await import('@playcanvas/pcui-graph');
  const actions = Graph.GRAPH_ACTIONS;
  const service = new AnimationGraphService(options.graph);
  let graphView: PcuiGraph | null = null;
  let selection: GraphSelection = null;
  let disposed = false;

  const header = element('header', { className: 'dialog-header' });
  const title = element('h2', { text: options.graph.name });
  header.append(title, button('Close', () => options.dialog.close(), 'secondary'));
  const toolbar = element('div', { className: 'animation-graph-toolbar' });
  const graphName = element('input', { attrs: { value: options.graph.name, 'aria-label': 'Graph name' } });
  graphName.addEventListener('change', () => {
    const next = service.value;
    next.name = graphName.value.trim() || 'Animation State Graph';
    service.replace(next);
    title.textContent = next.name;
  });
  toolbar.append(
    graphName,
    button('Add State', () => {
      const id = service.addState({ position: { x: 180, y: 140 } });
      selection = { type: 'node', id };
      rebuildGraph();
    }),
    button('Add Parameter', () => {
      service.addParameter('Parameter');
      renderInspector();
    }, 'secondary'),
    element('span', { className: 'muted', text: 'Right-click a state to connect a transition. Drag to position; wheel to zoom.' }),
  );
  const layout = element('div', { className: 'animation-graph-layout' });
  const canvas = element('div', { className: 'animation-graph-canvas' });
  const inspector = element('aside', { className: 'animation-graph-inspector' });
  layout.append(canvas, inspector);
  options.dialog.replaceChildren(header, toolbar, layout);

  const commit = () => {
    const value = service.value;
    title.textContent = value.name;
    options.onCommit(value);
    renderInspector();
  };
  service.addEventListener('change', commit);

  function rebuildGraph(): void {
    if (disposed) return;
    graphView?.destroy();
    canvas.replaceChildren();
    const settingsKey = `kyxos-animation-graph:${service.value.id}`;
    const saved = readGraphSettings(settingsKey);
    graphView = new Graph(graphSchema(actions), {
      dom: canvas,
      initialData: animationGraphToPcuiData(service.value),
      passiveUIEvents: true,
      incrementNodeNames: true,
      adjustVertices: true,
      includeFonts: false,
      contextMenuItems: [{
        text: 'Add state',
        action: actions.ADD_NODE,
        nodeType: NODE.STATE,
        attributes: { name: 'New State', speed: 1, loop: true },
      }],
      defaultStyles: { background: { gridSize: 10 } },
    });
    graphView.setGraphPosition(saved.x, saved.y);
    graphView.setGraphScale(saved.scale);

    graphView.on(actions.ADD_NODE, ({ node }) => {
      try {
        const id = service.addState({
          name: String(node.attributes?.name ?? 'New State'),
          speed: Number(node.attributes?.speed ?? 1),
          loop: Boolean(node.attributes?.loop ?? true),
          position: { x: Number(node.posX ?? 120), y: Number(node.posY ?? 120) },
        });
        selection = { type: 'node', id };
        rebuildGraph();
      } catch (error) { options.onError(error); }
    });
    graphView.on(actions.DELETE_NODE, ({ node }) => {
      try {
        service.removeState(String(node.id));
        selection = null;
        rebuildGraph();
      } catch (error) { options.onError(error); }
    });
    graphView.on(actions.UPDATE_NODE_POSITION, ({ nodeId, node }) => {
      if (String(nodeId).startsWith('__')) return;
      try {
        service.updateState(String(nodeId), { position: { x: Number(node.posX), y: Number(node.posY) } });
      } catch (error) { options.onError(error); }
    });
    graphView.on(actions.UPDATE_NODE_ATTRIBUTE, ({ node, attribute }) => {
      if (String(node.id).startsWith('__')) return;
      const value = node.attributes?.[attribute];
      try {
        if (attribute === 'name') service.updateState(String(node.id), { name: String(value) });
        if (attribute === 'speed') service.updateState(String(node.id), { speed: Number(value) });
        if (attribute === 'loop') service.updateState(String(node.id), { loop: Boolean(value) });
      } catch (error) { options.onError(error); }
    });
    graphView.on(actions.ADD_EDGE, ({ edge }) => {
      try {
        const from = String(edge.from) === '__any__' ? '*' : String(edge.from);
        if (String(edge.from) === '__start__') return;
        const id = service.addTransition(from, String(edge.to));
        selection = { type: 'edge', id };
        rebuildGraph();
      } catch (error) { options.onError(error); }
    });
    graphView.on(actions.DELETE_EDGE, ({ edgeId }) => {
      if (String(edgeId) === '__initial__') return;
      service.removeTransition(String(edgeId));
      selection = null;
      rebuildGraph();
    });
    graphView.on(actions.SELECT_NODE, ({ node }) => {
      const id = String(node.id);
      selection = id.startsWith('__') ? null : { type: 'node', id };
      renderInspector();
      graphView?.selectNode(node);
    });
    graphView.on(actions.SELECT_EDGE, ({ edgeId, edge }) => {
      const id = String(edgeId);
      selection = id === '__initial__' ? null : { type: 'edge', id };
      renderInspector();
      graphView?.selectEdge(edge, edgeId);
    });
    graphView.on(actions.DESELECT_ITEM, () => {
      selection = null;
      renderInspector();
      graphView?.deselectItem();
    });
    graphView.on(actions.UPDATE_TRANSLATE, ({ pos }) => {
      writeGraphSettings(settingsKey, { ...readGraphSettings(settingsKey), x: pos.x, y: pos.y });
    });
    graphView.on(actions.UPDATE_SCALE, ({ scale }) => {
      writeGraphSettings(settingsKey, { ...readGraphSettings(settingsKey), scale });
    });
    requestAnimationFrame(() => restoreSelection());
  }

  function restoreSelection(): void {
    if (!selection || !graphView) return;
    const data = graphView.data;
    if (selection.type === 'node' && data.nodes?.[selection.id]) graphView.selectNode(data.nodes[selection.id]);
    if (selection.type === 'edge' && data.edges?.[selection.id]) graphView.selectEdge(data.edges[selection.id], selection.id);
  }

  function renderInspector(): void {
    inspector.replaceChildren();
    renderIssues(inspector, service.value, options.clips);
    if (selection?.type === 'node') {
      const state = service.value.states.find((entry) => entry.id === selection!.id);
      if (state) renderStateInspector(inspector, state);
    } else if (selection?.type === 'edge') {
      const transition = service.value.transitions.find((entry) => entry.id === selection!.id);
      if (transition) renderTransitionInspector(inspector, transition);
    } else {
      inspector.append(element('p', { className: 'muted graph-selection-hint', text: 'Select a state or transition to edit it.' }));
    }
    renderParameters(inspector);
  }

  function renderStateInspector(root: HTMLElement, state: AnimationGraphState): void {
    const section = graphSection('State', true);
    const name = textInput(state.name, (value) => service.updateState(state.id, { name: value }));
    appendGraphField(section, 'Name', name);
    const mode = element('select');
    mode.append(
      new Option('Single Clip', 'clip'),
      new Option('1D Blend Tree', '1d'),
      new Option('2D Directional', '2d-directional'),
      new Option('2D Cartesian', '2d-cartesian'),
    );
    mode.value = state.blendTree?.type ?? 'clip';
    mode.addEventListener('change', () => {
      if (mode.value === 'clip') service.updateState(state.id, { blendTree: undefined });
      else {
        const numeric = service.value.parameters.find((parameter) => parameter.type === 'float' || parameter.type === 'integer');
        if (!numeric) {
          const parameterId = service.addParameter('Blend', 'float', 0);
          service.updateState(state.id, {
            clipId: undefined,
            blendTree: { type: mode.value as AnimationBlendTree['type'], parameterX: parameterId, parameterY: mode.value === '1d' ? undefined : parameterId, children: [] },
          });
        } else {
          service.updateState(state.id, {
            clipId: undefined,
            blendTree: { type: mode.value as AnimationBlendTree['type'], parameterX: numeric.id, parameterY: mode.value === '1d' ? undefined : numeric.id, children: [] },
          });
        }
      }
      rebuildGraph();
    });
    appendGraphField(section, 'Motion', mode);
    if (!state.blendTree) {
      const clip = clipSelect(options.clips, state.clipId, (clipId) => service.updateState(state.id, { clipId: clipId || undefined }));
      appendGraphField(section, 'Clip', clip);
    } else {
      renderBlendTree(section, state);
    }
    const speed = numberInput(state.speed, 0, 8, 0.05, (value) => service.updateState(state.id, { speed: value }));
    appendGraphField(section, 'Speed', speed);
    const loop = checkbox(state.loop, (value) => service.updateState(state.id, { loop: value }));
    appendGraphField(section, 'Loop', loop);
    const actionsRow = element('div', { className: 'inline-actions' });
    actionsRow.append(
      button(service.value.initialStateId === state.id ? 'Initial State' : 'Set Initial', () => {
        service.setInitialState(state.id);
        rebuildGraph();
      }, service.value.initialStateId === state.id ? 'active mini' : 'mini'),
      button('Delete', () => {
        try {
          service.removeState(state.id);
          selection = null;
          rebuildGraph();
        } catch (error) { options.onError(error); }
      }, 'mini danger'),
    );
    section.append(actionsRow);
    root.append(section);
  }

  function renderBlendTree(root: HTMLElement, state: AnimationGraphState): void {
    const tree = state.blendTree!;
    const numeric = service.value.parameters.filter((parameter) => parameter.type === 'float' || parameter.type === 'integer');
    const update = (next: AnimationBlendTree) => service.updateState(state.id, { clipId: undefined, blendTree: next });
    const x = parameterSelect(numeric, tree.parameterX, (parameterX) => update({ ...tree, parameterX }));
    appendGraphField(root, 'Parameter X', x);
    if (tree.type !== '1d') {
      const y = parameterSelect(numeric, tree.parameterY ?? tree.parameterX, (parameterY) => update({ ...tree, parameterY }));
      appendGraphField(root, 'Parameter Y', y);
    }
    const samples = element('div', { className: 'blend-tree-samples' });
    tree.children.forEach((child, index) => {
      const row = element('div', { className: 'blend-tree-row' });
      const clip = clipSelect(options.clips, child.clipId, (clipId) => {
        const children = structuredClone(tree.children);
        children[index] = { ...children[index], clipId: clipId || undefined };
        update({ ...tree, children });
      });
      row.append(clip);
      if (tree.type === '1d') {
        row.append(numberInput(child.threshold ?? 0, -1000, 1000, 0.01, (threshold) => {
          const children = structuredClone(tree.children);
          children[index] = { ...children[index], threshold };
          update({ ...tree, children });
        }));
      } else {
        row.append(
          numberInput(child.position?.x ?? 0, -1000, 1000, 0.01, (xValue) => {
            const children = structuredClone(tree.children);
            children[index] = { ...children[index], position: { x: xValue, y: children[index].position?.y ?? 0 } };
            update({ ...tree, children });
          }),
          numberInput(child.position?.y ?? 0, -1000, 1000, 0.01, (yValue) => {
            const children = structuredClone(tree.children);
            children[index] = { ...children[index], position: { x: children[index].position?.x ?? 0, y: yValue } };
            update({ ...tree, children });
          }),
        );
      }
      row.append(
        numberInput(child.speed ?? 1, 0, 8, 0.05, (speedValue) => {
          const children = structuredClone(tree.children);
          children[index] = { ...children[index], speed: speedValue };
          update({ ...tree, children });
        }),
        button('×', () => update({ ...tree, children: tree.children.filter((_, childIndex) => childIndex !== index) }), 'mini danger'),
      );
      samples.append(row);
    });
    samples.append(button('Add Blend Sample', () => {
      const clipId = options.clips[0]?.id;
      update({
        ...tree,
        children: [...tree.children, tree.type === '1d'
          ? { clipId, threshold: tree.children.length, speed: 1 }
          : { clipId, position: { x: tree.children.length, y: 0 }, speed: 1 }],
      });
    }, 'mini'));
    root.append(samples);
  }

  function renderTransitionInspector(root: HTMLElement, transition: AnimationGraphTransition): void {
    const section = graphSection('Transition', true);
    const states = service.value.states;
    const from = element('select');
    from.append(new Option('Any State', '*'));
    states.forEach((state) => from.append(new Option(state.name, state.id)));
    from.value = transition.fromStateId;
    from.addEventListener('change', () => service.updateTransition(transition.id, { fromStateId: from.value }));
    appendGraphField(section, 'From', from);
    const to = element('select');
    states.forEach((state) => to.append(new Option(state.name, state.id)));
    to.value = transition.toStateId;
    to.addEventListener('change', () => service.updateTransition(transition.id, { toStateId: to.value }));
    appendGraphField(section, 'To', to);
    appendGraphField(section, 'Duration', numberInput(transition.duration, 0, 30, 0.01, (duration) => service.updateTransition(transition.id, { duration })));
    const exit = element('input', { attrs: { type: 'number', min: '0', max: '1', step: '0.01', placeholder: 'Disabled', value: transition.exitTime == null ? '' : String(transition.exitTime) } });
    exit.addEventListener('change', () => service.updateTransition(transition.id, { exitTime: exit.value === '' ? undefined : Number(exit.value) }));
    appendGraphField(section, 'Exit Time', exit);
    const conditions = element('div', { className: 'graph-condition-list' });
    transition.conditions.forEach((condition, index) => conditions.append(renderCondition(transition, condition, index)));
    conditions.append(button('Add Condition', () => {
      const parameter = service.value.parameters[0];
      if (!parameter) {
        options.onError(new Error('Create a parameter before adding a condition.'));
        return;
      }
      service.addCondition(transition.id, {
        parameterId: parameter.id,
        operator: parameter.type === 'trigger' || parameter.type === 'boolean' ? 'set' : 'greater',
        value: parameter.type === 'boolean' || parameter.type === 'trigger' ? true : 0,
      });
    }, 'mini'));
    section.append(conditions, button('Delete Transition', () => {
      service.removeTransition(transition.id);
      selection = null;
      rebuildGraph();
    }, 'mini danger'));
    root.append(section);
  }

  function renderCondition(
    transition: AnimationGraphTransition,
    condition: AnimationGraphCondition,
    index: number,
  ): HTMLElement {
    const row = element('div', { className: 'graph-condition-row' });
    const parameter = element('select');
    service.value.parameters.forEach((entry) => parameter.append(new Option(entry.name, entry.id)));
    parameter.value = condition.parameterId;
    const selectedParameter = service.value.parameters.find((entry) => entry.id === condition.parameterId);
    const booleanParameter = selectedParameter?.type === 'boolean' || selectedParameter?.type === 'trigger';
    const operator = element('select');
    const operators = booleanParameter
      ? ['equals', 'notEquals', 'set']
      : ['equals', 'notEquals', 'greater', 'greaterOrEqual', 'less', 'lessOrEqual'];
    for (const value of operators) {
      operator.append(new Option(value, value));
    }
    operator.value = operators.includes(condition.operator) ? condition.operator : operators[0];
    const value = booleanParameter
      ? element('select')
      : element('input', { attrs: { type: 'number', step: '0.01', value: String(condition.value ?? 0) } });
    if (value instanceof HTMLSelectElement) {
      value.append(new Option('True', 'true'), new Option('False', 'false'));
      value.value = String(condition.value ?? true);
    }
    const update = () => {
      const conditions = structuredClone(transition.conditions);
      const nextParameter = service.value.parameters.find((entry) => entry.id === parameter.value);
      const nextBoolean = nextParameter?.type === 'boolean' || nextParameter?.type === 'trigger';
      conditions[index] = {
        parameterId: parameter.value,
        operator: operator.value as AnimationGraphCondition['operator'],
        value: operator.value === 'set' ? true : nextBoolean ? value.value === 'true' : Number(value.value),
      };
      service.updateTransition(transition.id, { conditions });
    };
    parameter.addEventListener('change', () => {
      const conditions = structuredClone(transition.conditions);
      const nextParameter = service.value.parameters.find((entry) => entry.id === parameter.value);
      const nextBoolean = nextParameter?.type === 'boolean' || nextParameter?.type === 'trigger';
      conditions[index] = {
        parameterId: parameter.value,
        operator: nextBoolean ? 'set' : 'greater',
        value: nextBoolean ? true : 0,
      };
      service.updateTransition(transition.id, { conditions });
    });
    operator.addEventListener('change', update);
    value.addEventListener('change', update);
    row.append(parameter, operator, value, button('×', () => service.removeCondition(transition.id, index), 'mini danger'));
    return row;
  }

  function renderParameters(root: HTMLElement): void {
    const section = graphSection('Parameters', true);
    for (const parameter of service.value.parameters) {
      const row = element('div', { className: 'graph-parameter-row' });
      const name = textInput(parameter.name, (value) => service.updateParameter(parameter.id, { name: value }));
      const type = element('select');
      for (const value of ['boolean', 'float', 'integer', 'trigger'] as const) type.append(new Option(value, value));
      type.value = parameter.type;
      type.addEventListener('change', () => {
        const nextType = type.value as AnimationGraphParameter['type'];
        service.updateParameter(parameter.id, {
          type: nextType,
          defaultValue: nextType === 'boolean' || nextType === 'trigger' ? false : 0,
        });
      });
      const defaultValue = parameter.type === 'boolean' || parameter.type === 'trigger'
        ? checkbox(Boolean(parameter.defaultValue), (value) => service.updateParameter(parameter.id, { defaultValue: value }))
        : numberInput(Number(parameter.defaultValue), -100000, 100000, parameter.type === 'integer' ? 1 : 0.01, (value) => service.updateParameter(parameter.id, { defaultValue: value }));
      row.append(name, type, defaultValue, button('×', () => service.removeParameter(parameter.id), 'mini danger'));
      section.append(row);
    }
    section.append(button('Add Parameter', () => service.addParameter('Parameter'), 'mini'));
    root.append(section);
  }

  const onClose = () => dispose();
  options.dialog.addEventListener('close', onClose, { once: true });
  rebuildGraph();
  renderInspector();
  if (!options.dialog.open) options.dialog.showModal();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    graphView?.destroy();
    graphView = null;
    service.removeEventListener('change', commit);
  }
  return dispose;
}

function renderIssues(root: HTMLElement, graph: AnimationStateGraph, clips: SceneAnimation[]): void {
  const issues = validateAnimationStateGraph(graph, clips.map((clip) => clip.id));
  if (!issues.length) return;
  const panel = element('details', { className: 'graph-issues' });
  panel.append(element('summary', { text: `${issues.length} validation issue${issues.length === 1 ? '' : 's'}` }));
  issues.forEach((issue) => panel.append(element('p', { text: `${issue.path}: ${issue.message}` })));
  root.append(panel);
}

function graphSection(title: string, open: boolean): HTMLDetailsElement {
  const section = element('details', { className: 'graph-inspector-section' });
  section.open = open;
  section.append(element('summary', { text: title }));
  return section;
}

function appendGraphField(root: HTMLElement, label: string, control: HTMLElement): void {
  const row = element('label', { className: 'graph-field' });
  row.append(element('span', { text: label }), control);
  root.append(row);
}

function textInput(value: string, update: (value: string) => void): HTMLInputElement {
  const input = element('input', { attrs: { value } });
  input.addEventListener('change', () => update(input.value));
  return input;
}

function numberInput(
  value: number,
  minimum: number,
  maximum: number,
  step: number,
  update: (value: number) => void,
): HTMLInputElement {
  const input = element('input', { attrs: { type: 'number', min: String(minimum), max: String(maximum), step: String(step), value: String(value) } });
  input.addEventListener('change', () => update(Number(input.value)));
  return input;
}

function checkbox(value: boolean, update: (value: boolean) => void): HTMLInputElement {
  const input = element('input', { attrs: { type: 'checkbox' } });
  input.checked = value;
  input.addEventListener('change', () => update(input.checked));
  return input;
}

function clipSelect(
  clips: SceneAnimation[],
  selected: string | undefined,
  update: (value: string) => void,
): HTMLSelectElement {
  const select = element('select');
  select.append(new Option('No Clip', ''));
  clips.forEach((clip) => select.append(new Option(clip.name, clip.id)));
  select.value = selected ?? '';
  select.addEventListener('change', () => update(select.value));
  return select;
}

function parameterSelect(
  parameters: AnimationGraphParameter[],
  selected: string,
  update: (value: string) => void,
): HTMLSelectElement {
  const select = element('select');
  parameters.forEach((parameter) => select.append(new Option(parameter.name, parameter.id)));
  select.value = selected;
  select.addEventListener('change', () => update(select.value));
  return select;
}

function readGraphSettings(key: string): { x: number; y: number; scale: number } {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.scale)) return value;
  } catch { /* Ignore invalid session-only UI state. */ }
  return { x: 0, y: 0, scale: 1 };
}

function writeGraphSettings(key: string, value: { x: number; y: number; scale: number }): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}
