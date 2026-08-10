import type {
  KyxosSceneContract,
  SceneNode,
  ScenePatch,
  Transform,
  Vec3,
} from '@kyxos/scene-contract';

export type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz' | 'xyz';
export type GizmoTransformMode = 'translate' | 'rotate' | 'scale';
export type GizmoCoordinateSpace = 'world' | 'local';
export type GizmoPivotMode = 'center' | 'last-selected' | 'individual';

export interface GizmoRay {
  origin: Vec3;
  direction: Vec3;
}

export interface GizmoCamera {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  orthographic?: boolean;
  orthographicSize?: number;
  fov?: number;
  viewportHeight?: number;
}

export interface GizmoSnapSettings {
  translate: number;
  rotateDegrees: number;
  scale: number;
  enabled: boolean;
}

export interface GizmoTransformTarget {
  id: string;
  transform: Transform;
}

export interface GizmoDragOptions {
  mode: GizmoTransformMode;
  axis: GizmoAxis;
  coordinateSpace: GizmoCoordinateSpace;
  pivotMode: GizmoPivotMode;
  pivot: Vec3;
  targets: GizmoTransformTarget[];
  activeTargetId?: string;
  camera: GizmoCamera;
  startRay: GizmoRay;
  snap: GizmoSnapSettings;
}

export interface GizmoDragUpdate {
  targets: GizmoTransformTarget[];
  delta: Vec3;
  angleDegrees: number;
  scale: Vec3;
}

export type GizmoPrimitive =
  | GizmoLinePrimitive
  | GizmoPolylinePrimitive
  | GizmoSpherePrimitive
  | GizmoBoxPrimitive
  | GizmoConePrimitive
  | GizmoDiscPrimitive
  | GizmoLabelPrimitive;

interface GizmoPrimitiveBase {
  id: string;
  role: string;
  pickable: boolean;
  opacity?: number;
  metadata?: Record<string, unknown>;
}

export interface GizmoLinePrimitive extends GizmoPrimitiveBase {
  kind: 'line';
  start: Vec3;
  end: Vec3;
  width?: number;
}

export interface GizmoPolylinePrimitive extends GizmoPrimitiveBase {
  kind: 'polyline';
  points: Vec3[];
  closed: boolean;
  width?: number;
}

export interface GizmoSpherePrimitive extends GizmoPrimitiveBase {
  kind: 'sphere';
  center: Vec3;
  radius: number;
  wireframe?: boolean;
}

export interface GizmoBoxPrimitive extends GizmoPrimitiveBase {
  kind: 'box';
  center: Vec3;
  size: Vec3;
  rotation: Vec3;
  wireframe?: boolean;
}

export interface GizmoConePrimitive extends GizmoPrimitiveBase {
  kind: 'cone';
  apex: Vec3;
  direction: Vec3;
  length: number;
  angleDegrees: number;
  wireframe?: boolean;
}

export interface GizmoDiscPrimitive extends GizmoPrimitiveBase {
  kind: 'disc';
  center: Vec3;
  normal: Vec3;
  radius: number;
  segments?: number;
}

export interface GizmoLabelPrimitive extends GizmoPrimitiveBase {
  kind: 'label';
  position: Vec3;
  text: string;
}

export interface GizmoBuildContext {
  node: SceneNode;
  scene: KyxosSceneContract;
  selected: boolean;
  active: boolean;
}

export interface GizmoBuilderDescriptor<T = unknown> {
  type: string;
  build(context: GizmoBuildContext, data: T): GizmoPrimitive[];
}

export interface GizmoHit {
  primitiveId: string;
  role: string;
  distance: number;
  point: Vec3;
}

