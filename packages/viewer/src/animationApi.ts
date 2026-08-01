import * as THREE from 'three/webgpu';
import type {
  AnimationBlendTree,
  AnimationGraphCondition,
  AnimationGraphParameter,
  AnimationGraphState,
  AnimationStateGraph,
  AssetResolver,
  KyxosSceneContract,
} from '@kyxos/scene-contract';
import { KyxosViewer } from './KyxosViewer';
import type { AnimationState } from './sceneTypes';

interface RuntimeAnimationState {
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  contractClipIndices: Map<string, number>;
  actions: Map<string, THREE.AnimationAction>;
  activeClipId?: string;
  speed: number;
  loop: boolean;
  time: number;
  graph?: AnimationStateGraph;
  graphEnabled: boolean;
  graphStateId?: string;
  graphStateTime: number;
  graphParameters: Record<string, boolean | number>;
  graphWeights: Map<string, WeightedClip>;
  graphTransition?: {
    from: Map<string, WeightedClip>;
    elapsed: number;
    duration: number;
  };
}

interface WeightedClip {
  clipId: string;
  weight: number;
  speed: number;
}

const animationStates = new WeakMap<KyxosViewer, RuntimeAnimationState>();

function state(viewer: KyxosViewer): RuntimeAnimationState {
  let current = animationStates.get(viewer);
  if (!current) {
    current = {
      mixer: null,
      clips: [],
      contractClipIndices: new Map(),
      actions: new Map(),
      speed: 1,
      loop: true,
      time: 0,
      graphEnabled: false,
      graphStateTime: 0,
      graphParameters: {},
      graphWeights: new Map(),
    };
    animationStates.set(viewer, current);
  }
  return current;
}

function internals(viewer: KyxosViewer): Record<string, any> {
  return viewer as unknown as Record<string, any>;
}

function configureContractAnimations(
  viewer: KyxosViewer,
  contract: KyxosSceneContract,
): void {
  const current = state(viewer);
  current.contractClipIndices.clear();
  for (const animation of contract.animations) {
    current.contractClipIndices.set(animation.id, animation.clipIndex);
  }
  current.graph = contract.animationStateGraph
    ? structuredClone(contract.animationStateGraph)
    : undefined;
  current.graphEnabled = Boolean(current.graph);
  current.graphStateId = current.graph?.initialStateId;
  current.graphStateTime = 0;
  current.graphTransition = undefined;
  current.graphWeights.clear();
  current.graphParameters = Object.fromEntries(
    current.graph?.parameters.map((parameter) => [parameter.id, parameter.defaultValue]) ?? [],
  );
}

function resolveClip(
  current: RuntimeAnimationState,
  clipId?: string,
): THREE.AnimationClip | undefined {
  if (!clipId) return current.clips[0];
  const index = current.contractClipIndices.get(clipId);
  if (index != null) return current.clips[index];
  return current.clips.find((clip) => clip.name === clipId);
}

function conditionMatches(
  condition: AnimationGraphCondition,
  parameters: Map<string, AnimationGraphParameter>,
  values: Record<string, boolean | number>,
): boolean {
  const parameter = parameters.get(condition.parameterId);
  if (!parameter) return false;
  const actual = values[parameter.id] ?? parameter.defaultValue;
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

function normalizeWeights(values: WeightedClip[]): WeightedClip[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value.weight), 0);
  if (total <= Number.EPSILON) {
    return values.map((value, index) => ({ ...value, weight: index === 0 ? 1 : 0 }));
  }
  return values.map((value) => ({ ...value, weight: Math.max(0, value.weight) / total }));
}

function sampleBlendTree(
  tree: AnimationBlendTree,
  values: Record<string, boolean | number>,
): WeightedClip[] {
  const x = Number(values[tree.parameterX] ?? 0);
  const y = Number(values[tree.parameterY ?? ''] ?? 0);
  const samples: Array<WeightedClip & { distance: number }> = [];
  for (const child of tree.children) {
    const distance = tree.type === '1d'
      ? Math.abs(x - Number(child.threshold ?? child.position?.x ?? 0))
      : Math.hypot(x - Number(child.position?.x ?? 0), y - Number(child.position?.y ?? 0));
    if (child.blendTree) {
      for (const nested of sampleBlendTree(child.blendTree, values)) {
        samples.push({
          ...nested,
          weight: nested.weight,
          speed: nested.speed * (child.speed ?? 1),
          distance,
        });
      }
    } else if (child.clipId) {
      samples.push({ clipId: child.clipId, weight: 1, speed: child.speed ?? 1, distance });
    }
  }
  if (!samples.length) return [];
  const exact = samples.filter((sample) => sample.distance <= Number.EPSILON);
  return normalizeWeights((exact.length ? exact : samples).map((sample) => ({
    clipId: sample.clipId,
    weight: exact.length ? sample.weight : sample.weight / Math.max(sample.distance, 0.000001),
    speed: sample.speed,
  })));
}

