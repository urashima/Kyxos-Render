import * as THREE from 'three/webgpu';
import {
  diffuseColor,
  materialReference,
  metalness,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  perspectiveDepthToViewZ,
  roughness,
  sample,
  vec4,
} from 'three/tsl';

import { createScreenSpaceSSSNode } from '../effects/screenSpaceSSSNode';
import type {
  ScreenSpaceSSSQuality,
  ScreenSpaceSSSSettings,
  ScreenSpaceSSSStatus,
} from '../types';

export const DEFAULT_SCREEN_SPACE_SSS_SETTINGS = Object.freeze({
  enabled: false,
  color: '#ffb59e',
  strength: 0.72,
  radius: 7.5,
  falloff: [1, 0.37, 0.3] as [number, number, number],
  thickness: 0.55,
  depthFalloff: 72,
  normalThreshold: 0.35,
  quality: 'medium' as ScreenSpaceSSSQuality,
  materialNames: null as string[] | null,
});

type ResolvedScreenSpaceSSSSettings = Omit<ScreenSpaceSSSSettings, 'materialNames'> & {
  materialNames: string[] | null;
};

type MaterialOverride = {
  material: THREE.Material & Record<string, unknown>;
  hadMask: boolean;
  previousMask: unknown;
  hadThickness: boolean;
  previousThickness: unknown;
};

type MaterialSelection = {
  selected: boolean;
  eligible: boolean;
  thickness: number;
};

type ScreenSpaceSSSRuntimeState = {
  settings: ResolvedScreenSpaceSSSSettings;
  overrides: MaterialOverride[];
  markedMaterials: number;
  eligibleMaterials: number;
  lastError: string | null;
};

type ViewerInternals = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  modelRoot: THREE.Group;
  nodes: any[];
  debugView: string;
  finalNode: any;
  beforeNode: any;
  renderPipeline: any;
  debugNodes: Map<string, any>;
  buildPipeline: (reason: string) => void;
  applyOutputSelection: () => void;
  resetTemporal: (reason?: string) => void;
  loadModel: (url: string) => Promise<void>;
  dispose: () => void;
  warn: (key: string, message: string) => void;
  setScreenSpaceSSS: (settings: Partial<ScreenSpaceSSSSettings>) => ScreenSpaceSSSStatus;
  getScreenSpaceSSSStatus: () => ScreenSpaceSSSStatus;
};

type ViewerConstructor = { prototype: unknown };

const states = new WeakMap<object, ScreenSpaceSSSRuntimeState>();
const installKey = Symbol.for('kyxos.viewer.deferred-screen-space-sss');
const qualityValues = new Set<ScreenSpaceSSSQuality>(['low', 'medium', 'high']);

declare module '../KyxosViewer' {
  interface KyxosViewer {
    setScreenSpaceSSS(settings: Partial<ScreenSpaceSSSSettings>): ScreenSpaceSSSStatus;
    getScreenSpaceSSSStatus(): ScreenSpaceSSSStatus;
  }
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function resolveColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : DEFAULT_SCREEN_SPACE_SSS_SETTINGS.color;
}

function resolveFalloff(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    return [...DEFAULT_SCREEN_SPACE_SSS_SETTINGS.falloff];
  }

  return [
    finite(value[0], DEFAULT_SCREEN_SPACE_SSS_SETTINGS.falloff[0], 0, 2),
    finite(value[1], DEFAULT_SCREEN_SPACE_SSS_SETTINGS.falloff[1], 0, 2),
    finite(value[2], DEFAULT_SCREEN_SPACE_SSS_SETTINGS.falloff[2], 0, 2),
  ];
}

function resolveMaterialNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = [...new Set(value.map(String).map((name) => name.trim()).filter(Boolean))];
  return names.length > 0 ? names : null;
}

export function resolveScreenSpaceSSSSettings(
  settings: Partial<ScreenSpaceSSSSettings> = {},
): ResolvedScreenSpaceSSSSettings {
  const requestedQuality = settings.quality as ScreenSpaceSSSQuality | undefined;
  return {
    enabled: settings.enabled ?? DEFAULT_SCREEN_SPACE_SSS_SETTINGS.enabled,
    color: resolveColor(settings.color),
    strength: finite(settings.strength, DEFAULT_SCREEN_SPACE_SSS_SETTINGS.strength, 0, 1.5),
    radius: finite(settings.radius, DEFAULT_SCREEN_SPACE_SSS_SETTINGS.radius, 0.25, 32),
    falloff: resolveFalloff(settings.falloff),
    thickness: finite(settings.thickness, DEFAULT_SCREEN_SPACE_SSS_SETTINGS.thickness, 0.01, 1),
    depthFalloff: finite(
      settings.depthFalloff,
      DEFAULT_SCREEN_SPACE_SSS_SETTINGS.depthFalloff,
      1,
      256,
    ),
    normalThreshold: finite(
      settings.normalThreshold,
      DEFAULT_SCREEN_SPACE_SSS_SETTINGS.normalThreshold,
      -1,
      0.99,
    ),
    quality:
      requestedQuality && qualityValues.has(requestedQuality)
        ? requestedQuality
        : DEFAULT_SCREEN_SPACE_SSS_SETTINGS.quality,
    materialNames: resolveMaterialNames(settings.materialNames),
  };
}

