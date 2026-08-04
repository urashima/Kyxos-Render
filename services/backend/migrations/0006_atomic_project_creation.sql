begin;

create or replace function public.create_project_for_user(
  target_user uuid,
  project_name text
) returns public.projects
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_name text;
  result public.projects;
begin
  if target_user is null or not exists (
    select 1 from auth.users where id = target_user
  ) then
    raise exception 'invalid project owner' using errcode = '22023';
  end if;

  normalized_name := trim(project_name);
  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'project name must contain 1 to 120 characters' using errcode = '22023';
  end if;

  insert into public.projects(owner_id, name)
  values(target_user, normalized_name)
  returning * into result;

  insert into public.project_members(project_id, user_id, role)
  values(result.id, target_user, 'owner');

  return result;
end
$$;

revoke execute on function public.create_project_for_user(uuid, text)
from public, anon, authenticated;
grant execute on function public.create_project_for_user(uuid, text)
to service_role;

commit;
