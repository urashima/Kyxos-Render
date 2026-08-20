export type Vec3Tuple = [number, number, number];

export interface Ray3 {
  origin: Vec3Tuple;
  direction: Vec3Tuple;
  tMin?: number;
  tMax?: number;
}

export interface RayTriangle {
  a: Vec3Tuple;
  b: Vec3Tuple;
  c: Vec3Tuple;
  normal?: Vec3Tuple;
  materialIndex?: number;
  sourceIndex?: number;
}

export interface BvhNode {
  min: Vec3Tuple;
  max: Vec3Tuple;
  left: number;
  right: number;
  firstTriangle: number;
  triangleCount: number;
}

export interface BuiltBvh {
  nodes: BvhNode[];
  triangles: RayTriangle[];
  sourceTriangleIndices: number[];
}

export interface RayHit {
  triangleIndex: number;
  sourceTriangleIndex: number;
  distance: number;
  barycentric: Vec3Tuple;
  position: Vec3Tuple;
  normal: Vec3Tuple;
  materialIndex: number;
}

const EPSILON = 1e-8;

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3Tuple, value: number): Vec3Tuple {
  return [a[0] * value, a[1] * value, a[2] * value];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(value: Vec3Tuple): Vec3Tuple {
  const length = Math.sqrt(Math.max(EPSILON, dot(value, value)));
  return scale(value, 1 / length);
}

function triangleBounds(triangle: RayTriangle): { min: Vec3Tuple; max: Vec3Tuple; centroid: Vec3Tuple } {
  return {
    min: [
      Math.min(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.min(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.min(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
    max: [
      Math.max(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.max(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.max(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
    centroid: [
      (triangle.a[0] + triangle.b[0] + triangle.c[0]) / 3,
      (triangle.a[1] + triangle.b[1] + triangle.c[1]) / 3,
      (triangle.a[2] + triangle.b[2] + triangle.c[2]) / 3,
    ],
  };
}

function mergeBounds(
  entries: readonly { min: Vec3Tuple; max: Vec3Tuple }[],
  indices: readonly number[],
): { min: Vec3Tuple; max: Vec3Tuple } {
  const min: Vec3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const index of indices) {
    const bounds = entries[index];
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  if (!indices.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function buildBvh(inputTriangles: readonly RayTriangle[], leafSize = 4): BuiltBvh {
  const triangles = inputTriangles.map((triangle, index) => ({
    ...triangle,
    a: [...triangle.a] as Vec3Tuple,
    b: [...triangle.b] as Vec3Tuple,
    c: [...triangle.c] as Vec3Tuple,
    sourceIndex: triangle.sourceIndex ?? index,
  }));
  const bounds = triangles.map(triangleBounds);
  const nodes: BvhNode[] = [];
  const ordered: RayTriangle[] = [];
  const sourceTriangleIndices: number[] = [];
  const safeLeafSize = Math.max(1, Math.floor(leafSize));

  const build = (indices: number[]): number => {
    const nodeIndex = nodes.length;
    const nodeBounds = mergeBounds(bounds, indices);
    nodes.push({
      ...nodeBounds,
      left: -1,
      right: -1,
      firstTriangle: 0,
      triangleCount: 0,
    });

    if (indices.length <= safeLeafSize) {
      const firstTriangle = ordered.length;
      for (const triangleIndex of indices) {
        ordered.push(triangles[triangleIndex]);
        sourceTriangleIndices.push(triangles[triangleIndex].sourceIndex ?? triangleIndex);
      }
      nodes[nodeIndex].firstTriangle = firstTriangle;
      nodes[nodeIndex].triangleCount = indices.length;
      return nodeIndex;
    }

    const centroidMin: Vec3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const centroidMax: Vec3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const index of indices) {
      const centroid = bounds[index].centroid;
      for (let axis = 0; axis < 3; axis += 1) {
        centroidMin[axis] = Math.min(centroidMin[axis], centroid[axis]);
        centroidMax[axis] = Math.max(centroidMax[axis], centroid[axis]);
      }
    }
    const extent: Vec3Tuple = [
      centroidMax[0] - centroidMin[0],
      centroidMax[1] - centroidMin[1],
      centroidMax[2] - centroidMin[2],
    ];
    let axis = 0;
    if (extent[1] > extent[axis]) axis = 1;
    if (extent[2] > extent[axis]) axis = 2;
    indices.sort((a, b) => bounds[a].centroid[axis] - bounds[b].centroid[axis]);
    const middle = Math.max(1, Math.min(indices.length - 1, Math.floor(indices.length / 2)));
    const left = build(indices.slice(0, middle));
    const right = build(indices.slice(middle));
    nodes[nodeIndex].left = left;
    nodes[nodeIndex].right = right;
    return nodeIndex;
  };

  if (triangles.length) build(triangles.map((_, index) => index));
  return { nodes, triangles: ordered, sourceTriangleIndices };
}

export function intersectAabb(
  ray: Ray3,
  min: Vec3Tuple,
  max: Vec3Tuple,
  maximumDistance = ray.tMax ?? Number.POSITIVE_INFINITY,
): boolean {
  let tMin = ray.tMin ?? 0;
  let tMax = maximumDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = ray.direction[axis];
    if (Math.abs(direction) < EPSILON) {
      if (ray.origin[axis] < min[axis] || ray.origin[axis] > max[axis]) return false;
      continue;
    }
    const inverse = 1 / direction;
    let near = (min[axis] - ray.origin[axis]) * inverse;
    let far = (max[axis] - ray.origin[axis]) * inverse;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMax < tMin) return false;
  }
  return true;
}

export function intersectTriangle(ray: Ray3, triangle: RayTriangle): { distance: number; barycentric: Vec3Tuple } | null {
  const edge1 = sub(triangle.b, triangle.a);
  const edge2 = sub(triangle.c, triangle.a);
  const p = cross(ray.direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < EPSILON) return null;
  const inverse = 1 / determinant;
  const t = sub(ray.origin, triangle.a);
  const u = dot(t, p) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross(t, edge1);
  const v = dot(ray.direction, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse;
  if (distance < (ray.tMin ?? 0) || distance > (ray.tMax ?? Number.POSITIVE_INFINITY)) return null;
  return { distance, barycentric: [1 - u - v, u, v] };
}

export function traceClosest(bvh: BuiltBvh, ray: Ray3): RayHit | null {
  if (!bvh.nodes.length) return null;
  const stack = [0];
  let closest = ray.tMax ?? Number.POSITIVE_INFINITY;
  let result: RayHit | null = null;

  while (stack.length) {
    const nodeIndex = stack.pop()!;
    const node = bvh.nodes[nodeIndex];
    if (!intersectAabb(ray, node.min, node.max, closest)) continue;
    if (node.triangleCount > 0) {
      for (let offset = 0; offset < node.triangleCount; offset += 1) {
        const triangleIndex = node.firstTriangle + offset;
        const triangle = bvh.triangles[triangleIndex];
        const hit = intersectTriangle({ ...ray, tMax: closest }, triangle);
        if (!hit || hit.distance >= closest) continue;
        closest = hit.distance;
        const edge1 = sub(triangle.b, triangle.a);
        const edge2 = sub(triangle.c, triangle.a);
        const normal = triangle.normal ? normalize(triangle.normal) : normalize(cross(edge1, edge2));
        result = {
          triangleIndex,
          sourceTriangleIndex: bvh.sourceTriangleIndices[triangleIndex] ?? triangleIndex,
          distance: hit.distance,
          barycentric: hit.barycentric,
          position: add(ray.origin, scale(ray.direction, hit.distance)),
          normal,
          materialIndex: triangle.materialIndex ?? 0,
        };
      }
    } else {
      if (node.right >= 0) stack.push(node.right);
      if (node.left >= 0) stack.push(node.left);
    }
  }
  return result;
}

export function traceAny(bvh: BuiltBvh, ray: Ray3): boolean {
  if (!bvh.nodes.length) return false;
  const stack = [0];
  while (stack.length) {
    const node = bvh.nodes[stack.pop()!];
    if (!intersectAabb(ray, node.min, node.max)) continue;
    if (node.triangleCount > 0) {
      for (let offset = 0; offset < node.triangleCount; offset += 1) {
        if (intersectTriangle(ray, bvh.triangles[node.firstTriangle + offset])) return true;
      }
    } else {
      if (node.right >= 0) stack.push(node.right);
      if (node.left >= 0) stack.push(node.left);
    }
  }
  return false;
}
