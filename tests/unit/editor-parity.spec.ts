import { describe, expect, it, vi } from 'vitest';
import {
  AnimationGraphService,
  AssetWorkspaceService,
  ClipboardService,
  DiagnosticConsole,
  HierarchyService,
  ImportTaskQueue,
  MIXED_VALUE,
  SceneWorkspaceService,
  SchemaInspectorModel,
  StudioApi,
  StudioMcpBridge,
  StudioPluginRegistry,
  animationGraphToPcuiData,
  applyPatch,
  createAnimationStateGraph,
  createDefaultInspectorRegistry,
  createProjectWorkspace,
  diffValues,
  evaluateAnimationStateGraph,
  rangeSelection,
  roleCan,
  threeWayMerge,
  validateAnimationStateGraph,
  type HierarchyCommandHost,
} from '../../packages/editor-core/src/index';
import type { KyxosSceneContract, ScenePatch } from '../../packages/scene-contract/src/index';
import { createFixtureContract, FIXTURE_HASH } from '../../packages/test-fixtures/src/index';

function mutableHost(initial = createFixtureContract()): HierarchyCommandHost & { scene: KyxosSceneContract } {
  return {
    scene: structuredClone(initial),
    getScene() { return structuredClone(this.scene); },
    execute(_label: string, createPatch: (scene: KyxosSceneContract) => ScenePatch) {
      this.scene = applyPatch(this.scene, createPatch(structuredClone(this.scene)));
    },
  };
}