export interface GizmoCommandHost {
  getScene(): KyxosSceneContract;
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

export interface CameraGizmoData {
  projection: 'perspective' | 'orthographic';
  fov: number;
  near: number;
  far: number;
  aspect: number;
  orthographicSize?: number;
  target?: Vec3;
}

export interface LightGizmoData {
  type: 'directional' | 'point' | 'spot' | 'ambient';
  range?: number;
  innerConeAngle?: number;
  outerConeAngle?: number;
}

export interface ZoneGizmoData {
  size: Vec3;
}

export interface ColliderGizmoData {
  type: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh' | 'compound';
  center: Vec3;
  size?: Vec3;
  radius?: number;
  height?: number;
  axis?: 'x' | 'y' | 'z';
}

export interface ParticleEmitterGizmoData {
  shape: 'point' | 'sphere' | 'hemisphere' | 'box' | 'cone';
  radius: number;
  angle: number;
  size: Vec3;
}

export interface AudioRangeGizmoData {
  positional: boolean;
  refDistance: number;
  maxDistance: number;
}

const EPSILON = 1e-7;
const AXIS: Record<'x' | 'y' | 'z', Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function multiply(a: Vec3, scalar: number): Vec3 { return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar }; }
function multiplyComponents(a: Vec3, b: Vec3): Vec3 { return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function length(a: Vec3): number { return Math.sqrt(dot(a, a)); }
function normalize(a: Vec3): Vec3 {
  const magnitude = length(a);
  return magnitude > EPSILON ? multiply(a, 1 / magnitude) : { x: 0, y: 0, z: 0 };
}
function distance(a: Vec3, b: Vec3): number { return length(subtract(a, b)); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function degrees(radians: number): number { return radians * 180 / Math.PI; }
function radians(degreesValue: number): number { return degreesValue * Math.PI / 180; }
function snap(value: number, step: number): number { return step > EPSILON ? Math.round(value / step) * step : value; }
function finiteVec3(value: Vec3): boolean { return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z); }

interface Quaternion { x: number; y: number; z: number; w: number }

function quaternionFromEuler(euler: Vec3): Quaternion {
  const x = radians(euler.x) * 0.5;
  const y = radians(euler.y) * 0.5;
  const z = radians(euler.z) * 0.5;
  const sx = Math.sin(x); const cx = Math.cos(x);
  const sy = Math.sin(y); const cy = Math.cos(y);
  const sz = Math.sin(z); const cz = Math.cos(z);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quaternionFromAxisAngle(axis: Vec3, angleRadians: number): Quaternion {
  const normal = normalize(axis);
  const half = angleRadians * 0.5;
  const sine = Math.sin(half);
  return { x: normal.x * sine, y: normal.y * sine, z: normal.z * sine, w: Math.cos(half) };
}

function quaternionToEuler(q: Quaternion): Vec3 {
  const sinr = 2 * (q.w * q.x + q.y * q.z);
  const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
  const x = Math.atan2(sinr, cosr);
  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const y = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const siny = 2 * (q.w * q.z + q.x * q.y);
  const cosy = 1 - 2 * (q.y * q.y + q.z * q.z);
  const z = Math.atan2(siny, cosy);
  return { x: degrees(x), y: degrees(y), z: degrees(z) };
}

function rotateVector(vector: Vec3, q: Quaternion): Vec3 {
  const qv = { x: q.x, y: q.y, z: q.z };
  const uv = cross(qv, vector);
  const uuv = cross(qv, uv);
  return add(vector, add(multiply(uv, 2 * q.w), multiply(uuv, 2)));
}

function axisVector(axis: 'x' | 'y' | 'z', rotation: Vec3, space: GizmoCoordinateSpace): Vec3 {
  return space === 'local' ? normalize(rotateVector(AXIS[axis], quaternionFromEuler(rotation))) : clone(AXIS[axis]);
}

function planeAxes(axis: GizmoAxis, rotation: Vec3, space: GizmoCoordinateSpace): [Vec3, Vec3] {
  switch (axis) {
    case 'xy': return [axisVector('x', rotation, space), axisVector('y', rotation, space)];
    case 'xz': return [axisVector('x', rotation, space), axisVector('z', rotation, space)];
    case 'yz': return [axisVector('y', rotation, space), axisVector('z', rotation, space)];
    default: throw new Error(`${axis} is not a plane axis.`);
  }
}

export function rayPlaneIntersection(ray: GizmoRay, point: Vec3, normal: Vec3): Vec3 | null {
  const direction = normalize(ray.direction);
  const denominator = dot(normal, direction);
  if (Math.abs(denominator) < EPSILON) return null;
  const time = dot(subtract(point, ray.origin), normal) / denominator;
  if (time < 0) return null;
  return add(ray.origin, multiply(direction, time));
}

export function closestRayLineParameter(ray: GizmoRay, linePoint: Vec3, lineDirection: Vec3): number | null {
  const u = normalize(ray.direction);
  const v = normalize(lineDirection);
  const w0 = subtract(ray.origin, linePoint);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w0);
  const e = dot(v, w0);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) < EPSILON) return null;
  return (a * e - b * d) / denominator;
}

export function calculateSelectionPivot(
  targets: GizmoTransformTarget[],
  mode: GizmoPivotMode,
  activeTargetId?: string,
): Vec3 {
  if (!targets.length) return { x: 0, y: 0, z: 0 };
  if (mode === 'last-selected') {
    return clone(targets.find((target) => target.id === activeTargetId)?.transform.position ?? targets.at(-1)!.transform.position);
  }
  if (mode === 'individual' && targets.length === 1) return clone(targets[0].transform.position);
  const total = targets.reduce((sum, target) => add(sum, target.transform.position), { x: 0, y: 0, z: 0 });
  return multiply(total, 1 / targets.length);
}

