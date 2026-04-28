-- Kids Coin Quest — daily family backups (Apr 2026)
--
-- Each family gets one snapshot per local day (idempotent — running the
-- create function twice in the same day is a no-op). Backups are
-- triggered client-side on session load (cheap RPC, no-op if today's
-- snapshot exists). Admins can list + restore from the global admin
-- dashboard's family drill-down modal.
--
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.

create table if not exists public.family_backups (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  state          jsonb not null,
  backup_date    date not null default current_date,
  created_at     timestamptz not null default now()
);

-- One backup per family per day. ON CONFLICT DO NOTHING in
-- create_my_backup_if_due() turns repeated calls into no-ops.
create unique index if not exists family_backups_family_date_unique
  on public.family_backups(family_id, backup_date);

-- Fast lookup for "show me this family's backups newest-first".
create index if not exists family_backups_family_created_idx
  on public.family_backups(family_id, created_at desc);

alter table public.family_backups enable row level security;

drop policy if exists "family_backups_owner_read" on public.family_backups;
create policy "family_backups_owner_read" on public.family_backups
  for select using (auth.uid() = owner_user_id);

drop policy if exists "family_backups_admin_read_all" on public.family_backups;
create policy "family_backups_admin_read_all" on public.family_backups
  for select using (public.current_user_is_admin());

-- Inserts go through create_my_backup_if_due() (security definer);
-- writes via .from() are blocked by RLS — that's intentional.

-- =============================================================
-- create_my_backup_if_due() — client-side trigger.
-- Snapshots the caller's family state into family_backups for today.
-- Idempotent: if today's backup already exists, returns null.
-- =============================================================
create or replace function public.create_my_backup_if_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  inserted_row record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.family_backups (family_id, owner_user_id, state)
  select id, owner_user_id, state
  from public.families
  where owner_user_id = auth.uid()
  on conflict (family_id, backup_date) do nothing
  returning id, family_id, backup_date into inserted_row;

  if inserted_row.id is null then
    return jsonb_build_object('created', false, 'reason', 'already_exists_today');
  end if;
  return jsonb_build_object(
    'created', true,
    'backup_id', inserted_row.id,
    'family_id', inserted_row.family_id,
    'backup_date', inserted_row.backup_date
  );
end;
$$;

revoke all on function public.create_my_backup_if_due() from public;
grant execute on function public.create_my_backup_if_due() to authenticated;


-- =============================================================
-- admin_list_family_backups(family_id) — list backups for one family.
-- Returns lightweight per-row aggregates so admins can pick a backup
-- without us sending the full state JSON for each.
-- =============================================================
create or replace function public.admin_list_family_backups(p_family_id uuid)
returns table(
  id          uuid,
  backup_date date,
  created_at  timestamptz,
  hero_count  int,
  tx_count    int,
  coin_total  numeric
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
      b.id,
      b.backup_date,
      b.created_at,
      coalesce(jsonb_array_length(b.state->'kids'), 0)::int,
      coalesce(jsonb_array_length(b.state->'transactions'), 0)::int,
      coalesce((
        select sum((k->>'balance')::numeric)
        from jsonb_array_elements(coalesce(b.state->'kids', '[]'::jsonb)) k
      ), 0)
    from public.family_backups b
    where b.family_id = p_family_id
    order by b.backup_date desc, b.created_at desc;
end;
$$;

revoke all on function public.admin_list_family_backups(uuid) from public;
grant execute on function public.admin_list_family_backups(uuid) to authenticated;


-- =============================================================
-- admin_restore_family_backup(backup_id) — overwrite families.state
-- with the snapshot from the given backup. Saves a "pre-restore"
-- snapshot of the CURRENT state under today's date first (with
-- ON CONFLICT UPDATE), so the admin can roll back the restore by
-- restoring today's snapshot. Atomic.
-- =============================================================
create or replace function public.admin_restore_family_backup(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  backup_state    jsonb;
  backup_fam_id   uuid;
  backup_owner_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Look up the backup we're about to restore.
  select b.state, b.family_id, b.owner_user_id
    into backup_state, backup_fam_id, backup_owner_id
  from public.family_backups b
  where b.id = p_backup_id;

  if backup_fam_id is null then
    raise exception 'backup not found';
  end if;

  -- Pre-restore snapshot — save the current state under TODAY's date so
  -- admin can roll back. ON CONFLICT UPDATE because there might already
  -- be a today-snapshot from the user's session; the latest pre-restore
  -- state replaces it (this IS the latest "before-anything-happened"
  -- state from the admin's POV).
  insert into public.family_backups (family_id, owner_user_id, state, backup_date)
  select id, owner_user_id, state, current_date
  from public.families
  where id = backup_fam_id
  on conflict (family_id, backup_date) do update
    set state = excluded.state, created_at = now();

  -- Apply the restore.
  update public.families
  set state = backup_state, updated_at = now()
  where id = backup_fam_id;

  return jsonb_build_object(
    'restored', true,
    'family_id', backup_fam_id,
    'from_backup_id', p_backup_id
  );
end;
$$;

revoke all on function public.admin_restore_family_backup(uuid) from public;
grant execute on function public.admin_restore_family_backup(uuid) to authenticated;
