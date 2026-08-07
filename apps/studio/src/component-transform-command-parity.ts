import { CommandBus, type EditorCommand } from '@kyxos/editor-core';
import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';

interface CommandBusPrototype {
  execute(command: EditorCommand): void;
  __kyxosComponentTransformParityInstalled?: boolean;
}

const TRANSFORM_PATH = /^\/nodes\/(\d+)\/transform\/(position|rotation)\/(x|y|z)$/;

function augmentComponentTransforms(scene: KyxosSceneContract, patch: ScenePatch): ScenePatch {
  const next: ScenePatch = [...patch];
  const seen = new Set<string>();

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
        const path = `/cameras/${cameraIndex}/transform/${group}/${axis}`;
        if (!seen.has(path)) {
          next.push({ op: 'replace', path, value: operation.value });
          seen.add(path);
        }
      }
    }

    if (node.lightId && scene.lights) {
      const lightIndex = scene.lights.findIndex((light) => light.id === node.lightId);
      if (lightIndex >= 0) {
        const path = `/lights/${lightIndex}/transform/${group}/${axis}`;
        if (!seen.has(path)) {
          next.push({ op: 'replace', path, value: operation.value });
          seen.add(path);
        }
      }
    }
  }

  return next;
}

export function installComponentTransformCommandParity(): void {
  const prototype = CommandBus.prototype as unknown as CommandBusPrototype;
  if (prototype.__kyxosComponentTransformParityInstalled) return;
  const originalExecute = prototype.execute;

  prototype.execute = function executeWithComponentTransformParity(command: EditorCommand): void {
    if (command.id !== 'viewport-gizmo-transform') {
      originalExecute.call(this, command);
      return;
    }

    const wrapped: EditorCommand = {
      ...command,
      patch(scene) {
        return augmentComponentTransforms(scene, command.patch(scene));
      },
    };
    originalExecute.call(this, wrapped);
  };

  prototype.__kyxosComponentTransformParityInstalled = true;
}

installComponentTransformCommandParity();