function dragPlaneNormal(
  axis: GizmoAxis,
  axisDirection: Vec3,
  camera: GizmoCamera,
  rotation: Vec3,
  space: GizmoCoordinateSpace,
): Vec3 {
  if (axis === 'xyz') return normalize(camera.forward);
  if (axis.length === 2) {
    const [first, second] = planeAxes(axis, rotation, space);
    return normalize(cross(first, second));
  }
  const side = cross(axisDirection, camera.forward);
  const normal = cross(axisDirection, side);
  return length(normal) > EPSILON ? normalize(normal) : normalize(camera.up);
}

function projectOnAxis(vector: Vec3, axis: Vec3): Vec3 {
  return multiply(axis, dot(vector, axis));
}

function snapVector(vector: Vec3, step: number): Vec3 {
  return { x: snap(vector.x, step), y: snap(vector.y, step), z: snap(vector.z, step) };
}

function rotatePointAroundPivot(point: Vec3, pivot: Vec3, rotation: Quaternion): Vec3 {
  return add(pivot, rotateVector(subtract(point, pivot), rotation));
}

export class GizmoDragSession {
  private readonly initial = new Map<string, Transform>();
  private readonly activeRotation: Vec3;
  private readonly axisDirection: Vec3;
  private readonly planeNormal: Vec3;
  private readonly startPoint: Vec3;
  private readonly startAxisParameter: number;
  private readonly startVector: Vec3;

  constructor(readonly options: GizmoDragOptions) {
    if (!options.targets.length) throw new Error('Gizmo drag requires at least one target.');
    for (const target of options.targets) {
      if (!finiteVec3(target.transform.position) || !finiteVec3(target.transform.rotation) || !finiteVec3(target.transform.scale)) throw new Error('Target transform is invalid.');
      this.initial.set(target.id, clone(target.transform));
    }
    this.activeRotation = clone(options.targets.find((target) => target.id === options.activeTargetId)?.transform.rotation ?? options.targets.at(-1)!.transform.rotation);
    const singleAxis = options.axis.length === 1 && options.axis !== 'xyz' ? options.axis as 'x' | 'y' | 'z' : 'x';
    this.axisDirection = axisVector(singleAxis, this.activeRotation, options.coordinateSpace);
    this.planeNormal = dragPlaneNormal(options.axis, this.axisDirection, options.camera, this.activeRotation, options.coordinateSpace);
    this.startPoint = rayPlaneIntersection(options.startRay, options.pivot, this.planeNormal) ?? clone(options.pivot);
    this.startAxisParameter = closestRayLineParameter(options.startRay, options.pivot, this.axisDirection) ?? 0;
    this.startVector = normalize(subtract(this.startPoint, options.pivot));
  }

  update(ray: GizmoRay): GizmoDragUpdate {
    switch (this.options.mode) {
      case 'translate': return this.translate(ray);
      case 'rotate': return this.rotate(ray);
      case 'scale': return this.scale(ray);
    }
  }

  private translate(ray: GizmoRay): GizmoDragUpdate {
    let delta: Vec3;
    if (this.options.axis.length === 1 && this.options.axis !== 'xyz') {
      const parameter = closestRayLineParameter(ray, this.options.pivot, this.axisDirection) ?? this.startAxisParameter;
      delta = multiply(this.axisDirection, parameter - this.startAxisParameter);
    } else {
      const point = rayPlaneIntersection(ray, this.options.pivot, this.planeNormal) ?? this.startPoint;
      delta = subtract(point, this.startPoint);
      if (this.options.axis.length === 2) {
        const [first, second] = planeAxes(this.options.axis, this.activeRotation, this.options.coordinateSpace);
        delta = add(projectOnAxis(delta, first), projectOnAxis(delta, second));
      }
    }
    if (this.options.snap.enabled) {
      const step = this.options.snap.translate;
      if (this.options.axis.length === 1 && this.options.axis !== 'xyz') delta = multiply(this.axisDirection, snap(dot(delta, this.axisDirection), step));
      else delta = snapVector(delta, step);
    }
    const targets = this.options.targets.map((target) => {
      const initial = this.initial.get(target.id)!;
      return { id: target.id, transform: { ...clone(initial), position: add(initial.position, delta) } };
    });
    return { targets, delta, angleDegrees: 0, scale: { x: 1, y: 1, z: 1 } };
  }

