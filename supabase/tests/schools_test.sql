-- Tests for 20261116000000_schools.sql. Run with supabase/tests/run.sh, which loads
-- stub_supabase.sql and every migration into a throwaway Postgres first.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create schema test;
grant usage on schema test to anon, authenticated;
create function test.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end;
$$;
-- Runs a statement and passes if it raises insufficient_privilege (or any error when anything = true).
create function test.refused(stmt text, what text, anything boolean default false) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception
    when insufficient_privilege then raise notice 'ok - %', what; return;
    when others then
      if anything then raise notice 'ok - % (%)', what, sqlerrm; return; end if;
      raise exception 'FAIL: % raised % instead of a permission error', what, sqlerrm;
  end;
  raise exception 'FAIL: % was allowed', what;
end;
$$;
grant execute on all functions in schema test to anon, authenticated;

-- People: you (admin), a school owner and instructor, another room's owner, three students.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@feltready.test'),
  ('00000000-0000-0000-0000-0000000000a1', 'Owner@School.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'teach@school.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'boss@cardroom.test'),
  ('00000000-0000-0000-0000-0000000000c1', 's1@x.test'),
  ('00000000-0000-0000-0000-0000000000c2', 's2@x.test'),
  ('00000000-0000-0000-0000-0000000000c3', 's3@x.test');
insert into public.admins values ('00000000-0000-0000-0000-00000000000a');
\set admin '00000000-0000-0000-0000-00000000000a'
\set owner '00000000-0000-0000-0000-0000000000a1'
\set teach '00000000-0000-0000-0000-0000000000a2'
\set boss '00000000-0000-0000-0000-0000000000b1'
\set s1 '00000000-0000-0000-0000-0000000000c1'
\set s2 '00000000-0000-0000-0000-0000000000c2'
\set s3 '00000000-0000-0000-0000-0000000000c3'

set role authenticated;

-- Admins set up the schools ------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'owner', false);
select test.refused($$select public.admin_create_org('Mine')$$, 'a non-admin can''t create an organization');

select set_config('request.jwt.claim.sub', :'admin', false);
select public.admin_create_org('Texas Gaming Institute', 'school', 'owner@school.test', 2) as org1 \gset
select public.admin_create_org('Card Room', 'card_room', 'boss@cardroom.test') as org2 \gset
select public.admin_add_org_member(:'org1', 'teach@school.test');
select test.refused($$select public.admin_add_org_member('$$ || :'org1' || $$', 'nobody@x.test')$$,
                    'adding an email with no account is refused', true);

-- Instructors make classes -------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'owner', false);
select public.create_class(:'org1', 'December PLO')->>'join_code' as code1 \gset
select public.create_class(:'org1', 'December PLO, evenings') \g /dev/null
select test.ok(:'code1' ~ '^[A-HJ-NP-Z2-9]{8}$', 'codes are 8 characters with no 0, O, 1, I or L');
select (select c->>'id' from jsonb_array_elements(public.my_orgs()->0->'classes') c where c->>'join_code' = :'code1') as class1 \gset
select test.ok(public.my_orgs()->0->>'role' = 'owner', 'my_orgs shows the owner''s role');
select test.ok(jsonb_array_length(public.my_orgs()->0->'classes') = 2, 'my_orgs lists the school''s classes');

select set_config('request.jwt.claim.sub', :'teach', false);
select public.create_class(:'org1', 'Weekend bootcamp')->>'join_code' as code2 \gset
select (select c->>'id' from jsonb_array_elements(public.my_orgs()->0->'classes') c where c->>'join_code' = :'code2') as class2 \gset
select test.ok(public.my_orgs()->0->>'role' = 'instructor', 'an added instructor can make classes too');

