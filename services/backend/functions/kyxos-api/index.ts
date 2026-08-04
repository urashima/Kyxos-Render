// Supabase Edge Function: authenticated Kyxos Studio API.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_UPLOAD_BYTES = Number(
  Deno.env.get('KYXOS_MAX_UPLOAD_BYTES') ?? 536870912,
);
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('KYXOS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const ASSET_BUCKET = 'kyxos-assets';

const mimeByExtension: Record<string, string[]> = {
  glb: ['model/gltf-binary', 'application/octet-stream'],
  hdr: ['image/vnd.radiance', 'application/octet-stream'],
  exr: ['image/x-exr', 'application/octet-stream'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  ktx2: ['image/ktx2', 'application/octet-stream'],
};

function requestOrigin(request: Request): string {
  return request.headers.get('origin') ?? '';
}

function originAllowed(request: Request): boolean {
  const origin = requestOrigin(request);
  return !origin || ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has(origin);
}

function cors(request: Request): HeadersInit {
  const origin = requestOrigin(request);
  return {
    'access-control-allow-origin': originAllowed(request) ? origin || '*' : 'null',
    'access-control-allow-headers': 'authorization, apikey, content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(
  request: Request,
  data: unknown,
  status = 200,
  cacheControl = 'no-store',
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors(request),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  });
}

function safeName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[^\w. -]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^\.+/, '')
    .slice(0, 180) || 'asset';
}

function safeSourcePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Source path must be project-relative.');
  }
  return normalized.slice(0, 320);
}

function validHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function prefixMatches(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function validateHeader(ext: string, bytes: Uint8Array): boolean {
  if (ext === 'glb') return prefixMatches(bytes, [0x67, 0x6c, 0x54, 0x46]);
  if (ext === 'png') return prefixMatches(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') {
    return prefixMatches(bytes, [0xff, 0xd8, 0xff]);
  }
  if (ext === 'webp') {
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
    );
  }
  if (ext === 'ktx2') {
    return prefixMatches(bytes, [
      0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb,
      0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  }
  if (ext === 'exr') return prefixMatches(bytes, [0x76, 0x2f, 0x31, 0x01]);
  if (ext === 'hdr') {
    return new TextDecoder().decode(bytes.slice(0, 10)).startsWith('#?RADIANCE');
  }
  return false;
}

function sceneAssetHashes(scene: any): string[] {
  return [...new Set(
    Object.values(scene?.assets ?? {}).map((asset: any) => String(asset.contentHash)),
  )];
}

function assertSafeContract(scene: any): void {
  const text = JSON.stringify(scene);
  if (/<script|javascript:|onerror\s*=|onload\s*=/i.test(text)) {
    throw new Error('Executable content is forbidden.');
  }
  if (/service[_-]?role|jwt[_-]?secret|access[_-]?token/i.test(text)) {
    throw new Error('Secrets are forbidden.');
  }
  for (const [id, asset] of Object.entries(scene?.assets ?? {}) as [string, any][]) {
    const hash = String(asset.contentHash ?? '');
    if (
      !validHash(hash) ||
      String(asset.id) !== id ||
      String(asset.uri) !== `asset://${hash}`
    ) {
      throw new Error('Scene assets must use stable IDs and asset:// SHA-256 references.');
    }
  }
}

function normalizeProject(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRelease(row: any, slug: string, currentVersionId?: string) {
  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    sceneSnapshot: row.scene_snapshot,
    sceneDigest: row.scene_digest,
    slug,
    createdAt: row.created_at,
    isCurrent: currentVersionId ? currentVersionId === row.id : true,
  };
}

function normalizeMember(row: any, email?: string) {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    email,
    role: row.role,
    createdAt: row.created_at,
  };
}

function normalizeBranch(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    headCheckpointId: row.head_checkpoint_id,
    baseCheckpointId: row.base_checkpoint_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function normalizeCheckpoint(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    branchId: row.branch_id,
    parentId: row.parent_id,
    label: row.label,
    snapshot: row.scene_snapshot,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function normalizeSourceFile(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    language: row.language,
    content: row.content,
    revision: row.revision,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

async function digestJson(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('');
}

async function signedUpload(
  admin: ReturnType<typeof createClient>,
  storageKey: string,
): Promise<{ uploadUrl: string; uploadToken?: string }> {
  const { data, error } = await admin.storage
    .from(ASSET_BUCKET)
    .createSignedUploadUrl(storageKey);
  if (error || !data?.signedUrl) throw error ?? new Error('Signed upload creation failed.');
  return {
    uploadUrl: data.signedUrl,
    uploadToken: (data as { token?: string }).token,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return originAllowed(request)
      ? new Response(null, { status: 204, headers: cors(request) })
      : json(request, { error: 'origin not allowed' }, 403);
  }
  if (!originAllowed(request)) return json(request, { error: 'origin not allowed' }, 403);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^.*\/kyxos-api\/?/, '');
  const authHeader = request.headers.get('authorization') ?? '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
  global: {
    headers: { Authorization: `Bearer ${accessToken}` },
    fetch: (input, init = {}) => {
      const headers = new Headers(
        input instanceof Request ? input.headers : undefined,
      );
      new Headers(init.headers).forEach((value, name) => {
        headers.set(name, value);
      });
      headers.set('Authorization', `Bearer ${accessToken}`);
      headers.set('apikey', ANON_KEY);
      return fetch(input, { ...init, headers });
    },
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(accessToken);

  try {
    // Compatibility public reads. Production Public Viewer uses public-scene,
    // which additionally returns a version-pinned signed asset manifest.
    if (path.startsWith('public/')) {
      const [kind, value] = path.slice(7).split('/');
      let version: any;
      let slugRow: any;
      if (kind === 'version') {
        const { data, error } = await admin
          .from('published_versions')
          .select('*')
          .eq('id', value)
          .single();
        if (error) throw error;
        version = data;
        const slugResult = await admin
          .from('public_slugs')
          .select('slug,current_version_id,is_enabled')
          .eq('project_id', data.project_id)
          .eq('is_enabled', true)
          .single();
        if (slugResult.error) throw slugResult.error;
        slugRow = slugResult.data;
      } else if (kind === 'slug') {
        const slugResult = await admin
          .from('public_slugs')
          .select('slug,current_version_id,is_enabled')
          .eq('slug', value)
          .eq('is_enabled', true)
          .single();
        if (slugResult.error) throw slugResult.error;
        slugRow = slugResult.data;
        const versionResult = await admin
          .from('published_versions')
          .select('*')
          .eq('id', slugRow.current_version_id)
          .single();
        if (versionResult.error) throw versionResult.error;
        version = versionResult.data;
      } else {
        return json(request, { error: 'not found' }, 404);
      }
      return json(
        request,
        normalizeRelease(version, slugRow.slug, slugRow.current_version_id),
        200,
        'public, max-age=60, stale-while-revalidate=300',
      );
    }

    if (authError || !user) return json(request, { error: 'authentication required' }, 401);

    if (path === 'projects' && request.method === 'GET') {
  const ownedResult = await admin
    .from('projects')
    .select('*')
    .eq('owner_id', user.id)
    .eq('status', 'active');
  if (ownedResult.error) throw ownedResult.error;

  const membershipResult = await admin
    .from('project_members')
    .select('project_id')
    .eq('user_id', user.id);
  if (membershipResult.error) throw membershipResult.error;

  const memberIds = [...new Set(
    (membershipResult.data ?? []).map((row) => row.project_id),
  )];
  let sharedRows = [];
  if (memberIds.length) {
    const sharedResult = await admin
      .from('projects')
      .select('*')
      .in('id', memberIds)
      .eq('status', 'active');
    if (sharedResult.error) throw sharedResult.error;
    sharedRows = sharedResult.data ?? [];
  }

  const projects = [...new Map(
    [...(ownedResult.data ?? []), ...sharedRows]
      .map((row) => [row.id, row]),
  ).values()].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
  return json(request, projects.map(normalizeProject));
}

    if (path === 'projects' && request.method === 'POST') {
  const body = await request.json();
  const { data, error } = await admin.rpc('create_project_for_user', {
    target_user: user.id,
    project_name: safeName(String(body.name ?? 'Untitled Project')),
  });
  if (error) throw error;
  return json(request, normalizeProject(data), 201);
}

    const projectMatch = path.match(/^projects\/([0-9a-f-]+)(?:\/(duplicate))?$/i);
    if (projectMatch) {
      const id = projectMatch[1];
      if (projectMatch[2] && request.method === 'POST') {
        const sourceResult = await userClient
          .from('projects')
          .select('*')
          .eq('id', id)
          .single();
        if (sourceResult.error) throw sourceResult.error;
        const copyResult = await userClient
          .from('projects')
          .insert({
            owner_id: user.id,
            name: `${sourceResult.data.name} Copy`,
            description: sourceResult.data.description,
          })
          .select()
          .single();
        if (copyResult.error) throw copyResult.error;
        const memberResult = await userClient.from('project_members').insert({
          project_id: copyResult.data.id,
          user_id: user.id,
          role: 'owner',
        });
        if (memberResult.error) throw memberResult.error;
        const { data: draft, error: draftError } = await userClient
          .from('scene_drafts')
          .select('*')
          .eq('project_id', id)
          .maybeSingle();
        if (draftError) throw draftError;
        if (draft) {
          const saveResult = await userClient.rpc('save_scene_draft', {
            target_project: copyResult.data.id,
            expected_revision: 0,
            contract: draft.contract_json,
            contract_version_value: draft.contract_version,
          });
          if (saveResult.error) throw saveResult.error;
        }
        return json(request, normalizeProject(copyResult.data), 201);
      }
      if (request.method === 'GET') {
        const { data, error } = await userClient
          .from('projects')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        return json(request, normalizeProject(data));
      }
      if (request.method === 'PATCH') {
        const body = await request.json();
        const patch: Record<string, unknown> = {};
        if (body.name != null) patch.name = safeName(String(body.name));
        if (body.status === 'archived') patch.status = 'archived';
        if (!Object.keys(patch).length) return json(request, { ok: true });
        const { error } = await userClient.from('projects').update(patch).eq('id', id);
        if (error) throw error;
        return json(request, { ok: true });
      }
      if (request.method === 'DELETE') {
        const { count, error: countError } = await userClient
          .from('published_versions')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', id);
        if (countError) throw countError;
        if (count) return json(request, { error: 'published projects cannot be deleted' }, 409);
        const { error } = await userClient.from('projects').delete().eq('id', id);
        if (error) throw error;
        return json(request, { ok: true });
      }
    }

    const memberMatch = path.match(/^projects\/([0-9a-f-]+)\/members(?:\/([0-9a-f-]+))?$/i);
    if (memberMatch) {
      const projectId = memberMatch[1];
      const memberId = memberMatch[2];
      if (!memberId && request.method === 'GET') {
        const { data, error } = await userClient
          .from('project_members')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at');
        if (error) throw error;
        const members = await Promise.all((data ?? []).map(async (row) => {
          const account = await admin.auth.admin.getUserById(row.user_id);
          return normalizeMember(row, account.data.user?.email);
        }));
        return json(request, members);
      }
      if (!memberId && request.method === 'POST') {
        const body = await request.json();
        const email = String(body.email ?? '').trim().toLowerCase();
        if (!email.includes('@') || !['editor', 'viewer'].includes(body.role)) {
          return json(request, { error: 'invalid member invitation' }, 400);
        }
        const { data, error } = await userClient.rpc('add_project_member_by_email', {
          target_project: projectId,
          member_email: email,
          member_role: body.role,
        });
        if (error) throw error;
        return json(request, normalizeMember(data, email), 201);
      }
      if (memberId && request.method === 'PATCH') {
        const body = await request.json();
        if (!['editor', 'viewer'].includes(body.role)) {
          return json(request, { error: 'invalid member role' }, 400);
        }
        const { data, error } = await userClient.rpc('set_project_member_role', {
          target_project: projectId,
          target_user: memberId,
          member_role: body.role,
        });
        if (error) throw error;
        const account = await admin.auth.admin.getUserById(data.user_id);
        return json(request, normalizeMember(data, account.data.user?.email));
      }
      if (memberId && request.method === 'DELETE') {
        const { error } = await userClient
          .from('project_members')
          .delete()
          .eq('project_id', projectId)
          .eq('user_id', memberId)
          .neq('role', 'owner');
        if (error) throw error;
        return json(request, { ok: true });
      }
    }

    const workspaceMatch = path.match(/^workspaces\/([0-9a-f-]+)$/i);
    if (workspaceMatch) {
      const projectId = workspaceMatch[1];
      if (request.method === 'GET') {
        const { data, error } = await userClient
          .from('project_workspaces')
          .select('*')
          .eq('project_id', projectId)
          .maybeSingle();
        if (error) throw error;
        return json(request, data ? {
          projectId,
          workspace: data.workspace_json,
          revision: data.revision,
          updatedAt: data.updated_at,
        } : null);
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        if (body.workspace?.version !== 1) return json(request, { error: 'unsupported workspace version' }, 400);
        const { data, error } = await userClient.rpc('save_project_workspace', {
          target_project: projectId,
          expected_revision: body.expectedRevision,
          workspace: body.workspace,
        });
        if (error) throw error;
        return json(request, { revision: data });
      }
    }

    const sourceFilesMatch = path.match(/^source-files\/([0-9a-f-]+)$/i);
    if (sourceFilesMatch) {
      const projectId = sourceFilesMatch[1];
      if (request.method === 'GET') {
        const { data, error } = await userClient
          .from('project_source_files')
          .select('*')
          .eq('project_id', projectId)
          .order('path');
        if (error) throw error;
        return json(request, (data ?? []).map(normalizeSourceFile));
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        const sourcePath = safeSourcePath(String(body.path ?? ''));
        const language = String(body.language ?? 'plaintext').slice(0, 40);
        const content = String(body.content ?? '');
        if (new TextEncoder().encode(content).byteLength > 2 * 1024 * 1024) {
          return json(request, { error: 'source file exceeds 2 MB' }, 413);
        }
        const expectedRevision = Number(body.expectedRevision ?? 0);
        const currentResult = await userClient
          .from('project_source_files')
          .select('*')
          .eq('project_id', projectId)
          .eq('path', sourcePath)
          .maybeSingle();
        if (currentResult.error) throw currentResult.error;
        const current = currentResult.data;
        if ((current?.revision ?? 0) !== expectedRevision) {
          return json(request, { error: 'source file revision conflict', current: current ? normalizeSourceFile(current) : null }, 409);
        }
        if (current) {
          const { data, error } = await userClient
            .from('project_source_files')
            .update({
              language,
              content,
              revision: current.revision + 1,
              updated_by: user.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', current.id)
            .eq('revision', expectedRevision)
            .select()
            .single();
          if (error) throw error;
          return json(request, normalizeSourceFile(data));
        }
        const { data, error } = await userClient
          .from('project_source_files')
          .insert({
            project_id: projectId,
            path: sourcePath,
            language,
            content,
            revision: 1,
            updated_by: user.id,
          })
          .select()
          .single();
        if (error) throw error;
        return json(request, normalizeSourceFile(data), 201);
      }
      if (request.method === 'DELETE') {
        const sourcePath = safeSourcePath(url.searchParams.get('path') ?? '');
        const { error } = await userClient
          .from('project_source_files')
          .delete()
          .eq('project_id', projectId)
          .eq('path', sourcePath);
        if (error) throw error;
        return json(request, { ok: true });
      }
    }

    const collaborationMatch = path.match(/^collaboration\/([0-9a-f-]+)(?:\/(operations|presence))?$/i);
    if (collaborationMatch) {
      const projectId = collaborationMatch[1];
      const action = collaborationMatch[2];
      if (!action && request.method === 'GET') {
        const sceneId = url.searchParams.get('sceneId');
        const cursor = url.searchParams.get('cursor');
        if (!sceneId) return json(request, { error: 'sceneId is required' }, 400);
        let operationQuery = userClient
          .from('realtime_operations')
          .select('*')
          .eq('project_id', projectId)
          .eq('scene_id', sceneId)
          .order('created_at')
          .limit(500);
        if (cursor) operationQuery = operationQuery.gt('created_at', cursor);
        const operationResult = await operationQuery;
        if (operationResult.error) throw operationResult.error;
        const presenceResult = await userClient
          .from('project_presence')
          .select('*')
          .eq('project_id', projectId)
          .gte('updated_at', new Date(Date.now() - 45_000).toISOString());
        if (presenceResult.error) throw presenceResult.error;
        const operations = (operationResult.data ?? []).map((row) => ({
          id: row.id,
          projectId: row.project_id,
          sceneId: row.scene_id,
          clientId: row.client_id,
          userId: row.user_id,
          sequence: row.sequence,
          baseRevision: row.base_revision,
          patch: row.patch_json,
          createdAt: row.created_at,
        }));
        const nextCursor = operations.at(-1)?.createdAt ?? cursor ?? new Date().toISOString();
        return json(request, {
          operations,
          presence: (presenceResult.data ?? []).map((row) => ({
            ...row.state_json,
            projectId: row.project_id,
            userId: row.user_id,
            clientId: row.client_id,
            sceneId: row.scene_id,
            updatedAt: new Date(row.updated_at).getTime(),
          })),
          cursor: nextCursor,
        });
      }
      if (action === 'operations' && request.method === 'POST') {
        const body = await request.json();
        const { data, error } = await userClient.rpc('append_realtime_operation', {
          target_project: projectId,
          target_scene: body.sceneId,
          operation_id: body.id,
          operation_client: body.clientId,
          operation_sequence: body.sequence,
          operation_base_revision: body.baseRevision,
          operation_patch: body.patch,
        });
        if (error) throw error;
        return json(request, { id: data.id }, 201);
      }
      if (action === 'presence' && request.method === 'POST') {
        const body = await request.json();
        const state = {
          displayName: String(body.displayName ?? '').slice(0, 80),
          color: String(body.color ?? '#ffffff').slice(0, 20),
          selection: Array.isArray(body.selection) ? body.selection.slice(0, 100) : [],
          camera: body.camera && typeof body.camera === 'object' ? body.camera : undefined,
        };
        const { error } = await userClient.from('project_presence').upsert({
          project_id: projectId,
          user_id: user.id,
          client_id: body.clientId,
          scene_id: body.sceneId,
          state_json: state,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return json(request, { ok: true });
      }
    }

    const versionMatch = path.match(/^versions\/([0-9a-f-]+)\/(branches|checkpoints)$/i);
    if (versionMatch) {
      const projectId = versionMatch[1];
      const kind = versionMatch[2];
      if (kind === 'branches' && request.method === 'GET') {
        const { data, error } = await userClient
          .from('version_branches')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at');
        if (error) throw error;
        return json(request, (data ?? []).map(normalizeBranch));
      }
      if (kind === 'branches' && request.method === 'POST') {
        const body = await request.json();
        const { data, error } = await userClient
          .from('version_branches')
          .insert({
            project_id: projectId,
            name: safeName(String(body.name ?? 'Branch')).slice(0, 80),
            head_checkpoint_id: body.baseCheckpointId ?? null,
            base_checkpoint_id: body.baseCheckpointId ?? null,
            created_by: user.id,
          })
          .select()
          .single();
        if (error) throw error;
        return json(request, normalizeBranch(data), 201);
      }
      if (kind === 'checkpoints' && request.method === 'GET') {
        let query = userClient
          .from('scene_checkpoints')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false });
        const branchId = url.searchParams.get('branchId');
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query;
        if (error) throw error;
        return json(request, (data ?? []).map(normalizeCheckpoint));
      }
      if (kind === 'checkpoints' && request.method === 'POST') {
        const body = await request.json();
        assertSafeContract(body.snapshot);
        const branchResult = await userClient
          .from('version_branches')
          .select('*')
          .eq('project_id', projectId)
          .eq('id', body.branchId)
          .single();
        if (branchResult.error) throw branchResult.error;
        const insertResult = await userClient
          .from('scene_checkpoints')
          .insert({
            project_id: projectId,
            branch_id: body.branchId,
            parent_id: branchResult.data.head_checkpoint_id,
            label: safeName(String(body.label ?? 'Checkpoint')).slice(0, 160),
            scene_snapshot: body.snapshot,
            scene_digest: await digestJson(body.snapshot),
            created_by: user.id,
          })
          .select()
          .single();
        if (insertResult.error) throw insertResult.error;
        const updateResult = await userClient
          .from('version_branches')
          .update({ head_checkpoint_id: insertResult.data.id })
          .eq('id', body.branchId);
        if (updateResult.error) throw updateResult.error;
        return json(request, normalizeCheckpoint(insertResult.data), 201);
      }
    }

    const draftMatch = path.match(/^drafts\/([0-9a-f-]+)(?:\/(revision))?$/i);
    if (draftMatch) {
      const projectId = draftMatch[1];
      if (draftMatch[2] && request.method === 'GET') {
        const { data, error } = await userClient
          .from('scene_drafts')
          .select('revision')
          .eq('project_id', projectId)
          .maybeSingle();
        if (error) throw error;
        return json(request, { revision: data?.revision ?? 0 });
      }
      if (request.method === 'GET') {
        const { data, error } = await userClient
          .from('scene_drafts')
          .select('*')
          .eq('project_id', projectId)
          .maybeSingle();
        if (error) throw error;
        return json(
          request,
          data
            ? {
                projectId,
                contract: data.contract_json,
                revision: data.revision,
                updatedAt: data.updated_at,
              }
            : null,
        );
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        assertSafeContract(body.contract);
        const { data, error } = await userClient.rpc('save_scene_draft', {
          target_project: projectId,
          expected_revision: body.expectedRevision,
          contract: body.contract,
          contract_version_value: body.contract.contractVersion,
        });
        if (error) throw error;
        return json(request, { revision: data });
      }
    }

    if (path === 'assets/upload' && request.method === 'POST') {
      const body = await request.json();
      const name = safeName(String(body.name ?? 'asset'));
      const ext = extension(name);
      const mime = String(body.mimeType ?? 'application/octet-stream');
      const size = Number(body.byteSize);
      const hash = String(body.hash ?? '');
      if (
        !validHash(hash) ||
        !mimeByExtension[ext]?.includes(mime) ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_UPLOAD_BYTES
      ) {
        return json(request, { error: 'invalid upload metadata' }, 400);
      }

      const existingResult = await userClient
        .from('assets')
        .select('*')
        .eq('content_hash', hash)
        .maybeSingle();
      if (existingResult.error) throw existingResult.error;
      if (existingResult.data) {
        const completed = existingResult.data.metadata_json?.completed === true;
        if (completed) {
          return json(request, {
            assetId: existingResult.data.id,
            storageKey: existingResult.data.storage_key,
            alreadyExists: true,
          });
        }
        await admin.storage.from(ASSET_BUCKET).remove([existingResult.data.storage_key]);
        const signed = await signedUpload(admin, existingResult.data.storage_key);
        return json(request, {
          assetId: existingResult.data.id,
          storageKey: existingResult.data.storage_key,
          ...signed,
          headers: { 'x-upsert': 'false' },
          alreadyExists: false,
        });
      }

      const storageKey = `${user.id}/${hash}/${name}`;
      const { data: asset, error } = await userClient
        .from('assets')
        .insert({
          owner_id: user.id,
          content_hash: hash,
          storage_key: storageKey,
          mime_type: mime,
          byte_size: size,
          metadata_json: { completed: false },
        })
        .select()
        .single();
      if (error) throw error;
      try {
        const signed = await signedUpload(admin, storageKey);
        return json(
          request,
          {
            assetId: asset.id,
            storageKey,
            ...signed,
            headers: { 'x-upsert': 'false' },
          },
          201,
        );
      } catch (error) {
        await admin.from('assets').delete().eq('id', asset.id);
        throw error;
      }
    }

    if (path === 'assets/complete' && request.method === 'POST') {
      const body = await request.json();
      const { data: asset, error } = await userClient
        .from('assets')
        .select('*')
        .eq('id', body.assetId)
        .single();
      if (error) throw error;
      try {
        const downloadResult = await admin.storage
          .from(ASSET_BUCKET)
          .download(asset.storage_key);
        if (downloadResult.error || !downloadResult.data) {
          throw downloadResult.error ?? new Error('Uploaded object is missing.');
        }
        const blob = downloadResult.data;
        if (blob.size !== asset.byte_size) {
          throw new Error('Uploaded byte size does not match.');
        }
        const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        if (!validateHeader(extension(asset.storage_key), header)) {
          throw new Error('File header does not match its extension.');
        }
        const computed = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const computedHash = [...new Uint8Array(computed)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        if (computedHash !== asset.content_hash) throw new Error('Content hash mismatch.');
        const metadata = {
          ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
          completed: true,
          verifiedAt: new Date().toISOString(),
        };
        const updateResult = await userClient
          .from('assets')
          .update({ metadata_json: metadata })
          .eq('id', asset.id);
        if (updateResult.error) throw updateResult.error;
        return json(request, { ok: true });
      } catch (validationError) {
        await admin.storage.from(ASSET_BUCKET).remove([asset.storage_key]);
        await admin.from('assets').delete().eq('id', asset.id);
        throw validationError;
      }
    }

    if (path === 'assets/manifest' && request.method === 'POST') {
      const body = await request.json();
      const ids = Array.isArray(body.assetIds)
        ? [...new Set(body.assetIds.map(String))].slice(0, 500)
        : [];
      if (!ids.length) return json(request, { assets: {} });
      const { data, error } = await userClient
        .from('assets')
        .select('*')
        .in('id', ids);
      if (error) throw error;
      const assets: Record<string, string> = {};
      for (const asset of data) {
        if (asset.metadata_json?.completed !== true) continue;
        const signedResult = await admin.storage
          .from(ASSET_BUCKET)
          .createSignedUrl(asset.storage_key, 900);
        if (signedResult.error) throw signedResult.error;
        if (signedResult.data?.signedUrl) {
          assets[`asset://${asset.content_hash}`] = signedResult.data.signedUrl;
        }
      }
      return json(request, { assets });
    }

    if (path === 'releases/publish' && request.method === 'POST') {
      const body = await request.json();
      assertSafeContract(body.contract);
      const hashes = sceneAssetHashes(body.contract);
      const assetResult = hashes.length
        ? await userClient
            .from('assets')
            .select('id,content_hash,metadata_json')
            .in('content_hash', hashes)
        : { data: [], error: null };
      if (assetResult.error) throw assetResult.error;
      const assets = assetResult.data ?? [];
      if (
        assets.length !== hashes.length ||
        assets.some((asset: any) => asset.metadata_json?.completed !== true)
      ) {
        throw new Error('One or more assets are missing or incomplete.');
      }
      const projectResult = await userClient
        .from('projects')
        .select('name')
        .eq('id', body.projectId)
        .single();
      if (projectResult.error) throw projectResult.error;
      const slugValue = `${
        String(projectResult.data.name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'scene'
      }-${String(body.projectId).slice(0, 8)}`;
      const releaseResult = await userClient.rpc('publish_scene', {
        target_project: body.projectId,
        expected_revision: body.expectedRevision,
        snapshot: body.contract,
        digest: '0'.repeat(64),
        contract_version_value: body.contract.contractVersion,
        compatibility: body.contract.compatibility,
        asset_ids: assets.map((entry: any) => entry.id),
        slug_value: slugValue,
      });
      if (releaseResult.error) throw releaseResult.error;
      return json(
        request,
        normalizeRelease(releaseResult.data, slugValue, releaseResult.data.id),
        201,
      );
    }

    if (path === 'releases' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      if (!projectId) return json(request, { error: 'projectId is required' }, 400);
      const { data, error } = await userClient
        .from('published_versions')
        .select('*,public_slugs(slug,current_version_id)')
        .eq('project_id', projectId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return json(
        request,
        data.map((release: any) => {
          const slug = release.public_slugs?.[0];
          return normalizeRelease(release, slug?.slug ?? '', slug?.current_version_id);
        }),
      );
    }

    if (path === 'releases/current' && request.method === 'POST') {
      const body = await request.json();
      const versionResult = await userClient
        .from('published_versions')
        .select('id,project_id')
        .eq('id', body.versionId)
        .eq('project_id', body.projectId)
        .single();
      if (versionResult.error) throw versionResult.error;
      const { error } = await userClient
        .from('public_slugs')
        .update({ current_version_id: body.versionId, is_enabled: true })
        .eq('project_id', body.projectId);
      if (error) throw error;
      return json(request, { ok: true });
    }

    if (path === 'releases/disable' && request.method === 'POST') {
      const body = await request.json();
      const { error } = await userClient
        .from('public_slugs')
        .update({ is_enabled: false })
        .eq('project_id', body.projectId);
      if (error) throw error;
      return json(request, { ok: true });
    }

    return json(request, { error: 'not found' }, 404);
  } catch (error) {
    console.error(error);
    const raw = error instanceof Error ? error.message : String(error);
    const status = /forbidden|42501/i.test(raw)
      ? 403
      : /conflict|40001|23505/i.test(raw)
        ? 409
        : /not found|PGRST116/i.test(raw)
          ? 404
          : 400;
    const message = raw.replace(
      /storage_key|service_role|jwt_secret|access_token|stack/gi,
      '[redacted]',
    );
    return json(request, { error: message }, status);
  }
});
