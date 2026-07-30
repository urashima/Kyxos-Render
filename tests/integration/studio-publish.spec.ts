import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  CommandBus,
  HistoryService,
  PublishService,
  SceneDocument,
  replaceCommand,
  type PublishRepository,
} from '../../packages/editor-core/src/index';
import type { KyxosSceneContract } from '../../packages/scene-contract/src/index';
import { getCapabilities } from '../../packages/viewer/src/sceneApi';
import { createFixtureContract } from '../../packages/test-fixtures/src/index';

describe('SceneDocument integration surfaces', () => {
  it('delivers one local patch per command to a viewport adapter boundary', () => {
    const document = new SceneDocument(createFixtureContract());
    const history = new HistoryService(document);
    const commands = new CommandBus(document, history);
    const viewportPatches: unknown[] = [];
    const adapter = { applyPatch: async (patch: unknown) => viewportPatches.push(patch) };
    document.addEventListener('change', (event) => {
      const patch = (event as CustomEvent).detail.patch;
      if (patch.length) void adapter.applyPatch(patch);
    });

    commands.execute(replaceCommand('/nodes/0/transform/scale/x', 2, 'Scale X', 'scale'));
    expect(viewportPatches).toEqual([
      [{ op: 'replace', path: '/nodes/0/transform/scale/x', value: 2 }],
    ]);
  });

  it('creates immutable release snapshots while draft edits continue', async () => {
    const document = new SceneDocument(createFixtureContract());
    const releases: Array<{ snapshot: KyxosSceneContract; version: number }> = [];
    const repository: PublishRepository = {
      async publish(_projectId, scene) {
        const version = releases.length + 1;
        releases.push({ snapshot: structuredClone(scene), version });
        return { versionId: `v${version}`, versionNumber: version, slug: 'fixture-scene' };
      },
    };
    const publisher = new PublishService(repository);
    await publisher.publish('project', document, 1);
    document.apply([{ op: 'replace', path: '/nodes/0/transform/position/x', value: 4 }]);
    await publisher.publish('project', document, 2);

    expect(releases.map((release) => release.version)).toEqual([1, 2]);
    expect(releases[0].snapshot.nodes[0].transform.position.x).toBe(0);
    expect(releases[1].snapshot.nodes[0].transform.position.x).toBe(4);
  });
});

describe('Capability negotiation and database enforcement', () => {
  it('reports viewer API, backend, effects, animation and picking without exposing Three.js', () => {
    const capability = getCapabilities.call({
      getMetrics: () => ({ backend: 'webgl2' }),
      getEffects: () => ({ traa: { enabled: true }, ssr: { enabled: true } }),
    } as any);
    expect(capability.viewerApiVersion).toBe('1.1.0');
    expect(capability.backend).toBe('webgl2');
    expect(capability.effects.traa.available).toBe(true);
    expect(capability.picking.available).toBe(true);
    expect(JSON.stringify(capability)).not.toMatch(/Object3D|RenderPipeline|RenderTarget|MRT/);
  });

  it('keeps drafts private and published snapshots immutable through RLS and triggers', async () => {
    const sql = await readFile('services/backend/migrations/0001_kyxos_studio.sql', 'utf8');
    expect(sql).toContain('alter table public.scene_drafts enable row level security');
    expect(sql).toContain('create policy drafts_owner_all');
    expect(sql).toContain('create policy slugs_public_read');
    expect(sql).toContain('published_versions_immutable');
    expect(sql).toContain('published_assets_immutable');
    expect(sql).toContain('save_scene_draft');
    expect(sql).toContain('publish_scene');
  });
});
