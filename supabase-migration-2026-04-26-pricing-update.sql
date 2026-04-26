-- Kids Coin Quest — Pricing Update (Apr 2026)
--
-- Simplification per Sebastian's call:
--   - Drop the 'family' tier (single-parent-only model is enough).
--   - Pro is €3/month or €19.99/year (44% annual discount).
--   - Add billing_period column so we can distinguish monthly vs yearly
--     in the dashboard MRR/ARR calculations.
--
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.

-- =============================================================
-- 1. Migrate any existing 'family' rows to 'pro' before tightening
-- the constraint. Right now this is empty, but belt-and-braces.
-- =============================================================
update public.subscriptions
   set plan = 'pro'
 where plan = 'family';

-- =============================================================
-- 2. Add billing_period column. Nullable for free + grandfathered
-- rows; for new pro signups it must be 'monthly' or 'yearly'.
-- =============================================================
alter table public.subscriptions
  add column if not exists billing_period text
    check (billing_period is null or billing_period in ('monthly', 'yearly'));

-- =============================================================
-- 3. Tighten the plan check constraint: drop 'family'.
-- Postgres won't let us alter the check directly — drop + re-add.
-- =============================================================
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;

alter table public.subscriptions
  add constraint subscriptions_plan_check
    check (plan in ('free', 'pro'));

