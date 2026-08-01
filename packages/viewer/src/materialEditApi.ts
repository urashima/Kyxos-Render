import type { SceneMaterial } from '@kyxos/scene-contract';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';

type SetMaterial = (
  this: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
) => Promise<void>;

interface ViewerPrototypeInternals {
  setMaterial?: SetMaterial;
  __kyxosMaterialEditApiInstalled?: boolean;
}

interface ViewerInternals {
  modelRoot?: Object3D;
}

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function materialBindings(root: Object3D): MeshStandardMaterial[] {
  const bindings: MeshStandardMaterial[] = [];
  root.traverse((entry) => {
    const mesh = entry as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const value of materials) {
      const material = value as MeshStandardMaterial;
      if (material.isMeshStandardMaterial || (material as any).isMeshPhysicalMaterial) {
        bindings.push(material);
      }
    }
  });
  return bindings;
}

function findAuthoredObject(viewer: KyxosViewer, nodeId: string): Object3D | null {
  const root = internals(viewer).modelRoot;
  if (!root) return null;
  let match: Object3D | null = null;
  root.traverse((entry) => {
    if (!match && entry.userData.kyxosNodeId === nodeId) match = entry;
  });
  return match;
}

/**
 * Completes the scene material edit transaction for WebGPU authoring.
 *
 * sceneApi owns canonical material assignment and texture loading. This small
 * extension runs after that operation, marks the concrete runtime material as
 * authored, exposes deterministic diagnostics to Studio tests and rebuilds the
 * render graph so node-material/MRT pipelines cannot keep stale material state.
 */
export function installMaterialEditApi(ViewerClass: typeof KyxosViewer): void {
  const prototype = ViewerClass.prototype as unknown as ViewerPrototypeInternals;
  if (prototype.__kyxosMaterialEditApiInstalled) return;

  const originalSetMaterial = prototype.setMaterial;
  if (typeof originalSetMaterial !== 'function') {
    throw new Error('Scene material API must be installed before material edit API.');
  }

  prototype.setMaterial = async function setAuthoredMaterial(
    nodeId: string,
    slot: number,
    material: SceneMaterial,
  ): Promise<void> {
    await originalSetMaterial.call(this, nodeId, slot, material);

    const object = findAuthoredObject(this, nodeId);
    const runtimeMaterial = object ? materialBindings(object)[slot] : undefined;
    if (runtimeMaterial) {
      runtimeMaterial.name = material.name;
      runtimeMaterial.userData.kyxosMaterialId = material.id;
      runtimeMaterial.userData.kyxosMaterialRevision =
        Number(runtimeMaterial.userData.kyxosMaterialRevision ?? 0) + 1;
      runtimeMaterial.needsUpdate = true;
    }

    this.canvas.dataset.materialNode = nodeId;
    this.canvas.dataset.materialSlot = String(slot);
    this.canvas.dataset.materialId = material.id;
    this.canvas.dataset.materialName = material.name;
    this.canvas.dataset.materialRevision = String(
      Number(this.canvas.dataset.materialRevision ?? 0) + 1,
    );
    this.resetTemporal('scene-material');
  };

  prototype.__kyxosMaterialEditApiInstalled = true;
}

installMaterialEditApi(KyxosViewer);
