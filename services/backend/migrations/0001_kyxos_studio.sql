begin;

create extension if not exists pgcrypto;

create type public.project_status as enum ('active', 'archived');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  thumbnail_asset_id uuid,
  status public.project_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  storage_key text not null unique check (storage_key !~ '[\\]' and storage_key !~ '\.\.'),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 536870912),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id, content_hash)
);

alter table public.projects add constraint projects_thumbnail_fk foreign key (thumbnail_asset_id) references public.assets(id) on delete set null;

create table public.project_assets (
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (project_id, asset_id)
);

create table public.scene_drafts (
  project_id uuid primary key references public.projects(id) on delete cascade,
  contract_json jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  contract_version text not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.scene_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision bigint not null,
  contract_json jsonb not null,
  contract_version text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(project_id, revision)
);

create table public.published_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  scene_snapshot jsonb not null,
  scene_digest text not null check (scene_digest ~ '^[a-f0-9]{64}$'),
  contract_version text not null,
  viewer_compatibility jsonb not null,
  thumbnail_asset_id uuid references public.assets(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(project_id, version_number),
  unique(project_id, scene_digest)
);

create table public.published_assets (
  version_id uuid not null references public.published_versions(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete restrict,
  primary key (version_id, asset_id)
);

create table public.public_slugs (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  project_id uuid not null unique references public.projects(id) on delete restrict,
  current_version_id uuid not null references public.published_versions(id) on delete restrict,
  is_enabled boolean not null default true,
  allowed_embed_origins text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scene_revisions_project_created_idx on public.scene_revisions(project_id, created_at desc);
create index published_versions_project_created_idx on public.published_versions(project_id, created_at desc);
create index published_assets_asset_idx on public.published_assets(asset_id);

create or replace function public.is_project_owner(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.projects where id = target_project and owner_id = auth.uid()) $$;

create or replace function public.prevent_published_version_mutation()
returns trigger language plpgsql as $$ begin raise exception 'published versions are immutable'; end $$;
create trigger published_versions_immutable before update or delete on public.published_versions for each row execute function public.prevent_published_version_mutation();
create trigger published_assets_immutable before update or delete on public.published_assets for each row execute function public.prevent_published_version_mutation();

create or replace function public.save_scene_draft(target_project uuid, expected_revision bigint, contract jsonb, contract_version_value text)
returns bigint language plpgsql security definer set search_path = public as $$
declare current_revision bigint; next_revision bigint;
begin
  if not public.is_project_owner(target_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select revision into current_revision from public.scene_drafts where project_id = target_project for update;
  current_revision := coalesce(current_revision, 0);
  if current_revision <> expected_revision then raise exception 'revision conflict: expected %, current %', expected_revision, current_revision using errcode = '40001'; end if;
  if contract::text ~* '<script|javascript:|onerror\\s*=|onload\\s*=' then raise exception 'executable content is forbidden'; end if;
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
) returns public.published_versions language plpgsql security definer set search_path = public as $$
declare draft_revision bigint; next_version integer; result public.published_versions; asset_count integer;
begin
  if not public.is_project_owner(target_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  select revision into draft_revision from public.scene_drafts where project_id = target_project for update;
  if draft_revision is null or draft_revision <> expected_revision then raise exception 'publish revision conflict' using errcode = '40001'; end if;
  if snapshot::text ~* 'https?://[^\" ]*(token|signature|sig|jwt)=' then raise exception 'signed URLs are forbidden in published snapshots'; end if;
  select count(*) into asset_count from public.project_assets pa join public.assets a on a.id = pa.asset_id where pa.project_id = target_project and pa.asset_id = any(asset_ids);
  if asset_count <> coalesce(array_length(asset_ids, 1), 0) then raise exception 'one or more assets are missing or not owned by the project'; end if;
  select coalesce(max(version_number), 0) + 1 into next_version from public.published_versions where project_id = target_project;
  insert into public.published_versions(project_id, version_number, scene_snapshot, scene_digest, contract_version, viewer_compatibility, created_by)
  values(target_project, next_version, snapshot, digest, contract_version_value, compatibility, auth.uid()) returning * into result;
  insert into public.published_assets(version_id, asset_id) select result.id, unnest(asset_ids);
  insert into public.public_slugs(slug, project_id, current_version_id, is_enabled)
  values(slug_value, target_project, result.id, true)
  on conflict(project_id) do update set current_version_id = excluded.current_version_id, is_enabled = true, updated_at = now();
  return result;
end $$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.assets enable row level security;
alter table public.project_assets enable row level security;
alter table public.scene_drafts enable row level security;
alter table public.scene_revisions enable row level security;
alter table public.published_versions enable row level security;
alter table public.published_assets enable row level security;
alter table public.public_slugs enable row level security;

create policy projects_owner_all on public.projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy members_owner_read on public.project_members for select using (public.is_project_owner(project_id));
create policy assets_owner_all on public.assets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy project_assets_owner_all on public.project_assets for all using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));
create policy drafts_owner_all on public.scene_drafts for all using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));
create policy revisions_owner_read on public.scene_revisions for select using (public.is_project_owner(project_id));
create policy releases_owner_read on public.published_versions for select using (public.is_project_owner(project_id));
create policy releases_public_read on public.published_versions for select to anon using (exists(select 1 from public.public_slugs s where s.is_enabled and (s.current_version_id = id or s.project_id = published_versions.project_id)));
create policy published_assets_owner_read on public.published_assets for select using (exists(select 1 from public.published_versions v where v.id = version_id and public.is_project_owner(v.project_id)));
create policy published_assets_public_read on public.published_assets for select to anon using (exists(select 1 from public.published_versions v join public.public_slugs s on s.project_id = v.project_id where v.id = version_id and s.is_enabled));
create policy slugs_owner_all on public.public_slugs for all using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));
create policy slugs_public_read on public.public_slugs for select to anon using (is_enabled);
create policy published_asset_metadata_public_read on public.assets for select to anon using (exists(select 1 from public.published_assets pa join public.published_versions v on v.id = pa.version_id join public.public_slugs s on s.project_id = v.project_id where pa.asset_id = assets.id and s.is_enabled));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('kyxos-assets', 'kyxos-assets', false, 536870912, array['model/gltf-binary','image/png','image/jpeg','image/webp','image/ktx2','image/vnd.radiance','image/x-exr'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_owner_upload on storage.objects for insert to authenticated with check (bucket_id = 'kyxos-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_owner_read on storage.objects for select to authenticated using (bucket_id = 'kyxos-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_owner_update on storage.objects for update to authenticated using (bucket_id = 'kyxos-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy storage_owner_delete_unpublished on storage.objects for delete to authenticated using (
  bucket_id = 'kyxos-assets' and (storage.foldername(name))[1] = auth.uid()::text and
  not exists(select 1 from public.assets a join public.published_assets pa on pa.asset_id = a.id where a.storage_key = name)
);

commit;