-- =============================================================
-- 4. Update admin_overview_stats: drop family fields, add yearly
-- breakdown, switch MRR currency labelling to EUR.
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
    select f.id, f.owner_user_id, f.state, f.updated_at, f.created_at, f.archived_at,
      coalesce(jsonb_array_length(f.state->'kids'), 0) as hero_count,
      coalesce(jsonb_array_length(f.state->'transactions'), 0) as tx_count,
      coalesce((select sum((k->>'balance')::numeric) from jsonb_array_elements(coalesce(f.state->'kids', '[]'::jsonb)) k), 0) as coin_total
    from public.families f
  ),
  prof as (
    select count(*) as total_users,
      count(*) filter (where p.is_admin) as admin_users,
      count(*) filter (where p.created_at > now() - interval '7 days')  as signups_7d,
      count(*) filter (where p.created_at > now() - interval '30 days') as signups_30d
    from public.profiles p
  ),
  auth_stats as (
    select count(*) filter (where u.last_sign_in_at > now() - interval '24 hours') as dau,
           count(*) filter (where u.last_sign_in_at > now() - interval '7 days')   as wau,
           count(*) filter (where u.last_sign_in_at > now() - interval '30 days')  as mau
    from auth.users u
  ),
  plans as (
    -- Pricing: Pro €3/month or €19.99/year
    -- MRR contribution: monthly Pro = 3, yearly Pro = 19.99/12 ≈ 1.67
    -- ARR contribution: monthly Pro × 12 = 36, yearly Pro = 19.99
    select
      count(*) filter (where s.plan = 'free') as free_count,
      count(*) filter (where s.plan = 'pro' and s.billing_period = 'monthly') as pro_monthly_count,
      count(*) filter (where s.plan = 'pro' and s.billing_period = 'yearly')  as pro_yearly_count,
      count(*) filter (where s.plan = 'pro' and s.billing_period is null)     as pro_unspecified_count,
      count(*) filter (where s.status = 'past_due') as past_due_count,
      count(*) filter (where s.status = 'canceled') as canceled_count,
      coalesce(sum(case
        when s.plan = 'pro' and s.billing_period = 'monthly' then 3.00
        when s.plan = 'pro' and s.billing_period = 'yearly'  then 19.99 / 12.0
        when s.plan = 'pro' and s.billing_period is null     then 3.00
        else 0
      end), 0)::numeric(10,2) as estimated_mrr_eur,
      coalesce(sum(case
        when s.plan = 'pro' and s.billing_period = 'monthly' then 36.00
        when s.plan = 'pro' and s.billing_period = 'yearly'  then 19.99
        when s.plan = 'pro' and s.billing_period is null     then 36.00
        else 0
      end), 0)::numeric(10,2) as estimated_arr_eur
    from public.subscriptions s
    where s.status in ('active', 'trialing')
  )
  select jsonb_build_object(
    'total_families',      (select count(*) from fam),
    'archived_families',   (select count(*) from fam where fam.archived_at is not null),
    'families_active_7d',  (select count(*) from fam where fam.updated_at > now() - interval '7 days' and fam.archived_at is null),
    'families_active_30d', (select count(*) from fam where fam.updated_at > now() - interval '30 days' and fam.archived_at is null),
    'families_active_90d', (select count(*) from fam where fam.updated_at > now() - interval '90 days' and fam.archived_at is null),
    'inactive_90d',        (select count(*) from fam where fam.updated_at < now() - interval '90 days' and fam.archived_at is null),
    'total_heroes',        (select coalesce(sum(fam.hero_count), 0) from fam where fam.archived_at is null),
    'total_coins',         (select coalesce(sum(fam.coin_total), 0) from fam where fam.archived_at is null),
    'total_transactions',  (select coalesce(sum(fam.tx_count), 0) from fam where fam.archived_at is null),
    'avg_heroes',          (select coalesce(round(avg(fam.hero_count)::numeric, 2), 0) from fam where fam.hero_count > 0 and fam.archived_at is null),
    'avg_coins_per_fam',   (select coalesce(round(avg(fam.coin_total)::numeric, 2), 0) from fam where fam.hero_count > 0 and fam.archived_at is null),
    'total_users',         (select total_users from prof),
    'admin_users',         (select admin_users from prof),
    'signups_7d',          (select signups_7d from prof),
    'signups_30d',         (select signups_30d from prof),
    'dau',                 (select dau from auth_stats),
    'wau',                 (select wau from auth_stats),
    'mau',                 (select mau from auth_stats),
    'plan_free',           (select free_count from plans),
    'plan_pro_monthly',    (select pro_monthly_count from plans),
    'plan_pro_yearly',     (select pro_yearly_count from plans),
    'plan_pro_total',      (select pro_monthly_count + pro_yearly_count + pro_unspecified_count from plans),
    'plan_past_due',       (select past_due_count from plans),
    'plan_canceled',       (select canceled_count from plans),
    'estimated_mrr_eur',   (select estimated_mrr_eur from plans),
    'estimated_arr_eur',   (select estimated_arr_eur from plans),
    'generated_at',        now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_overview_stats() from public;
grant execute on function public.admin_overview_stats() to authenticated;

-- =============================================================
-- 5. Update admin_families_detail to include billing_period.
-- DROP first because we're extending OUT-parameter signature
-- (PG error 42P13 otherwise).
-- =============================================================
drop function if exists public.admin_families_detail();

create or replace function public.admin_families_detail()
returns table(
  family_id uuid, owner_user_id uuid, email text, is_admin boolean,
  family_name text, hero_count int, coin_total numeric, tx_count int,
  current_streak int, family_created timestamptz, family_updated timestamptz,
  user_created timestamptz, last_sign_in_at timestamptz,
  archived_at timestamptz,
  plan text, plan_status text, billing_period text, current_period_end timestamptz
)
language plpgsql security definer set search_path = public stable
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      f.id, f.owner_user_id, p.email, p.is_admin, f.name,
      coalesce(jsonb_array_length(f.state->'kids'), 0)::int,
      coalesce((select sum((k->>'balance')::numeric) from jsonb_array_elements(coalesce(f.state->'kids', '[]'::jsonb)) k), 0),
      coalesce(jsonb_array_length(f.state->'transactions'), 0)::int,
      coalesce((f.state->'streak'->>'current')::int, 0),
      f.created_at, f.updated_at, p.created_at, u.last_sign_in_at,
      f.archived_at,
      coalesce(s.plan, 'free'),
      coalesce(s.status, 'active'),
      s.billing_period,
      s.current_period_end
    from public.families f
    left join public.profiles p      on p.user_id = f.owner_user_id
    left join auth.users u           on u.id      = f.owner_user_id
    left join public.subscriptions s on s.user_id = f.owner_user_id
    order by f.updated_at desc;
end;
$$;
revoke all on function public.admin_families_detail() from public;
grant execute on function public.admin_families_detail() to authenticated;

-- =============================================================
-- 6. Update admin_set_plan to accept billing_period.
-- =============================================================
drop function if exists public.admin_set_plan(uuid, text, text, timestamptz);

create or replace function public.admin_set_plan(
  p_user_id uuid,
  p_plan    text,
  p_status  text default 'active',
  p_billing_period text default null,
  p_period_end timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_plan not in ('free', 'pro') then
    raise exception 'invalid plan: must be free or pro';
  end if;
  if p_status not in ('active', 'trialing', 'past_due', 'canceled') then
    raise exception 'invalid status: must be active, trialing, past_due, or canceled';
  end if;
  if p_billing_period is not null and p_billing_period not in ('monthly', 'yearly') then
    raise exception 'invalid billing_period: must be monthly, yearly, or null';
  end if;
  -- Force billing_period to NULL for free plans.
  if p_plan = 'free' then
    p_billing_period := null;
  end if;
  insert into public.subscriptions (user_id, plan, status, billing_period, current_period_end)
  values (p_user_id, p_plan, p_status, p_billing_period, p_period_end)
  on conflict (user_id) do update
    set plan = excluded.plan,
        status = excluded.status,
        billing_period = excluded.billing_period,
        current_period_end = excluded.current_period_end,
        updated_at = now()
  returning jsonb_build_object(
    'user_id', user_id, 'plan', plan, 'status', status,
    'billing_period', billing_period, 'current_period_end', current_period_end
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_set_plan(uuid, text, text, text, timestamptz) from public;
grant execute on function public.admin_set_plan(uuid, text, text, text, timestamptz) to authenticated;

-- =============================================================
-- After running this file:
--   - Reload the app (hard refresh)
--   - 💳 Pläne tab now shows: Free count, Pro Monthly count, Pro
--     Yearly count, MRR (EUR), ARR (EUR), past-due, canceled.
--   - Plan dropdown is Free / Pro Monthly / Pro Yearly (3 choices,
--     not the old free/pro/family).
-- =============================================================
