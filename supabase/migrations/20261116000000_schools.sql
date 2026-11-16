-- Schools and card rooms: link a member's account to an instructor's class.
--
-- organizations  a dealer school or card room. An admin creates it (admin_create_org).
-- org_members    who runs it: 'owner' or 'instructor'. An admin adds them (admin_add_org_member).
-- classes        a group of students with a join code (8 letters and digits, shown as XXXX-XXXX).
--                Owners and instructors make them (create_class).
-- class_members  students who joined with the code (join_class). The row stays when they leave
--                (left_at), so the seat frees up and the school stops seeing their answers.
-- join_tries     wrong codes typed, so nobody can guess codes by trying them in bulk.
--
-- Every table is server-only: row-level security on, no policies, no grants to anon or
-- authenticated. All reads and writes go through the security definer functions below, which
-- check who is calling. A school only ever sees a student's answers from while the student is
-- in one of its classes: from joined_at on, and nothing once they leave. Rejoining starts a new
-- window from the new join.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'school' check (kind in ('school', 'card_room')),
  -- Most students in its classes at once (counted once across classes). Null: no limit.
  seat_limit integer check (seat_limit is null or seat_limit >= 0),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'instructor' check (role in ('owner', 'instructor')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{8}$'),
  code_expires_at timestamptz,            -- null: the code works until it's replaced or the class closes
  active boolean not null default true,   -- a closed class takes no new students; its roster stays
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index classes_org_idx on public.classes (org_id);

create table public.class_members (
  class_id uuid not null references public.classes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),  -- the name the instructor sees
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (class_id, user_id)
);
create index class_members_user_idx on public.class_members (user_id);

create table public.join_tries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index join_tries_user_at_idx on public.join_tries (user_id, at desc);

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.join_tries enable row level security;

revoke all on public.organizations, public.org_members, public.classes, public.class_members, public.join_tries
  from anon, authenticated;
grant all on public.organizations, public.org_members, public.classes, public.class_members, public.join_tries
  to service_role;


-- ---------------------------------------------------------------------------------------------
-- Helpers. Only the functions below call these; they aren't exposed through the API.

-- 'XXXX-XXXX', 'xxxx xxxx' and 'XXXXXXXX' all mean the same code.
create function public.normalize_join_code(code text)
returns text
language sql immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- A new unused code. No 0/O or 1/I/L, so it can be read aloud or off a whiteboard.
create function public.new_join_code()
returns text
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  code text;
begin
  loop
    b := uuid_send(gen_random_uuid());
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, get_byte(b, i) % length(alphabet) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.classes where join_code = code);
  end loop;
  return code;
end;
$$;

-- The caller's role in an organization: 'owner', 'instructor', or null. Admins count as owners.
create function public.org_role(org uuid)
returns text
language sql stable
security definer set search_path = ''
as $$
  select case
    when public.is_admin() then 'owner'
    else (select role from public.org_members where org_id = org and user_id = (select auth.uid()))
  end;
$$;

-- Students in an organization's classes right now, each counted once.
create function public.org_seats_used(org uuid)
returns integer
language sql stable
security definer set search_path = ''
as $$
  select count(distinct m.user_id)::integer
  from public.class_members m
  join public.classes c on c.id = m.class_id
  where c.org_id = org and m.left_at is null;
$$;

-- Ten wrong codes in an hour, then wait. Old tries are cleared as new ones come in.
create function public.join_tries_left()
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select count(*) < 10 from public.join_tries
  where user_id = (select auth.uid()) and at > now() - interval '1 hour';
$$;

create function public.note_wrong_code()
returns void
language sql volatile
security definer set search_path = ''
as $$
  delete from public.join_tries where user_id = (select auth.uid()) and at < now() - interval '1 day';
  insert into public.join_tries (user_id) values ((select auth.uid()));
$$;

-- Find a class by code, for the two student calls. Returns null when no class has the code.
create function public.class_by_code(code text)
returns public.classes
language sql stable
security definer set search_path = ''
as $$
  select * from public.classes where join_code = public.normalize_join_code(code);
$$;


-- ---------------------------------------------------------------------------------------------
-- Admins (you): set up a school and who runs it. Run these from the stats dashboard account or
-- the SQL editor. Owners and instructors need a FeltReady account first (sign in once).

