-- Double board bomb pots, the second game.
-- Answers: a new game id ('bomb') and a new question ('split': how much of a pot goes to the top board).
alter table public.attempts drop constraint attempts_game_check;
alter table public.attempts add constraint attempts_game_check check (game in ('plo', 'bomb'));
alter table public.attempts drop constraint attempts_kind_check;
alter table public.attempts add constraint attempts_kind_check check (kind in ('pot', 'cut', 'read', 'split'));

-- Score counters are kept per game: one row per member per game. Existing rows are pot limit
-- Omaha. Pages from before this change save without a game, which the default makes 'plo', and
-- their upsert (on the primary key) still lands on the right row.
alter table public.user_stats add column game text not null default 'plo' check (game in ('plo', 'bomb'));
alter table public.user_stats drop constraint user_stats_pkey;
alter table public.user_stats add primary key (user_id, game);

-- Row-level security policies check user_id only, so they cover every game's row. The table-level
-- grants in 20260927000200_api_grants.sql cover the new column.
