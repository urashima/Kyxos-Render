import { describe, expect, it, vi } from 'vitest';
import type { KyxosSceneContract } from '../../packages/scene-contract/src/index';
import {
  StudioPickerRegistry,
  createScenePickerProviders,
  evaluateCurve,
  evaluateGradient,
  normalizeCurve,
  normalizeGradient,
  type StudioPickerPreferenceStorage,
} from '../../packages/editor-core/src/pickers';
import {
  TextureAtlasEditor,
  createTextureAtlasDocument,
  detectTextureAtlasRegions,
  sliceTextureAtlasGrid,
  textureAtlasFromAssetMetadata,
  textureAtlasToAssetMetadata,
  validateTextureAtlas,
} from '../../packages/editor-core/src/texture-atlas';

class MemoryStorage implements StudioPickerPreferenceStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function sceneFixture(): KyxosSceneContract {
  return {
    contractVersion: '1.1.0',
    id: 'scene',
    metadata: { name: 'Scene', createdAt: '2026-08-03T00:00:00Z', updatedAt: '2026-08-03T00:00:00Z' },
    compatibility: { viewerApiMin: '1.1.0' },
    capabilities: [],
    assets: {
      texture: { id: 'texture', uri: 'asset://texture', contentHash: 'texture', kind: 'texture', mimeType: 'image/png', name: 'Albedo' },
      model: { id: 'model', uri: 'asset://model', contentHash: 'model', kind: 'model', mimeType: 'model/gltf-binary', name: 'Robot' },
    },
    nodes: [
      {
        id: 'root', name: 'Robot', parentId: null, children: [], visible: true,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        meshAssetId: 'model', materialSlots: ['material'],
      },
    ],
    materials: {
      material: {
        id: 'material', name: 'Robot Material', baseColor: { x: 1, y: 1, z: 1, w: 1 },
        metalness: 0.2, roughness: 0.7, emissive: { x: 0, y: 0, z: 0 }, opacity: 1,
        alphaMode: 'opaque', doubleSided: false,
      },
    },
    animations: [{ id: 'idle', name: 'Idle', clipIndex: 0, duration: 2, loop: true, speed: 1 }],
    environment: { rotation: 0, intensity: 1, backgroundIntensity: 1, backgroundBlur: 0, backgroundColor: '#000000', transparentBackground: false },
    cameras: [{
      id: 'camera', name: 'Camera', target: { x: 0, y: 0, z: 0 }, fov: 45, near: 0.01, far: 1000,
      transform: { position: { x: 0, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    }],
    lights: [{
      id: 'light', name: 'Key', type: 'directional', color: '#ffffff', intensity: 3, castShadow: true,
      transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    }],
    activeCameraId: 'camera',
    renderSettings: { backend: 'auto', qualityPreset: 'high', exposure: 1, toneMapping: 'aces', effects: {} },
  };
}

describe('Texture atlas algorithms', () => {
  it('slices deterministic padded grids', () => {
    expect(sliceTextureAtlasGrid(10, 6, { columns: 2, rows: 2, padding: 1, spacing: 1 })).toEqual([
      { x: 1, y: 1, width: 3, height: 1 },
      { x: 5, y: 1, width: 4, height: 1 },
      { x: 1, y: 3, width: 3, height: 2 },
      { x: 5, y: 3, width: 4, height: 2 },
    ]);
    expect(() => sliceTextureAtlasGrid(4, 4, { columns: 4, rows: 4, padding: 2 })).toThrow(/leave no room/);
  });

  it('detects disconnected alpha islands with padding and pixel thresholds', () => {
    const alpha = new Uint8Array(8 * 5);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [5, 2], [6, 2], [5, 3], [6, 3]]) {
      alpha[y * 8 + x] = 255;
    }
    expect(detectTextureAtlasRegions(alpha, 8, 5, { minimumPixels: 2, padding: 1 })).toEqual([
      { x: 0, y: 0, width: 4, height: 4, pixelCount: 3 },
      { x: 4, y: 1, width: 4, height: 4, pixelCount: 4 },
    ]);
  });

  it('edits, validates, serializes and restores frames through undoable operations', () => {
    let nextId = 0;
    const editor = new TextureAtlasEditor(createTextureAtlasDocument(64, 32, 'texture'), () => `frame-${++nextId}`);
    const changed = vi.fn();
    editor.addEventListener('change', changed);
    const first = editor.addFrame({ x: 0, y: 0, width: 16, height: 16 }, 'Idle');
    const second = editor.addFrame({ x: 8, y: 8, width: 16, height: 16 }, 'Idle');
    expect(editor.value.frames.map((frame) => frame.name)).toEqual(['Idle', 'Idle 2']);
    expect(validateTextureAtlas(editor.value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'frame.overlap', frameId: first, otherFrameId: second }),
    ]));

