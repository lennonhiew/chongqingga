-- Chongqingga trip poll. Lives beside Commonplace in the same Supabase project; every object is prefixed cq_.
-- Friends (anon key): read everything, and write only through cq_join / cq_vote.
-- Admin app (service-role key, kept on the PC): writes tables directly.

create table if not exists public.cq_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'
);

create table if not exists public.cq_polls (
  id text primary key,
  title text not null,
  subtitle text not null default '',
  multi boolean not null default true,
  sort int not null default 0
);

create table if not exists public.cq_options (
  id text primary key,
  poll_id text not null references public.cq_polls (id) on delete cascade,
  emoji text not null default '📍',
  name text not null,
  zh text not null default '',
  "when" text not null default 'day',
  price_cny numeric not null default 0,
  note text not null default '',
  image text not null default '',
  credit text not null default '',
  source text not null default '',
  sort int not null default 0
);

create table if not exists public.cq_members (
  id text primary key,
  name text not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz
);
create unique index if not exists cq_members_name_key on public.cq_members (lower(name));

create table if not exists public.cq_votes (
  option_id text not null references public.cq_options (id) on delete cascade,
  member_id text not null references public.cq_members (id) on delete cascade,
  poll_id text not null references public.cq_polls (id) on delete cascade,
  at timestamptz not null default now(),
  primary key (option_id, member_id)
);

alter table public.cq_settings enable row level security;
alter table public.cq_polls enable row level security;
alter table public.cq_options enable row level security;
alter table public.cq_members enable row level security;
alter table public.cq_votes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cq_settings','cq_polls','cq_options','cq_members','cq_votes'] loop
    execute format('drop policy if exists "cq read" on public.%I', t);
    execute format('create policy "cq read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Sign in by name: finds the friend or adds them.
create or replace function public.cq_join(p_name text)
returns public.cq_members
language plpgsql security definer set search_path = public as $$
declare
  m public.cq_members;
  n text := left(btrim(coalesce(p_name, '')), 40);
begin
  if n = '' then raise exception 'Type your name first.'; end if;
  select * into m from public.cq_members where lower(name) = lower(n);
  if not found then
    if (select count(*) from public.cq_members) >= 40 then raise exception 'The group is full.'; end if;
    insert into public.cq_members (id, name, last_seen)
    values ('m' || substr(md5(random()::text || clock_timestamp()::text), 1, 8), n, now())
    returning * into m;
  else
    update public.cq_members set last_seen = now() where id = m.id returning * into m;
  end if;
  return m;
end $$;

-- Tick or untick a place. Pick-one polls replace the earlier pick.
create or replace function public.cq_vote(p_option text, p_member text, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.cq_options;
  p public.cq_polls;
begin
  select * into o from public.cq_options where id = p_option;
  if not found then raise exception 'That place no longer exists.'; end if;
  perform 1 from public.cq_members where id = p_member;
  if not found then raise exception 'Your name was removed. Pick it again.'; end if;
  select * into p from public.cq_polls where id = o.poll_id;
  if p_on then
    if not p.multi then delete from public.cq_votes where member_id = p_member and poll_id = p.id; end if;
    insert into public.cq_votes (option_id, member_id, poll_id) values (p_option, p_member, p.id) on conflict do nothing;
  else
    delete from public.cq_votes where option_id = p_option and member_id = p_member;
  end if;
  update public.cq_members set last_seen = now() where id = p_member;
end $$;

revoke all on function public.cq_join(text) from public;
revoke all on function public.cq_vote(text, text, boolean) from public;
grant execute on function public.cq_join(text) to anon, authenticated;
grant execute on function public.cq_vote(text, text, boolean) to anon, authenticated;

-- Live updates
do $$
declare t text;
begin
  foreach t in array array['cq_settings','cq_polls','cq_options','cq_members','cq_votes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Photos the admin uploads (public to read; only the service key can write)
insert into storage.buckets (id, name, public) values ('cq-photos', 'cq-photos', true)
on conflict (id) do nothing;
