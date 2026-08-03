begin;

-- Roles are project-scoped. Project ownership remains authoritative and cannot
-- be delegated accidentally by editing project_members.
alter table public.project_members
  drop constraint if exists project_members_role_check;
alter table public.project_members
  add constraint project_members_role_check
  check (role in ('owner', 'editor', 'viewer'));

create or replace function public.project_role(target_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.projects
       where id = target_project and owner_id = auth.uid()
    ) then 'owner'
    else (
      select role from public.project_members
       where project_id = target_project and user_id = auth.uid()
       limit 1
    )
  end
$$;

create or replace function public.can_view_project(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.project_role(target_project) in ('owner', 'editor', 'viewer'), false) $$;

create or replace function public.can_edit_project(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.project_role(target_project) in ('owner', 'editor'), false) $$;

create or replace function public.can_manage_project(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.project_role(target_project) = 'owner', false) $$;

-- Project ownership is the single authority for the Owner role. Editors may
-- update project metadata, but neither an API bug nor a direct PostgREST call
-- may turn an Editor into the project owner.
create or replace function public.prevent_project_owner_change()
returns trigger language plpgsql as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'project ownership is immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists projects_owner_immutable on public.projects;
create trigger projects_owner_immutable
before update on public.projects
for each row execute function public.prevent_project_owner_change();

create table public.project_workspaces (
  project_id uuid primary key references public.projects(id) on delete cascade,
  workspace_json jsonb not null check (workspace_json->>'version' = '1'),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.project_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  contract_json jsonb not null,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, name)
);

create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  revision bigint not null default 1 check (revision > 0),
  template_json jsonb not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_presence (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  scene_id uuid,
  state_json jsonb not null default '{}'::jsonb check (octet_length(state_json::text) <= 65536),
  updated_at timestamptz not null default now(),
  primary key(project_id, user_id, client_id)
);

create table public.realtime_operations (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid not null,
  client_id uuid not null,
  user_id uuid not null references auth.users(id),
  sequence bigint not null check (sequence > 0),
  base_revision bigint not null check (base_revision >= 0),
  patch_json jsonb not null check (
    jsonb_typeof(patch_json) = 'array'
    and jsonb_array_length(patch_json) <= 1000
    and octet_length(patch_json::text) <= 2097152
  ),
  created_at timestamptz not null default now(),
  unique(project_id, client_id, sequence)
);

create table public.version_branches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  head_checkpoint_id uuid,
  base_checkpoint_id uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(project_id, name),
  unique(project_id, id)
);

create table public.scene_checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  branch_id uuid not null,
  parent_id uuid,
  label text not null check (char_length(label) between 1 and 160),
  scene_snapshot jsonb not null,
  scene_digest text not null check (scene_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(project_id, id),
  foreign key (project_id, branch_id)
    references public.version_branches(project_id, id) on delete cascade
);

alter table public.version_branches
  add constraint version_branches_head_fk foreign key (project_id, head_checkpoint_id)
  references public.scene_checkpoints(project_id, id) on delete set null (head_checkpoint_id),
  add constraint version_branches_base_fk foreign key (project_id, base_checkpoint_id)
  references public.scene_checkpoints(project_id, id) on delete set null (base_checkpoint_id);

alter table public.scene_checkpoints
  add constraint scene_checkpoints_parent_fk foreign key (project_id, parent_id)
  references public.scene_checkpoints(project_id, id) on delete cascade;

create table public.merge_conflicts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_branch_id uuid not null,
  target_branch_id uuid not null,
  path text not null,
  base_value jsonb,
  ours_value jsonb,
  theirs_value jsonb,
  resolution text check (resolution in ('ours', 'theirs')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id, source_branch_id)
    references public.version_branches(project_id, id) on delete cascade,
  foreign key (project_id, target_branch_id)
    references public.version_branches(project_id, id) on delete cascade
);

create table public.project_source_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null check (
    char_length(path) between 1 and 320
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '^/'
  ),
  language text not null default 'typescript' check (char_length(language) between 1 and 40),
  content text not null default '' check (octet_length(content) <= 2097152),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(project_id, path)
);