  private rotate(ray: GizmoRay): GizmoDragUpdate {
    const point = rayPlaneIntersection(ray, this.options.pivot, this.axisDirection) ?? this.startPoint;
    const current = normalize(subtract(point, this.options.pivot));
    const sine = dot(this.axisDirection, cross(this.startVector, current));
    const cosine = clamp(dot(this.startVector, current), -1, 1);
    let angle = degrees(Math.atan2(sine, cosine));
    if (this.options.snap.enabled) angle = snap(angle, this.options.snap.rotateDegrees);
    const deltaRotation = quaternionFromAxisAngle(this.axisDirection, radians(angle));
    const targets = this.options.targets.map((target) => {
      const initial = this.initial.get(target.id)!;
      const pivot = this.options.pivotMode === 'individual' ? initial.position : this.options.pivot;
      const position = this.options.pivotMode === 'individual'
        ? clone(initial.position)
        : rotatePointAroundPivot(initial.position, pivot, deltaRotation);
      const rotation = quaternionToEuler(quaternionMultiply(deltaRotation, quaternionFromEuler(initial.rotation)));
      return { id: target.id, transform: { ...clone(initial), position, rotation } };
    });
    return { targets, delta: { x: 0, y: 0, z: 0 }, angleDegrees: angle, scale: { x: 1, y: 1, z: 1 } };
  }

  private scale(ray: GizmoRay): GizmoDragUpdate {
    let factor = { x: 1, y: 1, z: 1 };
    if (this.options.axis === 'xyz') {
      const point = rayPlaneIntersection(ray, this.options.pivot, this.planeNormal) ?? this.startPoint;
      const startDistance = Math.max(EPSILON, distance(this.startPoint, this.options.pivot));
      let uniform = distance(point, this.options.pivot) / startDistance;
      if (dot(subtract(point, this.options.pivot), subtract(this.startPoint, this.options.pivot)) < 0) uniform *= -1;
      if (this.options.snap.enabled) uniform = snap(uniform - 1, this.options.snap.scale) + 1;
      uniform = Math.max(0.001, uniform);
      factor = { x: uniform, y: uniform, z: uniform };
    } else if (this.options.axis.length === 1) {
      const parameter = closestRayLineParameter(ray, this.options.pivot, this.axisDirection) ?? this.startAxisParameter;
      let amount = 1 + parameter - this.startAxisParameter;
      if (this.options.snap.enabled) amount = snap(amount - 1, this.options.snap.scale) + 1;
      amount = Math.max(0.001, amount);
      factor = this.options.axis === 'x' ? { x: amount, y: 1, z: 1 }
        : this.options.axis === 'y' ? { x: 1, y: amount, z: 1 }
          : { x: 1, y: 1, z: amount };
    } else {
      const point = rayPlaneIntersection(ray, this.options.pivot, this.planeNormal) ?? this.startPoint;
      const delta = subtract(point, this.startPoint);
      const [first, second] = planeAxes(this.options.axis, this.activeRotation, this.options.coordinateSpace);
      let firstFactor = Math.max(0.001, 1 + dot(delta, first));
      let secondFactor = Math.max(0.001, 1 + dot(delta, second));
      if (this.options.snap.enabled) {
        firstFactor = Math.max(0.001, snap(firstFactor - 1, this.options.snap.scale) + 1);
        secondFactor = Math.max(0.001, snap(secondFactor - 1, this.options.snap.scale) + 1);
      }
      factor = this.options.axis === 'xy' ? { x: firstFactor, y: secondFactor, z: 1 }
        : this.options.axis === 'xz' ? { x: firstFactor, y: 1, z: secondFactor }
          : { x: 1, y: firstFactor, z: secondFactor };
    }
    const targets = this.options.targets.map((target) => {
      const initial = this.initial.get(target.id)!;
      const pivot = this.options.pivotMode === 'individual' ? initial.position : this.options.pivot;
      const position = this.options.pivotMode === 'individual'
        ? clone(initial.position)
        : add(pivot, multiplyComponents(subtract(initial.position, pivot), factor));
      return { id: target.id, transform: { ...clone(initial), position, scale: multiplyComponents(initial.scale, factor) } };
    });
    return { targets, delta: { x: 0, y: 0, z: 0 }, angleDegrees: 0, scale: factor };
  }
}

function transformPoint(local: Vec3, transform: Transform): Vec3 {
  return add(transform.position, rotateVector(multiplyComponents(local, transform.scale), quaternionFromEuler(transform.rotation)));
}

function basisDirection(local: Vec3, transform: Transform): Vec3 {
  return normalize(rotateVector(local, quaternionFromEuler(transform.rotation)));
}

function line(id: string, role: string, start: Vec3, end: Vec3, pickable = false): GizmoLinePrimitive {
  return { id, role, kind: 'line', start, end, pickable };
}

