import * as THREE from 'three/webgpu';
import { buildBvh, type BuiltBvh, type RayTriangle, type Vec3Tuple } from './bvh';
import { buildBvhAsync } from './bvhWorkerClient';
import { buildAliasTable, buildEnvironmentAliasTable } from './sampling';

export interface ExtractedAdvancedScene {
  bvh: BuiltBvh;
  bvhWorkerUsed: boolean;
  triangles: Float32Array;
  nodes: Float32Array;
  materials: Float32Array;
  lights: Float32Array;
  lightAlias: Float32Array;
  environmentPixels: Float32Array;
  environmentAlias: Float32Array;
  environmentWidth: number;
  environmentHeight: number;
  triangleCount: number;
  materialCount: number;
  lightCount: number;
  emissiveLightCount: number;
  dynamicMeshes: boolean;
  estimatedBytes: number;
}

interface MaterialRecord {
  color: [number, number, number];
  metalness: number;
  emissive: [number, number, number];
  roughness: number;
  transmission: number;
  ior: number;
  clearcoat: number;
  opacity: number;
}

interface LightRecord {
  type: 0 | 1 | 2 | 3;
  a: [number, number, number, number];
  b: [number, number, number, number];
  c: [number, number, number, number];
  color: [number, number, number];
  intensity: number;
  power: number;
}

interface ExtractedGeometry {
  triangles: RayTriangle[];
  materialRecords: MaterialRecord[];
  emissiveLights: LightRecord[];
  dynamicMeshes: boolean;
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rgb(color: any, fallback = 1): [number, number, number] {
  return [finite(color?.r, fallback), finite(color?.g, fallback), finite(color?.b, fallback)];
}

function materialRecord(material: any): MaterialRecord {
  const color = rgb(material?.color, 1);
  const emissive = rgb(material?.emissive, 0);
  const emissiveIntensity = Math.max(0, finite(material?.emissiveIntensity, 1));
  return {
    color,
    metalness: Math.max(0, Math.min(1, finite(material?.metalness, 0))),
    emissive: [
      emissive[0] * emissiveIntensity,
      emissive[1] * emissiveIntensity,
      emissive[2] * emissiveIntensity,
    ],
    roughness: Math.max(0.015, Math.min(1, finite(material?.roughness, 1))),
    transmission: Math.max(0, Math.min(1, finite(material?.transmission, 0))),
    ior: Math.max(1.0001, Math.min(3, finite(material?.ior, 1.5))),
    clearcoat: Math.max(0, Math.min(1, finite(material?.clearcoat, 0))),
    opacity: Math.max(0, Math.min(1, finite(material?.opacity, 1))),
  };
}

function luminance3(value: readonly number[]): number {
  return Math.max(0, value[0] * 0.2126 + value[1] * 0.7152 + value[2] * 0.0722);
}

function triangleArea(a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return 0.5 * Math.hypot(cross[0], cross[1], cross[2]);
}

function getVertex(mesh: any, index: number, target: THREE.Vector3): THREE.Vector3 {
  if (typeof mesh.getVertexPosition === 'function') return mesh.getVertexPosition(index, target);
  return target.fromBufferAttribute(mesh.geometry.attributes.position, index);
}

function resolveTriangleMaterial(mesh: any, triangleOffset: number): any {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length <= 1) return materials[0];
  const groups = mesh.geometry.groups as Array<{ start: number; count: number; materialIndex?: number }>;
  const group = groups.find((entry) => triangleOffset >= entry.start && triangleOffset < entry.start + entry.count);
  return materials[group?.materialIndex ?? 0] ?? materials[0];
}