function ids(prefix = 'id') {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

describe('PlayCanvas-aligned hierarchy behavior', () => {
  it('supports folding, subtree duplication, ordered moves, clipboard, locking and isolation', () => {
    const host = mutableHost();
    const hierarchy = new HierarchyService(host, new ClipboardService(), ids('node'));
    const root = host.scene.nodes[0].id;
    const childA = hierarchy.add('empty', root);
    const childB = hierarchy.add('empty', root);
    const grandchild = hierarchy.add('empty', childA);

    hierarchy.setExpanded(root, false);
    hierarchy.setExpanded(childA, false);
    expect(hierarchy.rows()).toHaveLength(1);
    hierarchy.setExpanded(root, true);
    expect(hierarchy.rows().map((row) => row.id)).toEqual([root, childA, childB]);
    hierarchy.setExpanded(childA, true);
    expect(hierarchy.rows().find((row) => row.id === grandchild)?.depth).toBe(2);
    expect(rangeSelection(hierarchy.rows().map((row) => row.id), childA, childB)).toEqual([childA, grandchild, childB]);

    hierarchy.move([childB], childA, 'before');
    expect(host.scene.nodes.find((node) => node.id === root)?.children).toEqual([childB, childA]);
    const sourceRoot = host.scene.nodes.find((node) => node.id === childA)!;
    const sourceChild = host.scene.nodes.find((node) => node.id === grandchild)!;
    sourceRoot.meshAssetId = 'fixture-model';
    sourceRoot.materialSlots = ['fixture-material'];
    sourceRoot.materialVariantBindings = { polished: ['fixture-material'] };
    sourceRoot.skin = { skinIndex: 0, joints: [grandchild], skeletonNodeId: grandchild };
    sourceRoot.template = { templateId: 'template', instanceId: 'source-instance', sourceNodeId: childA, overrides: [] };
    sourceChild.template = { templateId: 'template', instanceId: 'source-instance', sourceNodeId: grandchild, overrides: [] };
    const duplicates = hierarchy.duplicate([childA]);
    expect(duplicates).toHaveLength(1);
    const clonedRoot = host.scene.nodes.find((node) => node.id === duplicates[0])!;
    expect(clonedRoot.children).toHaveLength(1);
    const clonedChild = host.scene.nodes.find((node) => node.id === clonedRoot.children[0])!;
    expect(clonedChild.parentId).toBe(clonedRoot.id);
    expect(clonedRoot.skin).toMatchObject({ joints: [clonedChild.id], skeletonNodeId: clonedChild.id });
    expect(clonedRoot.template?.instanceId).not.toBe('source-instance');
    expect(clonedChild.template?.instanceId).toBe(clonedRoot.template?.instanceId);
    expect(clonedRoot.template?.sourceNodeId).toBe(clonedRoot.id);
    const clonedVariantMaterial = clonedRoot.materialVariantBindings?.polished[0];
    expect(clonedVariantMaterial).not.toBe('fixture-material');
    expect(host.scene.materials[clonedVariantMaterial!]).toBeDefined();

    hierarchy.copy([childA]);
    const pasted = hierarchy.paste(childB);
    expect(host.scene.nodes.find((node) => node.id === pasted[0])?.parentId).toBe(childB);
    hierarchy.rename(childB, 'Container');
    hierarchy.setLocked([childB], true);
    hierarchy.setVisible([childB], false, true);
    expect(host.scene.nodes.find((node) => node.id === childB)).toMatchObject({ name: 'Container', locked: true, visible: false });
    hierarchy.isolate([childA]);
    expect(host.scene.nodes.find((node) => node.id === childA)?.visible).toBe(true);
    expect(host.scene.nodes.find((node) => node.id === childB)?.visible).toBe(false);
    hierarchy.unisolate();
    expect(host.scene.nodes.find((node) => node.id === root)?.visible).toBe(true);
  });

  it('creates typed camera/light entities with backing components', () => {
    const host = mutableHost();
    const hierarchy = new HierarchyService(host, new ClipboardService(), ids('typed'));
    const cameraNode = hierarchy.add('camera');
    const lightNode = hierarchy.add('spot-light');
    expect(host.scene.cameras.some((camera) => camera.id === host.scene.nodes.find((node) => node.id === cameraNode)?.cameraId)).toBe(true);
    const light = host.scene.lights?.find((entry) => entry.id === host.scene.nodes.find((node) => node.id === lightNode)?.lightId);
    expect(light).toMatchObject({ type: 'spot', decay: 2 });
  });
});

describe('Schema Inspector and Asset Workspace', () => {
  it('detects mixed values, updates all targets, clamps ranges and restores imported values', () => {
    const fixture = createFixtureContract();
    fixture.nodes.push({
      ...structuredClone(fixture.nodes[0]),
      id: 'second-node',
      name: 'Second',
      transform: { ...structuredClone(fixture.nodes[0].transform), position: { x: 4, y: 0, z: 0 } },
    });
    fixture.materials['fixture-material'].metadata = {
      original: { ...structuredClone(fixture.materials['fixture-material']), roughness: 0.25, metadata: undefined },
    };
    fixture.assets['fixture-texture'] = {
      id: 'fixture-texture', uri: `asset://${FIXTURE_HASH}`, contentHash: FIXTURE_HASH,
      kind: 'texture', mimeType: 'image/png', name: 'Fixture Texture',
    };
    fixture.materials['fixture-material'].baseColorTexture = {
      assetId: 'fixture-texture', texCoord: 0, colorSpace: 'srgb', channel: 'rgba',
      offset: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
      wrapS: 'repeat', wrapT: 'repeat', minFilter: 'linearMipLinear', magFilter: 'linear',
    };
    fixture.materials['fixture-material'].roughness = 0.8;
    const model = new SchemaInspectorModel(createDefaultInspectorRegistry());
    const context = { scene: fixture, nodeIds: ['fixture-node', 'second-node'] };
    const fields = model.registry.sections(context).flatMap((section) => section.fields(context));
    const positionX = fields.find((field) => field.id === 'transform.position.x')!;
    expect(model.read(positionX, context)).toMatchObject({ mixed: true, value: MIXED_VALUE });
    const moved = applyPatch(fixture, model.update(positionX, context, 2.5));
    expect(moved.nodes.map((node) => node.transform.position.x)).toEqual([2.5, 2.5]);

    const materialContext = { scene: fixture, nodeIds: ['fixture-node'] };
    const materialFields = model.registry.sections(materialContext).flatMap((section) => section.fields(materialContext));
    const roughness = materialFields.find((field) => field.id === 'material.roughness')!;
    expect(model.read(roughness, materialContext).overridden).toBe(true);
    const restored = applyPatch(fixture, model.restore(roughness, materialContext));
    expect(restored.materials['fixture-material'].roughness).toBe(0.25);
    expect(() => model.update(roughness, materialContext, 4)).toThrow(/at most 1/);
    const bounded = applyPatch(fixture, model.update(roughness, materialContext, 1));
    expect(bounded.materials['fixture-material'].roughness).toBe(1);
    const uvSet = materialFields.find((field) => field.id === 'material.baseColorTexture.texCoord')!;
    const movedUv = applyPatch(fixture, model.update(uvSet, materialContext, 2.7));
    expect(movedUv.materials['fixture-material'].baseColorTexture?.texCoord).toBe(3);
    expect(materialFields.map((field) => field.id)).toEqual(expect.arrayContaining([
      'material.baseColorTexture.colorSpace',
      'material.baseColorTexture.channel',
      'material.baseColorTexture.offset.x',
      'material.baseColorTexture.scale.y',
      'material.baseColorTexture.rotation',
      'material.baseColorTexture.wrapS',
      'material.baseColorTexture.minFilter',
    ]));
  });

  it('manages folders, filters, dependencies, trash, recovery and safe purge', () => {
    const fixture = createFixtureContract();
    fixture.assets.texture = {
      id: 'texture', uri: `asset://${FIXTURE_HASH}`, contentHash: FIXTURE_HASH,
      kind: 'texture', mimeType: 'image/png', name: 'Albedo',
    };
    fixture.materials['fixture-material'].baseColorTexture = {
      assetId: 'texture', colorSpace: 'srgb', offset: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
    };
    const host = mutableHost(fixture);
    const assets = new AssetWorkspaceService(host, ids('asset'));
    const folder = assets.createFolder('Textures');
    assets.move(['texture'], folder);
    expect(assets.list({ folderId: folder, query: 'albedo', kinds: ['texture'] })).toHaveLength(1);
    expect(assets.list().find((item) => item.asset.id === 'texture')?.reverseReferences[0].label).toContain('baseColorTexture');
    assets.remove(['texture']);
    expect(assets.list()).not.toContainEqual(expect.objectContaining({ asset: expect.objectContaining({ id: 'texture' }) }));
    expect(assets.list({ includeDeleted: true }).find((item) => item.asset.id === 'texture')?.deleted).toBe(true);
    expect(() => assets.purge(['texture'])).toThrow(/referenced/);
    assets.restore(['texture']);
    expect(assets.list().some((item) => item.asset.id === 'texture')).toBe(true);
    const duplicate = assets.duplicate('texture')!;
    expect(host.scene.assets[duplicate].metadata?.duplicatedFrom).toBe('texture');
  });

  it('runs bounded import jobs and preserves terminal task state', async () => {
    const queue = new ImportTaskQueue<string>(1, ids('task'));
    queue.enqueue('model.glb', async (context) => {
      context.report('parsing', 0.5);
      return 'ready';
    });
    await vi.waitFor(() => expect(queue.list()[0]?.stage).toBe('complete'));
    expect(queue.list()[0]).toMatchObject({ progress: 1, result: 'ready', attempts: 1 });
  });
});

describe('Scenes, templates, animation graphs, collaboration and extensions', () => {
  it('supports multi-scene lifecycle and template instance override apply/reset/unpack', () => {
    const fixture = createFixtureContract();
    const workspace = new SceneWorkspaceService(createProjectWorkspace('project', fixture), ids('workspace'));
    const first = workspace.activeScene.id;
    const second = workspace.createScene('Scene 2');
    workspace.renameScene(second.id, 'Secondary');
    const duplicate = workspace.duplicateScene(first);
    expect(workspace.value.scenes.map((scene) => scene.name)).toEqual(expect.arrayContaining(['Fixture Scene', 'Secondary', duplicate.name]));
    workspace.select(first);
    const template = workspace.createTemplate(first, ['fixture-node'], 'Triangle Prefab');
    const roots = workspace.instantiate(template.id, first);
    const siblingRoots = workspace.instantiate(template.id, first);
    let scene = workspace.activeScene.document;
    const instance = scene.nodes.find((node) => node.id === roots[0])!;
    instance.transform.position.x = 7;
    workspace.updateScene(first, scene);
    const overrides = workspace.refreshOverrideMetadata(first, instance.template!.instanceId);
    expect(overrides.some((override) => override.path === '/transform/position/x')).toBe(true);
    workspace.resetOverrides(first, instance.template!.instanceId, ['/transform/position/x']);
    expect(workspace.activeScene.document.nodes.find((node) => node.id === instance.id)?.transform.position.x).toBe(0);
    scene = workspace.activeScene.document;
    scene.nodes.find((node) => node.id === instance.id)!.visible = false;
    scene.nodes.find((node) => node.id === instance.id)!.name = 'Applied Name';
    scene.nodes.find((node) => node.id === siblingRoots[0])!.name = 'Preserved Override';
    workspace.updateScene(first, scene);
    workspace.applyOverrides(first, instance.template!.instanceId);
    expect(workspace.value.templates[0].revision).toBe(2);
    expect(workspace.activeScene.document.nodes.find((node) => node.id === siblingRoots[0])?.visible).toBe(false);
    expect(workspace.activeScene.document.nodes.find((node) => node.id === siblingRoots[0])?.name).toBe('Preserved Override');
    workspace.unpackInstance(first, instance.template!.instanceId);
    expect(workspace.activeScene.document.nodes.find((node) => node.id === instance.id)?.template).toBeUndefined();
    workspace.deleteScene(second.id);
    expect(workspace.value.scenes.some((entry) => entry.id === second.id)).toBe(false);
  });

  it('edits and evaluates states, transitions, parameters, conditions and blend trees', () => {
    const graph = createAnimationStateGraph();
    const service = new AnimationGraphService(graph, ids('graph'));
    const speed = service.addParameter('Speed', 'float', 0);
    const moving = service.addState({
      name: 'Moving',
      blendTree: {
        type: '1d', parameterX: speed,
        children: [{ clipId: 'idle', threshold: 0 }, { clipId: 'run', threshold: 1 }],
      },
    });
    const transition = service.addTransition(service.value.initialStateId, moving, 0.15);
    service.addCondition(transition, { parameterId: speed, operator: 'greater', value: 0.1 });
    expect(validateAnimationStateGraph(service.value, ['idle', 'run'])).toEqual([]);
    const evaluation = evaluateAnimationStateGraph(service.value, service.value.initialStateId, { [speed]: 0.75 });
    expect(evaluation.nextStateId).toBe(moving);
    expect(evaluation.blend.reduce((sum, sample) => sum + sample.weight, 0)).toBeCloseTo(1);
    const pcui = animationGraphToPcuiData(service.value);
    expect(pcui.nodes.__any__).toBeDefined();
    service.addTransition('*', moving);
    expect(Object.values(animationGraphToPcuiData(service.value).edges).some((edge) => edge.from === '__any__')).toBe(true);
  });

  it('enforces roles, computes diffs/merges and exposes Studio API, plugins and MCP', async () => {
    expect(roleCan('viewer', 'project:edit')).toBe(false);
    expect(roleCan('editor', 'version:create')).toBe(true);
    const base = createFixtureContract();
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.nodes[0].name = 'Ours';
    theirs.nodes[0].name = 'Theirs';
    theirs.nodes[0].visible = false;
    expect(diffValues(base, theirs).map((entry) => entry.path)).toEqual(expect.arrayContaining(['/nodes/0/name', '/nodes/0/visible']));
    const merge = threeWayMerge(base, ours, theirs);
    expect(merge.conflicts).toHaveLength(1);
    expect(merge.value.nodes[0].visible).toBe(false);

    let scene = base;
    let selection: string[] = [];
    const api = new StudioApi({
      getScene: () => scene,
      applyPatch: (_label, patch) => { scene = applyPatch(scene, patch); },
      getSelection: () => selection,
      setSelection: (ids) => { selection = ids; },
    });
    const console = new DiagnosticConsole();
    const registry = new StudioPluginRegistry(api, console);
    registry.register({
      manifest: { id: 'test.plugin', name: 'Test', version: '1', permissions: ['commands:register', 'scene:write'] },
      activate(context) { return context.api.registerCommand({ id: 'test.hide', label: 'Hide', run: () => context.api.applyPatch('Hide', [{ op: 'replace', path: '/nodes/0/visible', value: false }]) }); },
    });
    await registry.activate('test.plugin');
    await api.runCommand('test.hide');
    expect(scene.nodes[0].visible).toBe(false);
    registry.register({
      manifest: { id: 'test.readonly', name: 'Read only', version: '1', permissions: ['scene:read'] },
      activate(context) {
        expect(context.api.getScene().id).toBe(scene.id);
        expect(() => context.api.applyPatch('Forbidden', [])).toThrow(/scene:write/);
      },
    });
    await registry.activate('test.readonly');
    const mcp = new StudioMcpBridge(api, true);
    const tools = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((tools.result as any).tools.map((tool: any) => tool.name)).toContain('studio.apply_patch');
    const selectionResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'studio.get_selection', arguments: {} } });
    expect(selectionResult.error).toBeUndefined();
  });
});
