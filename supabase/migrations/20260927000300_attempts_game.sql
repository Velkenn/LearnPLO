-- Which game each answer belongs to, so the weak spots page (and later games) can filter by it.
-- Existing rows are all pot limit Omaha. The kind check stays as it is for now.
alter table public.attempts
  add column game text not null default 'plo' check (game in ('plo'));

-- The weak spots page reads one member's latest answers for one game.
drop index if exists public.attempts_user_created_idx;
create index attempts_user_game_created_idx on public.attempts (user_id, game, created_at desc);

-- The table-level grants in 20260927000200_api_grants.sql already cover the new column.