create function public.admin_create_org(org_name text, org_kind text default 'school',
                                        owner_email text default null, seats integer default null)
returns uuid
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  org uuid;
  owner uuid;
begin
  if not public.is_admin() and (select auth.uid()) is not null then
    raise exception 'Only admins can create organizations' using errcode = '42501';
  end if;
  if owner_email is not null then
    select id into owner from auth.users where lower(email) = lower(trim(owner_email));
    if owner is null then
      raise exception 'No FeltReady account uses %. Have them sign in once, then try again.', owner_email
        using errcode = 'P0002';
    end if;
  end if;
  insert into public.organizations (name, kind, seat_limit) values (trim(org_name), org_kind, seats)
    returning id into org;
  if owner is not null then
    insert into public.org_members (org_id, user_id, role) values (org, owner, 'owner');
  end if;
  return org;
end;
$$;

create function public.admin_add_org_member(org uuid, member_email text, member_role text default 'instructor')
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  member uuid;
begin
  if not public.is_admin() and (select auth.uid()) is not null then
    raise exception 'Only admins can add instructors' using errcode = '42501';
  end if;
  select id into member from auth.users where lower(email) = lower(trim(member_email));
  if member is null then
    raise exception 'No FeltReady account uses %. Have them sign in once, then try again.', member_email
      using errcode = 'P0002';
  end if;
  insert into public.org_members (org_id, user_id, role) values (org, member, member_role)
    on conflict (org_id, user_id) do update set role = excluded.role;
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Owners and instructors.

-- The organizations the caller runs, each with its classes and seat count.
create function public.my_orgs()
returns jsonb
language sql stable
security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'name', o.name, 'kind', o.kind, 'role', om.role,
    'seat_limit', o.seat_limit, 'seats_used', public.org_seats_used(o.id),
    'classes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'join_code', c.join_code, 'code_expires_at', c.code_expires_at,
        'active', c.active, 'created_at', c.created_at,
        'students', (select count(*) from public.class_members m where m.class_id = c.id and m.left_at is null)
      ) order by c.active desc, c.created_at desc), '[]'::jsonb)
      from public.classes c where c.org_id = o.id
    )
  ) order by o.name), '[]'::jsonb)
  from public.org_members om
  join public.organizations o on o.id = om.org_id
  where om.user_id = (select auth.uid());
$$;

create function public.create_class(org uuid, class_name text, expires_at timestamptz default null)
returns jsonb
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  c public.classes;
begin
  if public.org_role(org) is null then
    raise exception 'Only this school''s instructors can add classes' using errcode = '42501';
  end if;
  insert into public.classes (org_id, name, join_code, code_expires_at, created_by)
    values (org, trim(class_name), public.new_join_code(), expires_at, (select auth.uid()))
    returning * into c;
  return jsonb_build_object('id', c.id, 'name', c.name, 'join_code', c.join_code, 'code_expires_at', c.code_expires_at);
end;
$$;

-- Rename a class, or close it (no new students) and reopen it. Null leaves that part as it is.
create function public.set_class(class uuid, class_name text default null, is_active boolean default null)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  org uuid;
begin
  select org_id into org from public.classes where id = class;
  if org is null or public.org_role(org) is null then
    raise exception 'Only this school''s instructors can change the class' using errcode = '42501';
  end if;
  update public.classes
    set name = coalesce(trim(class_name), name), active = coalesce(is_active, active)
    where id = class;
end;
$$;

-- Replace the join code (the old one stops working), with an optional expiry. Students already
-- in the class stay in it.
create function public.new_class_code(class uuid, expires_at timestamptz default null)
returns text
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  org uuid;
  code text;
begin
  select org_id into org from public.classes where id = class;
  if org is null or public.org_role(org) is null then
    raise exception 'Only this school''s instructors can change the code' using errcode = '42501';
  end if;
  code := public.new_join_code();
  update public.classes set join_code = code, code_expires_at = expires_at where id = class;
  return code;
end;
$$;