function createState(): ScreenSpaceSSSRuntimeState {
  return {
    settings: resolveScreenSpaceSSSSettings(),
    overrides: [],
    markedMaterials: 0,
    eligibleMaterials: 0,
    lastError: null,
  };
}

function getState(viewer: object) {
  let state = states.get(viewer);
  if (!state) {
    state = createState();
    states.set(viewer, state);
  }
  return state;
}

function isEligibleMaterial(material: any) {
  return Boolean(
    material?.isMeshStandardMaterial ||
      material?.isMeshPhysicalMaterial ||
      material?.type === 'MeshSSSNodeMaterial',
  );
}

function restoreMaterialOverrides(state: ScreenSpaceSSSRuntimeState) {
  for (const override of state.overrides.splice(0)) {
    if (override.hadMask) override.material.kyxosSSSMask = override.previousMask;
    else delete override.material.kyxosSSSMask;

    if (override.hadThickness) override.material.kyxosSSSThickness = override.previousThickness;
    else delete override.material.kyxosSSSThickness;
  }
  state.markedMaterials = 0;
  state.eligibleMaterials = 0;
}

function matchesMaterial(
  object: THREE.Object3D,
  material: THREE.Material,
  names: string[] | null,
) {
  const explicit = (material.userData as Record<string, unknown> | undefined)?.kyxosSSS;
  if (explicit === false) return false;
  if (explicit === true) return true;
  if (!names) return true;

  const objectName = object.name.trim().toLowerCase();
  const materialName = material.name.trim().toLowerCase();
  return names.some((name) => {
    const target = name.toLowerCase();
    return target === objectName || target === materialName;
  });
}

function belongsToModelRoot(object: THREE.Object3D, modelRoot: THREE.Group) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === modelRoot) return true;
    current = current.parent;
  }
  return false;
}

