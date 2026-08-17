import { buildBvh, type BuiltBvh, type RayTriangle, type Vec3Tuple } from './bvh';

export type Mat4Tuple = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface Aabb3 {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

export interface MeshBlas {
  id: string;
  bvh: BuiltBvh;
  bounds: Aabb3;
}

export interface SceneAccelerationInstance {
  id: string;
  blasIndex: number;
  world: Mat4Tuple;
  inverseWorld: Mat4Tuple;
  worldBounds: Aabb3;
}

export interface TlasNode {
  min: Vec3Tuple;
  max: Vec3Tuple;
  left: number;
  right: number;
  firstInstance: number;
  instanceCount: number;
}

export interface BuiltTlas {
  nodes: TlasNode[];
  /** Instances reordered so every leaf references one contiguous range. */
  orderedInstanceIndices: number[];
}

export interface FlattenedAcceleration {
  triangles: RayTriangle[];
  blasNodes: Array<{
    min: Vec3Tuple;
    max: Vec3Tuple;
    left: number;
    right: number;
    firstTriangle: number;
    triangleCount: number;
  }>;
  instances: SceneAccelerationInstance[];
  blasRoots: number[];
  tlas: BuiltTlas;
}

function boundsFromBvh(bvh: BuiltBvh): Aabb3 {
  const root = bvh.nodes[0];
  return root
    ? { min: [...root.min] as Vec3Tuple, max: [...root.max] as Vec3Tuple }
    : { min: [0, 0, 0], max: [0, 0, 0] };
}

export function buildMeshBlas(id: string, triangles: readonly RayTriangle[], leafSize = 4): MeshBlas {
  const bvh = buildBvh(triangles, leafSize);
  return { id, bvh, bounds: boundsFromBvh(bvh) };
}

export function transformPoint(matrix: Mat4Tuple, point: Vec3Tuple): Vec3Tuple {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const inverseW = Math.abs(w) > 1e-12 ? 1 / w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * inverseW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * inverseW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * inverseW,
  ];
}

export function transformBounds(bounds: Aabb3, matrix: Mat4Tuple): Aabb3 {
  const minimum: Vec3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum: Vec3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let mask = 0; mask < 8; mask += 1) {
    const point: Vec3Tuple = [
      mask & 1 ? bounds.max[0] : bounds.min[0],
      mask & 2 ? bounds.max[1] : bounds.min[1],
      mask & 4 ? bounds.max[2] : bounds.min[2],
    ];
    const world = transformPoint(matrix, point);
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], world[axis]);
      maximum[axis] = Math.max(maximum[axis], world[axis]);
    }
  }
  return { min: minimum, max: maximum };
}

function mergeBounds(instances: readonly SceneAccelerationInstance[], indices: readonly number[]): Aabb3 {
  const min: Vec3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const index of indices) {
    const bounds = instances[index].worldBounds;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  if (!indices.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

function centroid(instance: SceneAccelerationInstance, axis: number): number {
  return (instance.worldBounds.min[axis] + instance.worldBounds.max[axis]) * 0.5;
}

export function buildTlas(instances: readonly SceneAccelerationInstance[], leafSize = 2): BuiltTlas {
  const nodes: TlasNode[] = [];
  const orderedInstanceIndices: number[] = [];
  const safeLeafSize = Math.max(1, Math.floor(leafSize));

  const build = (indices: number[]): number => {
    const nodeIndex = nodes.length;
    const bounds = mergeBounds(instances, indices);
    nodes.push({
      ...bounds,
      left: -1,
      right: -1,
      firstInstance: 0,
      instanceCount: 0,
    });
    if (indices.length <= safeLeafSize) {
      const firstInstance = orderedInstanceIndices.length;
      orderedInstanceIndices.push(...indices);
      nodes[nodeIndex].firstInstance = firstInstance;
      nodes[nodeIndex].instanceCount = indices.length;
      return nodeIndex;
    }

    const extent: Vec3Tuple = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    let axis = 0;
    if (extent[1] > extent[axis]) axis = 1;
    if (extent[2] > extent[axis]) axis = 2;
    indices.sort((a, b) => centroid(instances[a], axis) - centroid(instances[b], axis));
    const middle = Math.max(1, Math.min(indices.length - 1, Math.floor(indices.length / 2)));
    nodes[nodeIndex].left = build(indices.slice(0, middle));
    nodes[nodeIndex].right = build(indices.slice(middle));
    return nodeIndex;
  };

  if (instances.length) build(instances.map((_, index) => index));
  return { nodes, orderedInstanceIndices };
}

export function flattenAcceleration(
  blases: readonly MeshBlas[],
  inputInstances: readonly SceneAccelerationInstance[],
): FlattenedAcceleration {
  const triangles: RayTriangle[] = [];
  const blasNodes: FlattenedAcceleration['blasNodes'] = [];
  const blasRoots = new Array<number>(blases.length).fill(-1);

  blases.forEach((blas, blasIndex) => {
    const triangleOffset = triangles.length;
    const nodeOffset = blasNodes.length;
    blasRoots[blasIndex] = blas.bvh.nodes.length ? nodeOffset : -1;
    triangles.push(...blas.bvh.triangles.map((triangle) => ({
      ...triangle,
      a: [...triangle.a] as Vec3Tuple,
      b: [...triangle.b] as Vec3Tuple,
      c: [...triangle.c] as Vec3Tuple,
    })));
    for (const node of blas.bvh.nodes) {
      blasNodes.push({
        min: [...node.min] as Vec3Tuple,
        max: [...node.max] as Vec3Tuple,
        left: node.left >= 0 ? node.left + nodeOffset : -1,
        right: node.right >= 0 ? node.right + nodeOffset : -1,
        firstTriangle: node.firstTriangle + triangleOffset,
        triangleCount: node.triangleCount,
      });
    }
  });

  const tlas = buildTlas(inputInstances);
  const instances = tlas.orderedInstanceIndices.map((index) => inputInstances[index]);
  return { triangles, blasNodes, instances, blasRoots, tlas };
}

export function refitInstances(
  blases: readonly MeshBlas[],
  instances: readonly SceneAccelerationInstance[],
  transforms: ReadonlyMap<string, { world: Mat4Tuple; inverseWorld: Mat4Tuple }>,
): { instances: SceneAccelerationInstance[]; tlas: BuiltTlas } {
  const next = instances.map((instance) => {
    const transform = transforms.get(instance.id);
    if (!transform) return instance;
    const blas = blases[instance.blasIndex];
    return {
      ...instance,
      world: transform.world,
      inverseWorld: transform.inverseWorld,
      worldBounds: transformBounds(blas.bounds, transform.world),
    };
  });
  return { instances: next, tlas: buildTlas(next) };
}
