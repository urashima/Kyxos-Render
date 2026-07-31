import * as THREE from 'three/webgpu';

import { KyxosViewer, type KyxosViewerCreateOptions } from '@kyxos/viewer';

type ViewerCreate = (options: KyxosViewerCreateOptions) => Promise<KyxosViewer>;
type DemoPresetName = 'skin' | 'wax' | 'jade';

type MaterialLike = THREE.Material & {
  color?: { set: (value: string) => void };
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  userData: Record<string, unknown>;
  needsUpdate?: boolean;
};

type ViewerInternals = {
  modelRoot?: THREE.Group;
};

const presets: Record<
  DemoPresetName,
  {
    baseColor: string;
    roughness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    thickness: number;
  }
> = {
  skin: {
    baseColor: '#c98772',
    roughness: 0.58,
    clearcoat: 0.1,
    clearcoatRoughness: 0.38,
    thickness: 0.78,
  },
  wax: {
    baseColor: '#e6b774',
    roughness: 0.36,
    clearcoat: 0.24,
    clearcoatRoughness: 0.22,
    thickness: 0.92,
  },
  jade: {
    baseColor: '#5b9e77',
    roughness: 0.42,
    clearcoat: 0.16,
    clearcoatRoughness: 0.28,
    thickness: 0.85,
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

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
}

function clearModelRoot(root: THREE.Group) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    if (mesh.material) disposeMaterial(mesh.material);
  });
  root.clear();
}

function createStudyMaterial(name: string, thickness: number) {
  const material = new THREE.MeshPhysicalMaterial({
    color: presets.skin.baseColor,
    metalness: 0.02,
    roughness: presets.skin.roughness,
    clearcoat: presets.skin.clearcoat,
    clearcoatRoughness: presets.skin.clearcoatRoughness,
    envMapIntensity: 1.1,
  });
  material.name = name;
  material.userData = {
    kyxosSSS: true,
    kyxosSSSBaseThickness: thickness,
    kyxosSSSThickness: thickness,
  };
  return material;
}

function configureMesh(mesh: THREE.Mesh, name: string) {
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function replaceWithSSSStudy(viewer: KyxosViewer) {
  const root = (viewer as unknown as ViewerInternals).modelRoot;
  if (!root) return;

  clearModelRoot(root);

  const study = new THREE.Group();
  study.name = 'SSS.ComplexStudy';
  study.position.y = -0.08;

  const core = configureMesh(
    new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.78, 0.25, 256, 64, 2, 3),
      createStudyMaterial('SSS.Core.Medium', 0.62),
    ),
    'SSS Core · medium thickness',
  );
  core.position.set(0, 1.34, 0);
  core.rotation.set(0.12, -0.18, 0.08);
  study.add(core);

  const thinGeometry = new THREE.SphereGeometry(0.58, 64, 32);
  const leftShell = configureMesh(
    new THREE.Mesh(thinGeometry.clone(), createStudyMaterial('SSS.Shell.Thin.Left', 0.18)),
    'SSS Thin shell · left',
  );
  leftShell.position.set(-1.18, 1.42, 0.04);
  leftShell.scale.set(0.34, 1.05, 0.12);
  leftShell.rotation.set(0.08, 0.24, -0.3);
  study.add(leftShell);

  const rightShell = configureMesh(
    new THREE.Mesh(thinGeometry, createStudyMaterial('SSS.Shell.Thin.Right', 0.26)),
    'SSS Thin shell · right',
  );
  rightShell.position.set(1.18, 1.42, 0.04);
  rightShell.scale.set(0.4, 0.92, 0.16);
  rightShell.rotation.set(-0.05, -0.3, 0.32);
  study.add(rightShell);

  const crown = configureMesh(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.52, 5),
      createStudyMaterial('SSS.Crown.Thick', 0.94),
    ),
    'SSS Crown · thick volume',
  );
  crown.position.set(0, 2.32, -0.02);
  crown.scale.set(1.15, 0.72, 0.88);
  study.add(crown);

  const lowerArc = configureMesh(
    new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.13, 32, 128, Math.PI * 1.65),
      createStudyMaterial('SSS.Arc.Variable', 0.46),
    ),
    'SSS Lower arc · curved silhouette',
  );
  lowerArc.position.set(0, 0.38, 0.12);
  lowerArc.rotation.set(Math.PI / 2, 0, 0.55);
  study.add(lowerArc);

  root.add(study);
}

function applyDemoMaterial(viewer: KyxosViewer, presetName: DemoPresetName) {
  const preset = presets[presetName];
  const root = (viewer as unknown as ViewerInternals).modelRoot;
  if (!root) return;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const material of materials as MaterialLike[]) {
      material.color?.set(preset.baseColor);
      if ('metalness' in material) material.metalness = 0.02;
      if ('roughness' in material) material.roughness = preset.roughness;
      if ('clearcoat' in material) material.clearcoat = preset.clearcoat;
      if ('clearcoatRoughness' in material) material.clearcoatRoughness = preset.clearcoatRoughness;
      if ('envMapIntensity' in material) material.envMapIntensity = 1.1;

      const baseThickness = Number(material.userData?.kyxosSSSBaseThickness);
      const relativeThickness = Number.isFinite(baseThickness) ? baseThickness : 0.62;
      const thickness = Math.max(
        0.03,
        Math.min(1, relativeThickness * (preset.thickness / presets.skin.thickness)),
      );
      material.userData = {
        ...(material.userData ?? {}),
        kyxosSSS: true,
        kyxosSSSBaseThickness: relativeThickness,
        kyxosSSSThickness: thickness,
      };
      material.needsUpdate = true;
    }
  });

  viewer.setScreenSpaceSSS({ thickness: preset.thickness });
}

function mountStudyModelOption() {
  const select = document.querySelector<HTMLSelectElement>('#model-select');
  if (!select) {
    requestAnimationFrame(mountStudyModelOption);
    return;
  }

  if (!select.querySelector('option[value="procedural:sss-study"]')) {
    const option = document.createElement('option');
    option.value = 'procedural:sss-study';
    option.textContent = 'SSS complex study';
    select.prepend(option);
  }
  if (isSSSRoute()) select.value = 'procedural:sss-study';
}

if (!constructorState[patchKey]) {
  const originalCreate = viewerConstructor.create.bind(viewerConstructor);
  viewerConstructor.create = async (options: KyxosViewerCreateOptions) => {
    const viewer = await originalCreate(options);
    currentViewer = viewer;
    if (isSSSRoute()) {
      replaceWithSSSStudy(viewer);
      applyDemoMaterial(viewer, currentPreset);
    }
    return viewer;
  };
  constructorState[patchKey] = true;
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-sss-preset]');
  const presetName = button?.dataset.sssPreset as DemoPresetName | undefined;
  if (!presetName || !presets[presetName]) return;

  currentPreset = presetName;
  queueMicrotask(() => {
    if (currentViewer) applyDemoMaterial(currentViewer, currentPreset);
  });
});

document.addEventListener('change', (event) => {
  const select = event.target as HTMLSelectElement | null;
  if (select?.id !== 'model-select' || select.value !== 'procedural:sss-study') return;

  queueMicrotask(() => {
    if (!currentViewer) return;
    replaceWithSSSStudy(currentViewer);
    applyDemoMaterial(currentViewer, currentPreset);
  });
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountStudyModelOption, { once: true });
} else {
  mountStudyModelOption();
}
