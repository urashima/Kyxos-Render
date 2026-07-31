import * as THREE from 'three/webgpu';

import { disposeObject3D } from '../utils/dispose';

type ViewerInternals = {
  modelRoot: THREE.Group;
  loadModel: (url: string) => Promise<void>;
  resetTemporal: (reason?: string) => void;
};

type ViewerConstructor = { prototype: unknown };

const installKey = Symbol.for('kyxos.viewer.sss-study-model');

function createStudyMaterial(name: string, thickness: number) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#c98772',
    metalness: 0.02,
    roughness: 0.58,
    clearcoat: 0.1,
    clearcoatRoughness: 0.38,
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

function replaceWithSSSStudy(viewer: ViewerInternals) {
  disposeObject3D(viewer.modelRoot);
  viewer.modelRoot.clear();

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

  viewer.modelRoot.add(study);
}

/**
 * Adds `procedural:sss-study` without importing Three.js from the Playground.
 * Keeping model creation inside @kyxos/viewer guarantees that materials and TSL
 * nodes use the same Three.js module instance and the same shader stack context.
 */
export function installSSSStudyModelExtension(Viewer: ViewerConstructor) {
  const prototype = Viewer.prototype as ViewerInternals & Record<PropertyKey, unknown>;
  if (prototype[installKey]) return;

  const originalLoadModel = prototype.loadModel;
  prototype.loadModel = async function (url: string) {
    if (url !== 'procedural:sss-study') {
      await originalLoadModel.call(this, url);
      return;
    }

    replaceWithSSSStudy(this);
    this.resetTemporal('model-switch:sss-study');
  };

  Object.defineProperty(prototype, installKey, { value: true });
}