-- RLS also applies to direct PostgREST access, so the safety checks used by the
-- Edge Function are repeated at the database boundary for every authored JSON
-- document instead of trusting callers to use only the RPC routes.
create or replace function public.validate_editor_json_payload()
returns trigger language plpgsql as $$
declare payload jsonb;
begin
  payload := case tg_table_name
    when 'scene_drafts' then new.contract_json
    when 'project_workspaces' then new.workspace_json
    when 'project_scenes' then new.contract_json
    when 'project_templates' then new.template_json
    when 'scene_checkpoints' then new.scene_snapshot
    else '{}'::jsonb
  end;
  if octet_length(payload::text) > 67108864 then
    raise exception 'editor JSON payload exceeds 64 MB';
  end if;
  if payload::text ~* '<script|javascript:|onerror\s*=|onload\s*=' then
    raise exception 'executable content is forbidden';
  end if;
  if payload::text ~* 'service[_-]?role|jwt[_-]?secret|access[_-]?token' then
    raise exception 'secrets are forbidden in editor documents';
  end if;
  return new;
end
$$;

create trigger scene_drafts_json_guard before insert or update on public.scene_drafts
for each row execute function public.validate_editor_json_payload();
create trigger project_workspaces_json_guard before insert or update on public.project_workspaces
for each row execute function public.validate_editor_json_payload();
create trigger project_scenes_json_guard before insert or update on public.project_scenes
for each row execute function public.validate_editor_json_payload();
create trigger project_templates_json_guard before insert or update on public.project_templates
for each row execute function public.validate_editor_json_payload();
create trigger scene_checkpoints_json_guard before insert on public.scene_checkpoints
for each row execute function public.validate_editor_json_payload();

create index project_scenes_project_sort_idx on public.project_scenes(project_id, sort_order, created_at);
create index project_templates_project_idx on public.project_templates(project_id, updated_at desc);
create index presence_project_updated_idx on public.project_presence(project_id, updated_at desc);
create index operations_project_created_idx on public.realtime_operations(project_id, created_at, sequence);
create index checkpoints_branch_created_idx on public.scene_checkpoints(branch_id, created_at desc);
create index conflicts_project_unresolved_idx on public.merge_conflicts(project_id, created_at) where resolution is null;
create index source_files_project_path_idx on public.project_source_files(project_id, path);

