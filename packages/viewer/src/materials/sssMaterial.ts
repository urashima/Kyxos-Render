import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';

import type { KyxosViewer } from '../KyxosViewer';
import type { SSSMaterialSettings, SSSMaterialStatus, TextureInput } from '../types';

export const DEFAULT_SSS_MATERIAL_SETTINGS = Object.freeze({
  enabled: false,
  color: '#ff8050',
  distortion: 0.1,
  ambient: 0.4,
  attenuation: 0.8,
  power: 2,
  scale: 16,
});

type ResolvedSSSSettings = Omit<SSSMaterialSettings, 'thicknessMap'>;

type MaterialAssignment = {
  object: THREE.Object3D & { material: THREE.Material | THREE.Material[] };
  original: THREE.Material | THREE.Material[];
};

type SSSRuntimeState = {
  settings: ResolvedSSSSettings;
  thicknessTexture: THREE.Texture | null;
  ownsThicknessTexture: boolean;
  assignments: MaterialAssignment[];
  generatedMaterials: Set<THREE.Material>;
  convertedMaterials: number;
};

type ViewerInternals = KyxosViewer & {
  modelRoot: THREE.Group;
  materialTextures: Set<THREE.Texture>;
  resetTemporal: (reason?: string) => void;
  loadModel: (url: string) => Promise<void>;
  dispose: () => void;
};

type ViewerConstructor = {
  prototype: ViewerInternals;
};

const textureLoader = new THREE.TextureLoader();
const states = new WeakMap<KyxosViewer, SSSRuntimeState>();
const installKey = Symbol.for('kyxos.viewer.threejs-sss-extension');

const materialPropertyNames = [
  'name',
  'blending',
  'side',
  'shadowSide',
  'vertexColors',
  'opacity',
  'transparent',
  'alphaHash',
  'alphaTest',
  'depthTest',
  'depthWrite',
  'colorWrite',
  'toneMapped',
  'dithering',
  'premultipliedAlpha',
  'forceSinglePass',
  'visible',
  'fog',
  'wireframe',
  'wireframeLinewidth',
  'flatShading',
  'color',
  'map',
  'lightMap',
  'lightMapIntensity',
  'aoMap',
  'aoMapIntensity',
  'emissive',
  'emissiveIntensity',
  'emissiveMap',
  'bumpMap',
  'bumpScale',
  'normalMap',
  'normalMapType',
  'normalScale',
  'displacementMap',
  'displacementScale',
  'displacementBias',
  'roughness',
  'roughnessMap',
  'metalness',
  'metalnessMap',
  'alphaMap',
  'envMap',
  'envMapRotation',
  'envMapIntensity',
  'anisotropy',
  'anisotropyRotation',
  'anisotropyMap',
  'clearcoat',
  'clearcoatMap',
  'clearcoatRoughness',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'clearcoatNormalScale',
  'ior',
  'reflectivity',
  'iridescence',
  'iridescenceMap',
  'iridescenceIOR',
  'iridescenceThicknessRange',
  'iridescenceThicknessMap',
  'sheen',
  'sheenColor',
  'sheenColorMap',
  'sheenRoughness',
  'sheenRoughnessMap',
  'specularIntensity',
  'specularIntensityMap',
  'specularColor',
  'specularColorMap',
  'transmission',
  'transmissionMap',
  'thickness',
  'thicknessMap',
  'attenuationDistance',
  'attenuationColor',
  'dispersion',
  'retroreflectivity',
] as const;

