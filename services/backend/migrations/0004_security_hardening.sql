begin;

-- Trigger functions should never inherit a caller-controlled search path.
alter function public.prevent_project_owner_change() set search_path = public;
alter function public.validate_editor_json_payload() set search_path = public;
alter function public.prevent_published_version_mutation() set search_path = public;
alter function public.prevent_checkpoint_mutation() set search_path = public;

-- These helpers are invoked by RLS and authenticated application flows. They
-- must not be exposed to anonymous REST callers through PostgREST RPC routes.
revoke execute on function public.project_role(uuid) from public, anon;
revoke execute on function public.can_view_project(uuid) from public, anon;
revoke execute on function public.can_edit_project(uuid) from public, anon;
revoke execute on function public.can_manage_project(uuid) from public, anon;
revoke execute on function public.is_project_owner(uuid) from public, anon;
grant execute on function public.project_role(uuid) to authenticated;
grant execute on function public.can_view_project(uuid) to authenticated;
grant execute on function public.can_edit_project(uuid) to authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;

-- Mutating SECURITY DEFINER RPCs remain available to signed-in Studio users;
-- each function performs project-role and revision checks internally.
revoke execute on function public.save_scene_draft(uuid,bigint,jsonb,text) from public, anon;
revoke execute on function public.save_project_workspace(uuid,bigint,jsonb) from public, anon;
revoke execute on function public.publish_scene(uuid,bigint,jsonb,text,text,jsonb,uuid[],text) from public, anon;
revoke execute on function public.add_project_member_by_email(uuid,text,text) from public, anon;
revoke execute on function public.set_project_member_role(uuid,uuid,text) from public, anon;
revoke execute on function public.append_realtime_operation(uuid,uuid,uuid,uuid,bigint,bigint,jsonb) from public, anon;
grant execute on function public.save_scene_draft(uuid,bigint,jsonb,text) to authenticated;
grant execute on function public.save_project_workspace(uuid,bigint,jsonb) to authenticated;
grant execute on function public.publish_scene(uuid,bigint,jsonb,text,text,jsonb,uuid[],text) to authenticated;
grant execute on function public.add_project_member_by_email(uuid,text,text) to authenticated;
grant execute on function public.set_project_member_role(uuid,uuid,text) to authenticated;
grant execute on function public.append_realtime_operation(uuid,uuid,uuid,uuid,bigint,bigint,jsonb) to authenticated;

commit;
