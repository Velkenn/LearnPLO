-- Feedback from dealers, and a stats dashboard for the owner.
--
-- feedback: anyone (signed in or not) can send a message; nobody can read it through the API.
-- admins:   who can see the dashboard. Server-only. Add yourself once in the SQL editor:
--             insert into public.admins select id from auth.users where email = 'you@example.com';
-- is_admin() and admin_stats(): the dashboard's two calls. admin_stats() refuses anyone not in admins.

create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references auth.users on delete set null,
  message text not null check (char_length(message) between 1 and 2000),
  email text check (email is null or char_length(email) <= 200),
  context jsonb check (context is null or pg_column_size(context) <= 2000)
);
alter table public.feedback enable row level security;
create policy "Anyone can send feedback" on public.feedback for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon, authenticated;
grant all on public.feedback to service_role;

create table public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
grant all on public.admins to service_role;

create function public.is_admin()
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

-- Days are Central time, like the daily challenge.
create function public.admin_stats()
returns jsonb
language plpgsql stable
security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
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
        'new_members', (select count(*) from auth.users u where (u.created_at at time zone 'America/Chicago')::date = d.day),
        'active', (select count(distinct a.user_id) from public.attempts a where (a.created_at at time zone 'America/Chicago')::date = d.day),
        'answers', (select count(*) from public.attempts a where (a.created_at at time zone 'America/Chicago')::date = d.day),
        'daily_players', (select count(*) from public.daily_entries e where e.day = d.day and e.submitted_at is not null),
        'daily_avg', (select round(avg(e.right_count::numeric / nullif(e.total, 0)) * 100) from public.daily_entries e where e.day = d.day and e.submitted_at is not null)
      ) order by d.day desc)
      from (select generate_series(today - 13, today, interval '1 day')::date as day) d
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

revoke execute on function public.is_admin(), public.admin_stats() from public, anon;
grant execute on function public.is_admin(), public.admin_stats() to authenticated;
