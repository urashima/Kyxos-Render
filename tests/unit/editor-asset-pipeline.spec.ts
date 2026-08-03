import { describe, expect, it, vi } from 'vitest';
import {
  createEmptySceneContract,
  type KyxosSceneContract,
  type ScenePatch,
} from '../../packages/scene-contract/src/index';
import { applyPatch } from '../../packages/editor-core/src/index';
import {
  AssetAuthoringService,
  AssetProcessingQueue,
  analyzeAssetUsage,
  collectAssetReferences,
  createProcessingTask,
  expandBundleAssetIds,
  prepareAssetContent,
  recommendTextureColorSpaces,
  validateAssetPipeline,
  validateProcessingOptions,
  type AssetContentStore,
  type AssetProcessingTask,
} from '../../packages/editor-core/src/asset-pipeline';

function fixture(): KyxosSceneContract {
  const scene = createEmptySceneContract('Assets');
  scene.assets = {
    model: {
      id: 'model', uri: 'asset://model', contentHash: 'hash-model', kind: 'model',
      mimeType: 'model/gltf-binary', name: 'Model.glb',
    },
    material: {
      id: 'material', uri: 'asset://material', contentHash: 'hash-material', kind: 'material',
      mimeType: 'application/json', name: 'Material.material.json',
    },
    albedo: {
      id: 'albedo', uri: 'asset://albedo', contentHash: 'hash-albedo', kind: 'texture',
      mimeType: 'image/png', name: 'Albedo.png', metadata: { colorSpace: 'linear' },
    },
    normal: {
      id: 'normal', uri: 'asset://normal', contentHash: 'hash-normal', kind: 'texture',
      mimeType: 'image/png', name: 'Normal.png', metadata: { colorSpace: 'srgb' },
    },
    mixed: {
      id: 'mixed', uri: 'asset://mixed', contentHash: 'hash-mixed', kind: 'texture',
      mimeType: 'image/png', name: 'Mixed.png',
    },
    hdr: {
      id: 'hdr', uri: 'asset://hdr', contentHash: 'hash-hdr', kind: 'environment',
      mimeType: 'image/vnd.radiance', name: 'Studio.hdr',
    },
    orphan: {
      id: 'orphan', uri: 'asset://orphan', contentHash: 'hash-orphan', kind: 'other',
      mimeType: 'text/plain', name: 'Unused.txt',
    },
  };
  scene.materials.material = {
    id: 'material',
    name: 'Material',
    baseColor: { x: 1, y: 1, z: 1, w: 1 },
    baseColorTexture: { assetId: 'albedo', colorSpace: 'srgb' },
    metalness: 0,
    roughness: 0.5,
    normalTexture: { assetId: 'normal', colorSpace: 'linear' },
    emissive: { x: 0, y: 0, z: 0 },
    emissiveTexture: { assetId: 'mixed', colorSpace: 'srgb' },
    aoTexture: { assetId: 'mixed', colorSpace: 'linear' },
    opacity: 1,
    alphaMode: 'opaque',
    doubleSided: false,
  };
  scene.nodes = [{
    id: 'root',
    name: 'Root',
    parentId: null,
    children: [],
    visible: true,
    meshAssetId: 'model',
    materialSlots: ['material'],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }];
  scene.environment.assetId = 'hdr';
  scene.editorState = {
    ...(scene.editorState ?? {}),
    assetFolders: [{ id: 'source', name: 'Source', parentId: null }],
    assetBundles: [],
    assetProcessingTasks: [],
    assetProcessingLog: [],
  };
  return scene;
}

function createHost(initial: KyxosSceneContract) {
  let scene = structuredClone(initial);
  const executed = vi.fn();
  return {
    host: {
      getScene: () => structuredClone(scene),
      execute(label: string, build: (scene: KyxosSceneContract) => ScenePatch) {
        const patch = build(structuredClone(scene));
        scene = applyPatch(scene, patch);
        executed(label, patch);
      },
    },
    getScene: () => structuredClone(scene),
    executed,
  };
}