function stateMotion(
  graphState: AnimationGraphState | undefined,
  values: Record<string, boolean | number>,
): WeightedClip[] {
  if (!graphState) return [];
  const samples = graphState.blendTree
    ? sampleBlendTree(graphState.blendTree, values)
    : graphState.clipId
      ? [{ clipId: graphState.clipId, weight: 1, speed: 1 }]
      : [];
  return samples.map((sample) => ({ ...sample, speed: sample.speed * graphState.speed }));
}

function asWeightMap(samples: WeightedClip[]): Map<string, WeightedClip> {
  return new Map(samples.map((sample) => [sample.clipId, sample]));
}

function interpolateWeights(
  from: Map<string, WeightedClip>,
  to: Map<string, WeightedClip>,
  amount: number,
): Map<string, WeightedClip> {
  const result = new Map<string, WeightedClip>();
  for (const clipId of new Set([...from.keys(), ...to.keys()])) {
    const previous = from.get(clipId);
    const next = to.get(clipId);
    const weight = (previous?.weight ?? 0) + ((next?.weight ?? 0) - (previous?.weight ?? 0)) * amount;
    const speed = (previous?.speed ?? next?.speed ?? 1) + ((next?.speed ?? previous?.speed ?? 1) - (previous?.speed ?? next?.speed ?? 1)) * amount;
    result.set(clipId, { clipId, weight, speed });
  }
  return result;
}

function applyGraphWeights(current: RuntimeAnimationState, weights: Map<string, WeightedClip>, loop: boolean): void {
  if (!current.mixer) return;
  for (const clipId of new Set([...current.graphWeights.keys(), ...weights.keys()])) {
    const sample = weights.get(clipId);
    const weight = Math.max(0, sample?.weight ?? 0);
    let action = current.actions.get(clipId);
    if (!action && weight > Number.EPSILON) {
      const clip = resolveClip(current, clipId);
      if (!clip) continue;
      action = current.mixer.clipAction(clip);
      current.actions.set(clipId, action);
      action.reset().play();
    }
    if (!action) continue;
    const previousWeight = current.graphWeights.get(clipId)?.weight ?? 0;
    if (previousWeight <= Number.EPSILON && weight > Number.EPSILON && !action.isRunning()) {
      action.reset().play();
    }
    action.enabled = weight > Number.EPSILON;
    action.paused = false;
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.setEffectiveWeight(weight);
    action.setEffectiveTimeScale(sample?.speed ?? 1);
    if (weight <= Number.EPSILON && previousWeight > Number.EPSILON) action.stop();
  }
  current.graphWeights = new Map(weights);
  current.activeClipId = [...weights.values()].sort((left, right) => right.weight - left.weight)[0]?.clipId;
}

function graphDuration(current: RuntimeAnimationState, motion: WeightedClip[]): number {
  return motion.reduce((duration, sample) => {
    const clip = resolveClip(current, sample.clipId);
    return Math.max(duration, clip ? clip.duration / Math.max(Math.abs(sample.speed), 0.000001) : 0);
  }, 0);
}

