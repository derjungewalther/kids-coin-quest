-- R2-P2-09: Add Supabase RPC functions so the client can read profiles +
-- families without leaking user UUIDs in the request URL (PostgREST
-- filter-by-eq() puts them in the query string; .rpc() POSTs the call,
-- so the body carries the auth context but the URL is opaque).
--
-- Run this ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run this BEFORE deploying the client change that switches to .rpc().

-- =============================================================
-- get_my_profile() — caller's own profile
-- =============================================================
create or replace function public.get_my_profile()
returns table(user_id uuid, email text, is_admin boolean)
language sql
security definer
set search_path = public
stable
as $$
  select user_id, email, is_admin
  from public.profiles
  where user_id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

-- =============================================================
-- list_my_families() — caller's own family/families
-- =============================================================
create or replace function public.list_my_families()
returns table(id uuid, state jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select id, state, updated_at
  from public.families
  where owner_user_id = auth.uid();
$$;

revoke all on function public.list_my_families() from public;
grant execute on function public.list_my_families() to authenticated;

-- =============================================================
-- admin_list_all_families() — admin-only global view
-- Server-side admin check: any non-admin caller gets a 'forbidden' error
-- instead of just an empty result, so privilege escalation attempts are
-- visible in the logs.
-- =============================================================
create or replace function public.admin_list_all_families()
returns table(id uuid, owner_user_id uuid, name text, state jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select f.id, f.owner_user_id, f.name, f.state, f.updated_at
    from public.families f
    order by f.updated_at desc;
end;
$$;

revoke all on function public.admin_list_all_families() from public;
grant execute on function public.admin_list_all_families() to authenticated;

-- =============================================================
-- admin_list_all_profiles() — admin-only profile lookup
-- =============================================================
create or replace function public.admin_list_all_profiles()
returns table(user_id uuid, email text, is_admin boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select p.user_id, p.email, p.is_admin from public.profiles p;
end;
$$;

revoke all on function public.admin_list_all_profiles() from public;
grant execute on function public.admin_list_all_profiles() to authenticated;
