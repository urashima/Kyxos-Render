import type { Material, Object3D, Texture } from 'three/webgpu';

function disposeMaterial(material: Material) {
  const values = Object.values(material as unknown as Record<string, unknown>);
  for (const value of values) {
    if (value && typeof value === 'object' && (value as Texture).isTexture) {
      (value as Texture).dispose();
    }
  }
  material.dispose();
}

export function disposeObject3D(root: Object3D) {
  root.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      for (const material of object.material) disposeMaterial(material);
    } else if (object.material) {
      disposeMaterial(object.material);
    }
  });
}

export function disposeUnknown(value: unknown) {
  if (value && typeof value === 'object' && 'dispose' in value) {
    try {
      (value as { dispose: () => void }).dispose();
    } catch {
      // Best-effort cleanup for optional upstream nodes.
    }
  }
}