-- Take a student out of a class (frees their seat). Same as the student leaving.
create function public.remove_student(class uuid, student uuid)
returns void
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  org uuid;
begin
  select org_id into org from public.classes where id = class;
  if org is null or public.org_role(org) is null then
    raise exception 'Only this school''s instructors can remove students' using errcode = '42501';
  end if;
  update public.class_members set left_at = now()
    where class_id = class and user_id = student and left_at is null;
end;
$$;

-- A class and its students. For each student still in the class: their answers since they
-- joined, by game and question kind, and their most common mistakes (detail.miss; the page
-- labels them with MISS_LABELS). Students who left show only their name and when they left.
create function public.class_roster(class uuid)
returns jsonb
language plpgsql stable
security definer set search_path = ''
as $$
declare
  c public.classes;
  o public.organizations;
begin
  select * into c from public.classes where id = class;
  if c.id is null or public.org_role(c.org_id) is null then
    raise exception 'Only this school''s instructors can see the class' using errcode = '42501';
  end if;
  select * into o from public.organizations where id = c.org_id;
  return jsonb_build_object(
    'class', jsonb_build_object('id', c.id, 'name', c.name, 'join_code', c.join_code,
                                'code_expires_at', c.code_expires_at, 'active', c.active),
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'seat_limit', o.seat_limit,
                              'seats_used', public.org_seats_used(o.id)),
    'students', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', m.display_name, 'joined_at', m.joined_at, 'left_at', m.left_at,
        'stats', case when m.left_at is not null then null else (
          select jsonb_build_object(
            'answers', count(*),
            'right', count(*) filter (where a.correct),
            'answers_7d', count(*) filter (where a.created_at > now() - interval '7 days'),
            'last_at', max(a.created_at),
            'drills', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'game', d.game, 'kind', d.kind, 'answers', d.n, 'right', d.r, 'avg_ms', d.avg_ms
              ) order by d.game, d.kind), '[]'::jsonb)
              from (
                select x.game, x.kind, count(*) as n, count(*) filter (where x.correct) as r,
                       round(avg(x.ms) filter (where not x.timed_out and x.ms is not null))::integer as avg_ms
                from public.attempts x
                where x.user_id = m.user_id and x.created_at >= m.joined_at
                group by x.game, x.kind
              ) d
            ),
            'misses', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'game', t.game, 'kind', t.kind, 'miss', t.miss, 'count', t.n
              ) order by t.n desc, t.miss), '[]'::jsonb)
              from (
                select x.game, x.kind, x.detail->>'miss' as miss, count(*) as n
                from public.attempts x
                where x.user_id = m.user_id and x.created_at >= m.joined_at
                  and not x.correct and x.detail->>'miss' is not null
                group by x.game, x.kind, x.detail->>'miss'
                order by count(*) desc, x.detail->>'miss'
                limit 5
              ) t
            )
          )
          from public.attempts a
          where a.user_id = m.user_id and a.created_at >= m.joined_at
        ) end
      ) order by (m.left_at is not null), lower(m.display_name)), '[]'::jsonb)
      from public.class_members m
      where m.class_id = c.id
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- Students. These return { ok: true, ... } or { ok: false, error } instead of raising, so a
-- wrong code is still counted toward the limit. Errors:
--   too_many_tries  ten wrong codes in the last hour
--   not_found       no class has that code
--   expired         the code's expiry has passed
--   closed          the class isn't taking new students
--   full            the school has no free seats
--   bad_name        the name is blank or over 40 characters

-- What the join screen shows before the student agrees: the class, the school, and whether
-- they're already in it.
create function public.class_preview(code text)
returns jsonb
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  c public.classes;
  o public.organizations;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to join a class' using errcode = '42501';
  end if;
  if not public.join_tries_left() then
    return jsonb_build_object('ok', false, 'error', 'too_many_tries');
  end if;
  c := public.class_by_code(code);
  if c.id is null then
    perform public.note_wrong_code();
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into o from public.organizations where id = c.org_id;
  return jsonb_build_object(
    'ok', true,
    'class', jsonb_build_object('id', c.id, 'name', c.name),
    'org', jsonb_build_object('name', o.name, 'kind', o.kind),
    'already_in', exists (select 1 from public.class_members
                          where class_id = c.id and user_id = (select auth.uid()) and left_at is null),
    'error', case when not c.active then 'closed'
                  when c.code_expires_at is not null and c.code_expires_at <= now() then 'expired' end
  );