function extractGeometry(scene: any): ExtractedGeometry {
  const triangles: RayTriangle[] = [];
  const materialRecords: MaterialRecord[] = [];
  const materialIndices = new Map<any, number>();
  const emissiveLights: LightRecord[] = [];
  let dynamicMeshes = false;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  scene?.updateMatrixWorld?.(true);
  scene?.traverse?.((object: any) => {
    if (!object?.visible || !object.isMesh || !object.geometry?.attributes?.position) return;
    dynamicMeshes ||= Boolean(object.isSkinnedMesh || object.morphTargetInfluences?.length);
    object.updateWorldMatrix?.(true, false);
    const geometry = object.geometry;
    const index = geometry.index;
    const triangleVertexCount = index ? index.count : geometry.attributes.position.count;
    for (let offset = 0; offset + 2 < triangleVertexCount; offset += 3) {
      const ia = index ? index.getX(offset) : offset;
      const ib = index ? index.getX(offset + 1) : offset + 1;
      const ic = index ? index.getX(offset + 2) : offset + 2;
      getVertex(object, ia, a).applyMatrix4(object.matrixWorld);
      getVertex(object, ib, b).applyMatrix4(object.matrixWorld);
      getVertex(object, ic, c).applyMatrix4(object.matrixWorld);
      const va: Vec3Tuple = [a.x, a.y, a.z];
      const vb: Vec3Tuple = [b.x, b.y, b.z];
      const vc: Vec3Tuple = [c.x, c.y, c.z];
      const material = resolveTriangleMaterial(object, offset);
      let materialIndex = materialIndices.get(material);
      if (materialIndex == null) {
        materialIndex = materialRecords.length;
        materialIndices.set(material, materialIndex);
        materialRecords.push(materialRecord(material));
      }
      const triangleIndex = triangles.length;
      triangles.push({ a: va, b: vb, c: vc, materialIndex, sourceIndex: triangleIndex });
      const record = materialRecords[materialIndex];
      const emissivePower = luminance3(record.emissive) * triangleArea(va, vb, vc);
      if (emissivePower > 1e-6 && emissiveLights.length < 8192) {
        emissiveLights.push({
          type: 2,
          a: [va[0], va[1], va[2], 1],
          b: [vb[0], vb[1], vb[2], 1],
          c: [vc[0], vc[1], vc[2], 1],
          color: record.emissive,
          intensity: 1,
          power: emissivePower,
        });
      }
    }
  });

  if (!materialRecords.length) materialRecords.push(materialRecord(null));
  return { triangles, materialRecords, emissiveLights, dynamicMeshes };
}

function extractAnalyticLights(scene: any): LightRecord[] {
  const result: LightRecord[] = [];
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const direction = new THREE.Vector3();
  scene?.traverse?.((light: any) => {
    if (!light?.visible || !light.isLight || light.isAmbientLight || light.isHemisphereLight) return;
    light.getWorldPosition(position);
    const color = rgb(light.color, 1);
    const intensity = Math.max(0, finite(light.intensity, 1));
    if (light.isDirectionalLight) {
      light.target?.getWorldPosition?.(target);
      direction.copy(position).sub(target).normalize();
      result.push({
        type: 0,
        a: [direction.x, direction.y, direction.z, 0],
        b: [0, 0, 0, 0], c: [0, 0, 0, 0], color, intensity,
        power: Math.max(1e-6, luminance3(color) * intensity),
      });
      return;
    }
    if (light.isSpotLight) {
      light.target?.getWorldPosition?.(target);
      direction.copy(target).sub(position).normalize();
      const outer = Math.cos(Math.max(0, finite(light.angle, Math.PI / 3)));
      const penumbra = Math.max(0, Math.min(1, finite(light.penumbra, 0)));
      const inner = Math.cos(Math.max(0, finite(light.angle, Math.PI / 3)) * (1 - penumbra));
      result.push({
        type: 3,
        a: [position.x, position.y, position.z, Math.max(0, finite(light.distance, 0))],
        b: [direction.x, direction.y, direction.z, inner],
        c: [outer, Math.max(0, finite(light.decay, 2)), 0, 0], color, intensity,
        power: Math.max(1e-6, luminance3(color) * intensity),
      });
      return;
    }
    if (light.isPointLight) {
      result.push({
        type: 1,
        a: [position.x, position.y, position.z, Math.max(0, finite(light.distance, 0))],
        b: [0, 0, 0, 0],
        c: [Math.max(0, finite(light.decay, 2)), 0, 0, 0], color, intensity,
        power: Math.max(1e-6, luminance3(color) * intensity),
      });
    }
  });
  return result;
}

