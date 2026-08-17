/// <reference lib="webworker" />

import { buildBvh, type RayTriangle, type Vec3Tuple } from './bvh';

interface BvhWorkerRequest {
  id: number;
  packedTriangles: ArrayBuffer;
  triangleCount: number;
  leafSize: number;
}

interface BvhWorkerResponse {
  id: number;
  ok: boolean;
  bvh?: ReturnType<typeof buildBvh>;
  error?: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

function unpack(buffer: ArrayBuffer, count: number): RayTriangle[] {
  const packed = new Float32Array(buffer);
  const stride = 11;
  const triangles: RayTriangle[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const base = index * stride;
    triangles[index] = {
      a: [packed[base], packed[base + 1], packed[base + 2]] as Vec3Tuple,
      b: [packed[base + 3], packed[base + 4], packed[base + 5]] as Vec3Tuple,
      c: [packed[base + 6], packed[base + 7], packed[base + 8]] as Vec3Tuple,
      materialIndex: Math.max(0, Math.round(packed[base + 9])),
      sourceIndex: Math.max(0, Math.round(packed[base + 10])),
    };
  }
  return triangles;
}

scope.addEventListener('message', (event: MessageEvent<BvhWorkerRequest>) => {
  const request = event.data;
  try {
    const triangles = unpack(request.packedTriangles, request.triangleCount);
    const bvh = buildBvh(triangles, request.leafSize);
    const response: BvhWorkerResponse = { id: request.id, ok: true, bvh };
    scope.postMessage(response);
  } catch (error) {
    const response: BvhWorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
});

export {};
