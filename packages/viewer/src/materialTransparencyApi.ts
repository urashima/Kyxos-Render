import type { SceneMaterial } from '@kyxos/scene-contract';
import * as THREE from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';

type SetMaterial = (
  this: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
) => Promise<void>;

interface ViewerPrototype {
  setMaterial?: SetMaterial;
  __kyxosMaterialTransparencyInstalled?: boolean;
}

interface ViewerInternals {
  modelRoot?: THREE.Object3D;
}

interface MaterialBinding {
  owner: THREE.Mesh;
  material: THREE.Material;
}

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function clamp01(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function authoredObject(viewer: KyxosViewer, nodeId: string): THREE.Object3D | null {
  const root = internals(viewer).modelRoot;
  if (!root) return null;
  let match: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.userData.kyxosNodeId === nodeId) match = object;
  });
  return match;
}

function bindingFor(
  viewer: KyxosViewer,
  nodeId: string,
  slot: number,
): MaterialBinding | null {
  const object = authoredObject(viewer, nodeId);
  if (!object) return null;
  const bindings: MaterialBinding[] = [];
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => bindings.push({ owner: mesh, material }));
  });
  return bindings[slot] ?? (slot === 0 ? bindings[0] : null) ?? null;
}

function applyAlphaSurface(
  binding: MaterialBinding,
  source: SceneMaterial,
): void {
  const material = binding.material as THREE.Material & {
    alphaHash?: boolean;
    alphaToCoverage?: boolean;
    forceSinglePass?: boolean;
  };
  const mode = source.alphaMode ?? 'opaque';
  const authoredOpacity = clamp01(source.opacity, clamp01(source.baseColor?.w, 1));

  material.alphaHash = false;
  material.depthTest = true;
  material.colorWrite = true;
  material.blending = THREE.NormalBlending;
  material.premultipliedAlpha = false;
  material.side = source.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

  if (mode === 'blend') {
    material.opacity = authoredOpacity;
    material.transparent = true;
    material.alphaTest = 0;
    material.depthWrite = false;
    material.alphaToCoverage = false;
    // Keep the correct two-pass path for double-sided transparent surfaces.
    material.forceSinglePass = !source.doubleSided;
  } else if (mode === 'mask') {
    material.opacity = authoredOpacity;
    material.transparent = false;
    material.alphaTest = clamp01(source.alphaCutoff, 0.5);
    material.depthWrite = true;
    material.alphaToCoverage = true;
    material.forceSinglePass = false;
  } else {
    // glTF OPAQUE explicitly ignores base-color alpha.
    material.opacity = 1;
    material.transparent = false;
    material.alphaTest = 0;
    material.depthWrite = true;
    material.alphaToCoverage = false;
    material.forceSinglePass = false;
  }

  material.userData.kyxosAlphaMode = mode;
  material.userData.kyxosAuthoredOpacity = authoredOpacity;
  material.needsUpdate = true;
  binding.owner.renderOrder = mode === 'blend' ? 1 : 0;
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype.__kyxosMaterialTransparencyInstalled) {
  const originalSetMaterial = prototype.setMaterial;
  if (typeof originalSetMaterial !== 'function') {
    throw new Error('Complete material API must be installed before transparency support.');
  }

  prototype.setMaterial = async function setMaterialWithTransparency(
    nodeId: string,
    slot: number,
    material: SceneMaterial,
  ): Promise<void> {
    await originalSetMaterial.call(this, nodeId, slot, material);
    const binding = bindingFor(this, nodeId, slot);
    if (!binding) return;
    applyAlphaSurface(binding, material);
    this.canvas.dataset.materialAlphaMode = material.alphaMode ?? 'opaque';
    this.canvas.dataset.materialOpacity = String(
      clamp01(material.opacity, clamp01(material.baseColor?.w, 1)),
    );
    this.canvas.dataset.materialDepthWrite = String(binding.material.depthWrite);
    this.resetTemporal('material-alpha-surface');
  };

  prototype.__kyxosMaterialTransparencyInstalled = true;
}