function storeFixture(): AssetContentStore & { write: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  return {
    write: vi.fn(async ({ id, bytes }) => ({
      uri: `asset://${id}-hash` as const,
      contentHash: `${id}-hash`,
      byteSize: bytes.byteLength,
    })),
    remove: vi.fn(async () => undefined),
  };
}

async function waitForTask(
  state: ReturnType<typeof createHost>,
  taskId: string,
  statuses: AssetProcessingTask['status'][],
): Promise<AssetProcessingTask> {
  for (let index = 0; index < 200; index += 1) {
    const task = state.getScene().editorState?.assetProcessingTasks?.find((entry) => entry.id === taskId);
    if (task && statuses.includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Task ${taskId} did not reach ${statuses.join(', ')}.`);
}

describe('Asset creators', () => {
  it('prepares typed creator defaults and validates structured content', () => {
    const scene = fixture();
    const material = prepareAssetContent(scene, {
      creator: 'material', id: 'new-material', name: 'New Material', folderId: 'source',
    }, '2026-08-03T00:00:00.000Z');
    expect(material).toMatchObject({
      filename: 'New Material.material.json',
      mimeType: 'application/json',
      kind: 'material',
    });
    expect(material.material).toMatchObject({ id: 'new-material', roughness: 0.5 });

    const i18n = prepareAssetContent(scene, {
      creator: 'i18n', id: 'strings', name: 'Strings', language: 'zh-CN',
    });
    expect(JSON.parse(new TextDecoder().decode(i18n.bytes))).toEqual({ locale: 'zh-CN', messages: {} });

    expect(() => prepareAssetContent(scene, {
      creator: 'json', id: 'bad-json', name: 'Bad', content: '{',
    })).toThrow(/Invalid JSON content/);
    expect(() => prepareAssetContent(scene, {
      creator: 'text', id: 'model', name: 'Duplicate',
    })).toThrow(/already exists/);
  });

  it('persists content first then commits asset, material and bundle state atomically', async () => {
    const state = createHost(fixture());
    const store = storeFixture();
    const service = new AssetAuthoringService(state.host, store);

    const asset = await service.create({
      creator: 'material', id: 'new-material', name: 'New Material', folderId: 'source',
    });
    expect(asset).toMatchObject({
      id: 'new-material',
      uri: 'asset://new-material-hash',
      contentHash: 'new-material-hash',
      kind: 'material',
    });
    expect(state.getScene().materials['new-material']).toMatchObject({ name: 'New Material' });

    await service.create({
      creator: 'bundle',
      id: 'main-bundle',
      name: 'Main Bundle',
      bundleAssetIds: ['model', 'material'],
    });
    expect(state.getScene().editorState?.assetBundles?.[0]).toMatchObject({
      id: 'main-bundle', assetIds: ['model', 'material'], includeDependencies: true,
    });
    service.updateBundle('main-bundle', { preload: true, tags: [' launch ', 'launch', 'hero'] });
    expect(state.getScene().editorState?.assetBundles?.[0]).toMatchObject({
      preload: true, tags: ['launch', 'hero'],
    });
    service.removeBundle('main-bundle');
    expect(state.getScene().editorState?.assetBundles).toEqual([]);
    expect(store.write).toHaveBeenCalledTimes(2);
  });

  it('rolls stored content back when the scene command cannot commit', async () => {
    const scene = fixture();
    const store = storeFixture();
    const service = new AssetAuthoringService({
      getScene: () => structuredClone(scene),
      execute: () => { throw new Error('Scene is read only.'); },
    }, store);
    await expect(service.create({ creator: 'text', id: 'notes', name: 'Notes' })).rejects.toThrow(/read only/);
    expect(store.remove).toHaveBeenCalledTimes(1);
  });
});

describe('Asset graph and color-space audit', () => {
  it('collects usage, missing references and orphan assets', () => {
    const scene = fixture();
    scene.materials.material.roughnessTexture = { assetId: 'missing-mask' };
    const report = analyzeAssetUsage(scene);
    expect(report.usedAssetIds).toEqual(expect.arrayContaining(['model', 'albedo', 'normal', 'mixed', 'hdr']));
    expect(report.missingAssetIds).toEqual(['missing-mask']);
    expect(report.orphanAssetIds).toContain('orphan');
    expect(collectAssetReferences(scene).some((entry) => entry.path.includes('roughnessTexture'))).toBe(true);
  });

  it('recommends sRGB for color textures, linear for data and reports mixed usage', () => {
    const recommendations = recommendTextureColorSpaces(fixture());
    expect(recommendations.find((entry) => entry.assetId === 'albedo')).toMatchObject({
      current: 'linear', recommended: 'srgb', conflict: false,
    });
    expect(recommendations.find((entry) => entry.assetId === 'normal')).toMatchObject({
      current: 'srgb', recommended: 'linear', conflict: false,
    });
    expect(recommendations.find((entry) => entry.assetId === 'mixed')).toMatchObject({
      recommended: 'linear', conflict: true,
    });
  });

  it('expands material and texture dependencies for bundles', () => {
    const scene = fixture();
    const bundle = {
      id: 'bundle', name: 'Bundle', assetIds: ['model'], includeDependencies: true,
      preload: false, tags: [], createdAt: '', updatedAt: '',
    };
    expect(expandBundleAssetIds(scene, bundle)).toEqual(expect.arrayContaining([
      'model', 'material', 'albedo', 'normal', 'mixed',
    ]));
  });
});

describe('Processing task contracts', () => {
  it('normalizes tasks and rejects invalid conversion settings', () => {
    expect(createProcessingTask({
      id: ' convert task ',
      kind: 'texture-convert',
      assetIds: ['albedo', 'albedo'],
      options: { format: 'webp', quality: 0.8, maxSize: 2048 },
      maxAttempts: 20,
      now: '2026-08-03T00:00:00.000Z',
    })).toMatchObject({
      id: 'convert-task', assetIds: ['albedo'], status: 'queued', maxAttempts: 10,
    });
    expect(validateProcessingOptions('model-unwrap', { channel: 'uv9', padding: -1 })).toHaveLength(2);
    expect(() => createProcessingTask({
      id: 'bad', kind: 'texture-convert', assetIds: ['albedo'], options: { format: 'gif' },
    })).toThrow(/format is invalid/);
  });

  it('validates bundles, task inputs, cycles and malformed asset metadata', () => {
    const scene = fixture();
    scene.assets.albedo.uri = 'https://example.com/albedo.png' as `asset://${string}`;
    scene.assets.normal.metadata = { folderId: 'missing-folder' };
    scene.editorState!.assetBundles = [
      { id: 'bundle', name: 'Bundle', assetIds: ['missing'], includeDependencies: false, preload: false, tags: [], createdAt: '', updatedAt: '' },
      { id: 'bundle', name: 'Bundle', assetIds: [], includeDependencies: false, preload: false, tags: [], createdAt: '', updatedAt: '' },
    ];
    scene.editorState!.assetProcessingTasks = [
      createProcessingTask({ id: 'a', kind: 'thumbnail-regenerate', assetIds: ['model'], dependsOn: ['b'] }),
      createProcessingTask({ id: 'b', kind: 'model-unwrap', assetIds: ['missing'], dependsOn: ['a'] }),
    ];
    const codes = validateAssetPipeline(scene).map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'asset.uri-invalid',
      'asset.folder-missing',
      'bundle.duplicate-id',
      'bundle.duplicate-name',
      'bundle.asset-missing',
      'task.asset-missing',
      'task.dependency-cycle',
    ]));
  });
});

