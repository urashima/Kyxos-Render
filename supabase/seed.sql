insert into public.profiles (id, email, display_name)
values ('00000000-0000-0000-0000-000000000001', 'artist@example.com', 'Kyxos Artist')
on conflict (id) do nothing;
