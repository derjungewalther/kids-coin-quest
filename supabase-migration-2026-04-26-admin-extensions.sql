-- Kids Coin Quest — Admin Extensions (Apr 2026 batch 2)
--
-- Adds four feature-sets in one migration:
--   1. Pro-Family Drill-Down  — admin_family_detail(family_id)
--   2. Time-Series Charts     — admin_signups_per_day(days)
--   3. Soft-Delete inactive   — families.archived_at + admin_archive_family
--   4. Subscriptions          — public.subscriptions table + admin_set_plan
--
-- Run ONCE in the Supabase SQL Editor AFTER the previous migrations.
-- Idempotent — safe to re-run.

-- =============================================================
-- 3. Soft-delete: add archived_at to families
-- =============================================================
alter table public.families
  add column if not exists archived_at timestamptz;

create index if not exists families_archived_at_idx
  on public.families(archived_at)
  where archived_at is null;

-- =============================================================
-- 4. Subscriptions table — plan + status per user
--    Free is the default for everyone. Stripe integration (webhook
--    sync) comes later; for now plans can be set manually via
--    admin_set_plan().
-- =============================================================
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'pro', 'family')),
  status                 text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  current_period_end     timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_plan_idx on public.subscriptions(plan);

-- Touch updated_at on every change.
drop trigger if exists touch_subscriptions_updated_at on public.subscriptions;
create trigger touch_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Auto-create a 'free' subscription when a profile is created so every
-- user has a sensible default. Idempotent — does nothing if a row
-- already exists.
create or replace function public.handle_new_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, plan, status)
  values (new.user_id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_subscription on public.profiles;
create trigger on_profile_created_subscription
  after insert on public.profiles
  for each row execute function public.handle_new_subscription();

-- Backfill subscriptions for everyone who already has a profile but no
-- subscription row (i.e., users who signed up before this migration).
insert into public.subscriptions (user_id, plan, status)
select p.user_id, 'free', 'active'
from public.profiles p
left join public.subscriptions s on s.user_id = p.user_id
where s.user_id is null;

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_self_read" on public.subscriptions;
create policy "subscriptions_self_read" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "subscriptions_admin_read_all" on public.subscriptions;
create policy "subscriptions_admin_read_all" on public.subscriptions
  for select using (public.current_user_is_admin());

drop policy if exists "subscriptions_admin_write_all" on public.subscriptions;
create policy "subscriptions_admin_write_all" on public.subscriptions
  for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());


-- =============================================================
-- Update admin_families_detail to include archived_at + plan info.
-- The column list grows; old clients reading by index would break, but
-- the dashboard reads by name so it's safe.
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
  last_sign_in_at  timestamptz,
  archived_at      timestamptz,
  plan             text,
  plan_status      text,
  current_period_end timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
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
      u.last_sign_in_at,
      f.archived_at,
      coalesce(s.plan, 'free') as plan,
      coalesce(s.status, 'active') as plan_status,
      s.current_period_end
    from public.families f
    left join public.profiles p      on p.user_id      = f.owner_user_id
    left join auth.users u           on u.id           = f.owner_user_id
    left join public.subscriptions s on s.user_id      = f.owner_user_id
    order by f.updated_at desc;
end;
$$;

revoke all on function public.admin_families_detail() from public;
grant execute on function public.admin_families_detail() to authenticated;


