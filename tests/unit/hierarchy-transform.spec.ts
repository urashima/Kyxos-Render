import { describe, expect, it } from 'vitest';

import {
  composeTransform,
  decomposeTransform,
  localTransformForWorld,
  multiplyMatrix4,
  worldMatrixMap,
} from '@kyxos/editor-core/hierarchy-transform';
import type { SceneNode, Transform } from '@kyxos/scene-contract';

const closeTransform = (actual: Transform, expected: Transform): void => {
  for (const group of ['position', 'rotation', 'scale'] as const) {
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(actual[group][axis]).toBeCloseTo(expected[group][axis], 6);
    }
  }
};

const node = (
  id: string,
  parentId: string | null,
  transform: Transform,
): SceneNode => ({
  id,
  name: id,
  parentId,
  children: [],
  transform,
  visible: true,
});

describe('hierarchy transform math', () => {
  it('round-trips position, XYZ Euler rotation and scale', () => {
    const transform: Transform = {
      position: { x: 2.5, y: -1.25, z: 8 },
      rotation: { x: 0.35, y: -0.8, z: 1.1 },
      scale: { x: 1.5, y: 0.75, z: 2.2 },
    };
    closeTransform(decomposeTransform(composeTransform(transform)), transform);
  });

  it('derives a new local transform that preserves a child world matrix', () => {
    const oldParent = node('old-parent', null, {
      position: { x: 4, y: 1, z: -2 },
      rotation: { x: 0.1, y: 0.45, z: -0.2 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    });
    const newParent = node('new-parent', null, {
      position: { x: -3, y: 2, z: 5 },
      rotation: { x: -0.25, y: 0.3, z: 0.4 },
      scale: { x: 0.8, y: 0.8, z: 0.8 },
    });
    const child = node('child', oldParent.id, {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0.2, y: -0.1, z: 0.6 },
      scale: { x: 1, y: 1, z: 1 },
    });
    oldParent.children = [child.id];
    const before = worldMatrixMap([oldParent, newParent, child]).get(child.id)!;
    const parentWorld = worldMatrixMap([oldParent, newParent, child]).get(newParent.id)!;
    const local = localTransformForWorld(before, parentWorld)!;
    const after = multiplyMatrix4(parentWorld, composeTransform(local));
    for (let index = 0; index < 16; index += 1) {
      expect(after[index]).toBeCloseTo(before[index], 6);
    }
  });

  it('resolves nested parent matrices deterministically', () => {
    const root = node('root', null, {
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0.5, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const parent = node('parent', root.id, {
      position: { x: 0, y: 3, z: 0 },
      rotation: { x: 0.25, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const child = node('child', parent.id, {
      position: { x: 0, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0.75 },
      scale: { x: 1, y: 1, z: 1 },
    });
    root.children = [parent.id];
    parent.children = [child.id];
    const matrices = worldMatrixMap([root, parent, child]);
    const expected = multiplyMatrix4(
      multiplyMatrix4(composeTransform(root.transform), composeTransform(parent.transform)),
      composeTransform(child.transform),
    );
    const actual = matrices.get(child.id)!;
    for (let index = 0; index < 16; index += 1) {
      expect(actual[index]).toBeCloseTo(expected[index], 6);
    }
  });
});
