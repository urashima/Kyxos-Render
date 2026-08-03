import type {
  AnimationBlendTree,
  AnimationGraphCondition,
  AnimationGraphParameter,
  AnimationGraphState,
  AnimationGraphTransition,
  AnimationStateGraph,
} from '@kyxos/scene-contract';

export interface AnimationGraphIssue {
  path: string;
  message: string;
}

export interface AnimationGraphEvaluation {
  stateId: string;
  transitionId?: string;
  nextStateId?: string;
  blend: Array<{ clipId: string; weight: number; speed: number }>;
  consumedTriggers: string[];
}

export interface PcuiGraphData {
  nodes: Record<string, Record<string, unknown>>;
  edges: Record<string, Record<string, unknown>>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function uniqueName(base: string, existing: Iterable<string>): string {
  const values = new Set(existing);
  if (!values.has(base)) return base;
  let suffix = 2;
  while (values.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function conditionMatches(
  condition: AnimationGraphCondition,
  parameters: Map<string, AnimationGraphParameter>,
  values: Record<string, boolean | number>,
): boolean {
  const parameter = parameters.get(condition.parameterId);
  if (!parameter) return false;
  const actual = values[condition.parameterId] ?? parameter.defaultValue;
  const expected = condition.value;
  switch (condition.operator) {
    case 'equals': return actual === expected;
    case 'notEquals': return actual !== expected;
    case 'greater': return Number(actual) > Number(expected);
    case 'greaterOrEqual': return Number(actual) >= Number(expected);
    case 'less': return Number(actual) < Number(expected);
    case 'lessOrEqual': return Number(actual) <= Number(expected);
    case 'set': return Boolean(actual);
  }
}

function normalizeWeights(values: Array<{ clipId: string; weight: number; speed: number }>) {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  if (total <= Number.EPSILON) return values.map((value, index) => ({ ...value, weight: index ? 0 : 1 }));
  return values.map((value) => ({ ...value, weight: value.weight / total }));
}

export function sampleBlendTree(
  tree: AnimationBlendTree,
  values: Record<string, boolean | number>,
): Array<{ clipId: string; weight: number; speed: number }> {
  const x = Number(values[tree.parameterX] ?? 0);
  const y = Number(values[tree.parameterY ?? ''] ?? 0);
  const samples: Array<{ clipId: string; distance: number; speed: number; innerWeight: number }> = [];
  for (const child of tree.children) {
    const distance = tree.type === '1d'
      ? Math.abs(x - Number(child.threshold ?? child.position?.x ?? 0))
      : Math.hypot(x - Number(child.position?.x ?? 0), y - Number(child.position?.y ?? 0));
    if (child.blendTree) {
      for (const nested of sampleBlendTree(child.blendTree, values)) {
        samples.push({
          clipId: nested.clipId,
          distance,
          speed: nested.speed * (child.speed ?? 1),
          innerWeight: nested.weight,
        });
      }
    } else if (child.clipId) {
      samples.push({ clipId: child.clipId, distance, speed: child.speed ?? 1, innerWeight: 1 });
    }
  }
  if (!samples.length) return [];
  const exact = samples.filter((sample) => sample.distance <= Number.EPSILON);
  if (exact.length) return normalizeWeights(exact.map((sample) => ({
    clipId: sample.clipId,
    weight: sample.innerWeight,
    speed: sample.speed,
  })));
  return normalizeWeights(samples.map((sample) => ({
    clipId: sample.clipId,
    weight: sample.innerWeight / Math.max(sample.distance, 0.000001),
    speed: sample.speed,
  })));
}

export function validateAnimationStateGraph(
  graph: AnimationStateGraph,
  clipIds?: Iterable<string>,
): AnimationGraphIssue[] {
  const issues: AnimationGraphIssue[] = [];
  const states = new Set(graph.states.map((state) => state.id));
  const parameters = new Map(graph.parameters.map((parameter) => [parameter.id, parameter]));
  const clips = clipIds ? new Set(clipIds) : null;
  if (!states.has(graph.initialStateId)) issues.push({ path: '/initialStateId', message: 'Initial state is missing.' });
  if (states.size !== graph.states.length) issues.push({ path: '/states', message: 'State IDs must be unique.' });
  if (parameters.size !== graph.parameters.length) issues.push({ path: '/parameters', message: 'Parameter IDs must be unique.' });
  graph.states.forEach((state, index) => {
    if (!state.name.trim()) issues.push({ path: `/states/${index}/name`, message: 'State name is required.' });
    if (state.clipId && clips && !clips.has(state.clipId)) issues.push({ path: `/states/${index}/clipId`, message: 'Animation clip is missing.' });
    if (state.clipId && state.blendTree) issues.push({ path: `/states/${index}`, message: 'A state cannot have both a clip and a blend tree.' });
  });
  graph.transitions.forEach((transition, index) => {
    if (transition.fromStateId !== '*' && !states.has(transition.fromStateId)) issues.push({ path: `/transitions/${index}/fromStateId`, message: 'Source state is missing.' });
    if (!states.has(transition.toStateId)) issues.push({ path: `/transitions/${index}/toStateId`, message: 'Target state is missing.' });
    if (transition.duration < 0) issues.push({ path: `/transitions/${index}/duration`, message: 'Transition duration cannot be negative.' });
    transition.conditions.forEach((condition, conditionIndex) => {
      if (!parameters.has(condition.parameterId)) issues.push({ path: `/transitions/${index}/conditions/${conditionIndex}`, message: 'Condition parameter is missing.' });
    });
  });
  return issues;
}

export function evaluateAnimationStateGraph(
  graph: AnimationStateGraph,
  stateId: string | undefined,
  parameterValues: Record<string, boolean | number>,
  normalizedTime = 0,
): AnimationGraphEvaluation {
  const activeId = graph.states.some((state) => state.id === stateId) ? stateId! : graph.initialStateId;
  const parameters = new Map(graph.parameters.map((parameter) => [parameter.id, parameter]));
  const transition = graph.transitions.find((entry) =>
    (entry.fromStateId === '*' || entry.fromStateId === activeId) &&
    (entry.exitTime == null || normalizedTime >= entry.exitTime) &&
    entry.conditions.every((condition) => conditionMatches(condition, parameters, parameterValues)),
  );
  const nextState = graph.states.find((state) => state.id === (transition?.toStateId ?? activeId));
  const blend = nextState?.blendTree
    ? sampleBlendTree(nextState.blendTree, parameterValues)
    : nextState?.clipId
      ? [{ clipId: nextState.clipId, weight: 1, speed: nextState.speed }]
      : [];
  const consumedTriggers = transition
    ? [...new Set(transition.conditions.flatMap((condition) =>
        parameters.get(condition.parameterId)?.type === 'trigger' ? [condition.parameterId] : [],
      ))]
    : [];
  return {
    stateId: activeId,
    transitionId: transition?.id,
    nextStateId: transition?.toStateId,
    blend,
    consumedTriggers,
  };
}

export function animationGraphToPcuiData(graph: AnimationStateGraph): PcuiGraphData {
  const startId = '__start__';
  const anyId = '__any__';
  return {
    nodes: Object.fromEntries([
      [startId, { id: startId, nodeType: 3, posX: 32, posY: 32, attributes: { name: 'START' } }],
      [anyId, { id: anyId, nodeType: 4, posX: 32, posY: 180, attributes: { name: 'ANY' } }],
      ...graph.states.map((state) => [state.id, {
        id: state.id,
        nodeType: state.id === graph.initialStateId ? 1 : 0,
        posX: state.position.x,
        posY: state.position.y,
        attributes: { name: state.name, speed: state.speed, loop: state.loop },
      }]),
    ]),
    edges: Object.fromEntries([
      ['__initial__', { id: '__initial__', edgeType: 0, from: startId, to: graph.initialStateId }],
      ...graph.transitions.map((transition) => [transition.id, {
        id: transition.id,
        edgeType: transition.fromStateId === '*' ? 3 : 1,
        from: transition.fromStateId === '*' ? anyId : transition.fromStateId,
        to: transition.toStateId,
      }]),
    ]),
  };
}

export function createAnimationStateGraph(name = 'Animation State Graph'): AnimationStateGraph {
  const stateId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name,
    initialStateId: stateId,
    states: [{ id: stateId, name: 'Entry', speed: 1, loop: true, position: { x: 220, y: 80 } }],
    transitions: [],
    parameters: [],
  };
}

export class AnimationGraphService extends EventTarget {
  private graph: AnimationStateGraph;

  constructor(
    graph: AnimationStateGraph,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    super();
    this.graph = clone(graph);
  }

  get value(): AnimationStateGraph { return clone(this.graph) }

  replace(graph: AnimationStateGraph): void {
    const issues = validateAnimationStateGraph(graph);
    if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.graph = clone(graph);
    this.emit('replace');
  }

  addState(input: Partial<AnimationGraphState> = {}): string {
    const speed = input.speed ?? 1;
    if (!Number.isFinite(speed) || speed < 0) throw new Error('State speed must be a non-negative number.');
    const id = this.createId();
    this.graph.states.push({
      id,
      name: uniqueName(input.name?.trim() || 'New State', this.graph.states.map((state) => state.name)),
      speed,
      loop: input.loop ?? true,
      position: input.position ?? { x: 120, y: 120 },
      clipId: input.clipId,
      blendTree: input.blendTree ? clone(input.blendTree) : undefined,
    });
    if (this.graph.states.length === 1) this.graph.initialStateId = id;
    this.emit('state-added', { stateId: id });
    return id;
  }

  updateState(id: string, patch: Partial<Omit<AnimationGraphState, 'id'>>): void {
    const state = this.state(id);
    const next = { ...clone(state), ...clone(patch) };
    if (!next.name.trim()) throw new Error('State name is required.');
    if (!Number.isFinite(next.speed) || next.speed < 0) throw new Error('State speed must be a non-negative number.');
    if (next.clipId && next.blendTree) delete next.blendTree;
    Object.assign(state, next);
    this.emit('state-updated', { stateId: id });
  }

  removeState(id: string): void {
    if (this.graph.states.length === 1) throw new Error('An animation graph needs at least one state.');
    this.state(id);
    this.graph.states = this.graph.states.filter((state) => state.id !== id);
    this.graph.transitions = this.graph.transitions.filter((entry) => entry.fromStateId !== id && entry.toStateId !== id);
    if (this.graph.initialStateId === id) this.graph.initialStateId = this.graph.states[0].id;
    this.emit('state-removed', { stateId: id });
  }

  setInitialState(id: string): void {
    this.state(id);
    this.graph.initialStateId = id;
    this.emit('initial-state', { stateId: id });
  }

  addTransition(fromStateId: string | '*', toStateId: string, duration = 0.2): string {
    if (fromStateId !== '*') this.state(fromStateId);
    this.state(toStateId);
    if (fromStateId === toStateId) throw new Error('A transition cannot target the same state.');
    if (!Number.isFinite(duration) || duration < 0) throw new Error('Transition duration must be non-negative.');
    const id = this.createId();
    this.graph.transitions.push({ id, fromStateId, toStateId, duration, conditions: [] });
    this.emit('transition-added', { transitionId: id });
    return id;
  }

  updateTransition(id: string, patch: Partial<Omit<AnimationGraphTransition, 'id'>>): void {
    const transition = this.transition(id);
    const next = { ...clone(transition), ...clone(patch) };
    if (next.fromStateId !== '*') this.state(next.fromStateId);
    this.state(next.toStateId);
    if (next.fromStateId === next.toStateId) throw new Error('A transition cannot target the same state.');
    if (!Number.isFinite(next.duration) || next.duration < 0) throw new Error('Transition duration must be non-negative.');
    if (next.exitTime != null && (!Number.isFinite(next.exitTime) || next.exitTime < 0)) throw new Error('Exit time must be non-negative.');
    Object.assign(transition, next);
    this.emit('transition-updated', { transitionId: id });
  }

  removeTransition(id: string): void {
    this.graph.transitions = this.graph.transitions.filter((entry) => entry.id !== id);
    this.emit('transition-removed', { transitionId: id });
  }

  addParameter(
    name: string,
    type: AnimationGraphParameter['type'] = 'float',
    defaultValue: boolean | number = type === 'boolean' || type === 'trigger' ? false : 0,
  ): string {
    if (!['boolean', 'float', 'integer', 'trigger'].includes(type)) throw new Error('Parameter type is invalid.');
    if ((type === 'boolean' || type === 'trigger') && typeof defaultValue !== 'boolean') {
      throw new Error('Boolean and trigger parameters require a boolean default.');
    }
    if ((type === 'float' || type === 'integer') && !Number.isFinite(Number(defaultValue))) {
      throw new Error('Numeric parameters require a finite default.');
    }
    const id = this.createId();
    this.graph.parameters.push({
      id,
      name: uniqueName(name.trim() || 'Parameter', this.graph.parameters.map((entry) => entry.name)),
      type,
      defaultValue,
    });
    this.emit('parameter-added', { parameterId: id });
    return id;
  }

  updateParameter(id: string, patch: Partial<Omit<AnimationGraphParameter, 'id'>>): void {
    const parameter = this.parameter(id);
    const next = { ...clone(parameter), ...clone(patch) };
    if (!next.name.trim()) throw new Error('Parameter name is required.');
    if (!['boolean', 'float', 'integer', 'trigger'].includes(next.type)) throw new Error('Parameter type is invalid.');
    if ((next.type === 'boolean' || next.type === 'trigger') && typeof next.defaultValue !== 'boolean') {
      throw new Error('Boolean and trigger parameters require a boolean default.');
    }
    if ((next.type === 'float' || next.type === 'integer') && !Number.isFinite(Number(next.defaultValue))) {
      throw new Error('Numeric parameters require a finite default.');
    }
    Object.assign(parameter, next);
    this.emit('parameter-updated', { parameterId: id });
  }

  removeParameter(id: string): void {
    this.parameter(id);
    this.graph.parameters = this.graph.parameters.filter((entry) => entry.id !== id);
    for (const transition of this.graph.transitions) {
      transition.conditions = transition.conditions.filter((entry) => entry.parameterId !== id);
    }
    this.emit('parameter-removed', { parameterId: id });
  }

  addCondition(transitionId: string, condition: AnimationGraphCondition): void {
    this.parameter(condition.parameterId);
    this.transition(transitionId).conditions.push(clone(condition));
    this.emit('condition-added', { transitionId });
  }

  removeCondition(transitionId: string, index: number): void {
    this.transition(transitionId).conditions.splice(index, 1);
    this.emit('condition-removed', { transitionId, index });
  }

  private state(id: string): AnimationGraphState {
    const state = this.graph.states.find((entry) => entry.id === id);
    if (!state) throw new Error(`Animation state ${id} does not exist.`);
    return state;
  }

  private transition(id: string): AnimationGraphTransition {
    const transition = this.graph.transitions.find((entry) => entry.id === id);
    if (!transition) throw new Error(`Animation transition ${id} does not exist.`);
    return transition;
  }

  private parameter(id: string): AnimationGraphParameter {
    const parameter = this.graph.parameters.find((entry) => entry.id === id);
    if (!parameter) throw new Error(`Animation parameter ${id} does not exist.`);
    return parameter;
  }

  private emit(type: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail, graph: this.value } }));
  }
}
