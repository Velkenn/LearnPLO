-- Answering feedback. The owner replies from the stats dashboard; the sender sees the reply the
-- next time they open a game page (a note under the scores, and the thread in the feedback
-- sheet), and can write back.
--
-- Who a message belongs to: the member who sent it (feedback.user_id), or, for a signed-out
-- sender, a random id their browser keeps in localStorage and sends with each message
-- (feedback.sender). Nothing else can read a thread: every read and write goes through the
-- functions below.
--
-- feedback gains:
--   sender   the signed-out browser's random id (members' messages may carry one too)
--   seen_at  when the sender last opened their replies (a reply after it is unread)
--   done_at  the owner marked it handled (replying does this; the sender writing back clears it)
-- feedback_replies: the thread. Server-only, like feedback itself.
--
-- Sender's calls (anon or member): my_feedback(sender), feedback_seen(sender),
--   feedback_write_back(id, sender, body).
-- Owner's calls (admins only): admin_feedback(), admin_reply_feedback(id, body),
--   admin_feedback_done(id, done).

alter table public.feedback
  add column sender uuid,
  add column seen_at timestamptz,
  add column done_at timestamptz;
create index feedback_sender_idx on public.feedback (sender) where sender is not null;
create index feedback_user_idx on public.feedback (user_id) where user_id is not null;

-- Senders may only fill in their own columns, never seen_at or done_at.
revoke insert on public.feedback from anon, authenticated;
grant insert (message, email, context, user_id, sender) on public.feedback to anon, authenticated;

create table public.feedback_replies (
  id bigint generated always as identity primary key,
  feedback_id bigint not null references public.feedback on delete cascade,
  created_at timestamptz not null default now(),
  from_owner boolean not null,
  body text not null check (char_length(body) between 1 and 2000)
);
create index feedback_replies_thread_idx on public.feedback_replies (feedback_id, created_at);
alter table public.feedback_replies enable row level security;
revoke all on public.feedback_replies from anon, authenticated;
grant all on public.feedback_replies to service_role;

-- One thread as JSON: the message, then every reply in order.
create function public.feedback_thread(f public.feedback)
returns jsonb
language sql stable
security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', r.created_at, 'body', r.body, 'owner', r.from_owner) order by r.created_at, r.id), '[]'::jsonb)
  from public.feedback_replies r where r.feedback_id = f.id;
$$;
revoke execute on function public.feedback_thread(public.feedback) from public, anon, authenticated;

-- Whether the caller sent this message: their account, or their browser's id.
create function public.feedback_mine(f public.feedback, p_sender uuid)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select coalesce(f.user_id = (select auth.uid()), false)
      or coalesce(f.sender = p_sender, false);
$$;
revoke execute on function public.feedback_mine(public.feedback, uuid) from public, anon, authenticated;

-- ---- the sender ----

/** The caller's 10 latest messages that have a reply, newest first. */
create function public.my_feedback(p_sender uuid default null)
returns jsonb
language sql stable
security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(t.j order by t.at desc), '[]'::jsonb) from (
    select f.created_at as at, jsonb_build_object(
      'id', f.id, 'at', f.created_at, 'message', f.message, 'seen_at', f.seen_at,
      'replies', public.feedback_thread(f)
    ) as j
    from public.feedback f
    where public.feedback_mine(f, p_sender)
      and exists (select 1 from public.feedback_replies r where r.feedback_id = f.id and r.from_owner)
    order by f.created_at desc
    limit 10
  ) t;
$$;

/** The sender opened their replies: everything so far is read. */
create function public.feedback_seen(p_sender uuid default null)
returns void
language sql
security definer set search_path = ''
as $$
  update public.feedback f set seen_at = now() where public.feedback_mine(f, p_sender);
$$;

/** The sender writes back on a thread the owner has answered. Returns false if they can't. */
create function public.feedback_write_back(p_id bigint, p_sender uuid, p_body text)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  f public.feedback;
  body text := btrim(coalesce(p_body, ''));
begin
  select * into f from public.feedback where id = p_id;
  if not found or not public.feedback_mine(f, p_sender) then return false; end if;
  if char_length(body) not between 1 and 2000 then return false; end if;
  -- Only on a thread the owner has answered, and not without end.
  if not exists (select 1 from public.feedback_replies r where r.feedback_id = p_id and r.from_owner) then return false; end if;
  if (select count(*) from public.feedback_replies r where r.feedback_id = p_id) >= 40 then return false; end if;
  insert into public.feedback_replies (feedback_id, from_owner, body) values (p_id, false, body);
  update public.feedback set done_at = null, seen_at = now() where id = p_id;
  return true;
end;
$$;

revoke execute on function public.my_feedback(uuid), public.feedback_seen(uuid), public.feedback_write_back(bigint, uuid, text) from public;
grant execute on function public.my_feedback(uuid), public.feedback_seen(uuid), public.feedback_write_back(bigint, uuid, text) to anon, authenticated;

-- ---- the owner ----

/** The 50 latest messages with their threads, and whether a reply can reach the sender in the app. */
create function public.admin_feedback()
returns jsonb
language plpgsql stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see feedback' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'at', f.created_at, 'message', f.message,
      'email', coalesce(f.email, u.email), 'member', f.user_id is not null, 'context', f.context,
      'in_app', f.user_id is not null or f.sender is not null,
      'seen_at', f.seen_at, 'done_at', f.done_at, 'replies', public.feedback_thread(f)
    ) order by f.created_at desc), '[]'::jsonb)
    from (select * from public.feedback order by created_at desc limit 50) f
    left join auth.users u on u.id = f.user_id
  );
end;
$$;

/** Reply to a message. Replying marks it done. */
create function public.admin_reply_feedback(p_id bigint, p_body text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can reply to feedback' using errcode = '42501';
  end if;
  if char_length(body) not between 1 and 2000 then
    raise exception 'A reply is 1 to 2000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.feedback where id = p_id) then
    raise exception 'No such feedback' using errcode = 'P0002';
  end if;
  insert into public.feedback_replies (feedback_id, from_owner, body) values (p_id, true, body);
  update public.feedback set done_at = now() where id = p_id;
end;
$$;

/** Mark a message handled (or not) without replying, for example after answering by email. */
create function public.admin_feedback_done(p_id bigint, p_done boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change feedback' using errcode = '42501';
  end if;
  update public.feedback set done_at = case when p_done then now() end where id = p_id;
end;
$$;

revoke execute on function public.admin_feedback(), public.admin_reply_feedback(bigint, text), public.admin_feedback_done(bigint, boolean) from public, anon;
grant execute on function public.admin_feedback(), public.admin_reply_feedback(bigint, text), public.admin_feedback_done(bigint, boolean) to authenticated;