describe('Asset processing queue', () => {
  it('runs dependency-ordered tasks, persists progress, outputs and logs', async () => {
    const state = createHost(fixture());
    const order: string[] = [];
    const queue = new AssetProcessingQueue(state.host, 2, {
      'texture-convert': async ({ task, report }) => {
        order.push(task.id);
        report(0.25, 'Decoded source texture.');
        report(0.75, 'Encoded target texture.');
        return { outputs: ['converted'], messages: [{ message: 'Conversion complete.' }] };
      },
      'thumbnail-regenerate': async ({ task }) => {
        order.push(task.id);
        return { outputs: ['thumbnail'] };
      },
    });
    queue.enqueue(createProcessingTask({
      id: 'convert', kind: 'texture-convert', assetIds: ['albedo'],
      options: { format: 'webp', quality: 0.8 },
    }));
    queue.enqueue(createProcessingTask({
      id: 'thumb', kind: 'thumbnail-regenerate', assetIds: ['model'], dependsOn: ['convert'],
      options: { width: 256, height: 256 },
    }));
    await queue.drain();

    expect(order).toEqual(['convert', 'thumb']);
    expect(state.getScene().editorState?.assetProcessingTasks).toMatchObject([
      { id: 'convert', status: 'completed', progress: 1, outputs: ['converted'] },
      { id: 'thumb', status: 'completed', progress: 1, outputs: ['thumbnail'] },
    ]);
    expect(state.getScene().editorState?.assetProcessingLog?.map((entry) => entry.message)).toEqual(expect.arrayContaining([
      'Decoded source texture.', 'Encoded target texture.', 'Conversion complete.',
    ]));
  });

  it('automatically retries within the attempt budget and records the first failure', async () => {
    const state = createHost(fixture());
    let attempts = 0;
    const queue = new AssetProcessingQueue(state.host, 1, {
      'texture-recompress': async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Transient encoder failure.');
        return { outputs: ['compressed'] };
      },
    });
    queue.enqueue(createProcessingTask({
      id: 'recompress', kind: 'texture-recompress', assetIds: ['albedo'],
      options: { codec: 'uastc', quality: 128 }, maxAttempts: 2,
    }));
    await queue.drain();
    expect(attempts).toBe(2);
    expect(state.getScene().editorState?.assetProcessingTasks?.[0]).toMatchObject({
      status: 'completed', attempts: 2, outputs: ['compressed'],
    });
    expect(state.getScene().editorState?.assetProcessingLog?.some((entry) => entry.level === 'warning')).toBe(true);
  });

  it('fails tasks without handlers and supports retry after registering one', async () => {
    const state = createHost(fixture());
    const queue = new AssetProcessingQueue(state.host, 1);
    queue.enqueue(createProcessingTask({
      id: 'unwrap', kind: 'model-unwrap', assetIds: ['model'], options: { channel: 'uv1' },
    }));
    await waitForTask(state, 'unwrap', ['failed']);
    expect(state.getScene().editorState?.assetProcessingTasks?.[0].error).toContain('No handler');

    queue.register('model-unwrap', async () => ({ outputs: ['unwrapped'] }));
    queue.retry('unwrap');
    await queue.drain();
    expect(state.getScene().editorState?.assetProcessingTasks?.[0]).toMatchObject({
      status: 'completed', outputs: ['unwrapped'],
    });
  });

  it('cancels a running task through AbortSignal without overwriting cancellation', async () => {
    const state = createHost(fixture());
    let entered = false;
    const queue = new AssetProcessingQueue(state.host, 1, {
      'cubemap-prefilter': async ({ signal }) => {
        entered = true;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { outputs: ['should-not-commit'] };
      },
    });
    queue.enqueue(createProcessingTask({
      id: 'prefilter', kind: 'cubemap-prefilter', assetIds: ['hdr'], options: { resolution: 256, samples: 64 },
    }));
    for (let index = 0; index < 100 && !entered; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    queue.cancel('prefilter');
    const task = await waitForTask(state, 'prefilter', ['cancelled']);
    expect(task).toMatchObject({ status: 'cancelled' });
    expect(task.outputs).toBeUndefined();
  });
});
