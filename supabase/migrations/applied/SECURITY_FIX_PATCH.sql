-- =============================================================================
-- MUMS SECURITY FIX PATCH — v3.9.23
-- =============================================================================
-- Fixes 4 Security Advisor errors:
--   1. RLS Disabled: public.mums_presence
--   2. RLS Disabled: public.mums_sync_log
--   3. RLS Disabled: public.task_distributions
--   4. RLS Disabled: public.task_items
--
-- Run in: Supabase → SQL Editor → New Query → RUN
-- Safe to run multiple times (idempotent).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- FIX 1: mums_presence
-- -----------------------------------------------------------------------------
-- Presence is written by the server (service role bypasses RLS).
-- Authenticated users can read (needed for the online roster).
-- No client-side writes allowed.
-- -----------------------------------------------------------------------------
alter table public.mums_presence enable row level security;

drop policy if exists "presence_read"  on public.mums_presence;
drop policy if exists "presence_write" on public.mums_presence;

create policy "presence_read" on public.mums_presence
  for select to authenticated using (true);

-- No insert/update/delete policies = blocked for all non-service-role clients.


-- -----------------------------------------------------------------------------
-- FIX 2: mums_sync_log
-- -----------------------------------------------------------------------------
-- Sync log is written by the server only (service role).
-- SUPER_ADMIN can read for audit purposes.
-- Regular authenticated users: no access needed (server-side only).
-- -----------------------------------------------------------------------------
alter table public.mums_sync_log enable row level security;

drop policy if exists "sync_log_read_superadmin" on public.mums_sync_log;

create policy "sync_log_read_superadmin" on public.mums_sync_log
  for select to authenticated
  using (public.mums_is_super_admin(auth.uid()));

-- No insert/update/delete policies = service role only.


-- -----------------------------------------------------------------------------
-- FIX 3: task_distributions
-- -----------------------------------------------------------------------------
-- Authenticated users can read all distributions.
-- Writes are server-side only (service role).
-- -----------------------------------------------------------------------------
alter table public.task_distributions enable row level security;

drop policy if exists "task_distributions_read"  on public.task_distributions;
drop policy if exists "task_distributions_write" on public.task_distributions;

create policy "task_distributions_read" on public.task_distributions
  for select to authenticated using (true);

create policy "task_distributions_write" on public.task_distributions
  for all to service_role using (true) with check (true);


-- -----------------------------------------------------------------------------
-- FIX 4: task_items
-- -----------------------------------------------------------------------------
-- Authenticated users can read all task items.
-- Writes are server-side only (service role).
-- -----------------------------------------------------------------------------
alter table public.task_items enable row level security;

drop policy if exists "task_items_read"  on public.task_items;
drop policy if exists "task_items_write" on public.task_items;

create policy "task_items_read" on public.task_items
  for select to authenticated using (true);

create policy "task_items_write" on public.task_items
  for all to service_role using (true) with check (true);


-- -----------------------------------------------------------------------------
-- Also fix: support_catalog tables (if they exist but RLS is not enabled)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='support_catalog') then
    execute 'alter table public.support_catalog enable row level security';
    execute 'alter table public.support_catalog_comments enable row level security';
    execute 'alter table public.support_catalog_history enable row level security';
  end if;
end $$;


-- =============================================================================
-- Reload PostgREST schema cache
-- =============================================================================
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE. Go back to Security Advisor → Refresh.
-- The 4 RLS errors should be gone.
--
-- For the WARNING "Leaked Password Protection Disabled":
-- Fix manually: Auth → Settings → Enable "Leaked Password Protection" toggle
-- (Cannot be done via SQL — it's an Auth dashboard setting)
-- =============================================================================
