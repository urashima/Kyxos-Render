import type { SceneMaterial, TextureRef } from '@kyxos/scene-contract';
import * as THREE from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';

type TextureField =
  | 'baseColorTexture'
  | 'metalnessTexture'
  | 'roughnessTexture'
  | 'normalTexture'
  | 'emissiveTexture'
  | 'aoTexture'
  | 'clearcoatTexture'
  | 'clearcoatRoughnessTexture'
  | 'transmissionTexture'
  | 'thicknessTexture';

type RuntimeTextureProperty =
  | 'map'
  | 'metalnessMap'
  | 'roughnessMap'
  | 'normalMap'
  | 'emissiveMap'
  | 'aoMap'
  | 'clearcoatMap'
  | 'clearcoatRoughnessMap'
  | 'transmissionMap'
  | 'thicknessMap';

const textureBindings: ReadonlyArray<readonly [TextureField, RuntimeTextureProperty]> = [
  ['baseColorTexture', 'map'],
  ['metalnessTexture', 'metalnessMap'],
  ['roughnessTexture', 'roughnessMap'],
  ['normalTexture', 'normalMap'],
  ['emissiveTexture', 'emissiveMap'],
  ['aoTexture', 'aoMap'],
  ['clearcoatTexture', 'clearcoatMap'],
  ['clearcoatRoughnessTexture', 'clearcoatRoughnessMap'],
  ['transmissionTexture', 'transmissionMap'],
  ['thicknessTexture', 'thicknessMap'],
];

type SetMaterial = (
  this: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
) => Promise<void>;

interface ViewerPrototype {
  setMaterial?: SetMaterial;
  __kyxosEmbeddedGltfTextureApiInstalled?: boolean;
}

interface ViewerInternals {
  modelRoot?: THREE.Object3D;
  gltfNativeTextures?: Map<number, THREE.Texture>;
}

interface MaterialBinding {
  owner: THREE.Mesh;
  index: number;
  material: THREE.MeshStandardMaterial;
}

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function embeddedTextureIndex(reference: TextureRef | undefined): number | null {
  if (!reference?.assetId.startsWith('embedded-gltf-texture:')) return null;
  const match = reference.assetId.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
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

function materialBindings(root: THREE.Object3D): MaterialBinding[] {
  const bindings: MaterialBinding[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((entry, index) => {
      const material = entry as THREE.MeshStandardMaterial;
      if (material.isMeshStandardMaterial || (material as any).isMeshPhysicalMaterial) {
        bindings.push({ owner: mesh, index, material });
      }
    });
  });
  return bindings;
}

function stripEmbeddedReferences(material: SceneMaterial): SceneMaterial {
  const copy = structuredClone(material) as SceneMaterial & Partial<Record<TextureField, TextureRef>>;
  for (const [field] of textureBindings) {
    if (embeddedTextureIndex(copy[field]) != null) delete copy[field];
  }
  return copy;
}

function applyReference(texture: THREE.Texture, reference: TextureRef): void {
  texture.userData = {
    ...texture.userData,
    kyxosManagedTexture: true,
  };
  texture.colorSpace = reference.colorSpace === 'srgb'
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace;
  texture.channel = Math.max(0, Math.trunc(reference.texCoord ?? 0));
  const wrapping = {
    repeat: THREE.RepeatWrapping,
    clamp: THREE.ClampToEdgeWrapping,
    mirror: THREE.MirroredRepeatWrapping,
  } as const;
  texture.wrapS = wrapping[reference.wrapS ?? 'repeat'];
  texture.wrapT = wrapping[reference.wrapT ?? 'repeat'];
  const minFilters: Record<string, THREE.MinificationTextureFilter> = {
    nearest: THREE.NearestFilter,
    linear: THREE.LinearFilter,
    nearestMipNearest: THREE.NearestMipmapNearestFilter,
    linearMipNearest: THREE.LinearMipmapNearestFilter,
    nearestMipLinear: THREE.NearestMipmapLinearFilter,
    linearMipLinear: THREE.LinearMipmapLinearFilter,
  };
  const magFilters: Record<string, THREE.MagnificationTextureFilter> = {
    nearest: THREE.NearestFilter,
    linear: THREE.LinearFilter,
  };
  texture.minFilter = minFilters[reference.minFilter ?? 'linearMipLinear']
    ?? THREE.LinearMipmapLinearFilter;
  texture.magFilter = magFilters[reference.magFilter ?? 'linear'] ?? THREE.LinearFilter;
  texture.offset.set(reference.offset?.x ?? 0, reference.offset?.y ?? 0);
  texture.repeat.set(reference.scale?.x ?? 1, reference.scale?.y ?? 1);
  texture.rotation = reference.rotation ?? 0;
  texture.needsUpdate = true;
}

function replaceTexture(
  material: THREE.MeshStandardMaterial,
  property: RuntimeTextureProperty,
  texture: THREE.Texture,
): void {
  const candidate = material as THREE.MeshStandardMaterial & Record<string, unknown>;
  const previous = candidate[property] as THREE.Texture | null | undefined;
  if (previous?.userData.kyxosManagedTexture && previous !== texture) previous.dispose();
  candidate[property] = texture;
}

function restoreEmbeddedReferences(
  viewer: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
): number {
  const object = authoredObject(viewer, nodeId);
  const binding = object ? materialBindings(object)[slot] : undefined;
  if (!binding) return 0;
  const registry = internals(viewer).gltfNativeTextures;
  if (!registry) return 0;
  const source = material as SceneMaterial & Partial<Record<TextureField, TextureRef>>;
  let restored = 0;

  for (const [field, property] of textureBindings) {
    const reference = source[field];
    const index = embeddedTextureIndex(reference);
    const native = index == null ? undefined : registry.get(index);
    if (!reference || !native) continue;
    const texture = native.clone();
    texture.userData.gltfTextureIndex = index;
    applyReference(texture, reference);
    replaceTexture(binding.material, property, texture);
    restored += 1;
  }
  if (restored) binding.material.needsUpdate = true;
  return restored;
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype.__kyxosEmbeddedGltfTextureApiInstalled) {
  const originalSetMaterial = prototype.setMaterial;
  if (typeof originalSetMaterial !== 'function') {
    throw new Error('Scene material API must be installed before embedded glTF texture support.');
  }

  prototype.setMaterial = async function setMaterialWithEmbeddedGltfTextures(
    this: KyxosViewer,
    nodeId: string,
    slot: number,
    material: SceneMaterial,
  ): Promise<void> {
    await originalSetMaterial.call(this, nodeId, slot, stripEmbeddedReferences(material));
    const restored = restoreEmbeddedReferences(this, nodeId, slot, material);
    if (restored) {
      this.canvas.dataset.embeddedGltfTextures = String(restored);
    }
  };

  prototype.__kyxosEmbeddedGltfTextureApiInstalled = true;
}
