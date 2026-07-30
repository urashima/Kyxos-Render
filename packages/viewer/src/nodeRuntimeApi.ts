import * as THREE from 'three/webgpu';
import type { Transform } from '@kyxos/scene-contract';
import { KyxosViewer } from './KyxosViewer';

function internals(viewer: KyxosViewer): Record<string, any> {
  return viewer as unknown as Record<string, any>;
}

function findNodeObject(
  viewer: KyxosViewer,
  nodeId: string,
): THREE.Object3D | null {
  const root = internals(viewer).modelRoot as THREE.Object3D | undefined;
  let result: THREE.Object3D | null = null;
  root?.traverse((object) => {
    if (!result && object.userData.kyxosNodeId === nodeId) result = object;
  });
  return result;
}

const originalGetNodeState = KyxosViewer.prototype.getNodeState;
KyxosViewer.prototype.getNodeState = function getRuntimeNodeState(nodeId: string) {
  const original = originalGetNodeState.call(this, nodeId);
  if (original) return original;
  const object = findNodeObject(this, nodeId);
  if (!object) return null;
  return {
    id: nodeId,
    visible: object.visible,
    transform: {
      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      },
      rotation: {
        x: object.rotation.x,
        y: object.rotation.y,
        z: object.rotation.z,
      },
      scale: {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z,
      },
    },
  };
};

const originalSetNodeTransform = KyxosViewer.prototype.setNodeTransform;
KyxosViewer.prototype.setNodeTransform = function setRuntimeNodeTransform(
  nodeId: string,
  transform: Transform,
): void {
  originalSetNodeTransform.call(this, nodeId, transform);
  const object = findNodeObject(this, nodeId);
  if (!object) return;
  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.rotation.set(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  object.updateMatrix();
  object.updateMatrixWorld(true);
};

const originalSetNodeVisibility = KyxosViewer.prototype.setNodeVisibility;
KyxosViewer.prototype.setNodeVisibility = function setRuntimeNodeVisibility(
  nodeId: string,
  visible: boolean,
): void {
  originalSetNodeVisibility.call(this, nodeId, visible);
  const object = findNodeObject(this, nodeId);
  if (object) object.visible = visible;
};

const originalFrameNode = KyxosViewer.prototype.frameNode;
KyxosViewer.prototype.frameNode = function frameRuntimeNode(nodeId: string): void {
  const object = findNodeObject(this, nodeId);
  if (!object) {
    originalFrameNode.call(this, nodeId);
    return;
  }
  const internal = internals(this);
  const sphere = new THREE.Box3()
    .setFromObject(object)
    .getBoundingSphere(new THREE.Sphere());
  internal.controls.target.copy(sphere.center);
  const direction = internal.camera.position
    .clone()
    .sub(sphere.center)
    .normalize();
  internal.camera.position.copy(sphere.center).add(
    direction.multiplyScalar(Math.max(sphere.radius * 2.7, 1)),
  );
  internal.controls.update();
  this.resetTemporal('frame-runtime-node');
};
