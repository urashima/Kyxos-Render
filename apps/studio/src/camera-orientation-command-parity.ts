import { CommandBus, type EditorCommand } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneCamera,
  SceneNode,
  ScenePatch,
} from '@kyxos/scene-contract';

import {
  rotationFromTarget,
  shiftCameraTarget,
  targetFromRotation,
} from './camera-orientation-math';

interface CommandBusPrototype {
  execute(command: EditorCommand): void;
  __kyxosCameraOrientationParityInstalled?: boolean;
}

interface CameraEditDraft {
  index: number;
  original: SceneCamera;
  next: SceneCamera;
  positionChanged: boolean;
  rotationChanged: boolean;
  targetChanged: boolean;
}

const CAMERA_FIELD = /^\/cameras\/(\d+)\/(transform\/(position|rotation)\/(x|y|z)|target\/(x|y|z))$/;

function wholeArray<T>(patch: ScenePatch, path: string): { index: number; value: T[] } | null {
  const index = patch.findIndex((operation) =>
    operation.path === path &&
    (operation.op === 'replace' || operation.op === 'add') &&
    Array.isArray(operation.value),
  );
  if (index < 0) return null;
  return { index, value: patch[index].value as T[] };
}

function normalizeNewCameras(scene: KyxosSceneContract, patch: ScenePatch): ScenePatch {
  const cameraArray = wholeArray<SceneCamera>(patch, '/cameras');
  if (!cameraArray) return patch;
  const existing = new Set(scene.cameras.map((camera) => camera.id));
  let changed = false;
  const cameras = cameraArray.value.map((camera) => {
    if (existing.has(camera.id)) return camera;
    changed = true;
    return {
      ...structuredClone(camera),
      transform: {
        ...structuredClone(camera.transform),
        rotation: rotationFromTarget(camera.transform.position, camera.target),
      },
    };
  });
  if (!changed) return patch;
  const next = patch.map((operation, index) => index === cameraArray.index
    ? { ...operation, value: cameras }
    : operation);

  const nodeArray = wholeArray<SceneNode>(next, '/nodes');
  if (!nodeArray) return next;
  const byCamera = new Map(cameras.map((camera) => [camera.id, camera]));
  next[nodeArray.index] = {
    ...next[nodeArray.index],
    value: nodeArray.value.map((node) => {
      const camera = node.cameraId ? byCamera.get(node.cameraId) : undefined;
      if (!camera || scene.nodes.some((entry) => entry.id === node.id)) return node;
      return { ...node, transform: structuredClone(camera.transform) };
    }),
  };
  return next;
}

function draftCameraEdits(scene: KyxosSceneContract, patch: ScenePatch): Map<number, CameraEditDraft> {
  const drafts = new Map<number, CameraEditDraft>();
  for (const operation of patch) {
    if ((operation.op !== 'replace' && operation.op !== 'add') || typeof operation.value !== 'number') continue;
    const match = CAMERA_FIELD.exec(operation.path);
    if (!match) continue;
    const index = Number(match[1]);
    const original = scene.cameras[index];
    if (!original) continue;
    const draft = drafts.get(index) ?? {
      index,
      original,
      next: structuredClone(original),
      positionChanged: false,
      rotationChanged: false,
      targetChanged: false,
    };
    const group = match[3] as 'position' | 'rotation' | undefined;
    const transformAxis = match[4] as 'x' | 'y' | 'z' | undefined;
    const targetAxis = match[5] as 'x' | 'y' | 'z' | undefined;
    if (group && transformAxis) {
      const previous = original.transform[group][transformAxis];
      draft.next.transform[group][transformAxis] = operation.value;
      const changed = Math.abs(previous - operation.value) > 1e-9;
      if (group === 'position' && changed) draft.positionChanged = true;
      if (group === 'rotation' && changed) draft.rotationChanged = true;
    } else if (targetAxis) {
      const previous = original.target[targetAxis];
      draft.next.target[targetAxis] = operation.value;
      if (Math.abs(previous - operation.value) > 1e-9) draft.targetChanged = true;
    }
    drafts.set(index, draft);
  }
  return drafts;
}

function upsertDerived(
  patch: ScenePatch,
  explicit: Set<string>,
  path: string,
  value: number,
): void {
  if (explicit.has(path)) return;
  patch.push({ op: 'replace', path, value });
}

function synchronizeDirectCameraEdits(scene: KyxosSceneContract, patch: ScenePatch): ScenePatch {
  const next: ScenePatch = [...patch];
  const explicit = new Set(patch.map((operation) => operation.path));
  for (const draft of draftCameraEdits(scene, patch).values()) {
    if (draft.targetChanged && draft.rotationChanged) continue;

    if (draft.targetChanged) {
      const rotation = rotationFromTarget(draft.next.transform.position, draft.next.target);
      for (const axis of ['x', 'y', 'z'] as const) {
        upsertDerived(next, explicit, `/cameras/${draft.index}/transform/rotation/${axis}`, rotation[axis]);
      }
      continue;
    }

    let target = null;
    if (draft.rotationChanged) {
      target = targetFromRotation(
        draft.next.transform,
        draft.original.transform.position,
        draft.original.target,
      );
    } else if (draft.positionChanged) {
      target = shiftCameraTarget(
        draft.original.transform.position,
        draft.next.transform.position,
        draft.original.target,
      );
    }
    if (!target) continue;
    for (const axis of ['x', 'y', 'z'] as const) {
      upsertDerived(next, explicit, `/cameras/${draft.index}/target/${axis}`, target[axis]);
    }
  }
  return next;
}

function synchronizeCameraOrientation(scene: KyxosSceneContract, patch: ScenePatch): ScenePatch {
  return synchronizeDirectCameraEdits(scene, normalizeNewCameras(scene, patch));
}

export function installCameraOrientationCommandParity(): void {
  const prototype = CommandBus.prototype as unknown as CommandBusPrototype;
  if (prototype.__kyxosCameraOrientationParityInstalled) return;
  const originalExecute = prototype.execute;

  prototype.execute = function executeWithCameraOrientationParity(command: EditorCommand): void {
    const wrapped: EditorCommand = {
      ...command,
      patch(scene) {
        return synchronizeCameraOrientation(scene, command.patch(scene));
      },
    };
    originalExecute.call(this, wrapped);
  };

  prototype.__kyxosCameraOrientationParityInstalled = true;
}

installCameraOrientationCommandParity();