    editor.updateFrame(first, { pivot: { x: 0, y: 1 }, border: { left: 2, top: 2, right: 2, bottom: 2 } });
    const duplicates = editor.duplicateFrames([first]);
    expect(duplicates).toEqual(['frame-3']);
    expect(editor.canUndo).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.value.frames).toHaveLength(2);
    expect(editor.redo()).toBe(true);
    expect(editor.value.frames).toHaveLength(3);
    editor.removeFrames([second]);
    expect(editor.value.frames.some((frame) => frame.id === second)).toBe(false);
    expect(changed).toHaveBeenCalled();

    const metadata = textureAtlasToAssetMetadata(editor.value);
    expect(textureAtlasFromAssetMetadata(metadata)).toEqual(editor.value);
    expect(JSON.parse(editor.serialize()).version).toBe(1);
  });
});

describe('Studio typed picker registry', () => {
  it('combines providers, validates options and persists recent/favorite choices', async () => {
    const storage = new MemoryStorage();
    const registry = new StudioPickerRegistry('pickers', storage);
    registry.register({
      id: 'assets-a',
      kinds: ['asset'],
      priority: 5,
      search: () => [
        { id: 'robot', label: 'Robot Model', value: 'robot', keywords: ['mesh'] },
        { id: 'broken', label: 'Broken Asset', value: 'broken' },
      ],
      validate: (option) => option.id === 'broken' ? 'Asset is unavailable.' : null,
    });
    registry.register({
      id: 'assets-b',
      kinds: ['asset'],
      priority: 1,
      search: () => [{ id: 'robot', label: 'Robot Duplicate', value: 'robot-duplicate' }],
    });

    const results = await registry.search<string>({ kind: 'asset', query: 'robot' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'robot', label: 'Robot Model', providerId: 'assets-a' });
    const invalid = await registry.search({ kind: 'asset', query: 'broken' });
    expect(invalid[0]).toMatchObject({ disabled: true, validationError: 'Asset is unavailable.' });

    registry.commit('asset', ['robot']);
    registry.setFavorite('asset', 'robot', true);
    const restored = new StudioPickerRegistry('pickers', storage);
    expect(restored.isFavorite('asset', 'robot')).toBe(true);
  });

  it('provides entity, asset, material, animation, camera and light options from Scene Contract', async () => {
    const registry = new StudioPickerRegistry('scene-pickers', new MemoryStorage());
    for (const provider of createScenePickerProviders(sceneFixture)) registry.register(provider);
    expect((await registry.search({ kind: 'entity', query: 'robot' }))[0].id).toBe('root');
    expect((await registry.search({ kind: 'texture' }))[0].id).toBe('texture');
    expect((await registry.search({ kind: 'material' }))[0].id).toBe('material');
    expect((await registry.search({ kind: 'animation' }))[0].id).toBe('idle');
    expect((await registry.search({ kind: 'camera' }))[0].id).toBe('camera');
    expect((await registry.search({ kind: 'light' }))[0].id).toBe('light');
  });
});

describe('Curve and gradient picker values', () => {
  it('normalizes and evaluates step, linear and cubic curves', () => {
    expect(normalizeCurve({ keys: [{ time: 1, value: 10 }, { time: 0, value: 0 }] }).keys[0].time).toBe(0);
    expect(evaluateCurve({ keys: [{ time: 0, value: 2, interpolation: 'step' }, { time: 1, value: 8 }] }, 0.5)).toBe(2);
    expect(evaluateCurve({ keys: [{ time: 0, value: 0 }, { time: 1, value: 10 }] }, 0.25)).toBe(2.5);
    expect(evaluateCurve({ keys: [{ time: 0, value: 0, interpolation: 'cubic', outTangent: 0 }, { time: 1, value: 1, inTangent: 0 }] }, 0.5)).toBeCloseTo(0.5);
  });

  it('normalizes and evaluates linear and constant gradients', () => {
    expect(normalizeGradient({ stops: [{ position: 1, color: '#fff' }, { position: 0, color: '#000' }] }).stops[0]).toEqual({ position: 0, color: '#000000' });
    expect(evaluateGradient({ stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }] }, 0.5)).toBe('#808080');
    expect(evaluateGradient({ stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }], interpolation: 'constant' }, 0.8)).toBe('#ff0000');
  });
});
