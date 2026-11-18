-- Answers from signed-out visitors, by day, so the stats dashboard's daily table counts everyone
-- who answered, not only members.
--
-- visitor_days: one row per visitor per day (Central time) they answered, with how many answers.
-- Server-only, like visitors. track_guest() now adds to today's row as well as the visitor's total.
-- admin_stats() gains 'guest_answers' (all time) and, per day, 'guest_answers' and 'players'
-- (members and visitors who answered at least one question; a visitor who signed in counts once,
-- as the account it signed in to).

create table public.visitor_days (
  visitor uuid not null references public.visitors on delete cascade,
  day date not null,
  answers int not null default 0,
  primary key (visitor, day)
);
create index visitor_days_day on public.visitor_days (day);
alter table public.visitor_days enable row level security;
revoke all on public.visitor_days from anon, authenticated;
grant all on public.visitor_days to service_role;

-- Answers counted before this table existed: put each visitor's total on the last day they were seen.
-- (Every visitor with answers so far was seen on one day only, so nothing is misplaced.)
insert into public.visitor_days (visitor, day, answers)
select id, (last_seen at time zone 'America/Chicago')::date, answers
from public.visitors where answers > 0;

create or replace function public.track_guest(v uuid, answers int, step text)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  -- One call never adds more than a visit could plausibly answer between sends.
  n int := greatest(0, least(coalesce(track_guest.answers, 0), 200));
begin
  if v is null then return; end if;
  update public.visitors set
    answers = public.visitors.answers + n,
    signin_at = case when step in ('signin', 'code') then coalesce(signin_at, now()) else signin_at end,
    code_at = case when step = 'code' then coalesce(code_at, now()) else code_at end,
    last_seen = now()
  where id = v;
  if found and n > 0 then
    insert into public.visitor_days (visitor, day, answers)
    values (v, (now() at time zone 'America/Chicago')::date, n)
    on conflict (visitor, day) do update set answers = public.visitor_days.answers + excluded.answers;
  end if;
end;
$$;

revoke execute on function public.track_guest(uuid, int, text) from public;
grant execute on function public.track_guest(uuid, int, text) to anon, authenticated;

-- The dashboard. Same as 20261116100000_visitors.sql, plus the guest answer counts.
create or replace function public.admin_stats()
returns jsonb
language plpgsql stable
security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  since timestamptz := ((today - 6)::timestamp at time zone 'America/Chicago');
begin
  if not public.is_admin() then
    raise exception 'Only admins can see stats' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', today,
    'members', (select count(*) from auth.users),
    'members_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'answers', (select count(*) from public.attempts),
    'guest_answers', (select coalesce(sum(answers), 0) from public.visitors),
    'daily_runs', (select count(*) from public.daily_entries where submitted_at is not null),
    'days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'visitors', (select count(*) from public.visitors v left join auth.users u on u.id = v.user_id
                     where (v.first_seen at time zone 'America/Chicago')::date = d.day
                       and (u.id is null or u.created_at >= v.first_seen - interval '5 minutes')),
        'new_members', (select count(*) from auth.users u where (u.created_at at time zone 'America/Chicago')::date = d.day),
        'active', (select count(distinct a.user_id) from public.attempts a where (a.created_at at time zone 'America/Chicago')::date = d.day),
        'answers', (select count(*) from public.attempts a where (a.created_at at time zone 'America/Chicago')::date = d.day),
        'guest_answers', (select coalesce(sum(vd.answers), 0) from public.visitor_days vd where vd.day = d.day),
        'players', (select count(distinct who) from (
                      select a.user_id as who from public.attempts a
                      where (a.created_at at time zone 'America/Chicago')::date = d.day
                      union all
                      select coalesce(v.user_id, v.id) from public.visitor_days vd join public.visitors v on v.id = vd.visitor
                      where vd.day = d.day and vd.answers > 0
                    ) p),
        'daily_players', (select count(*) from public.daily_entries e where e.day = d.day and e.submitted_at is not null),
        'daily_avg', (select round(avg(e.right_count::numeric / nullif(e.total, 0)) * 100) from public.daily_entries e where e.day = d.day and e.submitted_at is not null)
      ) order by d.day desc)
      from (select generate_series(today - 13, today, interval '1 day')::date as day) d
    ),
    'visitors', (
      with w as (
        select v.*, (u.id is not null) as signed_up
        from public.visitors v left join auth.users u on u.id = v.user_id
        where v.first_seen >= since
          and (u.id is null or u.created_at >= v.first_seen - interval '5 minutes')
      )
      select jsonb_build_object(
        'visitors', (select count(*) from w),
        'played', (select count(*) from w where answers > 0 or signed_up),
        'opened_signin', (select count(*) from w where signin_at is not null or signed_up),
        'sent_code', (select count(*) from w where code_at is not null or signed_up),
        'signed_up', (select count(*) from w where signed_up),
        'came_back', (select count(*) from w where days > 1 and not signed_up),
        -- How far the ones who didn't sign up got.
        'left_after', jsonb_build_object(
          'none', (select count(*) from w where not signed_up and answers = 0),
          'few', (select count(*) from w where not signed_up and answers between 1 and 9),
          'some', (select count(*) from w where not signed_up and answers between 10 and 49),
          'lots', (select count(*) from w where not signed_up and answers >= 50)
        ),
        'sources', coalesce((
          select jsonb_agg(s order by (s->>'visitors')::int desc) from (
            select jsonb_build_object('source', coalesce(source, 'direct'), 'visitors', count(*),
                     'played', count(*) filter (where answers > 0 or signed_up),
                     'signed_up', count(*) filter (where signed_up)) as s
            from w group by coalesce(source, 'direct') order by count(*) desc limit 8
          ) t
        ), '[]'::jsonb)
      )
    ),
    'feedback', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'at', f.created_at, 'message', f.message,
        'email', coalesce(f.email, u.email), 'member', f.user_id is not null, 'context', f.context
      ) order by f.created_at desc), '[]'::jsonb)
      from (select * from public.feedback order by created_at desc limit 50) f
      left join auth.users u on u.id = f.user_id
    )
  );
end;
$$;