function boxCorners(center: Vec3, size: Vec3, rotation: Vec3): Vec3[] {
  const half = multiply(size, 0.5);
  const q = quaternionFromEuler(rotation);
  const corners: Vec3[] = [];
  for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) corners.push(add(center, rotateVector({ x, y, z }, q)));
  return corners;
}

export function buildCameraGizmo(context: GizmoBuildContext, data: CameraGizmoData): GizmoPrimitive[] {
  const transform = context.node.transform;
  const near = Math.max(0.001, data.near);
  const far = Math.max(near, data.far);
  const aspect = Math.max(0.001, data.aspect);
  const primitives: GizmoPrimitive[] = [];
  const frames: Array<{ distance: number; width: number; height: number; name: string }> = [];
  if (data.projection === 'orthographic') {
    const height = Math.max(0.001, data.orthographicSize ?? 1) * 2;
    frames.push({ distance: near, width: height * aspect, height, name: 'near' }, { distance: far, width: height * aspect, height, name: 'far' });
  } else {
    const tangent = Math.tan(radians(clamp(data.fov, 1, 179)) * 0.5);
    frames.push(
      { distance: near, width: 2 * near * tangent * aspect, height: 2 * near * tangent, name: 'near' },
      { distance: far, width: 2 * far * tangent * aspect, height: 2 * far * tangent, name: 'far' },
    );
  }
  const frameCorners = frames.map((frame) => {
    const halfW = frame.width * 0.5;
    const halfH = frame.height * 0.5;
    return [
      transformPoint({ x: -halfW, y: -halfH, z: -frame.distance }, transform),
      transformPoint({ x: halfW, y: -halfH, z: -frame.distance }, transform),
      transformPoint({ x: halfW, y: halfH, z: -frame.distance }, transform),
      transformPoint({ x: -halfW, y: halfH, z: -frame.distance }, transform),
    ];
  });
  frameCorners.forEach((corners, index) => primitives.push({ id: `camera:${context.node.id}:${frames[index].name}`, role: 'camera-frustum', kind: 'polyline', points: corners, closed: true, pickable: false }));
  for (let index = 0; index < 4; index += 1) primitives.push(line(`camera:${context.node.id}:edge:${index}`, 'camera-frustum', frameCorners[0][index], frameCorners[1][index]));
  if (data.target) primitives.push(line(`camera:${context.node.id}:target`, 'camera-target', transform.position, data.target, true));
  return primitives;
}

export function buildLightGizmo(context: GizmoBuildContext, data: LightGizmoData): GizmoPrimitive[] {
  const transform = context.node.transform;
  const forward = basisDirection({ x: 0, y: 0, z: -1 }, transform);
  const id = `light:${context.node.id}`;
  if (data.type === 'ambient') return [{ id, role: 'ambient-light', kind: 'sphere', center: clone(transform.position), radius: 0.25, wireframe: true, pickable: true }];
  if (data.type === 'directional') return [
    { id: `${id}:disc`, role: 'directional-light', kind: 'disc', center: clone(transform.position), normal: forward, radius: 0.25, pickable: true },
    line(`${id}:direction`, 'directional-light', transform.position, add(transform.position, multiply(forward, 1.5)), true),
  ];
  if (data.type === 'point') return [{ id, role: 'point-light-range', kind: 'sphere', center: clone(transform.position), radius: Math.max(0, data.range ?? 1), wireframe: true, pickable: true }];
  return [
    { id: `${id}:outer`, role: 'spot-light-outer', kind: 'cone', apex: clone(transform.position), direction: forward, length: Math.max(0, data.range ?? 1), angleDegrees: degrees(data.outerConeAngle ?? Math.PI / 4) * 2, wireframe: true, pickable: true },
    { id: `${id}:inner`, role: 'spot-light-inner', kind: 'cone', apex: clone(transform.position), direction: forward, length: Math.max(0, data.range ?? 1), angleDegrees: degrees(data.innerConeAngle ?? 0) * 2, wireframe: true, pickable: false },
  ];
}

export function buildZoneGizmo(context: GizmoBuildContext, data: ZoneGizmoData): GizmoPrimitive[] {
  return [{ id: `zone:${context.node.id}`, role: 'zone-bounds', kind: 'box', center: clone(context.node.transform.position), size: multiplyComponents(data.size, context.node.transform.scale), rotation: clone(context.node.transform.rotation), wireframe: true, pickable: true }];
}

