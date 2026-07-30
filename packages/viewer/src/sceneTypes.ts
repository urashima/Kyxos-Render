import type { Transform, Vec3 } from '@kyxos/scene-contract';

export interface AnimationState {
  clipId?: string;
  playing: boolean;
  loop?: boolean;
  speed?: number;
  time?: number;
}
export interface CameraState {
  transform: Transform;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
  autoRotate?: boolean;
}
export interface PickResult {
  nodeId: string;
  distance: number;
  point: Vec3;
}
