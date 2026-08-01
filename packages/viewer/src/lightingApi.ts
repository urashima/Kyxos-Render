import * as THREE from 'three/webgpu';
import type {
  AssetResolver,
  KyxosSceneContract,
  SceneLight,
  ScenePatch,
} from '@kyxos/scene-contract';
import { KyxosViewer } from './KyxosViewer';

interface LightingState {
  lights: SceneLight[];
  objects: THREE.Object3D[];
}

const lightingStates = new WeakMap<KyxosViewer, LightingState>();

function state(viewer: KyxosViewer): LightingState {
  let current = lightingStates.get(viewer);
  if (!current) {
    current = { lights: [], objects: [] };
    lightingStates.set(viewer, current);
  }
  return current;
}

function internals(viewer: KyxosViewer): Record<string, any> {
  return viewer as unknown as Record<string, any>;
}

function disposeManagedLights(viewer: KyxosViewer): void {
  const current = state(viewer);
  const scene = internals(viewer).scene as THREE.Scene | undefined;
  if (scene) {
    for (const object of current.objects) scene.remove(object);
  }
  current.objects = [];
}

function configureShadow(light: THREE.Light & { castShadow?: boolean; shadow?: any }, source: SceneLight): void {
  light.castShadow = source.castShadow;
  if (!light.shadow || !source.shadow) return;
  if (typeof source.shadow.bias === 'number') light.shadow.bias = source.shadow.bias;
  if (typeof source.shadow.normalBias === 'number') {
    light.shadow.normalBias = source.shadow.normalBias;
  }
  if (typeof source.shadow.radius === 'number') light.shadow.radius = source.shadow.radius;
  const mapSize = Number(source.shadow.mapSize ?? 1024);
  if (light.shadow.mapSize) {
    light.shadow.mapSize.set(
      Math.max(256, Math.min(4096, mapSize)),
      Math.max(256, Math.min(4096, mapSize)),
    );
  }
}

KyxosViewer.prototype.setLighting = function setLighting(lights: SceneLight[]): void {
  const scene = internals(this).scene as THREE.Scene | undefined;
  if (!scene) return;
  disposeManagedLights(this);
  const current = state(this);
  current.lights = structuredClone(lights);

  for (const source of lights) {
    let light: THREE.Light;
    if (source.type === 'ambient') {
      light = new THREE.AmbientLight(source.color, source.intensity);
    } else if (source.type === 'point') {
      light = new THREE.PointLight(
        source.color,
        source.intensity,
        source.range ?? 0,
        source.decay ?? 2,
      );
    } else if (source.type === 'spot') {
      const outer = source.outerConeAngle ?? Math.PI / 4;
      const inner = Math.min(source.innerConeAngle ?? 0, outer);
      light = new THREE.SpotLight(
        source.color,
        source.intensity,
        source.range ?? 0,
        outer,
        outer > 0 ? Math.max(0, Math.min(1, 1 - inner / outer)) : 0,
        source.decay ?? 2,
      );
    } else {
      light = new THREE.DirectionalLight(source.color, source.intensity);
    }

    light.name = source.name;
    light.userData.kyxosManagedLight = source.id;
    light.position.set(
      source.transform.position.x,
      source.transform.position.y,
      source.transform.position.z,
    );
    light.rotation.set(
      source.transform.rotation.x,
      source.transform.rotation.y,
      source.transform.rotation.z,
    );
    configureShadow(light as THREE.Light & { castShadow?: boolean; shadow?: any }, source);
    scene.add(light);
    current.objects.push(light);

    if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
      light.target.position.set(0, 0.8, 0);
      light.target.userData.kyxosManagedLightTarget = source.id;
      scene.add(light.target);
      current.objects.push(light.target);
    }
  }
  this.resetTemporal('scene-lighting');
};

function applyLightPatch(lights: SceneLight[], patch: ScenePatch): SceneLight[] {
  const next = structuredClone(lights);
  for (const operation of patch) {
    if (!operation.path.startsWith('/lights')) continue;
    const parts = operation.path
      .split('/')
      .slice(1)
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (parts.length === 1) {
      if ((operation.op === 'add' || operation.op === 'replace') && Array.isArray(operation.value)) {
        return structuredClone(operation.value) as SceneLight[];
      }
      continue;
    }
    const index = parts[1] === '-' ? next.length : Number(parts[1]);
    if (!Number.isInteger(index)) continue;
    if (parts.length === 2) {
      if (operation.op === 'remove') next.splice(index, 1);
      else if (operation.op === 'add') next.splice(index, 0, structuredClone(operation.value) as SceneLight);
      else if (operation.op === 'replace') next[index] = structuredClone(operation.value) as SceneLight;
      continue;
    }
    let target: any = next[index];
    if (!target) continue;
    for (const key of parts.slice(2, -1)) {
      target = target?.[key];
      if (target == null) break;
    }
    if (target == null) continue;
    const key = parts.at(-1)!;
    if (operation.op === 'remove') delete target[key];
    else if (operation.op === 'add' || operation.op === 'replace') {
      target[key] = structuredClone(operation.value);
    }
  }
  return next;
}

const originalLoadScene = KyxosViewer.prototype.loadScene;
KyxosViewer.prototype.loadScene = async function loadSceneWithLighting(
  contract: KyxosSceneContract,
  resolver: AssetResolver,
): Promise<void> {
  await originalLoadScene.call(this, contract, resolver);
  this.setLighting(contract.lights ?? []);
};

const originalApplyScenePatch = KyxosViewer.prototype.applyScenePatch;
KyxosViewer.prototype.applyScenePatch = async function applyScenePatchWithLighting(
  patch: ScenePatch,
): Promise<void> {
  await originalApplyScenePatch.call(this, patch);
  if (patch.some((operation) => operation.path.startsWith('/lights'))) {
    const next = applyLightPatch(state(this).lights, patch);
    this.setLighting(next);
  }
};

declare module './KyxosViewer' {
  interface KyxosViewer {
    setLighting(lights: SceneLight[]): void;
  }
}
