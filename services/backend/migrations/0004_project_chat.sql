begin;

create table public.project_chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  body text not null,
  reply_to_id uuid references public.project_chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique(project_id, id),
  check (
    (deleted_at is null and char_length(trim(body)) between 1 and 4000)
    or (deleted_at is not null and body = '')
  ),
  check (edited_at is null or edited_at >= created_at),
  check (deleted_at is null or deleted_at >= created_at)
);

create table public.project_chat_typing (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  updated_at timestamptz not null default now(),
  primary key(project_id, user_id, client_id)
);

create index project_chat_messages_project_created_idx
  on public.project_chat_messages(project_id, created_at desc, id);
create index project_chat_messages_reply_idx
  on public.project_chat_messages(project_id, reply_to_id)
  where reply_to_id is not null;
create index project_chat_typing_project_updated_idx
  on public.project_chat_typing(project_id, updated_at desc);

create or replace function public.validate_project_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id
      or new.user_id <> old.user_id
      or new.created_at <> old.created_at
      or new.reply_to_id is distinct from old.reply_to_id
    then
      raise exception 'chat message identity and reply target are immutable' using errcode = '42501';
    end if;
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.project_chat_messages parent
     where parent.id = new.reply_to_id
       and parent.project_id = new.project_id
  ) then
    raise exception 'chat reply target must belong to the same project' using errcode = '23503';
  end if;

  if new.deleted_at is null then
    new.body := trim(regexp_replace(new.body, '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', '', 'g'));
    if char_length(new.body) = 0 then
      raise exception 'chat message cannot be empty' using errcode = '23514';
    end if;
  else
    new.body := '';
    new.edited_at := coalesce(new.edited_at, new.deleted_at);
  end if;

  return new;
end
$$;

create trigger project_chat_messages_validate
before insert or update on public.project_chat_messages
for each row execute function public.validate_project_chat_message();

create or replace function public.validate_project_chat_typing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.project_id <> old.project_id
    or new.user_id <> old.user_id
    or new.client_id <> old.client_id
  ) then
    raise exception 'chat typing identity is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger project_chat_typing_validate
before insert or update on public.project_chat_typing
for each row execute function public.validate_project_chat_typing();

alter table public.project_chat_messages enable row level security;
alter table public.project_chat_typing enable row level security;

grant select, insert, update, delete on public.project_chat_messages to authenticated;
grant select, insert, update, delete on public.project_chat_typing to authenticated;

create policy chat_messages_member_read
on public.project_chat_messages for select to authenticated
using (public.can_view_project(project_id));

create policy chat_messages_member_insert
on public.project_chat_messages for insert to authenticated
with check (
  user_id = auth.uid()
  and public.can_view_project(project_id)
);

create policy chat_messages_author_or_owner_update
on public.project_chat_messages for update to authenticated
using (
  public.can_view_project(project_id)
  and (user_id = auth.uid() or public.can_manage_project(project_id))
)
with check (
  public.can_view_project(project_id)
  and (user_id = auth.uid() or public.can_manage_project(project_id))
);

create policy chat_messages_author_or_owner_delete
on public.project_chat_messages for delete to authenticated
using (
  public.can_view_project(project_id)
  and (user_id = auth.uid() or public.can_manage_project(project_id))
);

create policy chat_typing_member_read
on public.project_chat_typing for select to authenticated
using (public.can_view_project(project_id));

create policy chat_typing_self_write
on public.project_chat_typing for all to authenticated
using (
  user_id = auth.uid()
  and public.can_view_project(project_id)
)
with check (
  user_id = auth.uid()
  and public.can_view_project(project_id)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'project_chat_messages'
  ) then
    alter publication supabase_realtime add table public.project_chat_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'project_chat_typing'
  ) then
    alter publication supabase_realtime add table public.project_chat_typing;
  end if;
end
$$;

commit;
