import type {
  AssetResolver,
  KyxosSceneContract,
  SceneMaterial,
  TextureRef,
  Vec3,
} from '@kyxos/scene-contract';
import * as THREE from 'three/webgpu';

import { KyxosViewer } from './KyxosViewer';

type CompleteSceneMaterial = SceneMaterial & {
  unlit?: boolean;
  aoIntensity?: number;
  clearcoatNormalTexture?: TextureRef;
  clearcoatNormalScale?: number;
  sheenColorTexture?: TextureRef;
  sheenRoughnessTexture?: TextureRef;
  specularTexture?: TextureRef;
  specularColorTexture?: TextureRef;
  iridescence?: number;
  iridescenceTexture?: TextureRef;
  iridescenceIor?: number;
  iridescenceThicknessMinimum?: number;
  iridescenceThicknessMaximum?: number;
  iridescenceThicknessTexture?: TextureRef;
  anisotropy?: number;
  anisotropyRotation?: number;
  anisotropyTexture?: TextureRef;
  dispersion?: number;
};

type CompleteTextureField =
  | 'baseColorTexture'
  | 'clearcoatTexture'
  | 'clearcoatRoughnessTexture'
  | 'clearcoatNormalTexture'
  | 'transmissionTexture'
  | 'thicknessTexture'
  | 'sheenColorTexture'
  | 'sheenRoughnessTexture'
  | 'specularTexture'
  | 'specularColorTexture'
  | 'iridescenceTexture'
  | 'iridescenceThicknessTexture'
  | 'anisotropyTexture';

type RuntimeTextureProperty =
  | 'map'
  | 'clearcoatMap'
  | 'clearcoatRoughnessMap'
  | 'clearcoatNormalMap'
  | 'transmissionMap'
  | 'thicknessMap'
  | 'sheenColorMap'
  | 'sheenRoughnessMap'
  | 'specularIntensityMap'
  | 'specularColorMap'
  | 'iridescenceMap'
  | 'iridescenceThicknessMap'
  | 'anisotropyMap';

type SetMaterial = (
  this: KyxosViewer,
  nodeId: string,
  slot: number,
  material: SceneMaterial,
) => Promise<void>;

type LoadScene = (
  this: KyxosViewer,
  scene: KyxosSceneContract,
  resolver: AssetResolver,
) => Promise<void>;

interface ViewerPrototype {
  setMaterial?: SetMaterial;
  loadScene?: LoadScene;
  __kyxosCompleteMaterialApiInstalled?: boolean;
}

interface ViewerInternals {
  modelRoot?: THREE.Object3D;
  gltfNativeTextures?: Map<number, THREE.Texture>;
}

interface MaterialBinding {
  owner: THREE.Mesh;
  index: number;
  material: THREE.Material;
}

const resolverByViewer = new WeakMap<KyxosViewer, AssetResolver>();
const textureLoader = new THREE.TextureLoader();

const textureMappings: ReadonlyArray<
  readonly [CompleteTextureField, RuntimeTextureProperty]
> = [
  ['baseColorTexture', 'map'],
  ['clearcoatTexture', 'clearcoatMap'],
  ['clearcoatRoughnessTexture', 'clearcoatRoughnessMap'],
  ['clearcoatNormalTexture', 'clearcoatNormalMap'],
  ['transmissionTexture', 'transmissionMap'],
  ['thicknessTexture', 'thicknessMap'],
  ['sheenColorTexture', 'sheenColorMap'],
  ['sheenRoughnessTexture', 'sheenRoughnessMap'],
  ['specularTexture', 'specularIntensityMap'],
  ['specularColorTexture', 'specularColorMap'],
  ['iridescenceTexture', 'iridescenceMap'],
  ['iridescenceThicknessTexture', 'iridescenceThicknessMap'],
  ['anisotropyTexture', 'anisotropyMap'],
];

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: Vec3 | undefined, fallback = 1): THREE.Color {
  return new THREE.Color(
    finite(value?.x, fallback),
    finite(value?.y, fallback),
    finite(value?.z, fallback),
  );
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
    materials.forEach((material, index) => bindings.push({ owner: mesh, index, material }));
  });
  return bindings;
}

function bindingFor(
  viewer: KyxosViewer,
  nodeId: string,
  slot: number,
): MaterialBinding | null {
  const object = authoredObject(viewer, nodeId);
  if (!object) return null;
  const bindings = materialBindings(object);
  return bindings[slot] ?? (slot === 0 ? bindings[0] : null) ?? null;
}

