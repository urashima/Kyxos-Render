import { describe, expect, it } from 'vitest';

import {
  calculateEditorGroupLocalMatrix,
  composeEditorTransformMatrix,
  decomposeEditorTransformMatrix,
  editorQuaternionRotationZ,
  invertEditorTransformMatrix,
  multiplyEditorTransformMatrices,
} from '../../packages/viewer/src/editorGroupTransformMath';

describe('native multi-selection group transform math', () => {
  it('converts a translated center pivot into each root local space', () => {
    const parentWorld = composeEditorTransformMatrix([10, 0, 0]);
    const startObjectWorld = multiplyEditorTransformMatrices(
      parentWorld,
      composeEditorTransformMatrix([2, 0, 0]),
    );
    const result = decomposeEditorTransformMatrix(calculateEditorGroupLocalMatrix(
      invertEditorTransformMatrix(parentWorld),
      composeEditorTransformMatrix([11, 0, 0]),
      composeEditorTransformMatrix([14, 0, 0]),
      startObjectWorld,
    ));

    expect(result.position[0]).toBeCloseTo(5);
    expect(result.position[1]).toBeCloseTo(0);
    expect(result.scale).toEqual([1, 1, 1]);
  });

  it('rotates selected roots around the chosen pivot without double-applying the parent', () => {
    const parentWorld = composeEditorTransformMatrix([10, 0, 0]);
    const startPivot = composeEditorTransformMatrix([11, 0, 0]);
    const currentPivot = composeEditorTransformMatrix(
      [11, 0, 0],
      Math.PI / 2,
    );
    const startObjectWorld = composeEditorTransformMatrix([12, 0, 0]);
    const result = decomposeEditorTransformMatrix(calculateEditorGroupLocalMatrix(
      invertEditorTransformMatrix(parentWorld),
      startPivot,
      currentPivot,
      startObjectWorld,
    ));

    expect(result.position[0]).toBeCloseTo(1);
    expect(result.position[1]).toBeCloseTo(1);
    expect(editorQuaternionRotationZ(result.quaternion)).toBeCloseTo(Math.PI / 2);
  });
});
