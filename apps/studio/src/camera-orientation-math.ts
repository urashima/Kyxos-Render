import type { Transform, Vec3 } from '@kyxos/scene-contract';

export function vectorDistance(left: Vec3, right: Vec3): number {
  return Math.hypot(
    right.x - left.x,
    right.y - left.y,
    right.z - left.z,
  );
}

export function cameraForward(rotation: Vec3): Vec3 {
  const halfX = rotation.x * 0.5;
  const halfY = rotation.y * 0.5;
  const halfZ = rotation.z * 0.5;
  const c1 = Math.cos(halfX);
  const c2 = Math.cos(halfY);
  const c3 = Math.cos(halfZ);
  const s1 = Math.sin(halfX);
  const s2 = Math.sin(halfY);
  const s3 = Math.sin(halfZ);
  const qx = s1 * c2 * c3 + c1 * s2 * s3;
  const qy = c1 * s2 * c3 - s1 * c2 * s3;
  const qz = c1 * c2 * s3 + s1 * s2 * c3;
  const qw = c1 * c2 * c3 - s1 * s2 * s3;

  // Apply quaternion to local camera forward (0, 0, -1).
  const ix = -qy;
  const iy = qx;
  const iz = -qw;
  const iw = qz;
  const x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  const y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  const z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

export function targetFromRotation(
  transform: Transform,
  previousPosition: Vec3,
  previousTarget: Vec3,
): Vec3 {
  const distance = Math.max(0.01, vectorDistance(previousPosition, previousTarget));
  const forward = cameraForward(transform.rotation);
  return {
    x: transform.position.x + forward.x * distance,
    y: transform.position.y + forward.y * distance,
    z: transform.position.z + forward.z * distance,
  };
}

export function shiftCameraTarget(
  previousPosition: Vec3,
  nextPosition: Vec3,
  previousTarget: Vec3,
): Vec3 {
  return {
    x: previousTarget.x + (nextPosition.x - previousPosition.x),
    y: previousTarget.y + (nextPosition.y - previousPosition.y),
    z: previousTarget.z + (nextPosition.z - previousPosition.z),
  };
}

export function rotationFromTarget(position: Vec3, target: Vec3): Vec3 {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return { x: 0, y: 0, z: 0 };
  const x = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  const y = Math.atan2(-dx, -dz);
  return { x, y, z: 0 };
}
