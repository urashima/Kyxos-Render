import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveController,
  HistoryService,
  CommandBus,
  SceneDocument,
  applyPatch,
  addCommand,
  replaceCommand,
  type DraftRepository,
  type OfflineDraftStore,
} from '../../packages/editor-core/src/index';
import { createFixtureContract } from '../../packages/test-fixtures/src/index';

describe('Editor Core command and history flow', () => {
  it('routes edits through Command → Document → Patch and supports undo/redo', () => {
    const document = new SceneDocument(createFixtureContract());
    const history = new HistoryService(document);
    const commands = new CommandBus(document, history);
    const patches: unknown[] = [];
    document.addEventListener('change', (event) =>
      patches.push((event as CustomEvent).detail.patch),
    );

    commands.execute(
      replaceCommand('/nodes/0/transform/position/x', 1.5, 'Move X', 'node:x'),
    );
    expect(document.value.nodes[0].transform.position.x).toBe(1.5);
    expect(history.canUndo).toBe(true);
    expect(patches).toHaveLength(1);

    expect(history.undo()).toBe(true);
    expect(document.value.nodes[0].transform.position.x).toBe(0);
    expect(history.redo()).toBe(true);
    expect(document.value.nodes[0].transform.position.x).toBe(1.5);
  });

  it('undoes and redoes array append commands at the appended index', () => {
    const document = new SceneDocument(createFixtureContract());
    const history = new HistoryService(document);
    const commands = new CommandBus(document, history);
    const originalId = document.value.nodes[0].id;
    const appended = {
      ...structuredClone(document.value.nodes[0]),
      id: 'appended-node',
      name: 'Appended Node',
      parentId: null,
      children: [],
    };

    commands.execute(addCommand('/nodes/-', appended, 'Append node'));
    expect(document.value.nodes.map((node) => node.id)).toEqual([originalId, 'appended-node']);

    expect(history.undo()).toBe(true);
    expect(document.value.nodes.map((node) => node.id)).toEqual([originalId]);

    expect(history.redo()).toBe(true);
    expect(document.value.nodes.map((node) => node.id)).toEqual([originalId, 'appended-node']);
  });

  it('applies local JSON patches without rebuilding unrelated data', () => {
    const fixture = createFixtureContract();
    const next = applyPatch(fixture, [
      { op: 'replace', path: '/nodes/0/visible', value: false },
      { op: 'replace', path: '/materials/fixture-material/roughness', value: 0.9 },
    ]);
    expect(next.nodes[0].visible).toBe(false);
    expect(next.materials['fixture-material'].roughness).toBe(0.9);
    expect(fixture.nodes[0].visible).toBe(true);
  });
});

describe('Autosave revision control', () => {
  let browserWindow: EventTarget & {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces saves, avoids clean revision churn and reports conflict', async () => {
    const document = new SceneDocument(createFixtureContract());
    let serverRevision = 0;
    let saveCalls = 0;
    const repository: DraftRepository = {
      async load() {
        return null;
      },
      async save(_projectId, _contract, expectedRevision) {
        saveCalls += 1;
        if (expectedRevision !== serverRevision) throw new Error('409 revision conflict');
        serverRevision += 1;
        return { revision: serverRevision };
      },
    };
    const pending = new Map<string, unknown>();
    const offline: OfflineDraftStore = {
      async put(id, value) {
        pending.set(id, structuredClone(value));
      },
      async get(id) {
        return (pending.get(id) as Awaited<ReturnType<OfflineDraftStore['get']>>) ?? null;
      },
      async delete(id) {
        pending.delete(id);
      },
    };
    const autosave = new AutosaveController(
      'project',
      document,
      repository,
      offline,
      0,
      50,
    );
    const states: string[] = [];
    autosave.addEventListener('state', (event) =>
      states.push((event as CustomEvent).detail.state),
    );

    await autosave.flush();
    expect(saveCalls).toBe(0);
    expect(autosave.revision).toBe(0);

    document.apply([{ op: 'replace', path: '/nodes/0/visible', value: false }]);
    expect(autosave.state).toBe('Dirty');
    await vi.advanceTimersByTimeAsync(50);
    await autosave.flush();
    expect(saveCalls).toBe(1);
    expect(autosave.revision).toBe(1);
    expect(autosave.state).toBe('Saved');
    expect(states).toEqual(expect.arrayContaining(['Dirty', 'Saving', 'Saved']));

    await autosave.flush();
    expect(saveCalls).toBe(1);
    expect(autosave.revision).toBe(1);

    serverRevision = 3;
    document.apply([{ op: 'replace', path: '/nodes/0/visible', value: true }]);
    await autosave.flush();
    expect(autosave.state).toBe('Conflict');

    autosave.dispose();
    browserWindow.dispatchEvent(new Event('offline'));
    expect(autosave.state).toBe('Conflict');
  });
});
