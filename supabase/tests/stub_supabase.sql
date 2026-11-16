-- A stand-in for the parts of Supabase the migrations rely on, so they can run on a plain
-- Postgres: the API roles, auth.users, auth.uid(), and the rls_auto_enable() event trigger
-- function. auth.uid() reads the user id from request.jwt.claim.sub, like Supabase's does;
-- tests set it with: select set_config('request.jwt.claim.sub', '<uuid>', false);

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's worst case: everything new in public is open to the API until a migration says
-- otherwise. The migrations revoke what they don't mean to expose.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end; $$;
