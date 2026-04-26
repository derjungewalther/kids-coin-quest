-- Kids Coin Quest — Admin Dashboard RPCs (Apr 2026)
--
-- Run this ONCE in your Supabase SQL Editor AFTER the previous migrations.
-- Idempotent — safe to re-run.
--
-- Adds three new admin-only RPCs:
--   1. admin_overview_stats()    — aggregated KPIs (one row, JSONB)
--   2. admin_families_detail()   — family list with auth.users join
--   3. admin_login_activity(days)— daily sign-in counts for the last N days
--
-- All three raise 'forbidden' (errcode 42501) for non-admin callers.

-- =============================================================
-- admin_overview_stats() — one big snapshot of the whole tenant
-- =============================================================
create or replace function public.admin_overview_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with fam as (
    select
      f.id, f.owner_user_id, f.state, f.updated_at, f.created_at,
      coalesce(jsonb_array_length(f.state->'kids'), 0) as hero_count,
      coalesce(jsonb_array_length(f.state->'transactions'), 0) as tx_count,
      coalesce((
        select sum((k->>'balance')::numeric)
        from jsonb_array_elements(coalesce(f.state->'kids', '[]'::jsonb)) k
      ), 0) as coin_total
    from public.families f
  ),
  prof as (
    select
      count(*) as total_users,
      count(*) filter (where is_admin) as admin_users,
      count(*) filter (where created_at > now() - interval '7 days')  as signups_7d,
      count(*) filter (where created_at > now() - interval '30 days') as signups_30d
    from public.profiles
  ),
  auth_stats as (
    select
      count(*) filter (where last_sign_in_at > now() - interval '24 hours') as dau,
      count(*) filter (where last_sign_in_at > now() - interval '7 days')   as wau,
      count(*) filter (where last_sign_in_at > now() - interval '30 days')  as mau
    from auth.users
  )
  select jsonb_build_object(
    'total_families',     (select count(*) from fam),
    'families_active_7d', (select count(*) from fam where updated_at > now() - interval '7 days'),
    'families_active_30d',(select count(*) from fam where updated_at > now() - interval '30 days'),
    'families_active_90d',(select count(*) from fam where updated_at > now() - interval '90 days'),
    'inactive_90d',       (select count(*) from fam where updated_at < now() - interval '90 days'),
    'total_heroes',       (select coalesce(sum(hero_count), 0) from fam),
    'total_coins',        (select coalesce(sum(coin_total), 0) from fam),
    'total_transactions', (select coalesce(sum(tx_count), 0) from fam),
    'avg_heroes',         (select coalesce(round(avg(hero_count)::numeric, 2), 0) from fam where hero_count > 0),
    'avg_coins_per_fam',  (select coalesce(round(avg(coin_total)::numeric, 2), 0) from fam where hero_count > 0),
    'total_users',        (select total_users from prof),
    'admin_users',        (select admin_users from prof),
    'signups_7d',         (select signups_7d from prof),
    'signups_30d',        (select signups_30d from prof),
    'dau',                (select dau from auth_stats),
    'wau',                (select wau from auth_stats),
    'mau',                (select mau from auth_stats),
    'generated_at',       now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_overview_stats() from public;
grant execute on function public.admin_overview_stats() to authenticated;


-- =============================================================
-- admin_families_detail() — enriched family list
-- Joins families with profiles (for email) and auth.users (for
-- last_sign_in_at). Each row is one family with computed per-family
-- aggregates so the client doesn't have to walk JSONB blobs.
-- =============================================================
create or replace function public.admin_families_detail()
returns table(
  family_id        uuid,
  owner_user_id    uuid,
  email            text,
  is_admin         boolean,
  family_name      text,
  hero_count       int,
  coin_total       numeric,
  tx_count         int,
  current_streak   int,
  family_created   timestamptz,
  family_updated   timestamptz,
  user_created     timestamptz,
  last_sign_in_at  timestamptz
)
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
    select
      f.id as family_id,
      f.owner_user_id,
      p.email,
      p.is_admin,
      f.name as family_name,
      coalesce(jsonb_array_length(f.state->'kids'), 0)::int as hero_count,
      coalesce((
        select sum((k->>'balance')::numeric)
        from jsonb_array_elements(coalesce(f.state->'kids', '[]'::jsonb)) k
      ), 0) as coin_total,
      coalesce(jsonb_array_length(f.state->'transactions'), 0)::int as tx_count,
      coalesce((f.state->'streak'->>'current')::int, 0) as current_streak,
      f.created_at as family_created,
      f.updated_at as family_updated,
      p.created_at as user_created,
      u.last_sign_in_at
    from public.families f
    left join public.profiles p on p.user_id = f.owner_user_id
    left join auth.users u      on u.id = f.owner_user_id
    order by f.updated_at desc;
end;
$$;

revoke all on function public.admin_families_detail() from public;
grant execute on function public.admin_families_detail() to authenticated;


-- =============================================================
-- admin_login_activity(days int) — daily sign-in distribution
-- Returns one row per day for the last N days, with the count of
-- users whose last_sign_in_at falls in that day's UTC window.
-- (Caveat: "last sign-in" not "all sign-ins" — Supabase doesn't
-- expose the full audit log to security definer functions on the
-- free tier. Good enough as an "engagement pulse" proxy.)
-- =============================================================
create or replace function public.admin_login_activity(days int default 30)
returns table(day date, sign_ins int)
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
    with day_series as (
      select generate_series(
        date_trunc('day', now() - (days - 1) * interval '1 day')::date,
        date_trunc('day', now())::date,
        interval '1 day'
      )::date as day
    )
    select
      d.day,
      coalesce(count(u.id) filter (where date_trunc('day', u.last_sign_in_at)::date = d.day), 0)::int as sign_ins
    from day_series d
    left join auth.users u on date_trunc('day', u.last_sign_in_at)::date = d.day
    group by d.day
    order by d.day asc;
end;
$$;

revoke all on function public.admin_login_activity(int) from public;
grant execute on function public.admin_login_activity(int) to authenticated;


-- =============================================================
-- After running this file — nothing else needed. The client
-- automatically picks up the new RPCs and renders the dashboard.
-- =============================================================
