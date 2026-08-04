import { describe, expect, it, vi } from 'vitest';
import {
  GizmoDragSession,
  GizmoTransformService,
  boxWireframeLines,
  buildAudioRangeGizmo,
  buildCameraGizmo,
  buildColliderGizmo,
  buildLightGizmo,
  buildParticleEmitterGizmo,
  buildZoneGizmo,
  calculateSelectionPivot,
  closestRayLineParameter,
  createDefaultGizmoRegistry,
  gizmoScaleForCamera,
  pickGizmoPrimitive,
  rayPlaneIntersection,
  transformGizmoPrimitives,
  type GizmoCamera,
  type GizmoDragOptions,
  type GizmoTransformTarget,
} from '../../packages/editor-core/src/gizmos';
import {
  createEmptySceneContract,
  type KyxosSceneContract,
  type ScenePatch,
} from '../../packages/scene-contract/src/index';
import { applyPatch } from '../../packages/editor-core/src/index';

const camera: GizmoCamera = {
  position: { x: 0, y: 0, z: 10 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  fov: 60,
  viewportHeight: 1000,
};

function target(id: string, x = 0): GizmoTransformTarget {
  return {
    id,
    transform: {
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function dragOptions(changes: Partial<GizmoDragOptions> = {}): GizmoDragOptions {
  return {
    mode: 'translate',
    axis: 'x',
    coordinateSpace: 'world',
    pivotMode: 'center',
    pivot: { x: 0, y: 0, z: 0 },
    targets: [target('a')],
    activeTargetId: 'a',
    camera,
    startRay: { origin: { x: 0, y: 0, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
    snap: { translate: 1, rotateDegrees: 15, scale: 0.25, enabled: false },
    ...changes,
  };
}

function sceneFixture(): KyxosSceneContract {
  const scene = createEmptySceneContract('Gizmos');
  scene.nodes = [
    {
      id: 'a', name: 'A', parentId: null, children: [], visible: true,
      transform: target('a').transform,
    },
    {
      id: 'b', name: 'B', parentId: null, children: [], visible: true,
      transform: target('b', 2).transform,
    },
  ];
  return scene;
}

function commandHost(initial: KyxosSceneContract) {
  let scene = structuredClone(initial);
  const executed = vi.fn();
  return {
    host: {
      getScene: () => structuredClone(scene),
      execute(label: string, build: (scene: KyxosSceneContract) => ScenePatch, mergeKey?: string) {
        const patch = build(structuredClone(scene));
        scene = applyPatch(scene, patch);
        executed(label, patch, mergeKey);
      },
    },
    getScene: () => structuredClone(scene),
    executed,
  };
}

describe('Gizmo math helpers', () => {
  it('intersects rays with planes and projects onto axis lines', () => {
    expect(rayPlaneIntersection(
      { origin: { x: 1, y: 2, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    )).toEqual({ x: 1, y: 2, z: 0 });
    expect(rayPlaneIntersection(
      { origin: { x: 0, y: 0, z: 1 }, direction: { x: 1, y: 0, z: 0 } },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    )).toBeNull();
    expect(closestRayLineParameter(
      { origin: { x: 0, y: 0, z: 10 }, direction: { x: 2, y: 0, z: -10 } },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    )).toBeCloseTo(2, 5);
  });

  it('calculates center and last-selected pivots', () => {
    const targets = [target('a', -2), target('b', 2)];
    expect(calculateSelectionPivot(targets, 'center')).toEqual({ x: 0, y: 0, z: 0 });
    expect(calculateSelectionPivot(targets, 'last-selected', 'a')).toEqual({ x: -2, y: 0, z: 0 });
    expect(calculateSelectionPivot([], 'center')).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('keeps transform gizmos screen-sized in perspective and orthographic cameras', () => {
    const near = gizmoScaleForCamera({ x: 0, y: 0, z: 0 }, camera);
    const far = gizmoScaleForCamera({ x: 0, y: 0, z: -10 }, camera);
    expect(far).toBeGreaterThan(near);
    expect(gizmoScaleForCamera({ x: 0, y: 0, z: 0 }, { ...camera, orthographic: true, orthographicSize: 5 })).toBeCloseTo(0.96, 5);
  });
});

describe('Transform drag sessions', () => {
  it('translates an axis and applies snapping to multiple targets', () => {
    const session = new GizmoDragSession(dragOptions({
      targets: [target('a', -1), target('b', 1)],
      snap: { translate: 1, rotateDegrees: 15, scale: 0.25, enabled: true },
    }));
    const update = session.update({ origin: { x: 0, y: 0, z: 10 }, direction: { x: 2.4, y: 0, z: -10 } });
    expect(update.delta.x).toBe(2);
    expect(update.targets.map((entry) => entry.transform.position.x)).toEqual([1, 3]);
  });

  it('translates on a plane without leaking into the locked axis', () => {
    const session = new GizmoDragSession(dragOptions({ axis: 'xy' }));
    const update = session.update({ origin: { x: 0, y: 0, z: 10 }, direction: { x: 2, y: 3, z: -10 } });
    expect(update.delta).toMatchObject({ z: 0 });
    expect(update.targets[0].transform.position.x).toBeCloseTo(2, 5);
    expect(update.targets[0].transform.position.y).toBeCloseTo(3, 5);
  });

  it('rotates around an axis with angle snapping and shared pivot motion', () => {
    const session = new GizmoDragSession(dragOptions({
      mode: 'rotate',
      axis: 'y',
      targets: [target('a', 1)],
      startRay: { origin: { x: 1, y: 10, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      snap: { translate: 1, rotateDegrees: 15, scale: 0.25, enabled: true },
    }));
    const update = session.update({ origin: { x: 0, y: 10, z: 1 }, direction: { x: 0, y: -1, z: 0 } });
    expect(Math.abs(update.angleDegrees)).toBe(90);
    expect(update.targets[0].transform.position.x).toBeCloseTo(0, 5);
    expect(Math.abs(update.targets[0].transform.position.z)).toBeCloseTo(1, 5);
    expect(Math.abs(update.targets[0].transform.rotation.y)).toBeCloseTo(90, 5);
  });

  it('scales one axis, a plane and uniformly without negative collapse', () => {
    const axis = new GizmoDragSession(dragOptions({ mode: 'scale', axis: 'x' }));
    expect(axis.update({ origin: { x: 0, y: 0, z: 10 }, direction: { x: 1, y: 0, z: -10 } }).targets[0].transform.scale.x).toBeCloseTo(2, 5);

    const plane = new GizmoDragSession(dragOptions({ mode: 'scale', axis: 'xy' }));
    const planeUpdate = plane.update({ origin: { x: 0, y: 0, z: 10 }, direction: { x: 1, y: 2, z: -10 } });
    expect(planeUpdate.scale).toMatchObject({ x: 2, y: 3, z: 1 });

    const uniform = new GizmoDragSession(dragOptions({
      mode: 'scale', axis: 'xyz',
      startRay: { origin: { x: 1, y: 0, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
    }));
    const uniformUpdate = uniform.update({ origin: { x: 2, y: 0, z: 10 }, direction: { x: 0, y: 0, z: -1 } });
    expect(uniformUpdate.scale).toEqual({ x: 2, y: 2, z: 2 });
  });
});

describe('Component gizmo builders', () => {
  const scene = sceneFixture();
  const context = { node: scene.nodes[0], scene, selected: true, active: true };

  it('builds perspective and orthographic camera frustums', () => {
    const perspective = buildCameraGizmo(context, { projection: 'perspective', fov: 60, near: 1, far: 4, aspect: 2, target: { x: 0, y: 0, z: -5 } });
    expect(perspective.filter((primitive) => primitive.kind === 'polyline')).toHaveLength(2);
    expect(perspective.filter((primitive) => primitive.kind === 'line')).toHaveLength(5);
    const near = perspective.find((primitive) => primitive.id.endsWith(':near'));
    expect(near?.kind).toBe('polyline');
    if (near?.kind === 'polyline') expect(Math.abs(near.points[1].x - near.points[0].x)).toBeCloseTo(2.3094, 3);

    const orthographic = buildCameraGizmo(context, { projection: 'orthographic', fov: 60, near: 1, far: 4, aspect: 2, orthographicSize: 3 });
    const frame = orthographic.find((primitive) => primitive.id.endsWith(':near'));
    if (frame?.kind === 'polyline') expect(Math.abs(frame.points[1].x - frame.points[0].x)).toBeCloseTo(12, 5);
  });

  it('builds directional, point and spot light ranges', () => {
    expect(buildLightGizmo(context, { type: 'directional' }).map((primitive) => primitive.kind)).toEqual(['disc', 'line']);
    expect(buildLightGizmo(context, { type: 'point', range: 8 })).toMatchObject([{ kind: 'sphere', radius: 8 }]);
    expect(buildLightGizmo(context, { type: 'spot', range: 10, innerConeAngle: Math.PI / 12, outerConeAngle: Math.PI / 6 })).toMatchObject([
      { kind: 'cone', length: 10, angleDegrees: 60 },
      { kind: 'cone', length: 10, angleDegrees: 30 },
    ]);
  });

  it('builds zone, collider, particle and audio primitives', () => {
    expect(buildZoneGizmo(context, { size: { x: 2, y: 3, z: 4 } })).toMatchObject([{ kind: 'box', size: { x: 2, y: 3, z: 4 } }]);
    expect(buildColliderGizmo(context, { type: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 })).toMatchObject([{ kind: 'sphere', radius: 2 }]);
    expect(buildColliderGizmo(context, { type: 'capsule', center: { x: 0, y: 0, z: 0 }, radius: 1, height: 4, axis: 'y' })).toHaveLength(3);
    expect(buildParticleEmitterGizmo(context, { shape: 'cone', radius: 1, angle: 30, size: { x: 1, y: 1, z: 5 } })).toMatchObject([{ kind: 'cone', length: 5, angleDegrees: 30 }]);
    expect(buildAudioRangeGizmo(context, { positional: true, refDistance: 1, maxDistance: 20 })).toMatchObject([
      { kind: 'sphere', radius: 1 },
      { kind: 'sphere', radius: 20 },
    ]);
    expect(buildAudioRangeGizmo(context, { positional: false, refDistance: 1, maxDistance: 20 })).toEqual([]);
  });

  it('registers every default builder and returns isolated primitive copies', () => {
    const registry = createDefaultGizmoRegistry();
    expect(registry.list()).toEqual(['audio-range', 'camera', 'collider', 'light', 'particle-emitter', 'zone']);
    const first = registry.build('zone', context, { size: { x: 1, y: 1, z: 1 } });
    first[0].role = 'mutated';
    expect(registry.build('zone', context, { size: { x: 1, y: 1, z: 1 } })[0].role).toBe('zone-bounds');
  });
});

describe('Picking and transform commands', () => {
  it('picks the nearest sphere/line and expands box wireframes', () => {
    const hit = pickGizmoPrimitive(
      { origin: { x: 0, y: 0, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
      [
        { id: 'far', role: 'far', kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 1, pickable: true },
        { id: 'near', role: 'near', kind: 'sphere', center: { x: 0, y: 0, z: 5 }, radius: 1, pickable: true },
      ],
    );
    expect(hit).toMatchObject({ primitiveId: 'near', role: 'near' });
    expect(boxWireframeLines({ id: 'box', role: 'box', kind: 'box', center: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, pickable: true })).toHaveLength(12);
    expect(transformGizmoPrimitives({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 'world')).toHaveLength(10);
  });

  it('applies multi-node transforms through one mergeable command', () => {
    const state = commandHost(sceneFixture());
    const service = new GizmoTransformService(state.host);
    expect(service.targets(['a', 'b']).map((entry) => entry.id)).toEqual(['a', 'b']);
    const update = {
      targets: [
        { id: 'a', transform: { ...target('a').transform, position: { x: 3, y: 0, z: 0 } } },
        { id: 'b', transform: { ...target('b').transform, position: { x: 4, y: 0, z: 0 } } },
      ],
      delta: { x: 3, y: 0, z: 0 },
      angleDegrees: 0,
      scale: { x: 1, y: 1, z: 1 },
    };
    service.apply(update);
    expect(state.getScene().nodes.map((node) => node.transform.position.x)).toEqual([3, 4]);
    expect(state.executed).toHaveBeenCalledWith('Transform Selection', expect.any(Array), 'gizmo-transform');
    expect(() => service.apply({ ...update, targets: [...update.targets, { id: 'missing', transform: target('missing').transform }] })).toThrow(/missing/);
  });
});