function assignMaterial(binding: MaterialBinding, material: THREE.Material): void {
  if (Array.isArray(binding.owner.material)) {
    const materials = [...binding.owner.material];
    materials[binding.index] = material;
    binding.owner.material = materials;
  } else {
    binding.owner.material = material;
  }
  binding.material = material;
}

function copyGenericMaterial(target: THREE.Material, source: THREE.Material): void {
  target.name = source.name;
  target.blending = source.blending;
  target.side = source.side;
  target.vertexColors = source.vertexColors;
  target.opacity = source.opacity;
  target.transparent = source.transparent;
  target.alphaHash = source.alphaHash;
  target.alphaTest = source.alphaTest;
  target.depthTest = source.depthTest;
  target.depthWrite = source.depthWrite;
  target.colorWrite = source.colorWrite;
  target.stencilWrite = source.stencilWrite;
  target.stencilWriteMask = source.stencilWriteMask;
  target.stencilFunc = source.stencilFunc;
  target.stencilRef = source.stencilRef;
  target.stencilFuncMask = source.stencilFuncMask;
  target.stencilFail = source.stencilFail;
  target.stencilZFail = source.stencilZFail;
  target.stencilZPass = source.stencilZPass;
  target.polygonOffset = source.polygonOffset;
  target.polygonOffsetFactor = source.polygonOffsetFactor;
  target.polygonOffsetUnits = source.polygonOffsetUnits;
  target.dithering = source.dithering;
  target.premultipliedAlpha = source.premultipliedAlpha;
  target.forceSinglePass = source.forceSinglePass;
  target.toneMapped = source.toneMapped;
  target.userData = structuredClone(source.userData);
}