export function buildColliderGizmo(context: GizmoBuildContext, data: ColliderGizmoData): GizmoPrimitive[] {
  const transform = context.node.transform;
  const center = transformPoint(data.center, transform);
  const id = `collider:${context.node.id}`;
  if (data.type === 'box' || data.type === 'mesh' || data.type === 'compound') return [{ id, role: 'collider', kind: 'box', center, size: multiplyComponents(data.size ?? { x: 1, y: 1, z: 1 }, transform.scale), rotation: clone(transform.rotation), wireframe: true, pickable: true }];
  if (data.type === 'sphere') return [{ id, role: 'collider', kind: 'sphere', center, radius: Math.max(0, data.radius ?? 0.5) * Math.max(Math.abs(transform.scale.x), Math.abs(transform.scale.y), Math.abs(transform.scale.z)), wireframe: true, pickable: true }];
  const axis = data.axis ?? 'y';
  const direction = basisDirection(AXIS[axis], transform);
  const height = Math.max(0, data.height ?? 1) * Math.abs(transform.scale[axis]);
  const radiusScale = axis === 'x' ? Math.max(Math.abs(transform.scale.y), Math.abs(transform.scale.z))
    : axis === 'y' ? Math.max(Math.abs(transform.scale.x), Math.abs(transform.scale.z))
      : Math.max(Math.abs(transform.scale.x), Math.abs(transform.scale.y));
  const radius = Math.max(0, data.radius ?? 0.5) * radiusScale;
  const half = multiply(direction, height * 0.5);
  const primitives: GizmoPrimitive[] = [line(`${id}:axis`, 'collider-axis', subtract(center, half), add(center, half), true)];
  if (data.type === 'capsule') {
    primitives.push(
      { id: `${id}:a`, role: 'collider', kind: 'sphere', center: subtract(center, half), radius, wireframe: true, pickable: true },
      { id: `${id}:b`, role: 'collider', kind: 'sphere', center: add(center, half), radius, wireframe: true, pickable: true },
    );
  } else {
    primitives.push(
      { id: `${id}:a`, role: 'collider', kind: 'disc', center: subtract(center, half), normal: direction, radius, pickable: true },
      { id: `${id}:b`, role: 'collider', kind: 'disc', center: add(center, half), normal: direction, radius, pickable: true },
    );
  }
  return primitives;
}

export function buildParticleEmitterGizmo(context: GizmoBuildContext, data: ParticleEmitterGizmoData): GizmoPrimitive[] {
  const transform = context.node.transform;
  const id = `particle:${context.node.id}`;
  if (data.shape === 'point') return [{ id, role: 'particle-emitter', kind: 'sphere', center: clone(transform.position), radius: 0.08, wireframe: true, pickable: true }];
  if (data.shape === 'sphere' || data.shape === 'hemisphere') return [{ id, role: 'particle-emitter', kind: 'sphere', center: clone(transform.position), radius: Math.max(0, data.radius) * Math.max(...Object.values(transform.scale).map(Math.abs)), wireframe: true, pickable: true, metadata: { hemisphere: data.shape === 'hemisphere' } }];
  if (data.shape === 'box') return [{ id, role: 'particle-emitter', kind: 'box', center: clone(transform.position), size: multiplyComponents(data.size, transform.scale), rotation: clone(transform.rotation), wireframe: true, pickable: true }];
  return [{ id, role: 'particle-emitter', kind: 'cone', apex: clone(transform.position), direction: basisDirection({ x: 0, y: 0, z: -1 }, transform), length: Math.max(0.001, data.size.z), angleDegrees: clamp(data.angle, 0, 180), wireframe: true, pickable: true }];
}

export function buildAudioRangeGizmo(context: GizmoBuildContext, data: AudioRangeGizmoData): GizmoPrimitive[] {
  if (!data.positional) return [];
  return [
    { id: `audio:${context.node.id}:ref`, role: 'audio-reference-range', kind: 'sphere', center: clone(context.node.transform.position), radius: Math.max(0, data.refDistance), wireframe: true, pickable: true },
    { id: `audio:${context.node.id}:max`, role: 'audio-maximum-range', kind: 'sphere', center: clone(context.node.transform.position), radius: Math.max(data.refDistance, data.maxDistance), wireframe: true, pickable: true },
  ];
}

export class GizmoRegistry {
  private readonly descriptors = new Map<string, GizmoBuilderDescriptor>();

  register<T>(descriptor: GizmoBuilderDescriptor<T>): () => void {
    if (this.descriptors.has(descriptor.type)) throw new Error(`Gizmo ${descriptor.type} is already registered.`);
    this.descriptors.set(descriptor.type, descriptor as GizmoBuilderDescriptor);
    return () => { if (this.descriptors.get(descriptor.type) === descriptor) this.descriptors.delete(descriptor.type); };
  }

