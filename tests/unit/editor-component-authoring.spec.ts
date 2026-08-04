import { describe, expect, it, vi } from 'vitest';
import {
  createEmptySceneContract,
  type KyxosSceneContract,
  type ScenePatch,
} from '../../packages/scene-contract/src/index';
import { applyPatch } from '../../packages/editor-core/src/index';
import {
  ComponentAuthoringService,
  ComponentRegistry,
  componentMixedValue,
  copyAuthoringComponents,
  defaultComponentRegistry,
  normalizeComponentClipboard,
  summarizeAuthoringComponents,
  validateAuthoringComponents,
  type ComponentClipboard,
  type SceneAuthoringComponents,
} from '../../packages/editor-core/src/component-authoring-entry';

function fixture(): KyxosSceneContract {
  const scene = createEmptySceneContract('Components');
  scene.assets = {
    model: {
      id: 'model', uri: 'asset://model', contentHash: 'model', kind: 'model',
      mimeType: 'model/gltf-binary', name: 'Model.glb',
    },
    texture: {
      id: 'texture', uri: 'asset://texture', contentHash: 'texture', kind: 'texture',
      mimeType: 'image/png', name: 'Texture.png',
    },
    material: {
      id: 'material', uri: 'asset://material', contentHash: 'material', kind: 'material',
      mimeType: 'application/json', name: 'Material.material.json',
    },
    script: {
      id: 'script', uri: 'asset://script', contentHash: 'script', kind: 'script',
      mimeType: 'text/typescript', name: 'Behavior.ts',
    },
    audio: {
      id: 'audio', uri: 'asset://audio', contentHash: 'audio', kind: 'other',
      mimeType: 'audio/ogg', name: 'Sound.ogg',
    },
    sprite: {
      id: 'sprite', uri: 'asset://sprite', contentHash: 'sprite', kind: 'other',
      mimeType: 'application/json', name: 'Sprite.sprite.json',
    },
  };
  scene.nodes = [
    {
      id: 'root', name: 'Root', parentId: null, children: ['child', 'handle'], visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    },
    {
      id: 'child', name: 'Child', parentId: 'root', children: [], visible: true,
      transform: {
        position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    },
    {
      id: 'handle', name: 'Handle', parentId: 'root', children: [], visible: true,
      transform: {
        position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    },
  ];
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

describe('Component registry', () => {
  it('loads all built-in descriptors without losing default factories', () => {
    const descriptors = defaultComponentRegistry.list();
    expect(descriptors.map((entry) => entry.type)).toEqual(expect.arrayContaining([
      'render', 'sprite-renderer', 'audio-listener', 'audio-source', 'particle-system',
      'script', 'screen', 'element', 'button', 'scrollbar', 'scroll-view',
      'layout-group', 'layout-child', 'zone', 'gsplat',
    ]));
    expect(descriptors).toHaveLength(15);
    expect(defaultComponentRegistry.create('particle-system')).toMatchObject({
      maxParticles: 1000,
      lifetime: 5,
      emitter: { shape: 'point', radius: 1 },
    });
    expect(defaultComponentRegistry.get('button').requires).toEqual(['element']);
    expect(defaultComponentRegistry.get('gsplat').conflicts).toEqual(['render', 'sprite-renderer']);
    expect(defaultComponentRegistry.get('element').fields.some((field) => field.path === 'fontAssetId' && field.visibleWhen?.equals === 'text')).toBe(true);
  });

  it('supports custom descriptors and returns isolated descriptor copies', () => {
    const registry = new ComponentRegistry([]);
    const unregister = registry.register({
      type: 'zone',
      label: 'Custom Zone',
      category: 'World',
      icon: 'zone',
      requires: [],
      conflicts: [],
      fields: [{ path: 'size', label: 'Size', type: 'vec3' }],
      createDefault: () => ({ enabled: true, size: { x: 2, y: 2, z: 2 } }),
    });
    const list = registry.list();
    list[0].label = 'Mutated';
    expect(registry.get('zone').label).toBe('Custom Zone');
    expect(registry.create('zone').size).toEqual({ x: 2, y: 2, z: 2 });
    unregister();
    expect(registry.has('zone')).toBe(false);
  });
});

describe('Component authoring commands', () => {
  it('auto-adds required UI components and supports multi-object Mixed Value editing', () => {
    const state = createHost(fixture());
    const service = new ComponentAuthoringService(state.host);
    service.add(['root', 'child'], 'button');
    expect(state.getScene().nodes.slice(0, 2).every((node) => Boolean(node.authoringComponents?.element))).toBe(true);
    expect(state.getScene().nodes.slice(0, 2).every((node) => Boolean(node.authoringComponents?.button))).toBe(true);

    expect(componentMixedValue(state.getScene(), ['root', 'child'], 'button', 'active')).toEqual({
      mixed: false,
      value: true,
      values: [true, true],
      missingNodes: [],
    });
    service.set(['root'], 'button', 'active', false);
    expect(componentMixedValue(state.getScene(), ['root', 'child'], 'button', 'active')).toMatchObject({
      mixed: true,
      value: undefined,
      values: [false, true],
    });
    service.set(['root', 'child'], 'button', 'fadeDuration', 0.25);
    expect(state.getScene().nodes.slice(0, 2).map((node) => node.authoringComponents?.button?.fadeDuration)).toEqual([0.25, 0.25]);
  });

  it('enforces conflicts and required-component removal rules', () => {
    const state = createHost(fixture());
    const service = new ComponentAuthoringService(state.host);
    service.add(['root'], 'render', { meshAssetId: 'model', materialSlots: ['material'] });
    expect(() => service.add(['root'], 'gsplat')).toThrow(/conflicts with Render/);

    service.add(['child'], 'button');
    expect(() => service.remove(['child'], 'element')).toThrow(/required by Button/);
    service.remove(['child'], 'element', { cascade: true });
    expect(state.getScene().nodes[1].authoringComponents).toBeUndefined();
  });

  it('copies selected components and pastes with merge or replace semantics', () => {
    const state = createHost(fixture());
    const service = new ComponentAuthoringService(state.host);
    service.add(['root'], 'audio-source', { assetId: 'audio', loop: true });
    service.add(['root'], 'zone', { size: { x: 3, y: 4, z: 5 } });
    service.add(['child'], 'render', { meshAssetId: 'model' });

    const clipboard = service.copy('root', ['audio-source']);
    expect(clipboard.components).toEqual({
      'audio-source': expect.objectContaining({ assetId: 'audio', loop: true }),
    });
    service.paste(['child'], 'merge');
    expect(state.getScene().nodes[1].authoringComponents).toMatchObject({
      render: { meshAssetId: 'model' },
      'audio-source': { assetId: 'audio', loop: true },
    });

    const all = copyAuthoringComponents(state.getScene().nodes[0], undefined, '2026-08-03T00:00:00.000Z');
    service.paste(['handle'], 'replace', all);
    expect(Object.keys(state.getScene().nodes[2].authoringComponents ?? {}).sort()).toEqual(['audio-source', 'zone']);
    expect(normalizeComponentClipboard(JSON.parse(JSON.stringify(all)))).toEqual(all);
    expect(() => normalizeComponentClipboard({ version: 2, components: {} })).toThrow(/Unsupported/);
  });

  it('adds and reorders typed script entries', () => {
    const state = createHost(fixture());
    const service = new ComponentAuthoringService(state.host);
    service.addScript(['root'], {
      id: 'behavior', name: 'Behavior', assetId: 'script', enabled: true, attributes: { speed: 2 },
    });
    service.addScript(['root'], {
      id: 'late', name: 'Late Update', assetId: 'script', enabled: true, attributes: {},
    });
    expect(state.getScene().nodes[0].authoringComponents?.script?.executionOrder).toEqual(['behavior', 'late']);
    service.reorderScripts(['root'], ['late', 'behavior']);
    expect(state.getScene().nodes[0].authoringComponents?.script?.executionOrder).toEqual(['late', 'behavior']);
    expect(() => service.reorderScripts(['root'], ['behavior'])).toThrow(/every script exactly once/);
    expect(() => service.addScript(['root'], {
      id: 'behavior', name: 'Duplicate', assetId: 'script', enabled: true, attributes: {},
    })).toThrow(/already exists/);
  });
});

describe('Component validation', () => {
  it('validates scalar ranges, asset references, requirements, conflicts and listener uniqueness', () => {
    const scene = fixture();
    const invalid = {
      element: defaultComponentRegistry.create('element'),
      button: { ...defaultComponentRegistry.create('button'), targetNodeId: 'missing-node', fadeDuration: -1 },
      render: { ...defaultComponentRegistry.create('render'), meshAssetId: 'texture' },
      gsplat: { ...defaultComponentRegistry.create('gsplat'), assetId: 'missing-gsplat', shBands: 4 as 3 },
      'audio-listener': defaultComponentRegistry.create('audio-listener'),
    } satisfies SceneAuthoringComponents;
    scene.nodes[0].authoringComponents = invalid;
    scene.nodes[1].authoringComponents = {
      'audio-listener': defaultComponentRegistry.create('audio-listener'),
      scrollbar: { ...defaultComponentRegistry.create('scrollbar'), handleNodeId: 'root' },
      element: defaultComponentRegistry.create('element'),
    };
    scene.nodes[2].authoringComponents = {
      'scroll-view': {
        ...defaultComponentRegistry.create('scroll-view'),
        viewportNodeId: 'root',
        contentNodeId: 'missing-content',
        horizontalScrollbarNodeId: 'handle',
      },
      element: defaultComponentRegistry.create('element'),
    };

    const issues = validateAuthoringComponents(scene);
    const codes = issues.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'component.value-invalid',
      'component.asset-kind',
      'component.asset-missing',
      'component.node-missing',
      'component.node-type',
      'component.conflict',
      'component.listener-duplicate',
    ]));
  });

  it('validates script identity, asset kind and execution order', () => {
    const scene = fixture();
    scene.nodes[0].authoringComponents = {
      script: {
        enabled: true,
        scripts: [
          { id: 'same', name: 'One', assetId: 'texture', enabled: true, attributes: {} },
          { id: 'same', name: 'Two', assetId: 'missing', enabled: true, attributes: {} },
        ],
        executionOrder: ['same', 'missing-order'],
      },
    };
    const codes = validateAuthoringComponents(scene).map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining([
      'component.script-duplicate',
      'component.asset-kind',
      'component.asset-missing',
      'component.script-order',
    ]));
  });

  it('reports a missing required component and unknown imported component', () => {
    const scene = fixture();
    scene.nodes[0].authoringComponents = {
      button: defaultComponentRegistry.create('button'),
      mystery: { enabled: true },
    } as unknown as SceneAuthoringComponents;
    const codes = validateAuthoringComponents(scene).map((entry) => entry.code);
    expect(codes).toContain('component.required-missing');
    expect(codes).toContain('component.unknown');
  });
});

describe('Component summaries', () => {
  it('counts every registered component type across the scene', () => {
    const scene = fixture();
    scene.nodes[0].authoringComponents = {
      render: defaultComponentRegistry.create('render'),
      zone: defaultComponentRegistry.create('zone'),
    };
    scene.nodes[1].authoringComponents = {
      zone: defaultComponentRegistry.create('zone'),
      'particle-system': defaultComponentRegistry.create('particle-system'),
    };
    expect(summarizeAuthoringComponents(scene)).toMatchObject({
      render: 1,
      zone: 2,
      'particle-system': 1,
      button: 0,
      gsplat: 0,
    });
  });
});