select set_config('request.jwt.claim.sub', :'boss', false);
select test.refused($$select public.create_class('$$ || :'org1' || $$', 'Sneaky')$$, 'another room can''t add classes to this school');
select test.ok(jsonb_array_length(public.my_orgs()) = 1 and public.my_orgs()->0->>'name' = 'Card Room',
               'my_orgs only shows the caller''s own organizations');

-- A student joins ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'s1', false);
select test.ok(public.class_preview('ZZZZZZZZ')->>'error' = 'not_found', 'a wrong code isn''t found');
select test.ok((public.class_preview(lower(substr(:'code1', 1, 4)) || '-' || lower(substr(:'code1', 5))) ->> 'ok')::boolean,
               'codes work in lower case with a dash');
select test.ok(public.class_preview(:'code1')->'org'->>'name' = 'Texas Gaming Institute', 'the preview names the school');
select test.ok(public.join_class(:'code1', '   ')->>'error' = 'bad_name', 'a blank name is refused');
select test.ok((public.join_class(:'code1', 'Sam')->>'ok')::boolean, 'a student joins with the code');
select test.ok((public.class_preview(:'code1')->>'already_in')::boolean, 'the preview knows they''re in');
select test.ok(jsonb_array_length(public.my_classes()) = 1, 'my_classes lists the class');
select test.refused($$select public.class_roster('$$ || :'class1' || $$')$$, 'a student can''t see the roster');

-- Answers: one from before joining (the school mustn't see it), three after.
reset role;
insert into public.attempts (user_id, kind, correct, ms, created_at, detail, game) values
  (:'s1', 'pot', false, 9000, now() - interval '2 days', '{"miss":"old"}', 'plo'),
  (:'s1', 'pot', true, 4000, now(), null, 'plo'),
  (:'s1', 'pot', false, 6000, now(), '{"miss":"forgot_call"}', 'plo'),
  (:'s1', 'read', true, 3000, now(), null, 'plo');
set role authenticated;

select set_config('request.jwt.claim.sub', :'teach', false);
select public.class_roster(:'class1')->'students'->0->'stats' as st \gset
select test.ok((:'st'::jsonb->>'answers')::int = 3, 'the roster counts only answers since joining');
select test.ok((:'st'::jsonb->>'right')::int = 2, 'the roster counts right answers');
select test.ok(:'st'::jsonb->'misses'->0->>'miss' = 'forgot_call', 'the roster lists mistakes since joining');
select test.ok(jsonb_array_length(:'st'::jsonb->'misses') = 1, 'mistakes from before joining are left out');
select test.ok((select (d->>'avg_ms')::int from jsonb_array_elements(:'st'::jsonb->'drills') d where d->>'kind' = 'pot') = 5000,
               'the roster averages time per question kind');
select test.ok(public.class_roster(:'class1')->'students'->0->>'name' = 'Sam', 'the roster shows the student''s chosen name');

select set_config('request.jwt.claim.sub', :'boss', false);
select test.refused($$select public.class_roster('$$ || :'class1' || $$')$$, 'another room can''t see this school''s roster');

-- Seats --------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'s2', false);
select test.ok((public.join_class(:'code1', 'Pat')->>'ok')::boolean, 'a second student takes the second seat');
select set_config('request.jwt.claim.sub', :'s3', false);
select test.ok(public.join_class(:'code1', 'Lee')->>'error' = 'full', 'a third student is refused when seats are full');
select set_config('request.jwt.claim.sub', :'s1', false);
select test.ok((public.join_class(:'code2', 'Sam')->>'ok')::boolean, 'a student already at the school can join another class there');
select set_config('request.jwt.claim.sub', :'owner', false);
select test.ok((public.my_orgs()->0->>'seats_used')::int = 2, 'that student still counts as one seat');

-- Leaving ------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'s1', false);
select public.leave_class(:'class1');
select set_config('request.jwt.claim.sub', :'owner', false);
select test.ok((select s->'stats' from jsonb_array_elements(public.class_roster(:'class1')->'students') s where s->>'name' = 'Sam') = 'null'::jsonb,
               'after leaving, the school sees no answers');
