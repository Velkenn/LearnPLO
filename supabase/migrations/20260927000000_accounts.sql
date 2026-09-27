-- LearnPLO accounts: settings, stats, and a log of every answer.
-- Every table is locked down with row-level security: a signed-in user can only
-- read and write their own rows. Guests (not signed in) can't touch any of it.

-- One row per user. Display name is for a future leaderboard.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);

-- The settings sheet, stored as JSON so new settings don't need a migration.
create table public.user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Running counters shown in the score row (pot calls, reads, side pots, streak, times).
create table public.user_stats (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per answer, for averages and weak-spot tracking.
create table public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('pot', 'cut', 'read')),
  correct boolean not null,
  timed_out boolean not null default false,
  ms integer check (ms is null or ms >= 0),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index attempts_user_created_idx on public.attempts (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_stats enable row level security;
alter table public.attempts enable row level security;

create policy "Own profile: read" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Own profile: update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Own settings: read" on public.user_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own settings: insert" on public.user_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own settings: update" on public.user_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Own stats: read" on public.user_stats for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own stats: insert" on public.user_stats for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own stats: update" on public.user_stats for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Answers can be added and read back, never edited or deleted from the app.
create policy "Own attempts: read" on public.attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own attempts: insert" on public.attempts for insert to authenticated with check ((select auth.uid()) = user_id);

-- Create the profile row when someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