function toUnlit(source: THREE.Material, material: CompleteSceneMaterial): THREE.MeshBasicMaterial {
  if ((source as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
    return source as THREE.MeshBasicMaterial;
  }
  const standard = source as THREE.MeshStandardMaterial;
  const target = new THREE.MeshBasicMaterial({
    color: new THREE.Color(
      material.baseColor.x,
      material.baseColor.y,
      material.baseColor.z,
    ),
    map: standard.map ?? null,
    alphaMap: standard.alphaMap ?? null,
    opacity: material.opacity,
    transparent: material.alphaMode === 'blend',
    alphaTest: material.alphaMode === 'mask' ? material.alphaCutoff ?? 0.5 : 0,
    side: material.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  copyGenericMaterial(target, source);
  target.userData.kyxosConvertedMaterial = 'unlit';
  return target;
}

function toPhysical(source: THREE.Material): THREE.MeshPhysicalMaterial {
  if ((source as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    return source as THREE.MeshPhysicalMaterial;
  }
  const standard = source as THREE.MeshStandardMaterial;
  const target = new THREE.MeshPhysicalMaterial({
    color: standard.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: standard.map ?? null,
    lightMap: standard.lightMap ?? null,
    lightMapIntensity: finite(standard.lightMapIntensity, 1),
    aoMap: standard.aoMap ?? null,
    aoMapIntensity: finite(standard.aoMapIntensity, 1),
    emissive: standard.emissive?.clone() ?? new THREE.Color(0, 0, 0),
    emissiveIntensity: finite(standard.emissiveIntensity, 1),
    emissiveMap: standard.emissiveMap ?? null,
    bumpMap: standard.bumpMap ?? null,
    bumpScale: finite(standard.bumpScale, 1),
    normalMap: standard.normalMap ?? null,
    normalMapType: standard.normalMapType,
    normalScale: standard.normalScale?.clone() ?? new THREE.Vector2(1, 1),
    displacementMap: standard.displacementMap ?? null,
    displacementScale: finite(standard.displacementScale, 1),
    displacementBias: finite(standard.displacementBias, 0),
    roughness: finite(standard.roughness, 1),
    roughnessMap: standard.roughnessMap ?? null,
    metalness: finite(standard.metalness, 0),
    metalnessMap: standard.metalnessMap ?? null,
    alphaMap: standard.alphaMap ?? null,
    envMap: standard.envMap ?? null,
    envMapIntensity: finite(standard.envMapIntensity, 1),
    wireframe: Boolean(standard.wireframe),
    flatShading: Boolean(standard.flatShading),
    fog: standard.fog,
  });
  copyGenericMaterial(target, source);
  target.userData.kyxosConvertedMaterial = 'physical';
  return target;
}

function hasPhysicalFeatures(material: CompleteSceneMaterial): boolean {
  return Boolean(
    finite(material.clearcoat, 0) > 0
    || finite(material.transmission, 0) > 0
    || finite(material.thickness, 0) > 0
    || material.attenuationColor
    || material.ior != null
    || material.sheenColor
    || finite(material.sheenRoughness, 0) > 0
    || material.specularIntensity != null
    || material.specularColor
    || finite(material.iridescence, 0) > 0
    || finite(material.anisotropy, 0) > 0
    || finite(material.dispersion, 0) > 0
    || textureMappings.some(([field]) => field !== 'baseColorTexture' && material[field])
  );
}

function embeddedTextureIndex(reference: TextureRef | undefined): number | null {
  if (!reference?.assetId.startsWith('embedded-gltf-texture:')) return null;
  const match = reference.assetId.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function applyTextureReference(texture: THREE.Texture, reference: TextureRef): void {
  texture.userData = {
    ...texture.userData,
    kyxosManagedTexture: true,
    kyxosTextureAssetId: reference.assetId,
  };
  texture.flipY = false;
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

async function resolveTexture(
  viewer: KyxosViewer,
  reference: TextureRef,
): Promise<THREE.Texture | null> {
  const nativeIndex = embeddedTextureIndex(reference);
  const native = nativeIndex == null
    ? undefined
    : internals(viewer).gltfNativeTextures?.get(nativeIndex);
  if (native) {
    const texture = native.clone();
    texture.userData.gltfTextureIndex = nativeIndex;
    applyTextureReference(texture, reference);
    return texture;
  }

  const resolver = resolverByViewer.get(viewer);
  const scene = viewer.getLoadedSceneContract();
  const asset = scene?.assets[reference.assetId];
  if (!resolver || !asset) return null;
  if (asset.mimeType === 'image/ktx2') {
    viewer.dispatchEvent(new CustomEvent('warning', {
      detail: {
        message: `KTX2 texture ${asset.name ?? asset.id} requires the native glTF texture registry.`,
      },
    }));
    return null;
  }
  const texture = await textureLoader.loadAsync(await resolver.resolve(asset));
  applyTextureReference(texture, reference);
  return texture;
}

function replaceTexture(
  material: THREE.Material,
  property: RuntimeTextureProperty,
  texture: THREE.Texture | null,
): void {
  const target = material as THREE.Material & Record<string, unknown>;
  const previous = target[property] as THREE.Texture | null | undefined;
  if (previous?.userData.kyxosManagedTexture && previous !== texture) previous.dispose();
  target[property] = texture;
}

function originalHasTexture(
  material: CompleteSceneMaterial,
  field: CompleteTextureField,
): boolean {
  const original = material.metadata?.original;
  return Boolean(
    original
    && typeof original === 'object'
    && (original as Record<string, unknown>)[field],
  );
}

async function applyCompleteTextures(
  viewer: KyxosViewer,
  target: THREE.Material,
  material: CompleteSceneMaterial,
): Promise<number> {
  let applied = 0;
  for (const [field, property] of textureMappings) {
    if (field === 'baseColorTexture' && !material.unlit) continue;
    const reference = material[field];
    if (reference) {
      const texture = await resolveTexture(viewer, reference);
      if (texture) {
        replaceTexture(target, property, texture);
        applied += 1;
      }
    } else if (originalHasTexture(material, field)) {
      replaceTexture(target, property, null);
    }
  }
  return applied;
}

function applyPhysicalState(
  target: THREE.MeshPhysicalMaterial,
  material: CompleteSceneMaterial,
): void {
  target.clearcoat = finite(material.clearcoat, 0);
  target.clearcoatRoughness = finite(material.clearcoatRoughness, 0);
  target.clearcoatNormalScale.setScalar(finite(material.clearcoatNormalScale, 1));
  target.transmission = finite(material.transmission, 0);
  target.thickness = finite(material.thickness, 0);
  target.attenuationDistance = material.attenuationDistance == null
    ? Number.POSITIVE_INFINITY
    : finite(material.attenuationDistance, Number.POSITIVE_INFINITY);
  target.attenuationColor.copy(color(material.attenuationColor));
  target.ior = finite(material.ior, 1.5);
  target.sheen = material.sheenColor || material.sheenColorTexture || material.sheenRoughnessTexture
    ? 1
    : 0;
  target.sheenColor.copy(color(material.sheenColor, 0));
  target.sheenRoughness = finite(material.sheenRoughness, 0);
  target.specularIntensity = finite(material.specularIntensity, 1);
  target.specularColor.copy(color(material.specularColor));
  target.iridescence = finite(material.iridescence, 0);
  target.iridescenceIOR = finite(material.iridescenceIor, 1.3);
  target.iridescenceThicknessRange = [
    finite(material.iridescenceThicknessMinimum, 100),
    finite(material.iridescenceThicknessMaximum, 400),
  ];
  target.anisotropy = finite(material.anisotropy, 0);
  target.anisotropyRotation = finite(material.anisotropyRotation, 0);
  target.dispersion = finite(material.dispersion, 0);
  target.aoMapIntensity = finite(material.aoIntensity, 1);
}

function applyCommonState(target: THREE.Material, material: CompleteSceneMaterial): void {
  const candidate = target as THREE.Material & {
    color?: THREE.Color;
    opacity: number;
  };
  candidate.color?.setRGB(
    material.baseColor.x,
    material.baseColor.y,
    material.baseColor.z,
  );
  candidate.opacity = material.opacity;
  target.transparent = material.alphaMode === 'blend';
  target.alphaTest = material.alphaMode === 'mask' ? material.alphaCutoff ?? 0.5 : 0;
  target.depthWrite = material.alphaMode !== 'blend';
  target.side = material.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  target.name = material.name;
  target.userData.kyxosMaterialId = material.id;
  target.userData.kyxosCompleteMaterial = true;
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype.__kyxosCompleteMaterialApiInstalled) {
  const originalLoadScene = prototype.loadScene;
  const originalSetMaterial = prototype.setMaterial;
  if (typeof originalLoadScene !== 'function' || typeof originalSetMaterial !== 'function') {
    throw new Error('Scene API must be installed before complete material support.');
  }

  prototype.loadScene = async function loadSceneWithMaterialResolver(
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    resolverByViewer.set(this, resolver);
    await originalLoadScene.call(this, scene, resolver);
  };

  prototype.setMaterial = async function setCompleteMaterial(
    nodeId: string,
    slot: number,
    source: SceneMaterial,
  ): Promise<void> {
    await originalSetMaterial.call(this, nodeId, slot, source);
    const material = source as CompleteSceneMaterial;
    const binding = bindingFor(this, nodeId, slot);
    if (!binding) return;

    let target = binding.material;
    if (material.unlit) {
      const converted = toUnlit(target, material);
      if (converted !== target) {
        assignMaterial(binding, converted);
        target.dispose();
        target = converted;
      }
    } else if (hasPhysicalFeatures(material)) {
      const converted = toPhysical(target);
      if (converted !== target) {
        assignMaterial(binding, converted);
        target.dispose();
        target = converted;
      }
    }

    applyCommonState(target, material);
    if ((target as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const standard = target as THREE.MeshStandardMaterial;
      standard.emissive.setRGB(
        material.emissive.x,
        material.emissive.y,
        material.emissive.z,
      );
      standard.emissiveIntensity = finite(material.emissiveIntensity, 1);
      standard.aoMapIntensity = finite(material.aoIntensity, 1);
    }
    if ((target as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      applyPhysicalState(target as THREE.MeshPhysicalMaterial, material);
    }

    const textures = await applyCompleteTextures(this, target, material);
    target.needsUpdate = true;
    this.canvas.dataset.completeMaterialId = material.id;
    this.canvas.dataset.completeMaterialTextures = String(textures);
    this.canvas.dataset.completeMaterialState = JSON.stringify({
      unlit: Boolean(material.unlit),
      clearcoat: finite(material.clearcoat, 0),
      transmission: finite(material.transmission, 0),
      sheenRoughness: finite(material.sheenRoughness, 0),
      specularIntensity: finite(material.specularIntensity, 1),
      iridescence: finite(material.iridescence, 0),
      anisotropy: finite(material.anisotropy, 0),
      dispersion: finite(material.dispersion, 0),
    });
    this.resetTemporal('complete-scene-material');
  };

  prototype.__kyxosCompleteMaterialApiInstalled = true;
}
