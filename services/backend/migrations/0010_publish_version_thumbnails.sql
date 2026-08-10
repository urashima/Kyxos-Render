begin;

-- Keep the RPC signature stable for deployed clients. The Studio continuously
-- persists a verified project cover asset; publish_scene snapshots that asset
-- into each newly-created immutable published version and protects it through
-- published_assets just like scene dependencies.
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
  digest_snapshot jsonb;
  authoritative_digest text;
  persistent_hashes text[] := '{}'::text[];
  resolved_asset_ids uuid[] := '{}'::uuid[];
  missing_hashes text[] := '{}'::text[];
  project_thumbnail_asset uuid;
begin
  if not public.can_edit_project(target_project) then
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

  select coalesce(array_agg(distinct asset.value->>'contentHash'), '{}'::text[])
    into persistent_hashes
    from jsonb_each(coalesce(snapshot->'assets', '{}'::jsonb)) as asset(key, value)
   where coalesce(asset.value->'metadata'->>'embedded', 'false') <> 'true'
     and coalesce(asset.value->'metadata'->>'embeddedInAssetId', '') = ''
     and coalesce(asset.value->>'storageType', '') <> 'virtual'
     and coalesce(asset.value->>'runtimeOnly', 'false') <> 'true'
     and asset.key !~ '^embedded-gltf-'
     and coalesce(asset.value->>'contentHash', '') ~ '^[a-f0-9]{64}$';

  select coalesce(array_agg(distinct a.id), '{}'::uuid[])
    into resolved_asset_ids
    from public.assets a
   where a.content_hash = any(persistent_hashes)
     and a.metadata_json->>'completed' = 'true'
     and (
       a.owner_id = auth.uid()
       or exists (
         select 1
           from public.project_assets pa
          where pa.project_id = target_project
            and pa.asset_id = a.id
       )
     );

  select coalesce(array_agg(hash), '{}'::text[])
    into missing_hashes
    from unnest(persistent_hashes) as hash
   where not exists (
     select 1
       from public.assets a
      where a.content_hash = hash
        and a.metadata_json->>'completed' = 'true'
        and (
          a.owner_id = auth.uid()
          or exists (
            select 1
              from public.project_assets pa
             where pa.project_id = target_project
               and pa.asset_id = a.id
          )
        )
   );

  if coalesce(array_length(missing_hashes, 1), 0) > 0 then
    raise exception 'missing or incomplete persistent assets: %', array_to_string(missing_hashes, ', ');
  end if;

  -- Only snapshot a cover that is a completed asset and is already linked to
  -- this project. A stale/broken thumbnail must never block scene publishing.
  select p.thumbnail_asset_id
    into project_thumbnail_asset
    from public.projects p
    join public.assets a on a.id = p.thumbnail_asset_id
    join public.project_assets pa
      on pa.project_id = p.id
     and pa.asset_id = a.id
   where p.id = target_project
     and a.metadata_json->>'completed' = 'true'
   limit 1;

  digest_snapshot := jsonb_set(snapshot, '{metadata,updatedAt}', '""'::jsonb, true);
  authoritative_digest := encode(
    extensions.digest(convert_to(digest_snapshot::text, 'utf8'), 'sha256'),
    'hex'
  );

  insert into public.project_assets(project_id, asset_id)
  select target_project, resolved_asset_id
    from unnest(resolved_asset_ids) as resolved_asset_id
  on conflict(project_id, asset_id) do nothing;

  select *
    into result
    from public.published_versions
   where project_id = target_project
     and scene_digest = authoritative_digest;
  if result.id is not null then
    insert into public.public_slugs(slug, project_id, current_version_id, is_enabled)
    values(slug_value, target_project, result.id, true)
    on conflict(project_id) do update set
      slug = excluded.slug,
      current_version_id = excluded.current_version_id,
      is_enabled = true,
      updated_at = now();
    return result;
  end if;

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
    thumbnail_asset_id,
    created_by
  ) values (
    target_project,
    next_version,
    snapshot,
    authoritative_digest,
    contract_version_value,
    compatibility,
    project_thumbnail_asset,
    auth.uid()
  ) returning * into result;

  insert into public.published_assets(version_id, asset_id)
  select result.id, resolved_asset_id
    from unnest(resolved_asset_ids) as resolved_asset_id
  union
  select result.id, project_thumbnail_asset
   where project_thumbnail_asset is not null
  on conflict(version_id, asset_id) do nothing;

  insert into public.public_slugs(slug, project_id, current_version_id, is_enabled)
  values(slug_value, target_project, result.id, true)
  on conflict(project_id) do update set
    slug = excluded.slug,
    current_version_id = excluded.current_version_id,
    is_enabled = true,
    updated_at = now();

  return result;
end
$$;

commit;