select test.ok((public.my_orgs()->0->>'seats_used')::int = 2, 'still in the other class, so still a seat');
select set_config('request.jwt.claim.sub', :'s1', false);
select public.leave_class(:'class2');
select set_config('request.jwt.claim.sub', :'s3', false);
select test.ok((public.join_class(:'code1', 'Lee')->>'ok')::boolean, 'leaving every class frees the seat');

-- Rejoining starts a new window.
select set_config('request.jwt.claim.sub', :'s3', false);
select public.leave_class(:'class1');
select set_config('request.jwt.claim.sub', :'s1', false);
select test.ok((public.join_class(:'code1', 'Sammy')->>'ok')::boolean, 'a student can rejoin');
select set_config('request.jwt.claim.sub', :'owner', false);
select test.ok((select (s->'stats'->>'answers')::int from jsonb_array_elements(public.class_roster(:'class1')->'students') s where s->>'name' = 'Sammy') = 0,
               'after rejoining, earlier answers stay hidden');

-- Instructors remove students.
select public.remove_student(:'class1', :'s2');
select test.ok((public.my_orgs()->0->>'seats_used')::int = 1, 'removing a student frees their seat');

-- Codes and closing --------------------------------------------------------------------------
select public.new_class_code(:'class1') as code1b \gset
select set_config('request.jwt.claim.sub', :'s2', false);
select test.ok(public.class_preview(:'code1')->>'error' = 'not_found', 'a replaced code stops working');
select test.ok((public.class_preview(:'code1b')->>'ok')::boolean, 'the new code works');
select set_config('request.jwt.claim.sub', :'owner', false);
select public.new_class_code(:'class1', now() - interval '1 minute') as code1c \gset
select set_config('request.jwt.claim.sub', :'s2', false);
select test.ok(public.join_class(:'code1c', 'Pat')->>'error' = 'expired', 'an expired code is refused');
select set_config('request.jwt.claim.sub', :'owner', false);
select public.set_class(:'class2', is_active => false);
select set_config('request.jwt.claim.sub', :'s2', false);
select test.ok(public.join_class(:'code2', 'Pat')->>'error' = 'closed', 'a closed class takes no one new');
select test.ok(public.class_preview(:'code2')->>'error' = 'closed', 'the preview says it''s closed');
select set_config('request.jwt.claim.sub', :'s1', false);
select test.ok(jsonb_array_length(public.my_classes()) = 1, 'students already in stay in');

-- Guessing -----------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :'s3', false);
select public.class_preview('WRONG' || g) from generate_series(1, 10) g \g /dev/null
select test.ok(public.join_class(:'code1b', 'Lee')->>'error' = 'too_many_tries', 'ten wrong codes in an hour locks out guessing');
reset role;
select test.ok((select count(*) from public.join_tries where user_id = :'s3') = 10, 'wrong codes are counted');
set role authenticated;

-- The API can't go around the functions ------------------------------------------------------
select test.refused('select * from public.classes', 'members can''t read classes (and their codes) directly');
select test.refused('select * from public.class_members', 'members can''t read class members directly');
select test.refused('select * from public.organizations', 'members can''t read organizations directly');
select test.refused($$insert into public.class_members (class_id, user_id, display_name) values ('$$ || :'class1' || $$', '$$ || :'s3' || $$', 'x')$$,
                    'members can''t add themselves to a class directly');
select test.refused('select public.new_join_code()', 'helpers aren''t callable through the API');
select test.refused($$select public.org_seats_used('$$ || :'org1' || $$')$$, 'seat counts aren''t callable through the API');
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.refused($$select public.join_class('ABCDEFGH', 'x')$$, 'signed-out visitors can''t call join_class');
select test.refused('select public.my_orgs()', 'signed-out visitors can''t call my_orgs');
reset role;

\echo 'all schools tests passed'
