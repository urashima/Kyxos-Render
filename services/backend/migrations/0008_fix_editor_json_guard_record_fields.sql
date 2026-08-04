begin;

create or replace function public.validate_editor_json_payload()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  row_json jsonb;
  payload jsonb;
  payload_key text;
begin
  row_json := to_jsonb(new);
  payload_key := case tg_table_name
    when 'scene_drafts' then 'contract_json'
    when 'project_workspaces' then 'workspace_json'
    when 'project_scenes' then 'contract_json'
    when 'project_templates' then 'template_json'
    when 'scene_checkpoints' then 'scene_snapshot'
    else null
  end;

  payload := case
    when payload_key is null then '{}'::jsonb
    else coalesce(row_json -> payload_key, '{}'::jsonb)
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

commit;