function updateGraph(viewer: KyxosViewer, current: RuntimeAnimationState, delta: number): void {
  const graph = current.graph;
  if (!current.mixer || !graph || !current.graphEnabled) return;
  let activeState = graph.states.find((entry) => entry.id === current.graphStateId)
    ?? graph.states.find((entry) => entry.id === graph.initialStateId);
  if (!activeState) return;
  current.graphStateId = activeState.id;
  const activeMotion = stateMotion(activeState, current.graphParameters);
  const duration = graphDuration(current, activeMotion);
  const normalizedTime = duration > 0
    ? activeState.loop
      ? (current.graphStateTime % duration) / duration
      : Math.min(1, current.graphStateTime / duration)
    : 0;
  const parameters = new Map(graph.parameters.map((parameter) => [parameter.id, parameter]));
  const transition = graph.transitions.find((entry) =>
    entry.toStateId !== activeState!.id &&
    (entry.fromStateId === '*' || entry.fromStateId === activeState!.id) &&
    (entry.exitTime == null || normalizedTime >= entry.exitTime) &&
    entry.conditions.every((condition) => conditionMatches(condition, parameters, current.graphParameters)),
  );
  if (transition) {
    current.graphTransition = {
      from: new Map(current.graphWeights),
      elapsed: 0,
      duration: Math.max(0, transition.duration),
    };
    current.graphStateId = transition.toStateId;
    current.graphStateTime = 0;
    for (const condition of transition.conditions) {
      if (parameters.get(condition.parameterId)?.type === 'trigger') {
        current.graphParameters[condition.parameterId] = false;
      }
    }
    activeState = graph.states.find((entry) => entry.id === current.graphStateId) ?? activeState;
    viewer.dispatchEvent(new CustomEvent('animation-graph-transition', {
      detail: { transitionId: transition.id, stateId: activeState.id },
    }));
  }
  const target = asWeightMap(stateMotion(activeState, current.graphParameters));
  let effective = target;
  if (current.graphTransition) {
    current.graphTransition.elapsed += Math.max(0, delta);
    const amount = current.graphTransition.duration <= Number.EPSILON
      ? 1
      : Math.min(1, current.graphTransition.elapsed / current.graphTransition.duration);
    effective = interpolateWeights(current.graphTransition.from, target, amount);
    if (amount >= 1) current.graphTransition = undefined;
  }
  applyGraphWeights(current, effective, activeState.loop);
  current.mixer.update(Math.max(0, delta));
  current.graphStateTime += Math.max(0, delta);
  current.time = current.graphStateTime;
}

function startGraph(viewer: KyxosViewer, current: RuntimeAnimationState): boolean {
  const graph = current.graph;
  const activeState = graph?.states.find((entry) => entry.id === graph.initialStateId);
  if (!graph || !activeState || !current.mixer) return false;
  current.graphEnabled = true;
  current.graphStateId = activeState.id;
  current.graphStateTime = 0;
  current.graphTransition = undefined;
  current.mixer.stopAllAction();
  current.actions.clear();
  current.graphWeights.clear();
  const weights = asWeightMap(stateMotion(activeState, current.graphParameters));
  applyGraphWeights(current, weights, activeState.loop);
  viewer.setAnimationEnabled(weights.size > 0);
  return weights.size > 0;
}

const originalLoadModel = KyxosViewer.prototype.loadModel;
KyxosViewer.prototype.loadModel = async function loadModelWithAnimation(
  url: string,
): Promise<void> {
  await originalLoadModel.call(this, url);
  const current = state(this);
  current.mixer?.stopAllAction();
  current.mixer = null;
  current.clips = [];
  current.actions.clear();
  current.graphWeights.clear();
  current.time = 0;

  if (!url || url.startsWith('procedural:')) {
    internals(this).animateScene = () => undefined;
    return;
  }

  // Reuse clips from the same fully configured decode pass as the visible model.
  current.clips = ((internals(this).loadedGltfAnimations ?? []) as THREE.AnimationClip[])
    .map((clip) => clip.clone());
  if (!current.clips.length) {
    internals(this).animateScene = () => undefined;
    return;
  }

  current.mixer = new THREE.AnimationMixer(internals(this).modelRoot);
  internals(this).animateScene = (_elapsed: number, delta: number) => {
    if (!current.mixer) return;
    if (current.graphEnabled && current.graph) {
      updateGraph(this, current, delta);
      return;
    }
    current.mixer.update(delta * current.speed);
    current.time = current.mixer.time;
  };
};

const originalLoadScene = KyxosViewer.prototype.loadScene;
KyxosViewer.prototype.loadScene = async function loadSceneWithAnimation(
  contract: KyxosSceneContract,
  resolver: AssetResolver,
): Promise<void> {
  configureContractAnimations(this, contract);
  await originalLoadScene.call(this, contract, resolver);
  if (startGraph(this, state(this))) return;
  const initial = contract.animations.find((animation) => animation.autoplay);
  if (initial) {
    this.setAnimationState({
      clipId: initial.id,
      playing: true,
      loop: initial.loop,
      speed: initial.speed,
      time: 0,
    });
  } else {
    this.setAnimationEnabled(false);
  }
};

