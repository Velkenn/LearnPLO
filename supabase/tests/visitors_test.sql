-- Tests for 20261116100000_visitors.sql. Run with supabase/tests/run.sh (after the other tests,
-- in the same throwaway Postgres).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
set client_min_messages = warning;
drop schema if exists test cascade;
set client_min_messages = notice;
create schema test;
grant usage on schema test to anon, authenticated;
create function test.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end;
$$;
create function test.refused(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then raise notice 'ok - %', what; return;
  end;
  raise exception 'FAIL: % was allowed', what;
end;
$$;
grant execute on all functions in schema test to anon, authenticated;

\set admin '00000000-0000-0000-0000-00000000000a'
\set old '00000000-0000-0000-0000-0000000000d1'
\set fresh '00000000-0000-0000-0000-0000000000d2'
\set v1 '11111111-1111-1111-1111-111111111111'
\set v2 '22222222-2222-2222-2222-222222222222'
\set v3 '33333333-3333-3333-3333-333333333333'
\set v4 '44444444-4444-4444-4444-444444444444'
insert into auth.users (id, email) values (:'admin', 'admin@feltready.test') on conflict do nothing;
insert into public.admins values (:'admin') on conflict do nothing;
-- A member from long ago (signing in on a new device), and one about to sign up.
insert into auth.users (id, email, created_at) values (:'old', 'old@x.test', now() - interval '30 days');

-- ---- signed-out visitors ----
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.refused('select * from public.visitors', 'anon can''t read visitors');
select test.refused('insert into public.visitors (id) values (gen_random_uuid())', 'anon can''t insert visitors directly');
select test.refused($$select public.link_visitor('11111111-1111-1111-1111-111111111111')$$, 'anon can''t link a visitor');

select public.track_visit(:'v1', 'Reddit.com', '/plo/');
select public.track_visit(:'v1', 'reddit.com', '/plo/');                -- same browser again
select public.track_guest(:'v1', 12, null);
select public.track_guest(:'v1', 5000, 'signin');                        -- capped at 200 per call
select public.track_visit(:'v2', 'reddit.com', '/');
select public.track_guest(:'v2', 3, 'code');
select public.track_visit(:'v3', '', '/plo/');                           -- direct
select public.track_visit(:'v4', 'google.com', '/plo/');
select public.track_guest(:'v4', 30, 'code');
select public.track_guest('99999999-9999-9999-9999-999999999999', 10, 'code');  -- no row: nothing happens

reset role;
select test.ok((select answers from public.visitors where id = :'v1') = 212, 'answers add up, capped per call');
select test.ok((select days from public.visitors where id = :'v1') = 1, 'a second load the same day isn''t a new day');
select test.ok((select signin_at is not null and code_at is null from public.visitors where id = :'v1'), 'opening sign-in is noted');
select test.ok((select signin_at is not null and code_at is not null from public.visitors where id = :'v2'), 'asking for a code counts as opening sign-in too');
select test.ok((select source is null from public.visitors where id = :'v3'), 'no referrer is stored as null (direct)');
select test.ok((select count(*) from public.visitors) = 4, 'unknown ids don''t add rows');

-- Came back on a later day.
update public.visitors set last_seen = now() - interval '2 days' where id = :'v3';
set role anon;
select public.track_visit(:'v3', '', '/plo/');
reset role;
select test.ok((select days from public.visitors where id = :'v3') = 2, 'a visit on a later day counts');

-- ---- signing in ----
-- v2 signs up (a new account), v4 is an old member on a new device.
insert into auth.users (id, email) values (:'fresh', 'fresh@x.test');
set role authenticated;
select set_config('request.jwt.claim.sub', :'fresh', false);
select public.link_visitor(:'v2');
select set_config('request.jwt.claim.sub', :'old', false);
select public.link_visitor(:'v4');
select public.link_visitor(:'v2');                                       -- already linked: unchanged
select test.refused('select * from public.visitors', 'members can''t read visitors');
select test.refused('select public.admin_stats()', 'non-admins can''t see stats');
reset role;
select test.ok((select user_id from public.visitors where id = :'v2') = :'fresh', 'a linked visitor keeps its first account');

-- ---- the dashboard ----
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin', false);
create temp table s as select public.admin_stats() as j;
reset role;
select test.ok((select (j->'visitors'->>'visitors')::int from s) = 3, 'an old member on a new device isn''t a visitor');
select test.ok((select (j->'visitors'->>'played')::int from s) = 2, 'played: answered as a guest, or signed up');
select test.ok((select (j->'visitors'->>'opened_signin')::int from s) = 2, 'opened sign-in');
select test.ok((select (j->'visitors'->>'sent_code')::int from s) = 1, 'asked for a code');
select test.ok((select (j->'visitors'->>'signed_up')::int from s) = 1, 'signed up');
select test.ok((select (j->'visitors'->>'came_back')::int from s) = 1, 'came back without signing up');
select test.ok((select j->'visitors'->'left_after' from s) = '{"none": 1, "few": 0, "some": 0, "lots": 1}'::jsonb, 'how far the ones who left got');
select test.ok((select j->'visitors'->'sources'->0->>'source' from s) = 'reddit.com', 'top source first');
select test.ok((select (j->'visitors'->'sources'->0->>'signed_up')::int from s) = 1, 'sign-ups per source');
select test.ok((select (j->'days'->0->>'visitors')::int from s) = 3, 'visitors today in the daily table');
select test.ok((select j ? 'feedback' and j ? 'members' from s), 'the old dashboard numbers are still there');
