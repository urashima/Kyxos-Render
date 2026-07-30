import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveController,
  HistoryService,
  CommandBus,
  SceneDocument,
  applyPatch,
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
  beforeEach(() => {
    vi.useFakeTimers();
    const browserWindow = Object.assign(new EventTarget(), {
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

  it('debounces saves, advances optimistic revisions and reports conflict', async () => {
    const document = new SceneDocument(createFixtureContract());
    let serverRevision = 0;
    const repository: DraftRepository = {
      async load() {
        return null;
      },
      async save(_projectId, _contract, expectedRevision) {
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

    document.apply([{ op: 'replace', path: '/nodes/0/visible', value: false }]);
    expect(autosave.state).toBe('Dirty');
    await vi.advanceTimersByTimeAsync(50);
    await autosave.flush();
    expect(autosave.revision).toBe(1);
    expect(autosave.state).toBe('Saved');
    expect(states).toEqual(expect.arrayContaining(['Dirty', 'Saving', 'Saved']));

    serverRevision = 3;
    document.apply([{ op: 'replace', path: '/nodes/0/visible', value: true }]);
    await autosave.flush();
    expect(autosave.state).toBe('Conflict');
    autosave.dispose();
  });
});