declare module '../KyxosViewer' {
  interface KyxosViewer {
    setSSSMaterial(settings: Partial<SSSMaterialSettings>): Promise<SSSMaterialStatus>;
    getSSSMaterialStatus(): SSSMaterialStatus;
  }
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function resolveSSSMaterialSettings(
  settings: Partial<SSSMaterialSettings> = {},
): ResolvedSSSSettings {
  return {
    enabled: settings.enabled ?? DEFAULT_SSS_MATERIAL_SETTINGS.enabled,
    color: typeof settings.color === 'string' ? settings.color : DEFAULT_SSS_MATERIAL_SETTINGS.color,
    distortion: finite(settings.distortion, DEFAULT_SSS_MATERIAL_SETTINGS.distortion, 0.01, 1),
    ambient: finite(settings.ambient, DEFAULT_SSS_MATERIAL_SETTINGS.ambient, 0, 5),
    attenuation: finite(settings.attenuation, DEFAULT_SSS_MATERIAL_SETTINGS.attenuation, 0.01, 5),
    power: finite(settings.power, DEFAULT_SSS_MATERIAL_SETTINGS.power, 0.01, 16),
    scale: finite(settings.scale, DEFAULT_SSS_MATERIAL_SETTINGS.scale, 0.01, 50),
  };
}

function createState(): SSSRuntimeState {
  return {
    settings: resolveSSSMaterialSettings(),
    thicknessTexture: null,
    ownsThicknessTexture: false,
    assignments: [],
    generatedMaterials: new Set(),
    convertedMaterials: 0,
  };
}

function getState(viewer: KyxosViewer) {
  let state = states.get(viewer);
  if (!state) {
    state = createState();
    states.set(viewer, state);
  }
  return state;
}

function cloneMaterialValue(value: any) {
  if (
    value?.isColor ||
    value?.isVector2 ||
    value?.isVector3 ||
    value?.isVector4 ||
    value?.isEuler ||
    value?.isMatrix3 ||
    value?.isMatrix4
  ) {
    return value.clone();
  }
  return value;
}

function copyMaterialParameters(source: any) {
  const parameters: Record<string, unknown> = {};
  for (const name of materialPropertyNames) {
    if (source[name] !== undefined) parameters[name] = cloneMaterialValue(source[name]);
  }
  return parameters;
}

function configureSSSNodes(material: any, state: SSSRuntimeState) {
  const colorNode = uniform(new THREE.Color(state.settings.color));
  material.thicknessColorNode = state.thicknessTexture
    ? texture(state.thicknessTexture).mul(colorNode)
    : colorNode;
  material.thicknessDistortionNode = uniform(state.settings.distortion);
  material.thicknessAmbientNode = uniform(state.settings.ambient);
  material.thicknessAttenuationNode = uniform(state.settings.attenuation);
  material.thicknessPowerNode = uniform(state.settings.power);
  material.thicknessScaleNode = uniform(state.settings.scale);
  material.needsUpdate = true;
}

function convertMaterial(source: any, state: SSSRuntimeState) {
  if (source?.type === 'MeshSSSNodeMaterial') {
    configureSSSNodes(source, state);
    return source as THREE.Material;
  }

  if (!source?.isMeshStandardMaterial && !source?.isMeshPhysicalMaterial) return source as THREE.Material;

  const SSSMaterial = (THREE as any).MeshSSSNodeMaterial;
  if (!SSSMaterial) throw new Error('The pinned Three.js build does not export MeshSSSNodeMaterial.');

  const material = new SSSMaterial(copyMaterialParameters(source));
  material.name = `${source.name || source.type || 'Material'} · SSS`;
  material.userData = {
    ...(source.userData ?? {}),
    kyxosOriginalMaterialUuid: source.uuid,
    kyxosSSS: true,
  };
  configureSSSNodes(material, state);
  state.generatedMaterials.add(material);
  state.convertedMaterials += 1;
  return material as THREE.Material;
}

function restoreMaterials(state: SSSRuntimeState) {
  for (const assignment of state.assignments.splice(0)) assignment.object.material = assignment.original;
  for (const material of state.generatedMaterials) material.dispose();
  state.generatedMaterials.clear();
  state.convertedMaterials = 0;
}

function applyMaterials(viewer: ViewerInternals, state: SSSRuntimeState) {
  restoreMaterials(state);
  const replacements = new Map<THREE.Material, THREE.Material>();

  viewer.modelRoot.traverse((candidate: any) => {
    if (!candidate?.isMesh || !candidate.material) return;
    const original = candidate.material as THREE.Material | THREE.Material[];
    state.assignments.push({ object: candidate, original });

    const replace = (material: THREE.Material) => {
      const existing = replacements.get(material);
      if (existing) return existing;
      const converted = convertMaterial(material, state);
      replacements.set(material, converted);
      return converted;
    };

    candidate.material = Array.isArray(original) ? original.map(replace) : replace(original);
  });
}

async function loadThicknessTexture(viewer: ViewerInternals, input: TextureInput) {
  if (!input) return { texture: null, owned: false };
  if (typeof input !== 'string') {
    input.colorSpace = THREE.NoColorSpace;
    return { texture: input, owned: false };
  }

  const loaded = await textureLoader.loadAsync(input);
  loaded.colorSpace = THREE.NoColorSpace;
  loaded.wrapS = THREE.RepeatWrapping;
  loaded.wrapT = THREE.RepeatWrapping;
  viewer.materialTextures.add(loaded);
  return { texture: loaded, owned: true };
}

function releaseThicknessTexture(viewer: ViewerInternals, state: SSSRuntimeState) {
  if (state.thicknessTexture && state.ownsThicknessTexture) {
    viewer.materialTextures.delete(state.thicknessTexture);
    state.thicknessTexture.dispose();
  }
  state.thicknessTexture = null;
  state.ownsThicknessTexture = false;
}

function status(state: SSSRuntimeState): SSSMaterialStatus {
  return {
    ...state.settings,
    hasThicknessMap: state.thicknessTexture !== null,
    convertedMaterials: state.convertedMaterials,
  };
}

export function installSSSMaterialExtension(Viewer: ViewerConstructor) {
  const prototype = Viewer.prototype as ViewerInternals & Record<PropertyKey, unknown>;
  if (prototype[installKey]) return;

  const originalLoadModel = prototype.loadModel;
  const originalDispose = prototype.dispose;

  prototype.setSSSMaterial = async function (patch: Partial<SSSMaterialSettings>) {
    const state = getState(this);
    state.settings = resolveSSSMaterialSettings({ ...state.settings, ...patch });

    if (Object.prototype.hasOwnProperty.call(patch, 'thicknessMap')) {
      releaseThicknessTexture(this, state);
      const loaded = await loadThicknessTexture(this, patch.thicknessMap);
      state.thicknessTexture = loaded.texture;
      state.ownsThicknessTexture = loaded.owned;
    }

    if (state.settings.enabled) applyMaterials(this, state);
    else restoreMaterials(state);

    this.resetTemporal('sss-material');
    return status(state);
  };

  prototype.getSSSMaterialStatus = function () {
    return status(getState(this));
  };

  prototype.loadModel = async function (url: string) {
    const state = getState(this);
    const reapply = state.settings.enabled;
    if (reapply) restoreMaterials(state);
    await originalLoadModel.call(this, url);
    if (reapply) {
      applyMaterials(this, state);
      this.resetTemporal('sss-model-switch');
    }
  };

  prototype.dispose = function () {
    const state = states.get(this);
    if (state) {
      restoreMaterials(state);
      releaseThicknessTexture(this, state);
      states.delete(this);
    }
    originalDispose.call(this);
  };

  Object.defineProperty(prototype, installKey, { value: true });
}
