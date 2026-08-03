import * as THREE from 'three/webgpu';

export type EditorVector3Tuple = [number, number, number];
export type EditorQuaternionTuple = [number, number, number, number];

export interface EditorMatrixDecomposition {
  position: EditorVector3Tuple;
  quaternion: EditorQuaternionTuple;
  scale: EditorVector3Tuple;
}

/**
 * Converts a world-space group pivot delta back into one selected root's local
 * matrix. The caller supplies the inverse parent world matrix captured at drag
 * start so nested entities remain stable while the group is manipulated.
 */
export function calculateEditorGroupLocalMatrix(
  parentWorldInverse: THREE.Matrix4,
  startPivotWorld: THREE.Matrix4,
  currentPivotWorld: THREE.Matrix4,
  startObjectWorld: THREE.Matrix4,
): THREE.Matrix4 {
  const deltaWorld = currentPivotWorld
    .clone()
    .multiply(startPivotWorld.clone().invert());
  return parentWorldInverse
    .clone()
    .multiply(deltaWorld)
    .multiply(startObjectWorld);
}

/**
 * Lightweight tuple-based helpers keep matrix tests within the Viewer package's
 * dependency boundary instead of requiring the root test workspace to depend on
 * Three.js directly.
 */
export function composeEditorTransformMatrix(
  position: EditorVector3Tuple,
  rotationZ = 0,
  scale: EditorVector3Tuple = [1, 1, 1],
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      rotationZ,
    ),
    new THREE.Vector3(...scale),
  );
}

export function invertEditorTransformMatrix(value: THREE.Matrix4): THREE.Matrix4 {
  return value.clone().invert();
}

export function multiplyEditorTransformMatrices(
  left: THREE.Matrix4,
  right: THREE.Matrix4,
): THREE.Matrix4 {
  return left.clone().multiply(right);
}

export function decomposeEditorTransformMatrix(
  value: THREE.Matrix4,
): EditorMatrixDecomposition {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  value.decompose(position, quaternion, scale);
  return {
    position: position.toArray() as EditorVector3Tuple,
    quaternion: quaternion.toArray() as EditorQuaternionTuple,
    scale: scale.toArray() as EditorVector3Tuple,
  };
}

export function editorQuaternionRotationZ(
  quaternion: EditorQuaternionTuple,
): number {
  return new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(...quaternion),
  ).z;
}
