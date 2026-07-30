import { KyxosViewer, type KyxosViewerCreateOptions } from '@kyxos/viewer';

type ViewerCreate = (options: KyxosViewerCreateOptions) => Promise<KyxosViewer>;
type DemoPresetName = 'skin' | 'wax' | 'jade';

type MaterialLike = {
  color?: { set: (value: string) => void };
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  userData?: Record<string, unknown>;
  needsUpdate?: boolean;
};

type ViewerInternals = {
  modelRoot?: {
    traverse: (callback: (object: { isMesh?: boolean; material?: MaterialLike | MaterialLike[] }) => void) => void;
  };
};

const presets: Record<DemoPresetName, {
  baseColor: string;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  thickness: number;
}> = {
  skin: {
    baseColor: '#c98772',
    roughness: 0.58,
    clearcoat: 0.1,
    clearcoatRoughness: 0.38,
    thickness: 0.55,
  },
  wax: {
    baseColor: '#e6b774',
    roughness: 0.36,
    clearcoat: 0.24,
    clearcoatRoughness: 0.22,
    thickness: 0.82,
  },
  jade: {
    baseColor: '#5b9e77',
    roughness: 0.42,
    clearcoat: 0.16,
    clearcoatRoughness: 0.28,
    thickness: 0.68,
  },
};

const patchKey = Symbol.for('kyxos.playground.screen-space-sss-demo-material');
const viewerConstructor = KyxosViewer as typeof KyxosViewer & { create: ViewerCreate };
const constructorState = viewerConstructor as unknown as Record<PropertyKey, unknown>;
let currentViewer: KyxosViewer | null = null;
let currentPreset: DemoPresetName = 'skin';

function isSSSRoute() {
  return window.location.pathname.split('/').filter(Boolean).at(-1) === 'sss';
}

function applyDemoMaterial(viewer: KyxosViewer, presetName: DemoPresetName) {
  const preset = presets[presetName];
  const root = (viewer as unknown as ViewerInternals).modelRoot;
  if (!root) return;

  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      material.color?.set(preset.baseColor);
      if ('metalness' in material) material.metalness = 0.02;
      if ('roughness' in material) material.roughness = preset.roughness;
      if ('clearcoat' in material) material.clearcoat = preset.clearcoat;
      if ('clearcoatRoughness' in material) material.clearcoatRoughness = preset.clearcoatRoughness;
      if ('envMapIntensity' in material) material.envMapIntensity = 1.1;
      material.userData = {
        ...(material.userData ?? {}),
        kyxosSSS: true,
        kyxosSSSThickness: preset.thickness,
      };
      material.needsUpdate = true;
    }
  });

  // Medium keeps the published seven-tap profile while avoiding the optional
  // broad second lobe on software WebGL. Users can still select High manually.
  viewer.setScreenSpaceSSS({ thickness: preset.thickness, quality: 'medium' });
}

if (!constructorState[patchKey]) {
  const originalCreate = viewerConstructor.create.bind(viewerConstructor);
  viewerConstructor.create = async (options: KyxosViewerCreateOptions) => {
    const viewer = await originalCreate(options);
    currentViewer = viewer;
    if (isSSSRoute()) applyDemoMaterial(viewer, currentPreset);
    return viewer;
  };
  constructorState[patchKey] = true;
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-sss-preset]');
  const presetName = button?.dataset.sssPreset as DemoPresetName | undefined;
  if (!presetName || !presets[presetName]) return;

  currentPreset = presetName;
  // The main SSS control handler awaits the procedural model replacement. Its
  // continuation is queued before this microtask, so the material is calibrated
  // after the new model exists and then the SSS graph is rebuilt once more.
  queueMicrotask(() => {
    if (currentViewer) applyDemoMaterial(currentViewer, currentPreset);
  });
});
