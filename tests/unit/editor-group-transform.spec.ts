import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { calculateEditorGroupLocalMatrix } from '../../packages/viewer/src/editorGroupTransformMath';

function matrix(
  position: THREE.Vector3,
  rotation = new THREE.Quaternion(),
  scale = new THREE.Vector3(1, 1, 1),
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(position, rotation, scale);
}

function decompose(value: THREE.Matrix4) {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  value.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

describe('native multi-selection group transform math', () => {
  it('converts a translated center pivot into each root local space', () => {
    const parentWorld = matrix(new THREE.Vector3(10, 0, 0));
    const startObjectWorld = parentWorld.clone().multiply(
      matrix(new THREE.Vector3(2, 0, 0)),
    );
    const result = decompose(calculateEditorGroupLocalMatrix(
      parentWorld.clone().invert(),
      matrix(new THREE.Vector3(11, 0, 0)),
      matrix(new THREE.Vector3(14, 0, 0)),
      startObjectWorld,
    ));

    expect(result.position.x).toBeCloseTo(5);
    expect(result.position.y).toBeCloseTo(0);
    expect(result.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('rotates selected roots around the chosen pivot without double-applying the parent', () => {
    const parentWorld = matrix(new THREE.Vector3(10, 0, 0));
    const startPivot = matrix(new THREE.Vector3(11, 0, 0));
    const currentPivot = matrix(
      new THREE.Vector3(11, 0, 0),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI / 2,
      ),
    );
    const startObjectWorld = matrix(new THREE.Vector3(12, 0, 0));
    const result = decompose(calculateEditorGroupLocalMatrix(
      parentWorld.clone().invert(),
      startPivot,
      currentPivot,
      startObjectWorld,
    ));

    expect(result.position.x).toBeCloseTo(1);
    expect(result.position.y).toBeCloseTo(1);
    const euler = new THREE.Euler().setFromQuaternion(result.rotation);
    expect(euler.z).toBeCloseTo(Math.PI / 2);
  });
});