function packTriangles(bvh: BuiltBvh): Float32Array {
  const output = new Float32Array(Math.max(16, bvh.triangles.length * 16));
  bvh.triangles.forEach((triangle, index) => {
    const base = index * 16;
    output.set([...triangle.a, 1, ...triangle.b, 1, ...triangle.c, 1], base);
    const ab = new THREE.Vector3(
      triangle.b[0] - triangle.a[0], triangle.b[1] - triangle.a[1], triangle.b[2] - triangle.a[2],
    );
    const ac = new THREE.Vector3(
      triangle.c[0] - triangle.a[0], triangle.c[1] - triangle.a[1], triangle.c[2] - triangle.a[2],
    );
    const normal = ab.cross(ac).normalize();
    output.set([normal.x, normal.y, normal.z, triangle.materialIndex ?? 0], base + 12);
  });
  return output;
}

function packNodes(bvh: BuiltBvh): Float32Array {
  const output = new Float32Array(Math.max(12, bvh.nodes.length * 12));
  bvh.nodes.forEach((node, index) => {
    const base = index * 12;
    output.set([...node.min, node.left, ...node.max, node.right, node.firstTriangle, node.triangleCount, 0, 0], base);
  });
  return output;
}

function packMaterials(records: readonly MaterialRecord[]): Float32Array {
  const output = new Float32Array(Math.max(12, records.length * 12));
  records.forEach((material, index) => {
    const base = index * 12;
    output.set([...material.color, material.metalness], base);
    output.set([...material.emissive, material.roughness], base + 4);
    output.set([material.transmission, material.ior, material.clearcoat, material.opacity], base + 8);
  });
  return output;
}

function packLights(records: readonly LightRecord[]): { lights: Float32Array; alias: Float32Array } {
  const output = new Float32Array(Math.max(16, records.length * 16));
  const weights = records.map((entry) => entry.power);
  records.forEach((light, index) => {
    const base = index * 16;
    output.set(light.a, base);
    output.set(light.b, base + 4);
    output.set(light.c, base + 8);
    output.set([
      light.color[0] * light.intensity,
      light.color[1] * light.intensity,
      light.color[2] * light.intensity,
      light.type,
    ], base + 12);
  });
  const table = buildAliasTable(weights);
  const alias = new Float32Array(Math.max(4, table.length * 4));
  table.forEach((entry, index) => alias.set([entry.probability, entry.alias, entry.mass, 0], index * 4));
  return { lights: output, alias };
}

function halfToFloat(value: number): number {
  const dataUtils = (THREE as unknown as { DataUtils?: { fromHalfFloat?(value: number): number } }).DataUtils;
  return dataUtils?.fromHalfFloat?.(value) ?? value / 65535;
}

function readTextureComponent(data: ArrayLike<number>, index: number, half: boolean): number {
  const value = Number(data[index] ?? 0);
  return half ? halfToFloat(value) : value;
}

