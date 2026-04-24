-- Kids Coin Quest — Supabase schema
-- Run this ONCE in your Supabase project's SQL Editor after creating the project.
-- Idempotent: safe to re-run if something needs fixing.

-- =============================================================
-- profiles: extends auth.users with an is_admin flag
-- =============================================================
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile on signup so the app can always find one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- Helper: is the current user an admin? security definer so it bypasses RLS
-- when checking; otherwise policies that reference profiles.is_admin would
-- recurse into themselves (Postgres raises "infinite recursion in policy").
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where user_id = auth.uid()), false);
$$;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = user_id);

-- Admins can read every profile (for the admin dashboard).
drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all" on public.profiles
  for select using (public.current_user_is_admin());

-- =============================================================
-- families: one row per signed-in parent account (MVP)
-- The entire app state lives as a JSON blob in state.
-- Later we can normalise kids/transactions into their own tables.
-- =============================================================
create table if not exists public.families (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name          text,
  state         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists families_owner_unique on public.families(owner_user_id);

-- Touch updated_at automatically so the client can detect remote changes.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_families_updated_at on public.families;
create trigger touch_families_updated_at
  before update on public.families
  for each row execute function public.touch_updated_at();

alter table public.families enable row level security;

-- Owners have full CRUD over their own family row.
drop policy if exists "families_owner_crud" on public.families;
create policy "families_owner_crud" on public.families
  for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Admins can read every family for the dashboard (read-only).
drop policy if exists "families_admin_read" on public.families;
create policy "families_admin_read" on public.families
  for select using (public.current_user_is_admin());

-- =============================================================
-- delete_my_account: lets a signed-in user erase their own account
-- (families row, profile row, and the auth.users record) in one call.
-- Required for GDPR Art. 17 compliance — "right to erasure".
-- security definer is necessary because clients cannot delete auth.users
-- directly. The function only ever deletes auth.uid(), so there's no way
-- to abuse it to delete someone else.
-- =============================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  delete from public.families where owner_user_id = uid;
  delete from public.profiles where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- Any signed-in user may call delete_my_account for themselves.
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- =============================================================
-- After running this file:
--   1. Sign up in the app (password or Google)
--   2. Come back here and run:
--        update public.profiles set is_admin = true where email = 'you@example.com';
--      to grant yourself the admin role.
-- =============================================================
