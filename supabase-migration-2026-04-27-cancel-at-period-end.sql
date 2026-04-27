-- Kids Coin Quest — surface Stripe's cancel_at_period_end (Apr 2026)
--
-- Background: when a user cancels via the Stripe Customer Portal, by
-- default Stripe sets `cancel_at_period_end: true` and leaves status
-- as 'active' until the period actually ends. Our webhook discarded
-- that flag, so the dashboard kept showing them as Pro forever — no
-- visibility into "this user has scheduled cancellation".
--
-- This migration adds a column + extends the admin RPCs to expose it.
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.

alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

-- =============================================================
-- Update admin_families_detail to include cancel_at_period_end.
-- DROP first because the OUT-parameter signature changes (PG 42P13).
-- =============================================================
drop function if exists public.admin_families_detail();

create or replace function public.admin_families_detail()
returns table(
  family_id uuid, owner_user_id uuid, email text, is_admin boolean,
  family_name text, hero_count int, coin_total numeric, tx_count int,
  current_streak int, family_created timestamptz, family_updated timestamptz,
  user_created timestamptz, last_sign_in_at timestamptz,
  archived_at timestamptz,
  plan text, plan_status text, billing_period text, current_period_end timestamptz,
  cancel_at_period_end boolean
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
      s.current_period_end,
      coalesce(s.cancel_at_period_end, false)
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
-- Update admin_family_detail (drill-down) to include the flag too.
-- =============================================================
create or replace function public.admin_family_detail(p_family_id uuid)
returns jsonb
language plpgsql security definer set search_path = public stable
as $$
#variable_conflict use_column
declare result jsonb;
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
    'billing_period',    s.billing_period,
    'current_period_end',s.current_period_end,
    'cancel_at_period_end', coalesce(s.cancel_at_period_end, false),
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
-- After running:
--   - Redeploy the stripe-webhook Edge Function to pick up the
--     `cancel_at_period_end` field (code in repo already reads it).
--   - Hard-refresh the app — the admin dashboard now shows a
--     "cancels {date}" pill on rows that are scheduled to cancel.
-- =============================================================