create or replace function public.save_project_workspace(
  target_project uuid,
  expected_revision bigint,
  workspace jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare current_revision bigint; next_revision bigint;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if workspace->>'version' <> '1' then raise exception 'unsupported workspace version'; end if;
  select revision into current_revision from public.project_workspaces
   where project_id = target_project for update;
  current_revision := coalesce(current_revision, 0);
  if current_revision <> expected_revision then
    raise exception 'workspace revision conflict: expected %, current %', expected_revision, current_revision using errcode = '40001';
  end if;
  next_revision := current_revision + 1;
  insert into public.project_workspaces(project_id, workspace_json, revision, updated_by)
  values(target_project, workspace, next_revision, auth.uid())
  on conflict(project_id) do update set
    workspace_json = excluded.workspace_json,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    updated_at = now();
  return next_revision;
end
$$;

create or replace function public.add_project_member_by_email(
  target_project uuid,
  member_email text,
  member_role text
) returns public.project_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare target_user uuid; result public.project_members;
begin
  if not public.can_manage_project(target_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if member_role not in ('editor', 'viewer') then raise exception 'invalid member role'; end if;
  select id into target_user from auth.users where lower(email) = lower(trim(member_email)) limit 1;
  if target_user is null then raise exception 'user not found'; end if;
  insert into public.project_members(project_id, user_id, role)
  values(target_project, target_user, member_role)
  on conflict(project_id, user_id) do update set role = excluded.role
  returning * into result;
  return result;
end
$$;

create or replace function public.set_project_member_role(
  target_project uuid,
  target_user uuid,
  member_role text
) returns public.project_members
language plpgsql security definer set search_path = public as $$
declare result public.project_members;
begin
  if not public.can_manage_project(target_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if member_role not in ('editor', 'viewer') then raise exception 'invalid member role'; end if;
  update public.project_members set role = member_role
   where project_id = target_project and user_id = target_user and role <> 'owner'
   returning * into result;
  if result.user_id is null then raise exception 'member not found'; end if;
  return result;
end
$$;

create or replace function public.append_realtime_operation(
  target_project uuid,
  target_scene uuid,
  operation_id uuid,
  operation_client uuid,
  operation_sequence bigint,
  operation_base_revision bigint,
  operation_patch jsonb
) returns public.realtime_operations
language plpgsql
security definer
set search_path = public
as $$
declare result public.realtime_operations;
begin
  if not public.can_edit_project(target_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(operation_patch) <> 'array' or jsonb_array_length(operation_patch) > 1000 then
    raise exception 'invalid operation patch';
  end if;
  insert into public.realtime_operations(
    id, project_id, scene_id, client_id, user_id, sequence, base_revision, patch_json
  ) values (
    operation_id, target_project, target_scene, operation_client, auth.uid(),
    operation_sequence, operation_base_revision, operation_patch
  ) on conflict(id) do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.realtime_operations
     where id = operation_id
       and project_id = target_project
       and client_id = operation_client
       and user_id = auth.uid()
       and sequence = operation_sequence;
    if result.id is null then
      raise exception 'operation id collision' using errcode = '23505';
    end if;
  end if;
  return result;
end
$$;

create or replace function public.prevent_checkpoint_mutation()
returns trigger language plpgsql as $$
begin raise exception 'scene checkpoints are immutable'; end
$$;
create trigger scene_checkpoints_immutable
before update on public.scene_checkpoints
for each row execute function public.prevent_checkpoint_mutation();

-- Upgrade existing draft and release functions from owner-only to owner/editor.
create or replace function public.save_scene_draft(target_project uuid, expected_revision bigint, contract jsonb, contract_version_value text)
returns bigint language plpgsql security definer set search_path = public as $$
declare current_revision bigint; next_revision bigint;
begin
  if not public.can_edit_project(target_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select revision into current_revision from public.scene_drafts where project_id = target_project for update;
  current_revision := coalesce(current_revision, 0);
  if current_revision <> expected_revision then raise exception 'revision conflict: expected %, current %', expected_revision, current_revision using errcode = '40001'; end if;
  if contract::text ~* '<script|javascript:|onerror\s*=|onload\s*=' then raise exception 'executable content is forbidden'; end if;
  if contract::text ~* 'service[_-]?role|jwt[_-]?secret|access[_-]?token' then raise exception 'secrets are forbidden in scene contracts'; end if;
  next_revision := current_revision + 1;
  insert into public.scene_drafts(project_id, contract_json, revision, contract_version, updated_by)
  values(target_project, contract, next_revision, contract_version_value, auth.uid())
  on conflict(project_id) do update set contract_json = excluded.contract_json, revision = excluded.revision, contract_version = excluded.contract_version, updated_by = excluded.updated_by, updated_at = now();
  insert into public.scene_revisions(project_id, revision, contract_json, contract_version, created_by) values(target_project, next_revision, contract, contract_version_value, auth.uid());
  update public.projects set updated_at = now() where id = target_project;
  return next_revision;
end $$;

create or replace function public.publish_scene(
  target_project uuid,
  expected_revision bigint,
  snapshot jsonb,
  digest text,
  contract_version_value text,
  compatibility jsonb,
  asset_ids uuid[],
  slug_value text
) returns public.published_versions
language plpgsql security definer set search_path = public as $$
declare
  draft_revision bigint;
  next_version integer;
  result public.published_versions;
  requested_asset_count integer := coalesce(array_length(asset_ids, 1), 0);
  accessible_asset_count integer;
  digest_snapshot jsonb;
  authoritative_digest text;
begin
  if not public.can_edit_project(target_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select revision into draft_revision from public.scene_drafts where project_id = target_project for update;
  if draft_revision is null or draft_revision <> expected_revision then raise exception 'publish revision conflict' using errcode = '40001'; end if;
  if snapshot::text ~* 'https?://[^" ]*(token|signature|sig|jwt)=' then raise exception 'signed URLs are forbidden in published snapshots'; end if;
  if snapshot::text ~* '<script|javascript:|onerror\s*=|onload\s*=' then raise exception 'executable content is forbidden in published snapshots'; end if;
  digest_snapshot := jsonb_set(snapshot, '{metadata,updatedAt}', '""'::jsonb, true);
  authoritative_digest := encode(public.digest(convert_to(digest_snapshot::text, 'utf8'), 'sha256'), 'hex');

  select count(*) into accessible_asset_count
    from public.assets a
   where a.id = any(coalesce(asset_ids, '{}'::uuid[]))
     and (
       a.owner_id = auth.uid()
       or exists (
         select 1 from public.project_assets pa
          where pa.project_id = target_project and pa.asset_id = a.id
       )
     );
  if accessible_asset_count <> requested_asset_count then
    raise exception 'one or more assets are not available to this project';
  end if;

  insert into public.project_assets(project_id, asset_id)
  select target_project, a.id from public.assets a
   where a.owner_id = auth.uid() and a.id = any(coalesce(asset_ids, '{}'::uuid[]))
  on conflict(project_id, asset_id) do nothing;

  select * into result from public.published_versions
   where project_id = target_project and scene_digest = authoritative_digest;
  if result.id is not null then
    insert into public.public_slugs(slug, project_id, current_version_id, is_enabled)
    values(slug_value, target_project, result.id, true)
    on conflict(project_id) do update set current_version_id = excluded.current_version_id, is_enabled = true, updated_at = now();
    return result;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
    from public.published_versions where project_id = target_project;
  insert into public.published_versions(
    project_id, version_number, scene_snapshot, scene_digest, contract_version,
    viewer_compatibility, created_by
  ) values (
    target_project, next_version, snapshot, authoritative_digest,
    contract_version_value, compatibility, auth.uid()
  ) returning * into result;
  insert into public.published_assets(version_id, asset_id)
  select result.id, asset_id from unnest(coalesce(asset_ids, '{}'::uuid[])) as asset_id;
  insert into public.public_slugs(slug, project_id, current_version_id, is_enabled)
  values(slug_value, target_project, result.id, true)
  on conflict(project_id) do update set current_version_id = excluded.current_version_id, is_enabled = true, updated_at = now();
  return result;
end $$;

alter table public.project_workspaces enable row level security;
alter table public.project_scenes enable row level security;
alter table public.project_templates enable row level security;
alter table public.project_presence enable row level security;
alter table public.realtime_operations enable row level security;
alter table public.version_branches enable row level security;
alter table public.scene_checkpoints enable row level security;
alter table public.merge_conflicts enable row level security;
alter table public.project_source_files enable row level security;

drop policy if exists projects_owner_all on public.projects;
create policy projects_member_read on public.projects for select using (public.can_view_project(id));
create policy projects_owner_insert on public.projects for insert with check (owner_id = auth.uid());
create policy projects_editor_update on public.projects for update using (public.can_edit_project(id)) with check (public.can_edit_project(id));
create policy projects_owner_delete on public.projects for delete using (public.can_manage_project(id));

drop policy if exists members_owner_read on public.project_members;
create policy members_member_read on public.project_members for select using (public.can_view_project(project_id));
create policy members_owner_insert on public.project_members for insert with check (
  public.can_manage_project(project_id)
  and (
    role in ('editor', 'viewer')
    or (
      role = 'owner'
      and user_id = auth.uid()
      and exists(select 1 from public.projects where id = project_id and owner_id = auth.uid())
    )
  )
);
create policy members_owner_update on public.project_members for update
using (public.can_manage_project(project_id) and role <> 'owner')
with check (public.can_manage_project(project_id) and role in ('editor', 'viewer'));
create policy members_owner_delete on public.project_members for delete using (public.can_manage_project(project_id) and user_id <> auth.uid());

drop policy if exists drafts_owner_all on public.scene_drafts;
create policy drafts_member_read on public.scene_drafts for select using (public.can_view_project(project_id));
create policy drafts_editor_insert on public.scene_drafts for insert with check (public.can_edit_project(project_id));
create policy drafts_editor_update on public.scene_drafts for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy drafts_owner_delete on public.scene_drafts for delete using (public.can_manage_project(project_id));

drop policy if exists revisions_owner_read on public.scene_revisions;
create policy revisions_member_read on public.scene_revisions for select using (public.can_view_project(project_id));
drop policy if exists releases_owner_read on public.published_versions;
create policy releases_member_read on public.published_versions for select using (public.can_view_project(project_id));
drop policy if exists published_assets_owner_read on public.published_assets;
create policy published_assets_member_read on public.published_assets for select using (
  exists(select 1 from public.published_versions v where v.id = version_id and public.can_view_project(v.project_id))
);
create policy assets_project_member_read on public.assets for select using (
  exists(
    select 1 from public.project_assets pa
     where pa.asset_id = assets.id and public.can_view_project(pa.project_id)
  )
);
drop policy if exists project_assets_owner_all on public.project_assets;
create policy project_assets_member_read on public.project_assets for select using (public.can_view_project(project_id));
create policy project_assets_editor_insert on public.project_assets for insert with check (
  public.can_edit_project(project_id)
  and exists(select 1 from public.assets a where a.id = asset_id and a.owner_id = auth.uid())
);
create policy project_assets_owner_delete on public.project_assets for delete using (public.can_manage_project(project_id));
drop policy if exists slugs_owner_all on public.public_slugs;
create policy slugs_member_read on public.public_slugs for select using (public.can_view_project(project_id));
create policy slugs_editor_insert on public.public_slugs for insert with check (public.can_edit_project(project_id));
create policy slugs_editor_update on public.public_slugs for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy slugs_owner_delete on public.public_slugs for delete using (public.can_manage_project(project_id));

create policy workspaces_member_read on public.project_workspaces for select using (public.can_view_project(project_id));
create policy workspaces_editor_write on public.project_workspaces for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy scenes_member_read on public.project_scenes for select using (public.can_view_project(project_id));
create policy scenes_editor_write on public.project_scenes for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy templates_member_read on public.project_templates for select using (public.can_view_project(project_id));
create policy templates_editor_write on public.project_templates for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy presence_member_read on public.project_presence for select using (public.can_view_project(project_id));
create policy presence_self_write on public.project_presence for all using (user_id = auth.uid() and public.can_view_project(project_id)) with check (user_id = auth.uid() and public.can_view_project(project_id));
create policy operations_member_read on public.realtime_operations for select using (public.can_view_project(project_id));
create policy operations_editor_insert on public.realtime_operations for insert with check (user_id = auth.uid() and public.can_edit_project(project_id));
create policy branches_member_read on public.version_branches for select using (public.can_view_project(project_id));
create policy branches_editor_write on public.version_branches for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy checkpoints_member_read on public.scene_checkpoints for select using (public.can_view_project(project_id));
create policy checkpoints_editor_insert on public.scene_checkpoints for insert with check (created_by = auth.uid() and public.can_edit_project(project_id));
create policy conflicts_member_read on public.merge_conflicts for select using (public.can_view_project(project_id));
create policy conflicts_editor_write on public.merge_conflicts for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy source_files_member_read on public.project_source_files for select using (public.can_view_project(project_id));
create policy source_files_editor_write on public.project_source_files for all using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- Private Realtime channel topics are `project:<uuid>`. Realtime evaluates
-- these policies at channel join and first write; it does not persist rows.
create policy kyxos_realtime_member_read
on realtime.messages for select to authenticated
using (
  (select realtime.topic()) ~ '^project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.can_view_project(substring((select realtime.topic()) from 9)::uuid)
);
create policy kyxos_realtime_member_write
on realtime.messages for insert to authenticated
with check (
  (select realtime.topic()) ~ '^project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (
    (extension = 'presence' and public.can_view_project(substring((select realtime.topic()) from 9)::uuid))
    or (extension = 'broadcast' and public.can_edit_project(substring((select realtime.topic()) from 9)::uuid))
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'realtime_operations'
  ) then
    alter publication supabase_realtime add table public.realtime_operations;
  end if;
end
$$;

commit;
