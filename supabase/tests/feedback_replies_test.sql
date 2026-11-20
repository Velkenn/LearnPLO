-- Tests for 20261120000000_feedback_replies.sql. Run with supabase/tests/run.sh.
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
\set dealer '00000000-0000-0000-0000-0000000000f1'
\set other '00000000-0000-0000-0000-0000000000f2'
\set guest '55555555-5555-5555-5555-555555555555'
\set stranger '66666666-6666-6666-6666-666666666666'
insert into auth.users (id, email) values (:'admin', 'admin@feltready.test') on conflict do nothing;
insert into public.admins values (:'admin') on conflict do nothing;
insert into auth.users (id, email) values (:'dealer', 'dealer@x.test'), (:'other', 'other@x.test') on conflict do nothing;
delete from public.feedback;

-- ---- sending ----
set role anon;
select set_config('request.jwt.claim.sub', '', false);
insert into public.feedback (message, sender) values ('Guest message', :'guest');
select test.refused($$insert into public.feedback (message, done_at) values ('x', now())$$, 'a sender can''t mark their own message done');
select test.refused($$select * from public.feedback_replies$$, 'anon can''t read replies');
select test.refused($$select public.admin_feedback()$$, 'anon can''t list feedback');
select test.refused($$select public.admin_reply_feedback(1, 'hi')$$, 'anon can''t reply as the owner');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'dealer', false);
insert into public.feedback (message) values ('Member message');
select test.refused($$select public.feedback_thread(f) from public.feedback f$$, 'the thread helper isn''t callable from the API');
select test.refused($$select public.admin_reply_feedback(1, 'hi')$$, 'a member who isn''t an admin can''t reply');
select test.ok(public.my_feedback(null) = '[]'::jsonb, 'nothing to show before a reply');
reset role;
create temp table ids as select
  (select id from public.feedback where message = 'Guest message') as g,
  (select id from public.feedback where message = 'Member message') as m;
grant select on ids to anon, authenticated;

-- ---- the owner replies ----
set role authenticated;
select set_config('request.jwt.claim.sub', :'admin', false);
create temp table a as select public.admin_feedback() as j;
select test.ok(jsonb_array_length((select j from a)) = 2, 'the owner sees both messages');
select test.ok((select bool_and((x->>'in_app')::boolean) from a, jsonb_array_elements(j) x), 'both senders can get a reply in the app');
select test.ok((select x->>'email' from a, jsonb_array_elements(j) x where x->>'message' = 'Member message') = 'dealer@x.test', 'a member''s email comes from their account');
select public.admin_reply_feedback((select g from ids), '  Thanks! Which room?  ');
select public.admin_reply_feedback((select m from ids), 'Fixed now.');
reset role;
select test.ok((select done_at is not null from public.feedback where id = (select g from ids)), 'replying marks it done');
select test.ok((select body from public.feedback_replies where feedback_id = (select g from ids)) = 'Thanks! Which room?', 'the reply is trimmed');

-- ---- the guest reads it and writes back ----
set role anon;
select set_config('request.jwt.claim.sub', '', false);
create temp table mine as select public.my_feedback(:'guest') as j;
select test.ok(jsonb_array_length((select j from mine)) = 1, 'the guest sees only their own thread');
select test.ok((select j->0->'replies'->0->>'body' from mine) = 'Thanks! Which room?', 'with the owner''s reply');
select test.ok((select j->0->>'seen_at' from mine) is null, 'it''s unread');
select test.ok(public.my_feedback(:'stranger') = '[]'::jsonb, 'another browser''s id sees nothing');
select test.ok(public.my_feedback(null) = '[]'::jsonb, 'no id, no account: nothing');
select test.ok(not public.feedback_write_back((select m from ids), :'guest', 'sneaky'), 'a guest can''t write on someone else''s thread');
select public.feedback_seen(:'guest');
select test.ok(public.my_feedback(:'guest')->0->>'seen_at' is not null, 'opening the replies marks them read');
select test.ok(public.feedback_write_back((select g from ids), :'guest', 'Shuffle 214'), 'the guest writes back');
select test.ok(not public.feedback_write_back((select g from ids), :'guest', '   '), 'an empty write-back is refused');
reset role;
select test.ok((select done_at is null from public.feedback where id = (select g from ids)), 'writing back reopens it for the owner');
select test.ok((select count(*) from public.feedback_replies where feedback_id = (select g from ids)) = 2, 'the thread has both messages');

-- ---- the member, on any device ----
set role authenticated;
select set_config('request.jwt.claim.sub', :'dealer', false);
select test.ok(public.my_feedback(null)->0->>'message' = 'Member message', 'a member sees their thread without a browser id');
select set_config('request.jwt.claim.sub', :'other', false);
select test.ok(public.my_feedback(null) = '[]'::jsonb, 'another member sees nothing');
select test.ok(not public.feedback_write_back((select m from ids), null, 'hi'), 'another member can''t write back');

-- ---- the owner marks one done by hand ----
select set_config('request.jwt.claim.sub', :'admin', false);
select public.admin_feedback_done((select g from ids), true);
reset role;
select test.ok((select done_at is not null from public.feedback where id = (select g from ids)), 'marked done');
set role authenticated;
select public.admin_feedback_done((select g from ids), false);
reset role;
select test.ok((select done_at is null from public.feedback where id = (select g from ids)), 'and back again');

-- schools_test.sql makes its own test schema.
reset role;
set client_min_messages = warning;
drop schema test cascade;
delete from public.feedback;
delete from auth.users where id in (:'admin', :'dealer', :'other');
