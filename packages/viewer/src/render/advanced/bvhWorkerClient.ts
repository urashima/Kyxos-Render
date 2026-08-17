import { buildBvh, type BuiltBvh, type RayTriangle } from './bvh';

let requestId = 0;

function packTriangles(triangles: readonly RayTriangle[]): Float32Array {
  const stride = 11;
  const packed = new Float32Array(Math.max(stride, triangles.length * stride));
  triangles.forEach((triangle, index) => {
    const base = index * stride;
    packed.set([
      ...triangle.a,
      ...triangle.b,
      ...triangle.c,
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
