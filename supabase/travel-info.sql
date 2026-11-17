
-- Travel documents, end-to-end encrypted on the phone with the group code (site/crypto.js).
-- The database only holds scrambled text: cq_vault lets a phone check the code, cq_docs holds one sealed record per friend.
create table if not exists public.cq_vault (
  id int primary key default 1 check (id = 1),
  salt text not null,
  chk text not null,
  iv text not null
);
create table if not exists public.cq_docs (
  member_id text primary key references public.cq_members (id) on delete cascade,
  cipher text not null,
  iv text not null,
  updated_at timestamptz not null default now()
);
alter table public.cq_vault enable row level security;
alter table public.cq_docs enable row level security;
drop policy if exists "cq read" on public.cq_vault;
create policy "cq read" on public.cq_vault for select to anon, authenticated using (true);
drop policy if exists "cq read" on public.cq_docs;
create policy "cq read" on public.cq_docs for select to anon, authenticated using (true);

create or replace function public.cq_save_doc(p_member text, p_cipher text, p_iv text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cq_vault) then raise exception 'Travel info isn''t set up yet.'; end if;
  if not exists (select 1 from public.cq_members where id = p_member) then raise exception 'That person isn''t in the group.'; end if;
  -- Postgres regex repeat counts max out at 255, so check length separately.
  if p_cipher is null or p_iv is null
     or length(p_cipher) not between 1 and 8000 or length(p_iv) not between 1 and 40
     or p_cipher !~ '^[A-Za-z0-9+/=]+$' or p_iv !~ '^[A-Za-z0-9+/=]+$' then raise exception 'That didn''t look encrypted.'; end if;
  insert into public.cq_docs (member_id, cipher, iv, updated_at) values (p_member, p_cipher, p_iv, now())
  on conflict (member_id) do update set cipher = excluded.cipher, iv = excluded.iv, updated_at = now();
end $$;

create or replace function public.cq_delete_doc(p_member text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.cq_docs where member_id = p_member;
end $$;

revoke all on function public.cq_save_doc(text, text, text) from public;
revoke all on function public.cq_delete_doc(text) from public;
grant execute on function public.cq_save_doc(text, text, text) to anon, authenticated;
grant execute on function public.cq_delete_doc(text) to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['cq_vault','cq_docs'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
