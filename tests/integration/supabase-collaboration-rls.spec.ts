import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';

describe('production collaboration and RLS migration', () => {
  it('defines member-aware storage, realtime authorization and immutable version boundaries', async () => {
    const sql = await readFile('services/backend/migrations/0003_editor_collaboration.sql', 'utf8');
    const backend = await readFile('services/backend/functions/kyxos-api/index.ts', 'utf8');
    const browserClient = await readFile('packages/api-client/src/index.ts', 'utf8');

    expect(sql).toContain("check (role in ('owner', 'editor', 'viewer'))");
    expect(sql).toContain('create or replace function public.project_role');
    expect(sql).toContain("in ('owner', 'editor', 'viewer')");
    expect(sql).toContain("in ('owner', 'editor')");
    expect(sql).toContain('create policy projects_member_read');
    expect(sql).toContain('create trigger projects_owner_immutable');
    expect(sql).toContain("raise exception 'project ownership is immutable'");
    expect(sql).toContain("using (public.can_manage_project(project_id) and role <> 'owner')");
    expect(sql).toContain("with check (public.can_manage_project(project_id) and role in ('editor', 'viewer'))");
    expect(sql).toContain('create policy workspaces_member_read');
    expect(sql).toContain('create policy workspaces_editor_write');
    expect(sql).toContain('create policy scenes_member_read');
    expect(sql).toContain('create policy scenes_editor_write');
    expect(sql).toContain('create policy templates_member_read');
    expect(sql).toContain('create policy templates_editor_write');
    expect(sql).toContain('create policy source_files_member_read');
    expect(sql).toContain('create policy source_files_editor_write');
    expect(sql).toContain('create policy presence_member_read');
    expect(sql).toContain('create policy presence_self_write');
    expect(sql).toContain('create policy operations_member_read');
    expect(sql).toContain('create policy operations_editor_insert');
    expect(sql).toContain('create policy branches_member_read');
    expect(sql).toContain('create policy branches_editor_write');
    expect(sql).toContain('create policy checkpoints_member_read');
    expect(sql).toContain('create policy checkpoints_editor_insert');
    expect(sql).toContain('create policy conflicts_member_read');
    expect(sql).toContain('create policy conflicts_editor_write');
    expect(sql).toContain("raise exception 'operation id collision'");
    expect(sql).toContain('jsonb_array_length(patch_json) <= 1000');
    expect(sql).toContain('octet_length(content) <= 2097152');
    expect(sql).toContain('create trigger scene_drafts_json_guard');
    expect(sql).toContain('create trigger project_workspaces_json_guard');
    expect(sql).toContain('create trigger project_scenes_json_guard');
    expect(sql).toContain('create trigger project_templates_json_guard');
    expect(sql).toContain('create trigger scene_checkpoints_json_guard');
    expect(sql).toContain('create trigger scene_checkpoints_immutable');
    expect(sql).toContain("raise exception 'scene checkpoints are immutable'");
    expect(sql).toContain('before update on public.scene_checkpoints');
    expect(sql).not.toContain('before update or delete on public.scene_checkpoints');
    expect(sql).toContain('on realtime.messages for select to authenticated');
    expect(sql).toContain("extension = 'presence'");
    expect(sql).toContain("extension = 'broadcast'");
    expect(sql).toContain("realtime.topic()) ~ '^project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'");
    expect(sql).toContain('alter publication supabase_realtime add table public.realtime_operations');

    expect(backend).toContain("path.match(/^source-files\\/([0-9a-f-]+)$/i)");
    expect(backend).toContain("from('project_source_files')");
    expect(backend).toContain("from('project_presence').upsert");
    expect(backend).toContain("rpc('append_realtime_operation'");
    expect(backend).toContain("from('scene_checkpoints')");
    expect(browserClient).toContain('private: true');
    expect(browserClient).toContain("broadcast: { self: false, ack: true }");
    expect(browserClient).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

const live = Boolean(
  process.env.KYXOS_SUPABASE_URL &&
  process.env.KYXOS_SUPABASE_ANON_KEY &&
  process.env.KYXOS_RLS_OWNER_EMAIL &&
  process.env.KYXOS_RLS_OWNER_PASSWORD &&
  process.env.KYXOS_RLS_SECOND_EMAIL &&
  process.env.KYXOS_RLS_SECOND_PASSWORD,
);

describe.runIf(live)('live two-user Supabase RLS acceptance', () => {
  const url = process.env.KYXOS_SUPABASE_URL!;
  const anonKey = process.env.KYXOS_SUPABASE_ANON_KEY!;
  const createdProjectIds: string[] = [];
  let ownerToken = '';
  let secondToken = '';
  let ownerUserId = '';
  let secondUserId = '';

  async function signIn(email: string, password: string) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(response.ok, await response.text()).toBe(true);
    return response.json() as Promise<{ access_token: string; user: { id: string } }>;
  }

  async function rest(
    token: string,
    path: string,
    init: RequestInit = {},
    prefer = 'return=representation',
  ): Promise<Response> {
    return fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer,
        ...(init.headers ?? {}),
      },
    });
  }

  async function createProject(name: string): Promise<string> {
    const response = await rest(ownerToken, 'projects', {
      method: 'POST',
      body: JSON.stringify({ owner_id: ownerUserId, name, description: '' }),
    });
    expect(response.ok, await response.text()).toBe(true);
    const projectId = (await response.json())[0].id as string;
    createdProjectIds.push(projectId);
    const ownerMember = await rest(ownerToken, 'project_members', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, user_id: ownerUserId, role: 'owner' }),
    });
    expect(ownerMember.ok, await ownerMember.text()).toBe(true);
    return projectId;
  }

  afterAll(async () => {
    if (!ownerToken) return;
    for (const projectId of createdProjectIds.reverse()) {
      const response = await rest(
        ownerToken,
        `projects?id=eq.${projectId}`,
        { method: 'DELETE' },
        'return=minimal',
      );
      expect(response.ok, await response.text()).toBe(true);
    }
  });

  it('enforces owner, editor and viewer permissions across collaboration and version-control resources', async () => {
    const owner = await signIn(
      process.env.KYXOS_RLS_OWNER_EMAIL!,
      process.env.KYXOS_RLS_OWNER_PASSWORD!,
    );
    const second = await signIn(
      process.env.KYXOS_RLS_SECOND_EMAIL!,
      process.env.KYXOS_RLS_SECOND_PASSWORD!,
    );
    ownerToken = owner.access_token;
    secondToken = second.access_token;
    ownerUserId = owner.user.id;
    secondUserId = second.user.id;

    const projectId = await createProject(`RLS acceptance ${crypto.randomUUID()}`);
    const privateProjectId = await createProject(`RLS private ${crypto.randomUUID()}`);

    const editorMember = await rest(ownerToken, 'project_members', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, user_id: secondUserId, role: 'editor' }),
    });
    expect(editorMember.ok, await editorMember.text()).toBe(true);

    const editorRead = await rest(
      secondToken,
      `projects?id=eq.${projectId}&select=id,name`,
      { method: 'GET' },
    );
    expect(editorRead.ok).toBe(true);
    expect(await editorRead.json()).toHaveLength(1);

    const privateRead = await rest(
      secondToken,
      `projects?id=eq.${privateProjectId}&select=id`,
      { method: 'GET' },
    );
    expect(privateRead.ok).toBe(true);
    expect(await privateRead.json()).toHaveLength(0);

    const ownershipEscalation = await rest(secondToken, `projects?id=eq.${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ owner_id: secondUserId }),
    });
    expect(ownershipEscalation.ok).toBe(false);

    const secondOwnerEscalation = await rest(
      ownerToken,
      `project_members?project_id=eq.${projectId}&user_id=eq.${secondUserId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role: 'owner' }),
      },
    );
    expect(secondOwnerEscalation.ok).toBe(false);

    const sceneId = crypto.randomUUID();
    const editorScene = await rest(secondToken, 'project_scenes', {
      method: 'POST',
      body: JSON.stringify({
        id: sceneId,
        project_id: projectId,
        name: 'RLS Scene',
        contract_json: { version: '1', metadata: { acceptance: true } },
        sort_order: 0,
        created_by: secondUserId,
        updated_by: secondUserId,
      }),
    });
    expect(editorScene.ok, await editorScene.text()).toBe(true);

    const editorSource = await rest(secondToken, 'project_source_files', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        path: 'scripts/rls.ts',
        language: 'typescript',
        content: 'export const role = "editor";',
        updated_by: secondUserId,
      }),
    });
    expect(editorSource.ok, await editorSource.text()).toBe(true);

    const branchResponse = await rest(secondToken, 'version_branches', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        name: 'main',
        created_by: secondUserId,
      }),
    });
    expect(branchResponse.ok, await branchResponse.text()).toBe(true);
    const branchId = (await branchResponse.json())[0].id as string;

    const checkpointResponse = await rest(secondToken, 'scene_checkpoints', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        branch_id: branchId,
        label: 'Editor checkpoint',
        scene_snapshot: { version: '1', metadata: { checkpoint: true } },
        scene_digest: '0'.repeat(64),
        created_by: secondUserId,
      }),
    });
    expect(checkpointResponse.ok, await checkpointResponse.text()).toBe(true);
    const checkpointId = (await checkpointResponse.json())[0].id as string;

    const checkpointMutation = await rest(
      secondToken,
      `scene_checkpoints?id=eq.${checkpointId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ label: 'Mutated checkpoint' }),
      },
    );
    expect(checkpointMutation.ok).toBe(false);

    const operationId = crypto.randomUUID();
    const operationClientId = crypto.randomUUID();
    const appendOperation = await rest(secondToken, 'rpc/append_realtime_operation', {
      method: 'POST',
      body: JSON.stringify({
        target_project: projectId,
        target_scene: sceneId,
        operation_id: operationId,
        operation_client: operationClientId,
        operation_sequence: 1,
        operation_base_revision: 0,
        operation_patch: [{ op: 'replace', path: '/metadata/acceptance', value: 'editor' }],
      }),
    });
    expect(appendOperation.ok, await appendOperation.text()).toBe(true);

    const presenceClientId = crypto.randomUUID();
    const editorPresence = await rest(
      secondToken,
      'project_presence?on_conflict=project_id,user_id,client_id',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          user_id: secondUserId,
          client_id: presenceClientId,
          scene_id: sceneId,
          state_json: { selection: ['editor-node'] },
        }),
      },
      'resolution=merge-duplicates,return=representation',
    );
    expect(editorPresence.ok, await editorPresence.text()).toBe(true);

    const demote = await rest(
      ownerToken,
      `project_members?project_id=eq.${projectId}&user_id=eq.${secondUserId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role: 'viewer' }),
      },
    );
    expect(demote.ok, await demote.text()).toBe(true);

    for (const path of [
      `project_scenes?project_id=eq.${projectId}&select=id,name`,
      `version_branches?project_id=eq.${projectId}&select=id,name`,
      `scene_checkpoints?project_id=eq.${projectId}&select=id,label`,
      `realtime_operations?project_id=eq.${projectId}&select=id,sequence`,
      `project_presence?project_id=eq.${projectId}&select=user_id,state_json`,
      `project_source_files?project_id=eq.${projectId}&select=path,content`,
    ]) {
      const response = await rest(secondToken, path, { method: 'GET' });
      expect(response.ok, await response.text()).toBe(true);
      expect((await response.json()).length).toBeGreaterThan(0);
    }

    const viewerPresence = await rest(
      secondToken,
      `project_presence?project_id=eq.${projectId}&user_id=eq.${secondUserId}&client_id=eq.${presenceClientId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ state_json: { selection: ['viewer-node'] } }),
      },
    );
    expect(viewerPresence.ok, await viewerPresence.text()).toBe(true);

    const presenceSpoof = await rest(secondToken, 'project_presence', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: ownerUserId,
        client_id: crypto.randomUUID(),
        scene_id: sceneId,
        state_json: { spoofed: true },
      }),
    });
    expect(presenceSpoof.ok).toBe(false);

    const viewerSourceWrite = await rest(
      secondToken,
      `project_source_files?project_id=eq.${projectId}&path=eq.scripts%2Frls.ts`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'forbidden', updated_by: secondUserId }),
      },
    );
    expect(viewerSourceWrite.ok).toBe(true);

    const viewerBranchWrite = await rest(secondToken, 'version_branches', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        name: 'viewer-forbidden',
        created_by: secondUserId,
      }),
    });
    expect(viewerBranchWrite.ok).toBe(false);

    const viewerCheckpointWrite = await rest(secondToken, 'scene_checkpoints', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        branch_id: branchId,
        label: 'Viewer checkpoint',
        scene_snapshot: { version: '1' },
        scene_digest: '1'.repeat(64),
        created_by: secondUserId,
      }),
    });
    expect(viewerCheckpointWrite.ok).toBe(false);

    const viewerOperationWrite = await rest(secondToken, 'rpc/append_realtime_operation', {
      method: 'POST',
      body: JSON.stringify({
        target_project: projectId,
        target_scene: sceneId,
        operation_id: crypto.randomUUID(),
        operation_client: operationClientId,
        operation_sequence: 2,
        operation_base_revision: 1,
        operation_patch: [{ op: 'replace', path: '/metadata/acceptance', value: 'viewer' }],
      }),
    });
    expect(viewerOperationWrite.ok).toBe(false);

    const ownerVerification = await rest(
      ownerToken,
      `project_source_files?project_id=eq.${projectId}&path=eq.scripts%2Frls.ts&select=content`,
      { method: 'GET' },
    );
    expect((await ownerVerification.json())[0].content).toContain('editor');

    const checkpointVerification = await rest(
      ownerToken,
      `scene_checkpoints?id=eq.${checkpointId}&select=label`,
      { method: 'GET' },
    );
    expect((await checkpointVerification.json())[0].label).toBe('Editor checkpoint');
  }, 75_000);
});
