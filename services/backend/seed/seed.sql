-- Supabase local seed marker. The browser E2E creates its owner and project through
-- the same public API used by Studio, so no production-like auth identity is hard-coded.
-- CI may set app.kyxos_seed_owner before loading this file to add project fixtures.

do $$
begin
  raise notice 'Kyxos Studio schema, RLS, storage bucket and functions are ready for API-driven seed data.';
end $$;
