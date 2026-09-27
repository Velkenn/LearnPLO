-- Let signed-in users reach the tables through the API. This project doesn't expose new
-- tables automatically, so without these grants every request failed with
-- "permission denied for table" before row-level security was even checked.
-- Row-level security still limits each user to their own rows.

revoke all on public.profiles, public.user_settings, public.user_stats, public.attempts from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.user_settings, public.user_stats to authenticated;
grant select, insert on public.attempts to authenticated;

grant all on public.profiles, public.user_settings, public.user_stats, public.attempts to service_role;
