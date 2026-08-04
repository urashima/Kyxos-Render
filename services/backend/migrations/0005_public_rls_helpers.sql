begin;

-- PostgREST evaluates every applicable RLS policy. Public read policies share
-- tables with member policies, so anonymous reads need permission to execute
-- these boolean helpers. With auth.uid() null they only return false/null and
-- do not expose project data. Mutating SECURITY DEFINER RPCs remain revoked.
grant execute on function public.project_role(uuid) to anon;
grant execute on function public.can_view_project(uuid) to anon;
grant execute on function public.can_edit_project(uuid) to anon;
grant execute on function public.can_manage_project(uuid) to anon;
grant execute on function public.is_project_owner(uuid) to anon;

commit;
