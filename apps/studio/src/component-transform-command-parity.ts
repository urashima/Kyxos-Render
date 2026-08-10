import { CommandBus, type EditorCommand } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneCamera,
  SceneLight,
  SceneNode,
  ScenePatch,
} from '@kyxos/scene-contract';

import { shiftCameraTarget, targetFromRotation } from './camera-orientation-math';

interface CommandBusPrototype {
  execute(command: EditorCommand): void;
  __kyxosComponentTransformParityInstalled?: boolean;
}

interface CameraDraft {
  cameraIndex: number;
  camera: SceneCamera;
  positionChanged: boolean;
  rotationChanged: boolean;
}

const TRANSFORM_PATH = /^\/nodes\/(\d+)\/transform\/(position|rotation)\/(x|y|z)$/;
const COMPONENT_ADD_LABEL = /^Add (Camera|Directional Light|Point Light|Spot Light)$/;

function changedNumber(previous: number, next: unknown): boolean {
  return typeof next === 'number' && Math.abs(previous - next) > 1e-9;
}

function appendReplace(next: ScenePatch, seen: Set<string>, path: string, value: unknown): void {
  if (seen.has(path)) return;
  next.push({ op: 'replace', path, value });
  seen.add(path);
}

function augmentComponentTransforms(scene: KyxosSceneContract, patch: ScenePatch): ScenePatch {
  const next: ScenePatch = [...patch];
  const seen = new Set(
    patch
      .filter((operation) => operation.op === 'replace' || operation.op === 'add')
      .map((operation) => operation.path),
  );
  const cameraDrafts = new Map<number, CameraDraft>();

  for (const operation of patch) {
    if (operation.op !== 'replace' && operation.op !== 'add') continue;
    const match = TRANSFORM_PATH.exec(operation.path);
    if (!match) continue;

    const nodeIndex = Number(match[1]);
    const group = match[2] as 'position' | 'rotation';
    const axis = match[3] as 'x' | 'y' | 'z';
    const node = scene.nodes[nodeIndex];
    if (!node) continue;

    if (node.cameraId) {
      const cameraIndex = scene.cameras.findIndex((camera) => camera.id === node.cameraId);
      if (cameraIndex >= 0) {
        const camera = scene.cameras[cameraIndex];
        const draft = cameraDrafts.get(cameraIndex) ?? {
          cameraIndex,
          camera: structuredClone(camera),
          positionChanged: false,
          rotationChanged: false,
        };
        const previous = camera.transform[group][axis];
        const value = Number(operation.value);
        draft.camera.transform[group][axis] = value;
        if (group === 'position' && changedNumber(previous, operation.value)) draft.positionChanged = true;
        if (group === 'rotation' && changedNumber(previous, operation.value)) draft.rotationChanged = true;
        cameraDrafts.set(cameraIndex, draft);
        appendReplace(
          next,
          seen,
          `/cameras/${cameraIndex}/transform/${group}/${axis}`,
          operation.value,
        );
      }
    }

    if (node.lightId && scene.lights) {
      const lightIndex = scene.lights.findIndex((light) => light.id === node.lightId);
      if (lightIndex >= 0) {
        appendReplace(
          next,
          seen,
          `/lights/${lightIndex}/transform/${group}/${axis}`,
          operation.value,
        );
      }
    }
  }

  for (const draft of cameraDrafts.values()) {
    const original = scene.cameras[draft.cameraIndex];
    if (!original) continue;
    const target = draft.rotationChanged
      ? targetFromRotation(draft.camera.transform, original.transform.position, original.target)
      : draft.positionChanged
        ? shiftCameraTarget(original.transform.position, draft.camera.transform.position, original.target)
        : null;
    if (!target) continue;
    for (const axis of ['x', 'y', 'z'] as const) {
      appendReplace(next, seen, `/cameras/${draft.cameraIndex}/target/${axis}`, target[axis]);
    }
  }

  return next;
}

function arrayValue<T>(patch: ScenePatch, path: string): T[] | null {
  const operation = patch.find((entry) => entry.path === path && (entry.op === 'replace' || entry.op === 'add'));
  return operation && Array.isArray(operation.value) ? operation.value as T[] : null;
}

function normalizeAddedComponentNodeTransforms(
  scene: KyxosSceneContract,
  patch: ScenePatch,
): ScenePatch {
  const nodes = arrayValue<SceneNode>(patch, '/nodes');
  if (!nodes) return patch;

  const cameras = arrayValue<SceneCamera>(patch, '/cameras') ?? scene.cameras;
  const lights = arrayValue<SceneLight>(patch, '/lights') ?? scene.lights ?? [];
  const cameraById = new Map(cameras.map((camera) => [camera.id, camera]));
  const lightById = new Map(lights.map((light) => [light.id, light]));
  const existing = new Set(scene.nodes.map((node) => node.id));
  let changed = false;

  const normalizedNodes = nodes.map((node) => {
    if (existing.has(node.id)) return node;
    const camera = node.cameraId ? cameraById.get(node.cameraId) : undefined;
    const light = node.lightId ? lightById.get(node.lightId) : undefined;
    const componentTransform = camera?.transform ?? light?.transform;
    if (!componentTransform) return node;
    changed = true;
    return {
      ...node,
      transform: structuredClone(componentTransform),
    };
  });

  if (!changed) return patch;
  return patch.map((operation) =>
    operation.path === '/nodes' && (operation.op === 'replace' || operation.op === 'add')
      ? { ...operation, value: normalizedNodes }
      : operation,
  );
}

export function installComponentTransformCommandParity(): void {
  const prototype = CommandBus.prototype as unknown as CommandBusPrototype;
  if (prototype.__kyxosComponentTransformParityInstalled) return;
  const originalExecute = prototype.execute;

  prototype.execute = function executeWithComponentTransformParity(command: EditorCommand): void {
    const isViewportTransform = command.id === 'viewport-gizmo-transform';
    const isComponentAdd = COMPONENT_ADD_LABEL.test(command.label);
    if (!isViewportTransform && !isComponentAdd) {
      originalExecute.call(this, command);
      return;
    }

    const wrapped: EditorCommand = {
      ...command,
      patch(scene) {
        let patch = command.patch(scene);
        if (isComponentAdd) patch = normalizeAddedComponentNodeTransforms(scene, patch);
        if (isViewportTransform) patch = augmentComponentTransforms(scene, patch);
        return patch;
      },
    };
    originalExecute.call(this, wrapped);
  };

  prototype.__kyxosComponentTransformParityInstalled = true;
}

installComponentTransformCommandParity();