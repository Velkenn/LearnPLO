-- rls_auto_enable() is Supabase's event trigger that turns on row-level security for every new
-- table in public (event trigger ensure_rls). It runs on its own after CREATE TABLE and never needs
-- to be called through the API, so nobody but the owner gets EXECUTE. Event triggers fire
-- regardless of this grant.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
