import { afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('project chat database and client contract', () => {
  it('defines private persisted messages, self-owned typing and realtime publication', async () => {
    const migration = await readFile('services/backend/migrations/0004_project_chat.sql', 'utf8');
    const client = await readFile('packages/api-client/src/chat.ts', 'utf8');
    const manifest = await readFile('packages/api-client/package.json', 'utf8');

    expect(migration).toContain('create table public.project_chat_messages');
    expect(migration).toContain('create table public.project_chat_typing');
    expect(migration).toContain('chat message identity and reply target are immutable');
    expect(migration).toContain('chat reply target must belong to the same project');
    expect(migration).toContain('chat_messages_member_read');
    expect(migration).toContain('chat_messages_member_insert');
    expect(migration).toContain('user_id = auth.uid()');
    expect(migration).toContain('chat_messages_author_or_owner_update');
    expect(migration).toContain('public.can_manage_project(project_id)');
    expect(migration).toContain('chat_typing_member_read');
    expect(migration).toContain('chat_typing_self_write');
    expect(migration).toContain("tablename = 'project_chat_messages'");
    expect(migration).toContain("tablename = 'project_chat_typing'");
    expect(migration).toContain('alter publication supabase_realtime add table public.project_chat_messages');
    expect(migration).toContain('alter publication supabase_realtime add table public.project_chat_typing');

    expect(client).toContain("this.client.channel(`project:${this.options.projectId}`");
    expect(client).toContain("table: 'project_chat_messages'");
    expect(client).toContain("table: 'project_chat_typing'");
    expect(client).toContain("private: true");
    expect(client).toContain('normalizeChatBody');
    expect(client).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(JSON.parse(manifest).exports['./chat']).toBe('./src/chat.ts');
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

describe.runIf(live)('live project chat RLS acceptance', () => {
  const url = process.env.KYXOS_SUPABASE_URL!;
  const anonKey = process.env.KYXOS_SUPABASE_ANON_KEY!;
  const projects: string[] = [];
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
    projects.push(projectId);
    const ownerMember = await rest(ownerToken, 'project_members', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, user_id: ownerUserId, role: 'owner' }),
    });
    expect(ownerMember.ok, await ownerMember.text()).toBe(true);
    return projectId;
  }

  afterAll(async () => {
    for (const projectId of projects.reverse()) {
      const response = await rest(
        ownerToken,
        `projects?id=eq.${projectId}`,
        { method: 'DELETE' },
        'return=minimal',
      );
      expect(response.ok, await response.text()).toBe(true);
    }
  });

  it('allows member conversation while preventing identity spoofing and cross-project replies', async () => {
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

    const projectId = await createProject(`Chat acceptance ${crypto.randomUUID()}`);
    const privateProjectId = await createProject(`Chat private ${crypto.randomUUID()}`);
    const editorMember = await rest(ownerToken, 'project_members', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, user_id: secondUserId, role: 'editor' }),
    });
    expect(editorMember.ok, await editorMember.text()).toBe(true);

    const ownerMessageResponse = await rest(ownerToken, 'project_chat_messages', {
      method: 'POST',
      body: JSON.stringify({
        project_id: privateProjectId,
        user_id: ownerUserId,
        display_name: 'Owner',
        body: 'Private message',
      }),
    });
    expect(ownerMessageResponse.ok, await ownerMessageResponse.text()).toBe(true);
    const privateMessageId = (await ownerMessageResponse.json())[0].id as string;

    const editorMessageResponse = await rest(secondToken, 'project_chat_messages', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: secondUserId,
        display_name: 'Editor',
        body: 'Editor message',
      }),
    });
    expect(editorMessageResponse.ok, await editorMessageResponse.text()).toBe(true);
    const editorMessageId = (await editorMessageResponse.json())[0].id as string;

    const ownerRead = await rest(
      ownerToken,
      `project_chat_messages?project_id=eq.${projectId}&select=id,user_id,body`,
      { method: 'GET' },
    );
    expect(ownerRead.ok, await ownerRead.text()).toBe(true);
    expect(await ownerRead.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: editorMessageId, user_id: secondUserId, body: 'Editor message' }),
    ]));

    const privateRead = await rest(
      secondToken,
      `project_chat_messages?project_id=eq.${privateProjectId}&select=id`,
      { method: 'GET' },
    );
    expect(privateRead.ok, await privateRead.text()).toBe(true);
    expect(await privateRead.json()).toEqual([]);

    const spoof = await rest(secondToken, 'project_chat_messages', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: ownerUserId,
        display_name: 'Spoofed Owner',
        body: 'Forbidden',
      }),
    });
    expect(spoof.ok).toBe(false);

    const crossProjectReply = await rest(secondToken, 'project_chat_messages', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: secondUserId,
        display_name: 'Editor',
        body: 'Forbidden reply',
        reply_to_id: privateMessageId,
      }),
    });
    expect(crossProjectReply.ok).toBe(false);

    const editorEdit = await rest(
      secondToken,
      `project_chat_messages?id=eq.${editorMessageId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ body: 'Editor edited', edited_at: new Date().toISOString() }),
      },
    );
    expect(editorEdit.ok, await editorEdit.text()).toBe(true);

    const ownerModeration = await rest(
      ownerToken,
      `project_chat_messages?id=eq.${editorMessageId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          body: '',
          edited_at: new Date().toISOString(),
          deleted_at: new Date().toISOString(),
        }),
      },
    );
    expect(ownerModeration.ok, await ownerModeration.text()).toBe(true);
    expect((await ownerModeration.json())[0].body).toBe('');

    const demote = await rest(
      ownerToken,
      `project_members?project_id=eq.${projectId}&user_id=eq.${secondUserId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role: 'viewer' }),
      },
    );
    expect(demote.ok, await demote.text()).toBe(true);

    const viewerMessage = await rest(secondToken, 'project_chat_messages', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: secondUserId,
        display_name: 'Viewer',
        body: 'Viewer can participate',
      }),
    });
    expect(viewerMessage.ok, await viewerMessage.text()).toBe(true);

    const typingClientId = crypto.randomUUID();
    const typing = await rest(secondToken, 'project_chat_typing', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: secondUserId,
        client_id: typingClientId,
        display_name: 'Viewer',
      }),
    }, 'resolution=merge-duplicates,return=representation');
    expect(typing.ok, await typing.text()).toBe(true);

    const typingSpoof = await rest(secondToken, 'project_chat_typing', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_id: ownerUserId,
        client_id: crypto.randomUUID(),
        display_name: 'Spoofed Owner',
      }),
    });
    expect(typingSpoof.ok).toBe(false);
  }, 45_000);
});