-- =============================================================
-- Update admin_overview_stats to include plan-distribution counts.
-- =============================================================
create or replace function public.admin_overview_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with fam as (
    select
      f.id, f.owner_user_id, f.state, f.updated_at, f.created_at, f.archived_at,
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
      count(*) filter (where p.is_admin) as admin_users,
      count(*) filter (where p.created_at > now() - interval '7 days')  as signups_7d,
      count(*) filter (where p.created_at > now() - interval '30 days') as signups_30d
    from public.profiles p
  ),
  auth_stats as (
    select
      count(*) filter (where u.last_sign_in_at > now() - interval '24 hours') as dau,
      count(*) filter (where u.last_sign_in_at > now() - interval '7 days')   as wau,
      count(*) filter (where u.last_sign_in_at > now() - interval '30 days')  as mau
    from auth.users u
  ),
  plans as (
    select
      count(*) filter (where s.plan = 'free')   as free_count,
      count(*) filter (where s.plan = 'pro')    as pro_count,
      count(*) filter (where s.plan = 'family') as family_count,
      count(*) filter (where s.status = 'past_due') as past_due_count,
      count(*) filter (where s.status = 'canceled') as canceled_count,
      coalesce(sum(case when s.plan = 'pro' then 9 when s.plan = 'family' then 19 else 0 end), 0) as estimated_mrr
    from public.subscriptions s
    where s.status in ('active', 'trialing')
  )
  select jsonb_build_object(
    'total_families',     (select count(*) from fam),
    'archived_families',  (select count(*) from fam where fam.archived_at is not null),
    'families_active_7d', (select count(*) from fam where fam.updated_at > now() - interval '7 days' and fam.archived_at is null),
    'families_active_30d',(select count(*) from fam where fam.updated_at > now() - interval '30 days' and fam.archived_at is null),
    'families_active_90d',(select count(*) from fam where fam.updated_at > now() - interval '90 days' and fam.archived_at is null),
    'inactive_90d',       (select count(*) from fam where fam.updated_at < now() - interval '90 days' and fam.archived_at is null),
    'total_heroes',       (select coalesce(sum(fam.hero_count), 0) from fam where fam.archived_at is null),
    'total_coins',        (select coalesce(sum(fam.coin_total), 0) from fam where fam.archived_at is null),
    'total_transactions', (select coalesce(sum(fam.tx_count), 0) from fam where fam.archived_at is null),
    'avg_heroes',         (select coalesce(round(avg(fam.hero_count)::numeric, 2), 0) from fam where fam.hero_count > 0 and fam.archived_at is null),
    'avg_coins_per_fam',  (select coalesce(round(avg(fam.coin_total)::numeric, 2), 0) from fam where fam.hero_count > 0 and fam.archived_at is null),
    'total_users',        (select total_users from prof),
    'admin_users',        (select admin_users from prof),
    'signups_7d',         (select signups_7d from prof),
    'signups_30d',        (select signups_30d from prof),
    'dau',                (select dau from auth_stats),
    'wau',                (select wau from auth_stats),
    'mau',                (select mau from auth_stats),
    'plan_free',          (select free_count   from plans),
    'plan_pro',           (select pro_count    from plans),
    'plan_family',        (select family_count from plans),
    'plan_past_due',      (select past_due_count from plans),
    'plan_canceled',      (select canceled_count from plans),
    'estimated_mrr',      (select estimated_mrr  from plans),
    'generated_at',       now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_overview_stats() from public;
grant execute on function public.admin_overview_stats() to authenticated;


-- =============================================================
-- 1. admin_family_detail(family_id) — full drill-down for one family
-- Returns the entire family.state JSONB so the client can render
-- kids, transactions, achievements, etc. without per-kid round-trips.
-- =============================================================
create or replace function public.admin_family_detail(p_family_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'family_id',         f.id,
    'owner_user_id',     f.owner_user_id,
    'email',             p.email,
    'is_admin',          coalesce(p.is_admin, false),
    'family_name',       f.name,
    'family_created',    f.created_at,
    'family_updated',    f.updated_at,
    'archived_at',       f.archived_at,
    'user_created',      p.created_at,
    'last_sign_in_at',   u.last_sign_in_at,
    'plan',              coalesce(s.plan, 'free'),
    'plan_status',       coalesce(s.status, 'active'),
    'current_period_end',s.current_period_end,
    'state',             f.state
  ) into result
  from public.families f
  left join public.profiles p      on p.user_id = f.owner_user_id
  left join auth.users u           on u.id = f.owner_user_id
  left join public.subscriptions s on s.user_id = f.owner_user_id
  where f.id = p_family_id;
  return result;
end;
$$;

revoke all on function public.admin_family_detail(uuid) from public;
grant execute on function public.admin_family_detail(uuid) to authenticated;


-- =============================================================
-- 2. admin_signups_per_day(days int) — signup time-series
-- Counts profiles by created_at::date for the last N days.
-- =============================================================
create or replace function public.admin_signups_per_day(days int default 30)
returns table(day date, signups int)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
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
      coalesce(count(p.user_id) filter (where date_trunc('day', p.created_at)::date = d.day), 0)::int as signups
    from day_series d
    left join public.profiles p on date_trunc('day', p.created_at)::date = d.day
    group by d.day
    order by d.day asc;
end;
$$;

revoke all on function public.admin_signups_per_day(int) from public;
grant execute on function public.admin_signups_per_day(int) to authenticated;


-- =============================================================
-- 3. admin_archive_family / admin_unarchive_family
-- Soft-delete: sets families.archived_at to now() (or null on undo).
-- The family row stays untouched otherwise; row-level-security policies
-- still apply (so the owner can still read/write their data — the flag
-- is for filtering inside the admin dashboard).
-- =============================================================
create or replace function public.admin_archive_family(p_family_id uuid, p_archive boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.families
     set archived_at = case when p_archive then now() else null end
   where id = p_family_id
   returning jsonb_build_object('family_id', id, 'archived_at', archived_at) into result;
  return result;
end;
$$;

revoke all on function public.admin_archive_family(uuid, boolean) from public;
grant execute on function public.admin_archive_family(uuid, boolean) to authenticated;


-- =============================================================
-- 4. admin_set_plan(user_id, plan, status, current_period_end)
-- Manual plan override. Use cases:
--   - Comp a customer ("you get pro free for 12 months")
--   - Test the UI before Stripe is wired up
--   - Rescue a user whose Stripe webhook didn't fire
--
-- When Stripe is wired up, the webhook will write to subscriptions
-- directly via service-role key (bypassing RLS) — this RPC is for
-- admins via the dashboard only.
-- =============================================================
create or replace function public.admin_set_plan(
  p_user_id uuid,
  p_plan    text,
  p_status  text default 'active',
  p_period_end timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_plan not in ('free', 'pro', 'family') then
    raise exception 'invalid plan: must be free, pro, or family';
  end if;
  if p_status not in ('active', 'trialing', 'past_due', 'canceled') then
    raise exception 'invalid status: must be active, trialing, past_due, or canceled';
  end if;
  insert into public.subscriptions (user_id, plan, status, current_period_end)
  values (p_user_id, p_plan, p_status, p_period_end)
  on conflict (user_id) do update
    set plan = excluded.plan,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = now()
  returning jsonb_build_object('user_id', user_id, 'plan', plan, 'status', status, 'current_period_end', current_period_end) into result;
  return result;
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, text, timestamptz) from public;
grant execute on function public.admin_set_plan(uuid, text, text, timestamptz) to authenticated;


-- =============================================================
-- After running this file:
--   - Reload the app (hard refresh)
--   - Settings → 🛡 Globaler Admin
--   - New tab "💳 Plans" appears with plan distribution
--   - Click a row in Families tab to open the drill-down modal
--   - Archive icon (🗄) per row to soft-delete
--   - Sparkline charts in Overview + Logins tabs
--
-- STRIPE INTEGRATION (next step, NOT in this migration):
-- =============================================================
-- The schema is ready. To wire up Stripe:
--
-- 1. Create products + prices in Stripe Dashboard (Pro $9/mo, Family $19/mo)
-- 2. Set up a Supabase Edge Function:
--      supabase functions new stripe-webhook
--    Handle these events: checkout.session.completed,
--    customer.subscription.updated, customer.subscription.deleted,
--    invoice.payment_failed.
-- 3. In each handler, write to public.subscriptions using the
--    SERVICE_ROLE_KEY (bypasses RLS), looking up the user via
--    stripe_customer_id.
-- 4. Add Stripe Webhook URL to Stripe Dashboard pointing at the
--    Edge Function URL.
-- 5. Frontend: add an "Upgrade to Pro" button that calls
--    stripe.redirectToCheckout({ sessionId: ... }) — server-side
--    creates the session via another Edge Function.
-- =============================================================
