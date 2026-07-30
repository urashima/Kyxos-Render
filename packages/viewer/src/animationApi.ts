import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
  AssetResolver,
  KyxosSceneContract,
} from '@kyxos/scene-contract';
import { KyxosViewer } from './KyxosViewer';
import type { AnimationState } from './sceneTypes';

interface RuntimeAnimationState {
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  contractClipIndices: Map<string, number>;
  activeClipId?: string;
  speed: number;
  loop: boolean;
  time: number;
}

const animationStates = new WeakMap<KyxosViewer, RuntimeAnimationState>();

function state(viewer: KyxosViewer): RuntimeAnimationState {
  let current = animationStates.get(viewer);
  if (!current) {
    current = {
      mixer: null,
      clips: [],
      contractClipIndices: new Map(),
      speed: 1,
      loop: true,
      time: 0,
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

const originalLoadModel = KyxosViewer.prototype.loadModel;
KyxosViewer.prototype.loadModel = async function loadModelWithAnimation(
  url: string,
): Promise<void> {
  await originalLoadModel.call(this, url);
  const current = state(this);
  current.mixer?.stopAllAction();
  current.mixer = null;
  current.clips = [];
  current.time = 0;

  if (!url || url.startsWith('procedural:')) {
    internals(this).animateScene = () => undefined;
    return;
  }

  // The GLB is served through a content-hash URL and is normally fulfilled from
  // the browser cache on this second read. Clips are data-only and are rebound
  // to the already displayed modelRoot by their glTF track names.
  const gltf = await new GLTFLoader().loadAsync(url);
  current.clips = gltf.animations.map((clip) => clip.clone());
  if (!current.clips.length) {
    internals(this).animateScene = () => undefined;
    return;
  }

  current.mixer = new THREE.AnimationMixer(internals(this).modelRoot);
  internals(this).animateScene = (_elapsed: number, delta: number) => {
    if (!current.mixer) return;
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
  }
}