  build<T>(type: string, context: GizmoBuildContext, data: T): GizmoPrimitive[] {
    const descriptor = this.descriptors.get(type);
    if (!descriptor) throw new Error(`Unknown gizmo ${type}.`);
    return clone(descriptor.build(context, data));
  }

  list(): string[] { return [...this.descriptors.keys()].sort(); }
}

export function createDefaultGizmoRegistry(): GizmoRegistry {
  const registry = new GizmoRegistry();
  registry.register<CameraGizmoData>({ type: 'camera', build: buildCameraGizmo });
  registry.register<LightGizmoData>({ type: 'light', build: buildLightGizmo });
  registry.register<ZoneGizmoData>({ type: 'zone', build: buildZoneGizmo });
  registry.register<ColliderGizmoData>({ type: 'collider', build: buildColliderGizmo });
  registry.register<ParticleEmitterGizmoData>({ type: 'particle-emitter', build: buildParticleEmitterGizmo });
  registry.register<AudioRangeGizmoData>({ type: 'audio-range', build: buildAudioRangeGizmo });
  return registry;
}

function closestPointOnSegment(point: Vec3, start: Vec3, end: Vec3): Vec3 {
  const segment = subtract(end, start);
  const magnitude = dot(segment, segment);
  if (magnitude < EPSILON) return clone(start);
  const amount = clamp(dot(subtract(point, start), segment) / magnitude, 0, 1);
  return add(start, multiply(segment, amount));
}

function raySphereDistance(ray: GizmoRay, center: Vec3, radius: number): { distance: number; point: Vec3 } | null {
  const direction = normalize(ray.direction);
  const offset = subtract(ray.origin, center);
  const b = dot(offset, direction);
  const c = dot(offset, offset) - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const time = -b - Math.sqrt(discriminant);
  if (time < 0) return null;
  return { distance: time, point: add(ray.origin, multiply(direction, time)) };
}

function raySegmentDistance(ray: GizmoRay, start: Vec3, end: Vec3): { distance: number; separation: number; point: Vec3 } {
  const direction = normalize(ray.direction);
  const segment = subtract(end, start);
  const segmentLength = length(segment);
  const segmentDirection = segmentLength > EPSILON ? multiply(segment, 1 / segmentLength) : { x: 1, y: 0, z: 0 };
  const rayParameter = closestRayLineParameter({ origin: start, direction: segmentDirection }, ray.origin, direction) ?? 0;
  const segmentParameter = clamp(rayParameter, 0, segmentLength);
  const segmentPoint = add(start, multiply(segmentDirection, segmentParameter));
  const rayTime = Math.max(0, dot(subtract(segmentPoint, ray.origin), direction));
  const rayPoint = add(ray.origin, multiply(direction, rayTime));
  return { distance: rayTime, separation: distance(segmentPoint, rayPoint), point: rayPoint };
}

export function pickGizmoPrimitive(
  ray: GizmoRay,
  primitives: Iterable<GizmoPrimitive>,
  tolerance = 0.08,
): GizmoHit | null {
  const hits: GizmoHit[] = [];
  for (const primitive of primitives) {
    if (!primitive.pickable) continue;
    if (primitive.kind === 'sphere') {
      const hit = raySphereDistance(ray, primitive.center, primitive.radius + tolerance);
      if (hit) hits.push({ primitiveId: primitive.id, role: primitive.role, distance: hit.distance, point: hit.point });
    } else if (primitive.kind === 'line') {
      const hit = raySegmentDistance(ray, primitive.start, primitive.end);
      if (hit.separation <= tolerance + (primitive.width ?? 0)) hits.push({ primitiveId: primitive.id, role: primitive.role, distance: hit.distance, point: hit.point });
    } else if (primitive.kind === 'polyline') {
      for (let index = 0; index < primitive.points.length - (primitive.closed ? 0 : 1); index += 1) {
        const start = primitive.points[index];
        const end = primitive.points[(index + 1) % primitive.points.length];
        const hit = raySegmentDistance(ray, start, end);
        if (hit.separation <= tolerance + (primitive.width ?? 0)) hits.push({ primitiveId: primitive.id, role: primitive.role, distance: hit.distance, point: hit.point });
      }
    } else if (primitive.kind === 'disc') {
      const point = rayPlaneIntersection(ray, primitive.center, primitive.normal);
      if (point) {
        const radial = distance(point, primitive.center);
        if (Math.abs(radial - primitive.radius) <= tolerance || radial <= primitive.radius) hits.push({ primitiveId: primitive.id, role: primitive.role, distance: distance(ray.origin, point), point });
      }
    } else if (primitive.kind === 'box') {
      const radius = length(primitive.size) * 0.5;
      const hit = raySphereDistance(ray, primitive.center, radius + tolerance);
      if (hit) hits.push({ primitiveId: primitive.id, role: primitive.role, distance: hit.distance, point: hit.point });
    } else if (primitive.kind === 'cone') {
      const center = add(primitive.apex, multiply(normalize(primitive.direction), primitive.length * 0.5));
      const radius = Math.max(primitive.length * 0.5, Math.tan(radians(primitive.angleDegrees * 0.5)) * primitive.length);
      const hit = raySphereDistance(ray, center, radius + tolerance);
      if (hit) hits.push({ primitiveId: primitive.id, role: primitive.role, distance: hit.distance, point: hit.point });
    }
  }
  hits.sort((left, right) => left.distance - right.distance || left.primitiveId.localeCompare(right.primitiveId));
  return hits[0] ?? null;
}

