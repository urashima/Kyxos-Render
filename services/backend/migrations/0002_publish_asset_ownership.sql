begin;

-- Publishing is the authoritative moment when owner assets become pinned to a
-- project and to an immutable release. This keeps hash de-duplication reusable
-- while preventing a project from publishing assets owned by another user.
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
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_revision bigint;
  next_version integer;
  result public.published_versions;
  requested_asset_count integer := coalesce(array_length(asset_ids, 1), 0);
  owned_asset_count integer;
begin
  if not public.is_project_owner(target_project) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select revision
    into draft_revision
    from public.scene_drafts
   where project_id = target_project
   for update;

  if draft_revision is null or draft_revision <> expected_revision then
    raise exception 'publish revision conflict' using errcode = '40001';
  end if;

  if snapshot::text ~* 'https?://[^\" ]*(token|signature|sig|jwt)=' then
    raise exception 'signed URLs are forbidden in published snapshots';
  end if;

  if snapshot::text ~* '<script|javascript:|onerror\s*=|onload\s*=' then
    raise exception 'executable content is forbidden in published snapshots';
  end if;

  select count(*)
    into owned_asset_count
    from public.assets
   where owner_id = auth.uid()
     and id = any(coalesce(asset_ids, '{}'::uuid[]));

  if owned_asset_count <> requested_asset_count then
    raise exception 'one or more assets are missing or are not owned by the publisher';
  end if;

  insert into public.project_assets(project_id, asset_id)
  select target_project, asset_id
    from unnest(coalesce(asset_ids, '{}'::uuid[])) as asset_id
  on conflict(project_id, asset_id) do nothing;

  select coalesce(max(version_number), 0) + 1
    into next_version
    from public.published_versions
   where project_id = target_project;

  insert into public.published_versions(
    project_id,
    version_number,
    scene_snapshot,
    scene_digest,
    contract_version,
    viewer_compatibility,
    created_by
  ) values (
    target_project,
    next_version,
    snapshot,
    digest,
    contract_version_value,
    compatibility,
    auth.uid()
  ) returning * into result;

  insert into public.published_assets(version_id, asset_id)
  select result.id, asset_id
    from unnest(coalesce(asset_ids, '{}'::uuid[])) as asset_id;

  insert into public.public_slugs(
    slug,
    project_id,
    current_version_id,
    is_enabled
  ) values (
    slug_value,
    target_project,
    result.id,
    true
  )
  on conflict(project_id) do update
    set current_version_id = excluded.current_version_id,
        is_enabled = true,
        updated_at = now();

  return result;
end
$$;

commit;
