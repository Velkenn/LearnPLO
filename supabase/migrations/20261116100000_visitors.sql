-- Visitors who haven't signed up, for the owner's stats dashboard.
--
-- Each signed-out browser gets a random id (kept in localStorage; no cookies, no IP addresses,
-- nothing that names a person). One row per browser records where it came from, how many
-- questions it answered as a guest, whether it opened the sign-in box or asked for a code, and
-- which account it signed in to, if it ever did. Members who are already signed in never get a row.
--
-- visitors: server-only. The page writes through three functions that only ever touch one row:
--   track_visit(id, source, landing)  a page load while signed out (adds the row the first time)
--   track_guest(id, answers, step)    answers since the last call, and a sign-in step reached
--   link_visitor(id)                  signed in: ties the row to the account
-- admin_stats() gains a 'visitors' block (and a visitors count per day), still admins only.

create table public.visitors (
  id uuid primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- Days (Central time) this browser came back on, counting the first.
  days int not null default 1,
  source text check (source is null or char_length(source) <= 80),
  landing text check (landing is null or char_length(landing) <= 40),
  answers int not null default 0,
  signin_at timestamptz,   -- opened the sign-in box
  code_at timestamptz,     -- asked for an emailed code (or tried a passkey)
  user_id uuid references auth.users on delete set null,
  linked_at timestamptz
);
create index visitors_first_seen on public.visitors (first_seen);
create index visitors_user on public.visitors (user_id) where user_id is not null;
alter table public.visitors enable row level security;
revoke all on public.visitors from anon, authenticated;
grant all on public.visitors to service_role;

create function public.track_visit(v uuid, source text, landing text)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
begin
  if v is null then return; end if;
  insert into public.visitors (id, source, landing)
  values (v, nullif(left(lower(trim(source)), 80), ''), nullif(left(trim(landing), 40), ''))
  on conflict (id) do update set
    days = public.visitors.days
      + case when (public.visitors.last_seen at time zone 'America/Chicago')::date < today then 1 else 0 end,
    last_seen = now();
end;
$$;

create function public.track_guest(v uuid, answers int, step text)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
begin
  if v is null then return; end if;
  update public.visitors set
    -- One call never adds more than a visit could plausibly answer between sends.
    answers = public.visitors.answers + greatest(0, least(coalesce(track_guest.answers, 0), 200)),
    signin_at = case when step in ('signin', 'code') then coalesce(signin_at, now()) else signin_at end,
    code_at = case when step = 'code' then coalesce(code_at, now()) else code_at end,
    last_seen = now()
  where id = v;
end;
$$;

create function public.link_visitor(v uuid)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
begin
  if v is null or (select auth.uid()) is null then return; end if;
  update public.visitors set user_id = (select auth.uid()), linked_at = now()
  where id = v and user_id is null;
end;
$$;

revoke execute on function public.track_visit(uuid, text, text), public.track_guest(uuid, int, text) from public;
grant execute on function public.track_visit(uuid, text, text), public.track_guest(uuid, int, text) to anon, authenticated;
revoke execute on function public.link_visitor(uuid) from public, anon;
grant execute on function public.link_visitor(uuid) to authenticated;

-- The dashboard. Same as before, plus 'visitors' (last 7 days) and a visitors count per day.
-- "Signed up" means the browser signed in to an account made after its first visit. A browser
-- that signed in to an older account belongs to an existing member on a new device, so it's
-- left out of the visitor numbers altogether.
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
