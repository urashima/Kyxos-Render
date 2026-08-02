import * as THREE from 'three/webgpu';

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
