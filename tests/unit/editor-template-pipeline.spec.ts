import { describe, expect, it, vi } from 'vitest';
import {
  createEmptySceneContract,
  type KyxosSceneContract,
  type ScenePatch,
} from '../../packages/scene-contract/src/index';
import { applyPatch } from '../../packages/editor-core/src/index';
import {
  TemplatePipelineService,
  applyTemplateUpdate,
  captureTemplateDefinition,
  computeTemplateOverrides,
  findTemplateConflicts,
  instantiateTemplate,
  repairCorruptedTemplateInstances,
  revertTemplateOverrides,
  unlinkTemplateInstance,
  validateTemplateState,
} from '../../packages/editor-core/src/template-pipeline';

function fixture(): KyxosSceneContract {
  const scene = createEmptySceneContract('Templates');
  scene.nodes = [
    {
      id: 'root',
      name: 'Root',
      parentId: null,
      children: ['child'],
      visible: true,
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
    {
      id: 'child',
      name: 'Child',
      parentId: 'root',
      children: [],
      visible: true,
      transform: {
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  ];
  return scene;
}

function withTemplate(): KyxosSceneContract {
  const scene = fixture();
  const template = captureTemplateDefinition(scene, 'root', {
    id: 'template-1',
    name: 'Actor',
    createdAt: '2026-08-03T00:00:00.000Z',
  });
  scene.editorState = {
    ...(scene.editorState ?? {}),
    templates: [template],
    templateInstances: [],
  };
  return scene;
}

function instantiate(scene: KyxosSceneContract, instanceId = 'instance-1') {
  return instantiateTemplate(scene, 'template-1', {
    instanceId,
    nodeIdForSource: (sourceId) => `copy-${sourceId}`,
    now: '2026-08-03T00:01:00.000Z',
  });
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

describe('Template capture and instances', () => {
  it('captures a complete subtree and instantiates stable source bindings', () => {
    const scene = withTemplate();
    const template = scene.editorState!.templates![0];
    expect(template.rootSourceNodeId).toBe('root');
    expect(template.nodes.map((node) => node.sourceNodeId)).toEqual(['root', 'child']);
    expect(template.nodes[0].childSourceNodeIds).toEqual(['child']);

    const result = instantiate(scene);
    expect(result.rootNodeId).toBe('copy-root');
    expect(result.scene.nodes.slice(-2).map((node) => node.id)).toEqual(['copy-root', 'copy-child']);
    expect(result.scene.nodes.find((node) => node.id === 'copy-child')?.template).toMatchObject({
      templateId: 'template-1',
      instanceId: 'instance-1',
      sourceNodeId: 'child',
    });
    expect(validateTemplateState(result.scene)).toEqual([]);
  });

  it('computes local property and hierarchy overrides against the instance base', () => {
    const result = instantiate(withTemplate());
    const child = result.scene.nodes.find((node) => node.id === 'copy-child')!;
    child.name = 'Local Child';
    child.transform.position.x = 7;
    child.parentId = null;
    const overrides = computeTemplateOverrides(result.scene, 'instance-1');
    expect(overrides.map((entry) => `${entry.sourceNodeId}${entry.path}`)).toEqual(expect.arrayContaining([
      'child/name',
      'child/transform',
      'child/parentSourceNodeId',
    ]));
  });
});

describe('Template conflict manager', () => {
  it('detects three-way value conflicts and preserves the selected side', () => {
    const result = instantiate(withTemplate());
    const scene = result.scene;
    const instanceChild = scene.nodes.find((node) => node.id === 'copy-child')!;
    instanceChild.name = 'Local Child';

    const template = scene.editorState!.templates![0];
    template.version = 2;
    template.nodes.find((node) => node.sourceNodeId === 'child')!.properties.name = 'Template Child';
    template.nodes.find((node) => node.sourceNodeId === 'child')!.properties.visible = false;

    const conflicts = findTemplateConflicts(scene, 'instance-1');
    const nameConflict = conflicts.find((entry) => entry.path === '/name');
    expect(nameConflict).toMatchObject({
      kind: 'value-conflict',
      sourceNodeId: 'child',
      baseValue: 'Child',
      templateValue: 'Template Child',
      instanceValue: 'Local Child',
      blocking: true,
    });

    const applied = applyTemplateUpdate(scene, 'instance-1', {
      [nameConflict!.id]: 'instance',
    }, (sourceId) => `new-${sourceId}`);
    expect(applied.nodes.find((node) => node.id === 'copy-child')).toMatchObject({
      name: 'Local Child',
      visible: false,
    });
    expect(applied.editorState!.templateInstances![0]).toMatchObject({
      templateVersion: 2,
    });
    expect(applied.nodes.find((node) => node.id === 'copy-child')?.template?.overrides).toContain('/name');
  });

  it('requires an explicit decision for template deletions and safely unlinks preserved nodes', () => {
    const result = instantiate(withTemplate());
    const scene = result.scene;
    const template = scene.editorState!.templates![0];
    template.version = 2;
    template.nodes = template.nodes.filter((node) => node.sourceNodeId !== 'child');
    template.nodes[0].childSourceNodeIds = [];

    const conflict = findTemplateConflicts(scene, 'instance-1').find((entry) => entry.kind === 'template-node-deleted')!;
    expect(() => applyTemplateUpdate(scene, 'instance-1')).toThrow(/Resolve 1 template conflicts/);
    const preserved = applyTemplateUpdate(scene, 'instance-1', { [conflict.id]: 'unlink' });
    expect(preserved.nodes.find((node) => node.id === 'copy-child')?.template).toBeUndefined();
    expect(preserved.nodes.find((node) => node.id === 'copy-root')?.children).not.toContain('copy-child');
  });

  it('reverts instance overrides to current template values', () => {
    const result = instantiate(withTemplate());
    const scene = result.scene;
    scene.nodes.find((node) => node.id === 'copy-child')!.name = 'Local Child';
    const reverted = revertTemplateOverrides(scene, 'instance-1');
    expect(reverted.nodes.find((node) => node.id === 'copy-child')?.name).toBe('Child');
    expect(computeTemplateOverrides(reverted, 'instance-1')).toEqual([]);
  });

  it('unlinks an instance without deleting authored nodes', () => {
    const result = instantiate(withTemplate());
    const unlinked = unlinkTemplateInstance(result.scene, 'instance-1');
    expect(unlinked.nodes.some((node) => node.id === 'copy-root')).toBe(true);
    expect(unlinked.nodes.some((node) => node.template?.instanceId === 'instance-1')).toBe(false);
    expect(unlinked.editorState?.templateInstances).toEqual([]);
  });
});

describe('Template corruption repair', () => {
  it('rebuilds missing records and unlinks duplicate source bindings', () => {
    const result = instantiate(withTemplate());
    const scene = result.scene;
    scene.editorState!.templateInstances = [];
    scene.nodes.push({
      ...structuredClone(scene.nodes.find((node) => node.id === 'copy-child')!),
      id: 'duplicate-child',
      parentId: 'copy-root',
    });
    scene.nodes.find((node) => node.id === 'copy-root')!.children.push('duplicate-child');

    const repaired = repairCorruptedTemplateInstances(scene);
    expect(repaired.actions.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'create-missing-instance-record',
    ]));
    expect(repaired.scene.editorState?.templateInstances).toHaveLength(1);

    const repairedAgain = repairCorruptedTemplateInstances(repaired.scene);
    expect(repairedAgain.actions.map((entry) => entry.code)).toContain('unlink-duplicate-source');
    expect(repairedAgain.scene.nodes.find((node) => node.id === 'duplicate-child')?.template).toBeUndefined();
  });

  it('unlinks records whose source template no longer exists', () => {
    const result = instantiate(withTemplate());
    result.scene.editorState!.templates = [];
    const repaired = repairCorruptedTemplateInstances(result.scene);
    expect(repaired.actions.map((entry) => entry.code)).toContain('unlink-missing-template');
    expect(repaired.scene.nodes.some((node) => node.template?.instanceId === 'instance-1')).toBe(false);
    expect(repaired.scene.editorState?.templateInstances).toEqual([]);
  });
});

describe('Template command service', () => {
  it('routes create, instantiate, update, revert, unlink and repair through canonical patches', () => {
    const state = createHost(fixture());
    const ids = ['template-service', 'instance-service', 'service-root', 'service-child'];
    const service = new TemplatePipelineService(state.host, () => ids.shift()!);
    const changed = vi.fn();
    service.addEventListener('change', changed);

    const templateId = service.createTemplate('root', 'Service Template');
    expect(templateId).toBe('template-service');
    const instance = service.instantiate(templateId);
    expect(instance).toEqual({ instanceId: 'instance-service', rootNodeId: 'service-root' });
    expect(state.getScene().nodes.some((node) => node.id === 'service-child')).toBe(true);

    state.getScene();
    service.updateTemplateFromInstance(instance.instanceId);
    expect(state.getScene().editorState?.templates?.[0].version).toBe(2);
    service.revert(instance.instanceId);
    service.unlink(instance.instanceId);
    expect(state.getScene().editorState?.templateInstances).toEqual([]);
    expect(service.repair()).toEqual([]);
    expect(state.executed).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
  });
});