function extractEnvironment(scene: any, resource: any): {
  pixels: Float32Array;
  alias: Float32Array;
  width: number;
  height: number;
} {
  const texture = resource?.isTexture ? resource : resource?.texture ?? scene?.environment;
  const image = texture?.image;
  const sourceData = image?.data as ArrayLike<number> | undefined;
  const sourceWidth = Math.max(1, Math.floor(finite(image?.width, 1)));
  const sourceHeight = Math.max(1, Math.floor(finite(image?.height, 1)));
  if (!sourceData?.length || sourceWidth * sourceHeight <= 1) {
    const background = scene?.background?.isColor ? rgb(scene.background, 0.04) : [0.04, 0.04, 0.04] as [number, number, number];
    const pixels = new Float32Array([background[0], background[1], background[2], 1]);
    const alias = new Float32Array([1, 0, 1, 4 * Math.PI]);
    return { pixels, alias, width: 1, height: 1 };
  }

  const scale = Math.min(1, 512 / sourceWidth, 256 / sourceHeight);
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  const channels = Math.max(1, Math.round(sourceData.length / (sourceWidth * sourceHeight)));
  const half = sourceData instanceof Uint16Array && texture?.type === (THREE as any).HalfFloatType;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(sourceHeight - 1, Math.floor(((y + 0.5) / height) * sourceHeight));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sourceWidth - 1, Math.floor(((x + 0.5) / width) * sourceWidth));
      const source = (sy * sourceWidth + sx) * channels;
      const destination = (y * width + x) * 4;
      pixels[destination] = readTextureComponent(sourceData, source, half);
      pixels[destination + 1] = readTextureComponent(sourceData, source + Math.min(1, channels - 1), half);
      pixels[destination + 2] = readTextureComponent(sourceData, source + Math.min(2, channels - 1), half);
      pixels[destination + 3] = 1;
    }
  }
  const distribution = buildEnvironmentAliasTable(width, height, (x, y) => {
    const offset = (y * width + x) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  });
  const alias = new Float32Array(Math.max(4, distribution.entries.length * 4));
  distribution.entries.forEach((entry, index) => {
    const y = Math.floor(index / width);
    const theta0 = (Math.PI * y) / height;
    const theta1 = (Math.PI * (y + 1)) / height;
    const solidAngle = (2 * Math.PI * (Math.cos(theta0) - Math.cos(theta1))) / width;
    alias.set([entry.probability, entry.alias, entry.mass, solidAngle], index * 4);
  });
  return { pixels, alias, width, height };
}

function finalizeAdvancedScene(
  runtime: any,
  geometry: ExtractedGeometry,
  bvh: BuiltBvh,
  bvhWorkerUsed: boolean,
): ExtractedAdvancedScene {
  const scene = runtime.scene;
  const analytic = extractAnalyticLights(scene);
  const lightRecords = [...analytic, ...geometry.emissiveLights];
  const packedLights = packLights(lightRecords);
  const environment = extractEnvironment(scene, runtime.environmentResource);
  const triangles = packTriangles(bvh);
  const nodes = packNodes(bvh);
  const materials = packMaterials(geometry.materialRecords);
  const estimatedBytes =
    triangles.byteLength + nodes.byteLength + materials.byteLength + packedLights.lights.byteLength +
    packedLights.alias.byteLength + environment.pixels.byteLength + environment.alias.byteLength;

  return {
    bvh,
    bvhWorkerUsed,
    triangles,
    nodes,
    materials,
    lights: packedLights.lights,
    lightAlias: packedLights.alias,
    environmentPixels: environment.pixels,
    environmentAlias: environment.alias,
    environmentWidth: environment.width,
    environmentHeight: environment.height,
    triangleCount: bvh.triangles.length,
    materialCount: geometry.materialRecords.length,
    lightCount: lightRecords.length,
    emissiveLightCount: geometry.emissiveLights.length,
    dynamicMeshes: geometry.dynamicMeshes,
    estimatedBytes,
  };
}

export function extractAdvancedScene(viewer: unknown): ExtractedAdvancedScene {
  const runtime = viewer as any;
  const geometry = extractGeometry(runtime.scene);
  return finalizeAdvancedScene(runtime, geometry, buildBvh(geometry.triangles, 4), false);
}

export async function extractAdvancedSceneAsync(viewer: unknown): Promise<ExtractedAdvancedScene> {
  const runtime = viewer as any;
  const geometry = extractGeometry(runtime.scene);
  // Yield once before starting the worker so the existing raster frame can be
  // presented and Studio can display the Building state immediately.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const { bvh, workerUsed } = await buildBvhAsync(geometry.triangles, 4);
  return finalizeAdvancedScene(runtime, geometry, bvh, workerUsed);
}
