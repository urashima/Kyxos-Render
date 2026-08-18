import { buildBvh, type BuiltBvh, type RayTriangle, type Vec3Tuple } from './bvh';

let requestId = 0;

interface SmoothRayTriangle extends RayTriangle {
  normalA?: Vec3Tuple;
  normalB?: Vec3Tuple;
  normalC?: Vec3Tuple;
}

function normalizedFaceNormal(triangle: RayTriangle): Vec3Tuple {
  if (triangle.normal) return triangle.normal;
  const ab: Vec3Tuple = [
    triangle.b[0] - triangle.a[0],
    triangle.b[1] - triangle.a[1],
    triangle.b[2] - triangle.a[2],
  ];
  const ac: Vec3Tuple = [
    triangle.c[0] - triangle.a[0],
    triangle.c[1] - triangle.a[1],
    triangle.c[2] - triangle.a[2],
  ];
  const cross: Vec3Tuple = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(cross[0], cross[1], cross[2]);
  return length > 1e-12
    ? [cross[0] / length, cross[1] / length, cross[2] / length]
    : [0, 1, 0];
}

/**
 * Worker packet layout (23 floats):
 * position A/B/C (9), geometric normal (3), shading normal A/B/C (9),
 * material index (1), source triangle index (1).
 *
 * Keeping the shading normals here is critical: buildBvh() reorders triangle
 * records, so restoring normals after the worker response would associate them
 * with the wrong triangle.
 */
function packTriangles(triangles: readonly RayTriangle[]): Float32Array {
  const stride = 23;
  const packed = new Float32Array(Math.max(stride, triangles.length * stride));
  triangles.forEach((triangle, index) => {
    const smooth = triangle as SmoothRayTriangle;
    const faceNormal = normalizedFaceNormal(triangle);
    const normalA = smooth.normalA ?? faceNormal;
    const normalB = smooth.normalB ?? faceNormal;
    const normalC = smooth.normalC ?? faceNormal;
    const base = index * stride;
    packed.set([
      ...triangle.a,
      ...triangle.b,
      ...triangle.c,
      ...faceNormal,
      ...normalA,
      ...normalB,
      ...normalC,
      triangle.materialIndex ?? 0,
      triangle.sourceIndex ?? index,
    ], base);
  });
  return packed;
}

export interface AsyncBvhBuildResult {
  bvh: BuiltBvh;
  workerUsed: boolean;
}

export async function buildBvhAsync(
  triangles: readonly RayTriangle[],
  leafSize = 4,
): Promise<AsyncBvhBuildResult> {
  if (!triangles.length) return { bvh: buildBvh([], leafSize), workerUsed: false };
  if (typeof Worker !== 'function' || typeof URL !== 'function') {
    return { bvh: buildBvh(triangles, leafSize), workerUsed: false };
  }

  const packed = packTriangles(triangles);
  const id = ++requestId;
  try {
    const worker = new Worker(new URL('./bvhWorker.ts', import.meta.url), {
      type: 'module',
      name: 'kyxos-bvh-builder',
    });
    const response = await new Promise<BuiltBvh>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        worker.terminate();
        reject(new Error('BVH worker timed out.'));
      }, 60_000);
      worker.addEventListener('error', (event) => {
        globalThis.clearTimeout(timeout);
        worker.terminate();
        reject(event.error ?? new Error(event.message || 'BVH worker failed.'));
      }, { once: true });
      worker.addEventListener('message', (event: MessageEvent<{
        id: number;
        ok: boolean;
        bvh?: BuiltBvh;
        error?: string;
      }>) => {
        if (event.data.id !== id) return;
        globalThis.clearTimeout(timeout);
        worker.terminate();
        if (!event.data.ok || !event.data.bvh) {
          reject(new Error(event.data.error ?? 'BVH worker returned no result.'));
          return;
        }
        resolve(event.data.bvh);
      });
      worker.postMessage({
        id,
        packedTriangles: packed.buffer,
        triangleCount: triangles.length,
        leafSize,
      }, [packed.buffer]);
    });
    return { bvh: response, workerUsed: true };
  } catch {
    return { bvh: buildBvh(triangles, leafSize), workerUsed: false };
  }
}
