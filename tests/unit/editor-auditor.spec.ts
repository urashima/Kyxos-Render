import { describe, expect, it } from 'vitest';
import type { KyxosSceneContract } from '../../packages/scene-contract/src/index';
import {
  StudioAuditor,
  StudioUserDataStore,
  type StudioUserDataStorage,
} from '../../packages/editor-core/src/auditor';

class MemoryStorage implements StudioUserDataStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function createScene(): KyxosSceneContract {
  return {
    contractVersion: '1.1.0',
    id: 'scene-audit',
    metadata: {
      name: 'Audit Scene',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      authorId: 'user-a',
    },
    compatibility: { viewerApiMin: '1.1.0' },
    capabilities: [],
    assets: {
      orphan: {
        id: 'orphan',
        uri: 'asset://orphan',
        contentHash: 'orphan',
        kind: 'texture',
        mimeType: 'image/png',
        name: 'Unused texture',
      },
      model: {
        id: 'model',
        uri: 'asset://model',
        contentHash: 'model',
        kind: 'model',
        mimeType: 'model/gltf-binary',
        metadata: { dependencies: ['missing-dependency'] },
      },
    },
    nodes: [
      {
        id: 'root',
        name: 'Duplicate',
        parentId: null,
        children: ['child', 'child', 'missing-child'],
        transform: {
          position: { x: Number.NaN, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 0, y: 1, z: 1 },
        },
        visible: true,
        meshAssetId: 'missing-model',
        materialSlots: ['broken-material'],
        animationIds: ['missing-animation'],
        cameraId: 'missing-camera',
        lightId: 'missing-light',
      },
      {
        id: 'child',
        name: 'Duplicate',
        parentId: 'missing-parent',
        children: [],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        visible: true,
        skin: {
          skinIndex: 0,
          joints: ['missing-joint'],
          skeletonNodeId: 'missing-skeleton',
        },
        morphWeights: [Number.NaN],
      },
    ],
    materials: {
      material: {
        id: 'material',
        name: 'Broken material',
        baseColor: { x: 1, y: 1, z: 1, w: 1 },
        baseColorTexture: { assetId: 'missing-texture' },
        metalness: 2,
        roughness: -1,
        emissive: { x: 0, y: 0, z: 0 },
        opacity: 2,
        alphaMode: 'mask',
        alphaCutoff: Number.NaN,
        doubleSided: false,
        ior: 8,
      },
    },
    animations: [],
    environment: {
      assetId: 'missing-environment',
      rotation: 0,
      intensity: 1,
      backgroundIntensity: 1,
      backgroundBlur: 0,
      backgroundColor: '#000000',
      transparentBackground: false,
    },
    cameras: [
      {
        id: 'camera',
        name: 'Camera',
        transform: {
          position: { x: 0, y: 0, z: 5 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        target: { x: 0, y: 0, z: 0 },
        fov: 300,
        near: 0,
        far: -1,
        projection: 'perspective',
      },
    ],
    lights: [
      {
        id: 'light',
        name: 'Spot',
        type: 'spot',
        color: '#ffffff',
        intensity: -1,
        transform: {
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        castShadow: true,
        innerConeAngle: 1,
        outerConeAngle: 0.5,
      },
    ],
    activeCameraId: 'missing-active-camera',
    renderSettings: {
      backend: 'auto',
      qualityPreset: 'high',
      exposure: 1,
      toneMapping: 'aces',
      effects: {},
    },
  };
}

describe('Studio Scene Auditor', () => {
  it('reports hierarchy, reference and runtime-range problems with undoable safe fixes', () => {
    const auditor = new StudioAuditor();
    const report = auditor.audit(createScene());
    const codes = report.findings.map((finding) => finding.code);

    expect(codes).toEqual(expect.arrayContaining([
      'camera.active-missing',
      'hierarchy.invalid-children',
      'hierarchy.parent-missing',
      'transform.non-finite',
      'asset.mesh-missing',
      'material.slot-missing',
      'texture.reference-missing',
      'skin.joint-missing',
      'camera.near-invalid',
      'light.intensity-invalid',
      'asset.dependency-missing',
      'asset.orphaned',
    ]));
    expect(report.summary.errors).toBeGreaterThan(5);
    expect(report.summary.fixable).toBeGreaterThan(8);

    const patch = auditor.safeFixPatch(report);
    expect(patch).toContainEqual({ op: 'replace', path: '/activeCameraId', value: 'camera' });
    expect(patch).toContainEqual({ op: 'remove', path: '/environment/assetId' });
    expect(patch.some((operation) => operation.path === '/nodes/0/children')).toBe(true);
    expect(patch.some((operation) => operation.path === '/materials/material/metalness')).toBe(true);
  });

  it('supports per-user ignored rules and optional orphan scanning', () => {
    const auditor = new StudioAuditor();
    const report = auditor.audit(createScene(), {
      ignoredCodes: ['transform.zero-scale', 'hierarchy.duplicate-name'],
      includeOrphanAssets: false,
    });
    const codes = report.findings.map((finding) => finding.code);
    expect(codes).not.toContain('transform.zero-scale');
    expect(codes).not.toContain('hierarchy.duplicate-name');
    expect(codes).not.toContain('asset.orphaned');
  });
});

describe('Studio scoped user data', () => {
  it('isolates users and projects, persists values and validates imports', () => {
    const storage = new MemoryStorage();
    const first = new StudioUserDataStore('userdata', storage);
    const projectA = first.scope('user-a', 'project-a');
    const projectB = first.scope('user-a', 'project-b');
    const otherUser = first.scope('user-b', 'project-a');

    projectA.set('auditor.ignoredCodes', ['asset.orphaned']);
    projectB.set('camera.bookmark', { slot: 2 });
    otherUser.set('auditor.ignoredCodes', ['scene.empty']);

    expect(projectA.get('auditor.ignoredCodes', [])).toEqual(['asset.orphaned']);
    expect(projectB.get('auditor.ignoredCodes', [])).toEqual([]);
    expect(otherUser.get('auditor.ignoredCodes', [])).toEqual(['scene.empty']);

    const restored = new StudioUserDataStore('userdata', storage);
    expect(restored.scope('user-a', 'project-a').get('auditor.ignoredCodes', [])).toEqual(['asset.orphaned']);
    expect(JSON.parse(restored.export()).version).toBe(1);

    restored.scope('user-a', 'project-a').delete('auditor.ignoredCodes');
    expect(restored.scope('user-a', 'project-a').list()).toEqual({});
    expect(() => restored.import('{"version":2,"scopes":{}}')).toThrow(/Unsupported/);
  });
});