end;
$$;

-- Join with a code, under the name the instructor will see. Joining a class you're already in
-- just updates the name.
create function public.join_class(code text, student_name text)
returns jsonb
language plpgsql volatile
security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  c public.classes;
  o public.organizations;
  nm text := trim(coalesce(student_name, ''));
  already boolean;
begin
  if me is null then
    raise exception 'Sign in to join a class' using errcode = '42501';
  end if;
  if not public.join_tries_left() then
    return jsonb_build_object('ok', false, 'error', 'too_many_tries');
  end if;
  c := public.class_by_code(code);
  if c.id is null then
    perform public.note_wrong_code();
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if char_length(nm) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;

  -- Lock the school's row so two students can't take the last seat at once.
  select * into o from public.organizations where id = c.org_id for update;

  already := exists (select 1 from public.class_members
                     where class_id = c.id and user_id = me and left_at is null);
  if already then
    update public.class_members set display_name = nm where class_id = c.id and user_id = me;
  else
    if not c.active then
      return jsonb_build_object('ok', false, 'error', 'closed');
    end if;
    if c.code_expires_at is not null and c.code_expires_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
    -- Someone already in another of the school's classes doesn't take a second seat.
    if o.seat_limit is not null
       and not exists (select 1 from public.class_members m join public.classes k on k.id = m.class_id
                       where k.org_id = o.id and m.user_id = me and m.left_at is null)
       and public.org_seats_used(o.id) >= o.seat_limit then
      return jsonb_build_object('ok', false, 'error', 'full');
    end if;
    insert into public.class_members (class_id, user_id, display_name)
      values (c.id, me, nm)
      on conflict (class_id, user_id)
      do update set display_name = excluded.display_name, joined_at = now(), left_at = null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'class', jsonb_build_object('id', c.id, 'name', c.name),
    'org', jsonb_build_object('name', o.name, 'kind', o.kind)
  );
end;
$$;

-- Leave a class. The school stops seeing your answers right away.
create function public.leave_class(class uuid)
returns void
language sql volatile
security definer set search_path = ''
as $$
  update public.class_members set left_at = now()
  where class_id = class and user_id = (select auth.uid()) and left_at is null;
$$;

-- The classes the caller is in, for the account page.
create function public.my_classes()
returns jsonb
language sql stable
security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'class_id', c.id, 'class_name', c.name, 'org_name', o.name, 'org_kind', o.kind,
    'name', m.display_name, 'joined_at', m.joined_at
  ) order by m.joined_at desc), '[]'::jsonb)
  from public.class_members m
  join public.classes c on c.id = m.class_id
  join public.organizations o on o.id = c.org_id
  where m.user_id = (select auth.uid()) and m.left_at is null;
$$;


-- ---------------------------------------------------------------------------------------------
-- Who can call what. Supabase grants EXECUTE on new functions to everyone by default, so the
-- helpers are taken away from the API, and the rest are for signed-in members only.

revoke execute on function
  public.normalize_join_code(text), public.new_join_code(), public.org_role(uuid),
  public.org_seats_used(uuid), public.join_tries_left(), public.note_wrong_code(),
  public.class_by_code(text)
  from public, anon, authenticated;

revoke execute on function
  public.admin_create_org(text, text, text, integer), public.admin_add_org_member(uuid, text, text),
  public.my_orgs(), public.create_class(uuid, text, timestamptz), public.set_class(uuid, text, boolean),
  public.new_class_code(uuid, timestamptz), public.remove_student(uuid, uuid), public.class_roster(uuid),
  public.class_preview(text), public.join_class(text, text), public.leave_class(uuid), public.my_classes()
  from public, anon;

grant execute on function
  public.admin_create_org(text, text, text, integer), public.admin_add_org_member(uuid, text, text),
  public.my_orgs(), public.create_class(uuid, text, timestamptz), public.set_class(uuid, text, boolean),
  public.new_class_code(uuid, timestamptz), public.remove_student(uuid, uuid), public.class_roster(uuid),
  public.class_preview(text), public.join_class(text, text), public.leave_class(uuid), public.my_classes()
  to authenticated;