export class GizmoTransformService extends EventTarget {
  constructor(private readonly host: GizmoCommandHost) {
    super();
  }

  apply(update: GizmoDragUpdate, label = 'Transform Selection', mergeKey = 'gizmo-transform'): void {
    const byId = new Map(update.targets.map((target) => [target.id, target.transform]));
    this.host.execute(label, (scene) => {
      const patch: ScenePatch = [];
      scene.nodes.forEach((node, index) => {
        const transform = byId.get(node.id);
        if (transform) patch.push({ op: 'replace', path: `/nodes/${index}/transform`, value: clone(transform) });
      });
      if (patch.length !== byId.size) {
        const found = new Set(scene.nodes.filter((node) => byId.has(node.id)).map((node) => node.id));
        throw new Error(`Transform targets are missing: ${[...byId.keys()].filter((id) => !found.has(id)).join(', ')}`);
      }
      return patch;
    }, mergeKey);
    this.dispatchEvent(new CustomEvent('change', { detail: clone(update) }));
  }

  targets(nodeIds: Iterable<string>): GizmoTransformTarget[] {
    const ids = new Set(nodeIds);
    const scene = this.host.getScene();
    const targets = scene.nodes.filter((node) => ids.has(node.id)).map((node) => ({ id: node.id, transform: clone(node.transform) }));
    if (targets.length !== ids.size) throw new Error('One or more transform targets are missing.');
    return targets;
  }
}

export function gizmoScaleForCamera(position: Vec3, camera: GizmoCamera, pixels = 96): number {
  if (camera.orthographic) {
    const viewportHeight = Math.max(1, camera.viewportHeight ?? 1080);
    return Math.max(EPSILON, (camera.orthographicSize ?? 10) * 2 * pixels / viewportHeight);
  }
  const viewportHeight = Math.max(1, camera.viewportHeight ?? 1080);
  const fov = radians(camera.fov ?? 60);
  const worldHeight = 2 * Math.max(EPSILON, distance(position, camera.position)) * Math.tan(fov * 0.5);
  return Math.max(EPSILON, worldHeight * pixels / viewportHeight);
}

export function transformGizmoPrimitives(
  pivot: Vec3,
  rotation: Vec3,
  space: GizmoCoordinateSpace,
  scaleValue = 1,
): GizmoPrimitive[] {
  const primitives: GizmoPrimitive[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    const direction = axisVector(axis, rotation, space);
    primitives.push(line(`transform:${axis}`, `axis-${axis}`, pivot, add(pivot, multiply(direction, scaleValue)), true));
    primitives.push({ id: `rotate:${axis}`, role: `rotate-${axis}`, kind: 'disc', center: clone(pivot), normal: direction, radius: scaleValue * 0.8, pickable: true });
  }
  for (const plane of ['xy', 'xz', 'yz'] as const) {
    const [first, second] = planeAxes(plane, rotation, space);
    const offset = add(multiply(first, scaleValue * 0.25), multiply(second, scaleValue * 0.25));
    primitives.push({ id: `transform:${plane}`, role: `plane-${plane}`, kind: 'box', center: add(pivot, offset), size: { x: scaleValue * 0.22, y: scaleValue * 0.22, z: scaleValue * 0.02 }, rotation: clone(rotation), wireframe: false, pickable: true });
  }
  primitives.push({ id: 'transform:xyz', role: 'uniform', kind: 'sphere', center: clone(pivot), radius: scaleValue * 0.09, pickable: true });
  return primitives;
}

export function boxWireframeLines(primitive: GizmoBoxPrimitive): GizmoLinePrimitive[] {
  const corners = boxCorners(primitive.center, primitive.size, primitive.rotation);
  const pairs = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7],
    [4, 5], [4, 6], [5, 7], [6, 7],
  ];
  return pairs.map(([a, b], index) => line(`${primitive.id}:edge:${index}`, primitive.role, corners[a], corners[b], primitive.pickable));
}
