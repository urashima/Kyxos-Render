import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production collaboration and RLS migration', () => {
  it('defines member-aware storage, realtime authorization and immutable checkpoint boundaries', async () => {
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
    expect(sql).toContain('create policy source_files_member_read');
    expect(sql).toContain('create policy source_files_editor_write');
    expect(sql).toContain('create policy presence_self_write');
    expect(sql).toContain('create policy operations_editor_insert');
    expect(sql).toContain("raise exception 'operation id collision'");
    expect(sql).toContain('jsonb_array_length(patch_json) <= 1000');
    expect(sql).toContain('octet_length(content) <= 2097152');
    expect(sql).toContain('create trigger scene_drafts_json_guard');
    expect(sql).toContain('create trigger project_workspaces_json_guard');
    expect(sql).toContain('create policy checkpoints_editor_insert');
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
  let projectId = '';
  let ownerToken = '';
  let secondToken = '';
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

  it('allows an editor to write, then enforces viewer read-only access for the same second user', async () => {
    const owner = await signIn(process.env.KYXOS_RLS_OWNER_EMAIL!, process.env.KYXOS_RLS_OWNER_PASSWORD!);
    const second = await signIn(process.env.KYXOS_RLS_SECOND_EMAIL!, process.env.KYXOS_RLS_SECOND_PASSWORD!);
    ownerToken = owner.access_token;
    secondToken = second.access_token;
    secondUserId = second.user.id;

    const projectResponse = await rest(ownerToken, 'projects', {
      method: 'POST',
      body: JSON.stringify({ owner_id: owner.user.id, name: `RLS acceptance ${crypto.randomUUID()}`, description: '' }),
    });
    expect(projectResponse.ok, await projectResponse.text()).toBe(true);
    projectId = (await projectResponse.json())[0].id;

    const ownerMember = await rest(ownerToken, 'project_members', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, user_id: owner.user.id, role: 'owner' }),
    });
    expect(ownerMember.ok, await ownerMember.text()).toBe(true);
    const editorMember = await rest(ownerToken, 'project_members', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, user_id: secondUserId, role: 'editor' }),
    });
    expect(editorMember.ok, await editorMember.text()).toBe(true);

    const editorRead = await rest(secondToken, `projects?id=eq.${projectId}&select=id,name`, { method: 'GET' });
    expect(editorRead.ok).toBe(true);
    expect((await editorRead.json())).toHaveLength(1);
    const ownershipEscalation = await rest(secondToken, `projects?id=eq.${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ owner_id: secondUserId }),
    });
    expect(ownershipEscalation.ok).toBe(false);
    const secondOwnerEscalation = await rest(ownerToken, `project_members?project_id=eq.${projectId}&user_id=eq.${secondUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(secondOwnerEscalation.ok).toBe(false);
    const editorSource = await rest(secondToken, 'project_source_files', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, path: 'scripts/rls.ts', language: 'typescript', content: 'export const role = "editor";', updated_by: secondUserId }),
    });
    expect(editorSource.ok, await editorSource.text()).toBe(true);

    const demote = await rest(ownerToken, `project_members?project_id=eq.${projectId}&user_id=eq.${secondUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(demote.ok, await demote.text()).toBe(true);
    const viewerRead = await rest(secondToken, `project_source_files?project_id=eq.${projectId}&select=path,content`, { method: 'GET' });
    expect(viewerRead.ok).toBe(true);
    expect((await viewerRead.json())[0].path).toBe('scripts/rls.ts');

    const viewerWrite = await rest(secondToken, `project_source_files?project_id=eq.${projectId}&path=eq.scripts%2Frls.ts`, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'forbidden', updated_by: secondUserId }),
    });
    expect(viewerWrite.ok).toBe(true);
    const ownerVerification = await rest(ownerToken, `project_source_files?project_id=eq.${projectId}&path=eq.scripts%2Frls.ts&select=content`, { method: 'GET' });
    expect((await ownerVerification.json())[0].content).toContain('editor');
  }, 45_000);

  it('cleans up the isolated acceptance project', async () => {
    if (!projectId) return;
    const response = await rest(ownerToken, `projects?id=eq.${projectId}`, { method: 'DELETE' }, 'return=minimal');
    expect(response.ok, await response.text()).toBe(true);
  });
});
