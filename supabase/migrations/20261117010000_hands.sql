-- Hands played, for the stats dashboard: a hand counts when it ends (everyone folded to one
-- player, or the last pot was shipped), in either game and in the daily challenge.
-- Counting starts with this migration; there's nothing earlier to fill in.
--
-- Signed-out visitors: visitors.hands and visitor_days.hands, sent by track_guest() along with
-- answers (it gains a hands argument, defaulting to 0 so pages loaded before this still work).
-- Members: member_days, one row per member per day (Central time) per game, written only through
-- count_hands(n, game), which counts for the signed-in member.
-- admin_stats() gains 'hands' (all time) and 'hands' per day, members and visitors together.

alter table public.visitors add column hands int not null default 0;
alter table public.visitor_days add column hands int not null default 0;

create table public.member_days (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  game text not null check (game in ('plo', 'bomb')),
  hands int not null default 0,
  primary key (user_id, day, game)
);
create index member_days_day on public.member_days (day);
alter table public.member_days enable row level security;
revoke all on public.member_days from anon, authenticated;
grant all on public.member_days to service_role;

drop function public.track_guest(uuid, int, text);
create function public.track_guest(v uuid, answers int, step text, hands int default 0)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  -- One call never adds more than a visit could plausibly play between sends.
  n int := greatest(0, least(coalesce(track_guest.answers, 0), 200));
  h int := greatest(0, least(coalesce(track_guest.hands, 0), 50));
begin
  if v is null then return; end if;
  update public.visitors set
    answers = public.visitors.answers + n,
    hands = public.visitors.hands + h,
    signin_at = case when step in ('signin', 'code') then coalesce(signin_at, now()) else signin_at end,
    code_at = case when step = 'code' then coalesce(code_at, now()) else code_at end,
    last_seen = now()
  where id = v;
  if found and (n > 0 or h > 0) then
    insert into public.visitor_days (visitor, day, answers, hands)
    values (v, (now() at time zone 'America/Chicago')::date, n, h)
    on conflict (visitor, day) do update set
      answers = public.visitor_days.answers + excluded.answers,
      hands = public.visitor_days.hands + excluded.hands;
  end if;
end;
$$;
revoke execute on function public.track_guest(uuid, int, text, int) from public;
grant execute on function public.track_guest(uuid, int, text, int) to anon, authenticated;

create function public.count_hands(n int, game text)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  h int := greatest(0, least(coalesce(count_hands.n, 0), 50));
begin
  if me is null or h = 0 or count_hands.game not in ('plo', 'bomb') then return; end if;
  insert into public.member_days (user_id, day, game, hands)
  values (me, (now() at time zone 'America/Chicago')::date, count_hands.game, h)
  on conflict on constraint member_days_pkey do update set hands = public.member_days.hands + excluded.hands;
end;
$$;
revoke execute on function public.count_hands(int, text) from public, anon;
grant execute on function public.count_hands(int, text) to authenticated;

-- The dashboard. Same as 20261117000000_visitor_days.sql, plus hands.
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
    'hands', (select coalesce(sum(hands), 0) from public.member_days) + (select coalesce(sum(hands), 0) from public.visitors),
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
        'hands', (select coalesce(sum(m.hands), 0) from public.member_days m where m.day = d.day)
               + (select coalesce(sum(vd.hands), 0) from public.visitor_days vd where vd.day = d.day),
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