KyxosViewer.prototype.setAnimationState = function setAnimationRuntimeState(
  animation: AnimationState,
): void {
  const current = state(this);
  current.graphEnabled = false;
  current.graphTransition = undefined;
  current.graphWeights.clear();
  current.actions.clear();
  const clip = resolveClip(current, animation.clipId);
  current.activeClipId = animation.clipId;
  current.speed = Number.isFinite(animation.speed)
    ? Math.max(0, animation.speed ?? 1)
    : 1;
  current.loop = animation.loop !== false;
  current.time = Math.max(0, animation.time ?? current.time);

  if (!current.mixer || !clip) {
    this.setAnimationEnabled(false);
    return;
  }

  current.mixer.stopAllAction();
  const action = current.mixer.clipAction(clip);
  action.enabled = true;
  action.clampWhenFinished = !current.loop;
  action.setLoop(
    current.loop ? THREE.LoopRepeat : THREE.LoopOnce,
    current.loop ? Infinity : 1,
  );
  action.setEffectiveTimeScale(1);
  action.reset();
  if (current.time > 0) {
    action.time = Math.min(current.time, Math.max(0, clip.duration));
  }
  action.play();
  action.paused = !animation.playing;
  this.setAnimationEnabled(animation.playing);
  this.resetTemporal('animation-state');
};

KyxosViewer.prototype.setAnimationGraphParameter = function setAnimationGraphParameter(
  idOrName: string,
  value: boolean | number,
): void {
  const current = state(this);
  const parameter = current.graph?.parameters.find((entry) => entry.id === idOrName || entry.name === idOrName);
  if (!parameter) throw new Error(`Animation graph parameter ${idOrName} does not exist.`);
  const numericValue = Number(value);
  if ((parameter.type === 'float' || parameter.type === 'integer') && !Number.isFinite(numericValue)) {
    throw new Error(`Animation graph parameter ${idOrName} requires a finite number.`);
  }
  current.graphParameters[parameter.id] = parameter.type === 'boolean' || parameter.type === 'trigger'
    ? Boolean(value)
    : parameter.type === 'integer'
      ? Math.trunc(numericValue)
      : numericValue;
  if (!current.graphEnabled) startGraph(this, current);
  else this.setAnimationEnabled(true);
};

KyxosViewer.prototype.fireAnimationGraphTrigger = function fireAnimationGraphTrigger(idOrName: string): void {
  const current = state(this);
  const parameter = current.graph?.parameters.find((entry) => entry.id === idOrName || entry.name === idOrName);
  if (!parameter || parameter.type !== 'trigger') {
    throw new Error(`Animation graph trigger ${idOrName} does not exist.`);
  }
  this.setAnimationGraphParameter(parameter.id, true);
};

KyxosViewer.prototype.getAnimationGraphState = function getAnimationGraphState() {
  const current = state(this);
  if (!current.graph) return null;
  return {
    graphId: current.graph.id,
    stateId: current.graphStateId ?? current.graph.initialStateId,
    parameters: structuredClone(current.graphParameters),
  };
};

const originalDispose = KyxosViewer.prototype.dispose;
KyxosViewer.prototype.dispose = function disposeAnimationRuntime(): void {
  const current = animationStates.get(this);
  current?.mixer?.stopAllAction();
  if (current?.mixer) current.mixer.uncacheRoot(internals(this).modelRoot);
  current?.actions.clear();
  animationStates.delete(this);
  originalDispose.call(this);
};

KyxosViewer.prototype.getAnimationState = function getAnimationRuntimeState():
  | (AnimationState & { duration: number; availableClips: string[] })
  | null {
  const current = state(this);
  const clip = resolveClip(current, current.activeClipId);
  if (!clip) return null;
  return {
    clipId: current.activeClipId,
    playing: this.getAnimationEnabled(),
    loop: current.loop,
    speed: current.speed,
    time: current.time,
    duration: clip.duration,
    availableClips: current.clips.map((entry) => entry.name),
  };
};

declare module './KyxosViewer' {
  interface KyxosViewer {
    getAnimationState():
      | (AnimationState & { duration: number; availableClips: string[] })
      | null;
    setAnimationGraphParameter(idOrName: string, value: boolean | number): void;
    fireAnimationGraphTrigger(idOrName: string): void;
    getAnimationGraphState(): {
      graphId: string;
      stateId: string;
      parameters: Record<string, boolean | number>;
    } | null;
  }
}
