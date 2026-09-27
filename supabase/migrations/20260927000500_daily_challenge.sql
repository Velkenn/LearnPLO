-- Daily challenge: one deal per game per day, and each member's run at it.
-- Only the daily edge function (service role) reads or writes these. The seed stays on the
-- server until someone starts, and scores are written only after the server grades the answers.
-- So there are no policies and no grants for anon or authenticated.

create table public.daily_challenges (
  game text not null default 'plo' check (game in ('plo')),
  day date not null,                       -- the challenge day, midnight to midnight Central
  seed bigint not null check (seed >= 0 and seed < 4294967296),
  version integer not null,                -- CHALLENGE_VERSION in src/engine/challenge.ts
  created_at timestamptz not null default now(),
  primary key (game, day)
);

create table public.daily_entries (
  game text not null default 'plo',
  day date not null,
  user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  right_count integer check (right_count >= 0),
  total integer check (total >= 0),
  ms integer check (ms >= 0),              -- server time from start to submit
  answers jsonb,
  primary key (game, day, user_id),
  foreign key (game, day) references public.daily_challenges (game, day) on delete cascade
);
-- The leaderboard: most right, then fastest.
create index daily_entries_board_idx on public.daily_entries (game, day, right_count desc, ms)
  where submitted_at is not null;

alter table public.daily_challenges enable row level security;
alter table public.daily_entries enable row level security;

revoke all on public.daily_challenges, public.daily_entries from anon, authenticated;
grant all on public.daily_challenges, public.daily_entries to service_role;
