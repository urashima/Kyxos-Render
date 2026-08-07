import type { SceneNode, Transform } from '@kyxos/scene-contract';

export type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

const EPSILON = 1e-8;

export const identityMatrix4 = (): Matrix4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export function composeTransform(transform: Transform): Matrix4 {
  const halfX = transform.rotation.x * 0.5;
  const halfY = transform.rotation.y * 0.5;
  const halfZ = transform.rotation.z * 0.5;
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
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  const sx = transform.scale.x;
  const sy = transform.scale.y;
  const sz = transform.scale.z;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    transform.position.x,
    transform.position.y,
    transform.position.z,
    1,
  ];
}

export function multiplyMatrix4(a: Matrix4, b: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0) as Matrix4;
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return result;
}

export function determinantMatrix4(matrix: Matrix4): number {
  const [
    n11, n21, n31, n41,
    n12, n22, n32, n42,
    n13, n23, n33, n43,
    n14, n24, n34, n44,
  ] = matrix;
  return (
    n41 * (
      +n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 +
      n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34
    ) +
    n42 * (
      +n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 -
      n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31
    ) +
    n43 * (
      +n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 +
      n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31
    ) +
    n44 * (
      -n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 +
      n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31
    )
  );
}

export function invertMatrix4(matrix: Matrix4): Matrix4 | null {
  const [
    n11, n21, n31, n41,
    n12, n22, n32, n42,
    n13, n23, n33, n43,
    n14, n24, n34, n44,
  ] = matrix;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 -
    n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 +
    n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 -
    n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 +
    n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const determinant = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (Math.abs(determinant) <= EPSILON) return null;
  const inverseDeterminant = 1 / determinant;
  return [
    t11 * inverseDeterminant,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * inverseDeterminant,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * inverseDeterminant,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * inverseDeterminant,
    t12 * inverseDeterminant,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * inverseDeterminant,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * inverseDeterminant,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * inverseDeterminant,
    t13 * inverseDeterminant,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * inverseDeterminant,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * inverseDeterminant,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * inverseDeterminant,
    t14 * inverseDeterminant,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * inverseDeterminant,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * inverseDeterminant,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * inverseDeterminant,
  ];
}

function columnLength(matrix: Matrix4, offset: number): number {
  return Math.hypot(matrix[offset], matrix[offset + 1], matrix[offset + 2]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function decomposeTransform(matrix: Matrix4): Transform {
  let sx = columnLength(matrix, 0);
  const sy = columnLength(matrix, 4);
  const sz = columnLength(matrix, 8);
  if (determinantMatrix4(matrix) < 0) sx = -sx;
  const inverseSx = Math.abs(sx) > EPSILON ? 1 / sx : 0;
  const inverseSy = Math.abs(sy) > EPSILON ? 1 / sy : 0;
  const inverseSz = Math.abs(sz) > EPSILON ? 1 / sz : 0;
  const m11 = matrix[0] * inverseSx;
  const m12 = matrix[4] * inverseSy;
  const m13 = matrix[8] * inverseSz;
  const m22 = matrix[5] * inverseSy;
  const m23 = matrix[9] * inverseSz;
  const m32 = matrix[6] * inverseSy;
  const m33 = matrix[10] * inverseSz;
  const y = Math.asin(clamp(m13, -1, 1));
  const singular = Math.abs(m13) >= 0.9999999;
  return {
    position: { x: matrix[12], y: matrix[13], z: matrix[14] },
    rotation: singular
      ? { x: Math.atan2(m32, m22), y, z: 0 }
      : { x: Math.atan2(-m23, m33), y, z: Math.atan2(-m12, m11) },
    scale: { x: sx, y: sy, z: sz },
  };
}

export function hierarchyRootIds(nodes: SceneNode[], ids: Iterable<string>): string[] {
  const selected = new Set(ids);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    if (!selected.has(node.id)) return false;
    let parentId = node.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return true;
  }).map((node) => node.id);
}

export function worldMatrixMap(nodes: SceneNode[]): Map<string, Matrix4> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Map<string, Matrix4>();
  const resolving = new Set<string>();
  const resolve = (id: string): Matrix4 => {
    const cached = result.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || resolving.has(id)) return identityMatrix4();
    resolving.add(id);
    const local = composeTransform(node.transform);
    const world = node.parentId && byId.has(node.parentId)
      ? multiplyMatrix4(resolve(node.parentId), local)
      : local;
    resolving.delete(id);
    result.set(id, world);
    return world;
  };
  for (const node of nodes) resolve(node.id);
  return result;
}

export function localTransformForWorld(
  world: Matrix4,
  parentWorld?: Matrix4 | null,
): Transform | null {
  if (!parentWorld) return decomposeTransform(world);
  const inverseParent = invertMatrix4(parentWorld);
  return inverseParent ? decomposeTransform(multiplyMatrix4(inverseParent, world)) : null;
}
