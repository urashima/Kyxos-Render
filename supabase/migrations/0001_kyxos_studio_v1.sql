create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  slug text not null,
  description text not null default '',
  thumbnail_url text,
  visibility text not null default 'draft' check (visibility in ('draft', 'unlisted', 'public', 'unpublished')),
  draft_scene jsonb not null,
  draft_revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug)
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null default 0,
  kind text not null check (kind in ('glb', 'gltf-zip', 'hdr', 'exr', 'texture', 'video', 'sequence')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  unique(project_id, id, revision),
  unique(storage_path)
);

create table if not exists public.scene_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null,
  scene jsonb not null,
  metadata jsonb not null,
  created_at timestamptz not null default now(),
  unique(project_id, revision)
);

create table if not exists public.publish_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_id uuid references public.scene_revisions(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null unique,
  visibility text not null check (visibility in ('unlisted', 'public', 'unpublished')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.scene_revisions enable row level security;
alter table public.publish_links enable row level security;

create policy "profiles owner read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles owner update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "projects owner select" on public.projects
  for select using (auth.uid() = owner_id);
create policy "projects owner insert" on public.projects
  for insert with check (auth.uid() = owner_id);
create policy "projects owner update" on public.projects
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "projects owner delete" on public.projects
  for delete using (auth.uid() = owner_id);

create policy "assets owner select" on public.assets
  for select using (auth.uid() = owner_id);
create policy "assets owner insert" on public.assets
  for insert with check (auth.uid() = owner_id);
create policy "assets owner update" on public.assets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "scene revisions owner select" on public.scene_revisions
  for select using (auth.uid() = owner_id);
create policy "scene revisions owner insert" on public.scene_revisions
  for insert with check (auth.uid() = owner_id);
create policy "public active scene revisions" on public.scene_revisions
  for select using (
    exists (
      select 1 from public.publish_links
      where publish_links.revision_id = scene_revisions.id
        and publish_links.is_active
        and publish_links.visibility in ('unlisted', 'public')
    )
  );

create policy "publish links owner select" on public.publish_links
  for select using (auth.uid() = owner_id);
create policy "publish links owner insert" on public.publish_links
  for insert with check (auth.uid() = owner_id);
create policy "publish links owner update" on public.publish_links
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "publish links public resolve" on public.publish_links
  for select using (is_active and visibility in ('unlisted', 'public'));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();

drop trigger if exists publish_links_touch_updated_at on public.publish_links;
create trigger publish_links_touch_updated_at
before update on public.publish_links
for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyxos-assets',
  'kyxos-assets',
  false,
  524288000,
  array[
    'model/gltf-binary',
    'model/gltf+json',
    'application/zip',
    'image/vnd.radiance',
    'image/x-exr',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/ktx2',
    'video/mp4',
    'video/webm'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