function applyMaterialMask(viewer: ViewerInternals, state: ScreenSpaceSSSRuntimeState) {
  restoreMaterialOverrides(state);
  const selections = new Map<THREE.Material, MaterialSelection>();

  // The SSS G-buffer renders the complete scene. Every encountered material gets
  // explicit zero-valued custom properties so materialReference() is defined for
  // floors, helpers and other non-SSS objects as well as the selected model.
  viewer.scene.traverse((object: any) => {
    if (!object?.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const inModel = belongsToModelRoot(object, viewer.modelRoot);

    for (const material of materials as THREE.Material[]) {
      const eligible = inModel && isEligibleMaterial(material);
      const selected = eligible && matchesMaterial(object, material, state.settings.materialNames);
      const userThickness = Number(
        (material.userData as Record<string, unknown> | undefined)?.kyxosSSSThickness,
      );
      const thickness = Number.isFinite(userThickness)
        ? Math.max(0.01, Math.min(1, userThickness))
        : state.settings.thickness;
      const previous = selections.get(material);

      selections.set(material, {
        selected: Boolean(previous?.selected || selected),
        eligible: Boolean(previous?.eligible || eligible),
        thickness: selected ? thickness : (previous?.thickness ?? state.settings.thickness),
      });
    }
  });

  for (const [material, selection] of selections) {
    const record = material as THREE.Material & Record<string, unknown>;
    state.overrides.push({
      material: record,
      hadMask: Object.prototype.hasOwnProperty.call(record, 'kyxosSSSMask'),
      previousMask: record.kyxosSSSMask,
      hadThickness: Object.prototype.hasOwnProperty.call(record, 'kyxosSSSThickness'),
      previousThickness: record.kyxosSSSThickness,
    });
    record.kyxosSSSMask = selection.selected ? 1 : 0;
    record.kyxosSSSThickness = selection.selected ? selection.thickness : 0;
    material.needsUpdate = true;
    if (selection.eligible) state.eligibleMaterials += 1;
    if (selection.selected) state.markedMaterials += 1;
  }
}

function createStatus(state: ScreenSpaceSSSRuntimeState): ScreenSpaceSSSStatus {
  return {
    ...state.settings,
    falloff: [...state.settings.falloff],
    materialNames: state.settings.materialNames ? [...state.settings.materialNames] : null,
    markedMaterials: state.markedMaterials,
    eligibleMaterials: state.eligibleMaterials,
    lastError: state.lastError,
  };
}

function appendScreenSpaceSSS(viewer: ViewerInternals, state: ScreenSpaceSSSRuntimeState) {
  if (
    !state.settings.enabled ||
    viewer.debugView !== 'final' ||
    !viewer.renderPipeline ||
    !viewer.finalNode ||
    !viewer.beforeNode ||
    state.markedMaterials === 0
  ) {
    return;
  }

  const gBufferPass = pass(viewer.scene, viewer.camera);
  gBufferPass.name = 'Kyxos.ScreenSpaceSSS.GBuffer';
  gBufferPass.transparent = false;
  gBufferPass.options.samples = 0;
  gBufferPass.setMRT(
    mrt({
      output: packNormalToRGB(normalView),
      sssData: vec4(
        materialReference('kyxosSSSMask', 'float'),
        materialReference('kyxosSSSThickness', 'float'),
        roughness,
        1,
      ),
      surface: vec4(diffuseColor.rgb, metalness),
    }),
  );

  const normalPacked = gBufferPass.getTextureNode('output');
  const sssData = gBufferPass.getTextureNode('sssData');
  const surface = gBufferPass.getTextureNode('surface');
  const depth = gBufferPass.getTextureNode('depth');
  const viewZ = sample((uv: any) =>
    perspectiveDepthToViewZ(depth.sample(uv).r, viewer.camera.near, viewer.camera.far),
  );

  gBufferPass.getTexture('output').type = THREE.UnsignedByteType;
  gBufferPass.getTexture('sssData').type = THREE.UnsignedByteType;
  gBufferPass.getTexture('surface').type = THREE.UnsignedByteType;

  const effect = createScreenSpaceSSSNode(
    viewer.beforeNode,
    viewZ,
    normalPacked,
    sssData,
    surface,
    state.settings,
  );

  viewer.nodes.push(gBufferPass, ...effect.resources);
  // finalNode is already in display/output color space because the core pipeline
  // owns the single renderOutput() transform. Applying renderOutput() again here
  // double tone-maps and color-converts the frame and can produce black output.
  viewer.finalNode = vec4(viewer.finalNode.rgb.add(effect.deltaNode.rgb), viewer.finalNode.a);
  viewer.debugNodes.set('final', viewer.finalNode);
  viewer.applyOutputSelection();
  viewer.renderPipeline.needsUpdate = true;
}

export function installScreenSpaceSSSExtension(Viewer: ViewerConstructor) {
  const prototype = Viewer.prototype as ViewerInternals & Record<PropertyKey, unknown>;
  if (prototype[installKey]) return;

  const originalBuildPipeline = prototype.buildPipeline;
  const originalLoadModel = prototype.loadModel;
  const originalDispose = prototype.dispose;

  prototype.buildPipeline = function (reason: string) {
    const state = getState(this);
    if (state.settings.enabled) applyMaterialMask(this, state);
    originalBuildPipeline.call(this, reason);

    try {
      state.lastError = null;
      appendScreenSpaceSSS(this, state);
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      this.warn('screen-space-sss', `Screen-space SSS was isolated: ${state.lastError}`);
    }
  };

  prototype.setScreenSpaceSSS = function (patch: Partial<ScreenSpaceSSSSettings>) {
    const state = getState(this);
    state.settings = resolveScreenSpaceSSSSettings({ ...state.settings, ...patch });
    state.lastError = null;

    if (state.settings.enabled) applyMaterialMask(this, state);
    else restoreMaterialOverrides(state);

    this.resetTemporal('screen-space-sss');
    return createStatus(state);
  };

  prototype.getScreenSpaceSSSStatus = function () {
    return createStatus(getState(this));
  };

  prototype.loadModel = async function (url: string) {
    const state = getState(this);
    restoreMaterialOverrides(state);
    await originalLoadModel.call(this, url);
    if (state.settings.enabled) {
      applyMaterialMask(this, state);
      this.resetTemporal('screen-space-sss-model');
    }
  };

  prototype.dispose = function () {
    const state = states.get(this);
    if (state) {
      restoreMaterialOverrides(state);
      states.delete(this);
    }
    originalDispose.call(this);
  };

  Object.defineProperty(prototype, installKey, { value: true });
}
