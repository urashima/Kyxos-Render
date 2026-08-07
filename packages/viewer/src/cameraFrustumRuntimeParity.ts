import * as THREE from 'three/webgpu';
import type { SceneCamera } from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';
import type { CameraState } from './sceneTypes';

type CameraWithFrustum = SceneCamera & { frustumCulling?: boolean };

interface ViewerPrototype {
  setCameraState(camera?: SceneCamera | CameraState): void;
  __kyxosCameraFrustumRuntimeParityInstalled?: boolean;
}

function isAuthoredCamera(camera: SceneCamera | CameraState): camera is CameraWithFrustum {
  return 'id' in camera;
}

function applyFrustumCulling(viewer: KyxosViewer, enabled: boolean): void {
  const modelRoot = (viewer as unknown as { modelRoot?: THREE.Object3D }).modelRoot;
  if (!modelRoot) return;
  modelRoot.traverse((object) => {
    if (object === modelRoot || object.userData.kyxosToolOverlay) return;
    object.frustumCulled = enabled;
  });
  viewer.canvas.dataset.managedCameraFrustumCulling = String(enabled);
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype.__kyxosCameraFrustumRuntimeParityInstalled) {
  const originalSetCameraState = prototype.setCameraState;
  prototype.setCameraState = function setCameraStateWithFrustumParity(
    this: KyxosViewer,
    camera?: SceneCamera | CameraState,
  ): void {
    originalSetCameraState.call(this, camera);
    if (!camera) return;
    const enabled = !isAuthoredCamera(camera) || camera.frustumCulling !== false;
    applyFrustumCulling(this, enabled);
  };
  prototype.__kyxosCameraFrustumRuntimeParityInstalled = true;
}
