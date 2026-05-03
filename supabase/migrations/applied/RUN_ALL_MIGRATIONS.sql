-- =============================================================================
-- RUN_ALL_MIGRATIONS.sql (COMPLETE — Phase 637 / QBTabBugFix)
-- Generated: 2026-03-12
-- Purpose: Full idempotent migration set for BOTH PROD and UAT Supabase projects.
-- Run in Supabase SQL Editor as role: postgres
-- ALL statements are safe to run multiple times (IF NOT EXISTS / OR REPLACE).
-- =============================================================================


-- ===========================================================================
-- Migration: 20260127_01_profiles_avatar_url.sql
-- ===========================================================================

-- 2026-01-27: Add avatar_url to mums_profiles (profile photos stored in Storage public bucket)
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists avatar_url text;

-- Optional: keep updated_at correct (trigger is already created in schema.sql).


-- ===========================================================================
-- Migration: 20260127_02_storage_public_bucket.sql
-- ===========================================================================

-- 2026-01-27: Supabase Storage public bucket bootstrap (optional)
--
-- Goal: Create a PUBLIC bucket (default name: "public") for avatars and other images.
--
-- IMPORTANT
-- - This app performs SERVER-SIDE uploads only (Vercel /api/users/upload_avatar).
-- - Client-side upload policies are not required.
-- - Public reads are allowed by marking the bucket public.
--
-- If you want a different bucket name, set the Vercel env var:
--   SUPABASE_PUBLIC_BUCKET=<your_bucket>

-- 1) Create/ensure a public bucket named "public".
-- NOTE: Storage schema may differ across Supabase versions; if this fails,
-- create the bucket from the UI instead.
insert into storage.buckets (id, name, public)
values ('public', 'public', true)
on conflict (id) do update set public = true;

-- 2) OPTIONAL RLS policies for storage.objects
-- If you have RLS enabled on storage.objects and you want explicit read rules,
-- you may enable these. Public buckets usually do not require these for reads.
--
-- alter table storage.objects enable row level security;
--
-- -- Allow anyone (including anon) to read objects in the public bucket.
-- drop policy if exists "Public bucket read" on storage.objects;
-- create policy "Public bucket read" on storage.objects
-- for select
-- using (bucket_id = 'public');
--
-- -- Block client-side writes (uploads are server-side only). This is the default
-- -- if you do not create any insert/update policies for authenticated/anon.


-- ===========================================================================
-- Migration: 20260128_01_profiles_team_override.sql
-- ===========================================================================

-- MUMS: SUPER_ADMIN team override
-- Allows SUPER_ADMIN to optionally assign themselves to a shift team while defaulting to Developer Access.

alter table if exists public.mums_profiles
  add column if not exists team_override boolean not null default false;

-- Backfill: SUPER roles infer override from whether a team_id is set.
update public.mums_profiles
set team_override = (team_id is not null)
where upper(coalesce(role,'')) in ('SUPER_ADMIN','SUPER_USER');

-- Enforce default Developer Access for SUPER roles without override.
update public.mums_profiles
set team_id = null
where upper(coalesce(role,'')) in ('SUPER_ADMIN','SUPER_USER')
  and team_override = false;


-- ===========================================================================
-- Migration: 20260128_02_deduplicate_supermace.sql
-- ===========================================================================

-- MUMS Step 2: Deduplicate Super Mace (and any other accidental duplicates) by email
-- Goal:
--   1) Ensure only one mums_profiles row exists for email supermace@mums.local
--   2) Enforce a unique constraint on mums_profiles.email going forward
-- Notes:
--   - Your current mums_profiles schema does NOT include an email column. This migration adds it.
--   - This migration intentionally does NOT touch auth.users (Supabase Auth) records.

-- 1) Enable CITEXT for case-insensitive email.
create extension if not exists citext;

-- 2) Add email column (nullable) to mums_profiles.
alter table if exists public.mums_profiles
  add column if not exists email citext;

-- 3) Backfill/refresh email from auth.users (authoritative source).
--    We overwrite to guarantee alignment.
update public.mums_profiles p
set email = lower(trim(u.email))::citext
from auth.users u
where u.id = p.user_id
  and u.email is not null;

-- Normalize blanks to NULL (defensive).
update public.mums_profiles
set email = null
where email is not null and btrim(email::text) = '';

-- 4) Delete duplicate profile rows by email, keeping the best candidate.
--    Keep order:
--      - SUPER_ADMIN first
--      - then SUPER_USER
--      - then most recently updated
--      - then newest created
with ranked as (
  select
    user_id,
    lower(email::text) as email_key,
    row_number() over (
      partition by lower(email::text)
      order by
        (upper(coalesce(role,'')) = 'SUPER_ADMIN') desc,
        (upper(coalesce(role,'')) = 'SUPER_USER') desc,
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.mums_profiles
  where email is not null
)
delete from public.mums_profiles p
using ranked r
where p.user_id = r.user_id
  and r.rn > 1;

-- 5) Safety check: fail migration if duplicates still exist (should never happen after delete above).
do $$
begin
  if exists (
    select 1
    from public.mums_profiles
    where email is not null
    group by lower(email::text)
    having count(*) > 1
  ) then
    raise exception 'Deduplication failed: duplicate emails still exist in public.mums_profiles.';
  end if;
end $$;

-- 6) Enforce uniqueness on email going forward.
--    (Unique allows multiple NULLs, which is fine; email is populated from auth.users.)
alter table if exists public.mums_profiles
  drop constraint if exists mums_profiles_email_unique;

alter table if exists public.mums_profiles
  add constraint mums_profiles_email_unique unique (email);


-- ===========================================================================
-- Migration: 20260130_01_mums_sync_log.sql
-- ===========================================================================

--------------------------------------------------------------------------------
-- 2026-01-30: MUMS - Audit log for mailbox override changes (safe migration)
-- Creates mums_sync_log if it does not exist.
-- Required constraints:
--   - user_id is NOT NULL
--------------------------------------------------------------------------------

create table if not exists public.mums_sync_log (
  id bigserial primary key,
  user_id uuid not null,
  scope text not null check (scope in ('global','superadmin')),
  "timestamp" timestamptz not null default now(),
  effective_time timestamptz,
  action text not null
);

create index if not exists mums_sync_log_timestamp_idx
  on public.mums_sync_log ("timestamp" desc);

create index if not exists mums_sync_log_scope_idx
  on public.mums_sync_log (scope);

--------------------------------------------------------------------------------
-- NOTE:
-- RLS is not enabled here. If you enable RLS in the future, ensure that:
--   - Only SUPER_ADMIN can insert rows (server already enforces).
--   - Read permissions are aligned with your audit visibility requirements.
--------------------------------------------------------------------------------


-- ===========================================================================
-- Migration: 20260130_01_rls_profiles_select_own.sql
-- ===========================================================================

DROP POLICY IF EXISTS profiles_select_own ON public.mums_profiles;
CREATE POLICY profiles_select_own
ON public.mums_profiles
FOR SELECT
USING (user_id = (select auth.uid()));
ALTER TABLE public.mums_profiles ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- Migration: 20260201_01_heartbeat_table.sql
-- ===========================================================================

--------------------------------------------------------------------------------
-- 2026-02-01: Keep-alive heartbeat table (lightweight)
-- Used by /api/keep_alive to prevent Supabase project pausing on free plans.

create table if not exists public.heartbeat (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz default now()
);

-- Keep lightweight: no indexes required.
-- RLS is OFF by default for new tables; keep it disabled.
alter table public.heartbeat disable row level security;


-- ===========================================================================
-- Migration: 20260203_01_heartbeat_uid_rls.sql
-- ===========================================================================

--------------------------------------------------------------------------------
-- 2026-02-03: Heartbeat RLS alignment (uid column + per-user policies)
--
-- Goal:
-- - Add uid column so authenticated clients can write/read their own heartbeat
-- - Enable RLS and enforce per-user access
-- - Keep server-side keep-alive working (service role bypasses RLS)
--------------------------------------------------------------------------------

-- Add user identifier column for RLS enforcement
alter table if exists public.heartbeat
  add column if not exists uid uuid;

-- Enable Row Level Security
alter table public.heartbeat enable row level security;

-- Policies (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heartbeat'
      and policyname = 'User can read own heartbeat'
  ) then
    create policy "User can read own heartbeat"
    on public.heartbeat
    for select
    using (auth.uid() = uid);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heartbeat'
      and policyname = 'User can insert own heartbeat'
  ) then
    create policy "User can insert own heartbeat"
    on public.heartbeat
    for insert
    with check (auth.uid() = uid);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heartbeat'
      and policyname = 'User can update own heartbeat'
  ) then
    create policy "User can update own heartbeat"
    on public.heartbeat
    for update
    using (auth.uid() = uid)
    with check (auth.uid() = uid);
  end if;
end
$$;


-- ===========================================================================
-- Migration: 20260214_01_invite_only_azure_guard.sql
-- ===========================================================================

-- 2026-02-14: Invite-only Azure OAuth guard for auth.users
--
-- Goal:
-- - On new auth.users row insertion, require a pre-existing whitelist row in public.mums_profiles by email.
-- - If matched (case-insensitive), attach auth.users.id to the existing profile row.
-- - If no match, raise an exception to abort signup/login.

create extension if not exists citext;

create or replace function public.mums_link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_profile_exists boolean;
begin
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Invite-only login denied: missing email.';
  end if;

  select exists (
    select 1
    from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  )
  into v_profile_exists;

  if not v_profile_exists then
    raise exception using
      errcode = 'P0001',
      message = format('Invite-only login denied for email: %s', v_email);
  end if;

  update public.mums_profiles p
  set user_id = new.id,
      updated_at = now()
  where lower(trim(coalesce(p.email::text, ''))) = v_email;

  return new;
end;
$$;

drop trigger if exists trg_mums_link_auth_user_to_profile on auth.users;

create trigger trg_mums_link_auth_user_to_profile
after insert on auth.users
for each row
execute function public.mums_link_auth_user_to_profile();


-- ===========================================================================
-- Migration: 20260215_01_task_items_reference_url_and_distribution_idx.sql
-- ===========================================================================

-- 2026-02-15: Task orchestration high-volume support
-- 1) Add optional reference_url to task_items for OneDrive/SharePoint links.
-- 2) Ensure distribution_id has an index for faster grouping/aggregation.

alter table if exists public.task_items
  add column if not exists reference_url text;

create index if not exists task_items_distribution_id_idx
  on public.task_items (distribution_id);


-- ===========================================================================
-- Migration: 20260216_01_task_orchestration_core.sql
-- ===========================================================================

-- 2026-02-16: Task Orchestration Core (Distributions + Items)
--
-- Why:
-- - /api/tasks/* endpoints expect these objects to exist.
-- - Missing tables/views will cause 500s like "distribution_create_failed".
--
-- Safe to run multiple times.

--------------------------------------------------------------------------------
-- UUID generator (Supabase usually has this, but keep it safe/idempotent)
--------------------------------------------------------------------------------

create extension if not exists pgcrypto;

--------------------------------------------------------------------------------
-- task_distributions
--------------------------------------------------------------------------------

create table if not exists public.task_distributions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  title text not null,
  description text,
  reference_url text,
  status text not null default 'ONGOING'
);

create index if not exists task_distributions_created_by_idx
  on public.task_distributions (created_by);

--------------------------------------------------------------------------------
-- task_items
--------------------------------------------------------------------------------

create table if not exists public.task_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  distribution_id uuid not null references public.task_distributions(id) on delete cascade,

  -- Work metadata
  case_number text not null,
  site text not null,

  -- Assignee
  assigned_to uuid not null,

  -- Task details
  task_description text not null,
  description text,
  remarks text,
  reference_url text,
  status text not null default 'PENDING'
);

create index if not exists task_items_distribution_id_idx
  on public.task_items (distribution_id);

create index if not exists task_items_assigned_to_idx
  on public.task_items (assigned_to);

-- RLS for task tables (Security Advisor requirement)
alter table public.task_distributions enable row level security;
drop policy if exists "task_distributions_read"         on public.task_distributions;
drop policy if exists "task_distributions_service_write" on public.task_distributions;
create policy "task_distributions_read"
  on public.task_distributions for select to authenticated using (true);
create policy "task_distributions_service_write"
  on public.task_distributions for all to service_role using (true) with check (true);

alter table public.task_items enable row level security;
drop policy if exists "task_items_read"          on public.task_items;
drop policy if exists "task_items_service_write" on public.task_items;
create policy "task_items_read"
  on public.task_items for select to authenticated using (true);
create policy "task_items_service_write"
  on public.task_items for all to service_role using (true) with check (true);

--------------------------------------------------------------------------------
-- view: team workload matrix (optional helper)
-- NOTE: We DROP first to avoid Postgres 42P16 (cannot drop columns from view)
--------------------------------------------------------------------------------

drop view if exists public.view_team_workload_matrix;

create view public.view_team_workload_matrix
with (security_invoker=true)
as
select
  assigned_to as user_id,
  count(*) filter (where status in ('PENDING','ONGOING')) as open_tasks,
  count(*) as total_tasks,
  max(updated_at) as last_updated_at
from public.task_items
group by assigned_to;


-- ===========================================================================
-- Migration: 20260217_01_security_advisor_hardening.sql
-- ===========================================================================

-- 2026-02-17: Security Advisor hardening
--
-- Addresses common Supabase Security Advisor findings:
-- - SECURITY DEFINER view warning (prefer SECURITY INVOKER)
-- - Functions with mutable/unspecified search_path
-- - Extensions installed in public schema (move to extensions)
--
-- Safe to run multiple times.

--------------------------------------------------------------------------------
-- Ensure extensions schema exists
--------------------------------------------------------------------------------

create schema if not exists extensions;

--------------------------------------------------------------------------------
-- Move citext extension out of public schema (if present)
--------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'citext') then
    if (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'citext') = 'public' then
      execute 'alter extension citext set schema extensions';
    end if;
  end if;
exception when others then
  -- Non-fatal: extension move may require elevated privileges depending on project settings.
  null;
end$$;

--------------------------------------------------------------------------------
-- Set SECURITY INVOKER on workload view if it exists
--------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'view_team_workload_matrix'
      and c.relkind = 'v'
  ) then
    execute 'alter view public.view_team_workload_matrix set (security_invoker=true)';
  end if;
exception when others then
  null;
end$$;

--------------------------------------------------------------------------------
-- Harden trigger/util functions: set explicit search_path
--------------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.mums_set_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Re-apply search_path hardening for auth->profile linking helper
-- Re-apply search_path hardening for auth->profile linking helper
create or replace function public.mums_link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text;
  v_profile_exists boolean;
begin
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Invite-only login denied: missing email.';
  end if;

  select exists (
    select 1
    from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  )
  into v_profile_exists;

  if not v_profile_exists then
    raise exception using
      errcode = 'P0001',
      message = format('Invite-only login denied for email: %s', v_email);
  end if;

  update public.mums_profiles p
  set user_id = new.id,
      updated_at = now()
  where lower(trim(coalesce(p.email::text, ''))) = v_email;

  return new;
end;
$$;


-- ===========================================================================
-- Migration: 20260217_02_phase1_task_distribution_monitoring - Copy.sql
-- ===========================================================================

-- -----------------------------------------------------------------------------
-- 2026-02-17: Phase 1 Foundation — Task Distribution & Monitoring
--
-- Why:
-- - Support richer per-task tracking (status enum, problem notes, audit fields)
-- - Support distribution-level opt-in for daily reminders
--
-- Safe to run multiple times.
-- -----------------------------------------------------------------------------

-- Distribution-level toggle
alter table if exists public.task_distributions
  add column if not exists enable_daily_alerts boolean not null default false;

-- Canonical task status enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_item_status') then
    create type public.task_item_status as enum ('Pending', 'Ongoing', 'Completed', 'With Problem');
  end if;
end $$;

-- New audit/problem fields
alter table if exists public.task_items
  add column if not exists problem_notes text,
  add column if not exists assigned_by uuid,
  add column if not exists transferred_from uuid;

-- Ensure task_items.status uses the enum (migrates legacy values safely)
do $$
declare
  current_udt text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'status'
  ) then
    select udt_name into current_udt
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'status'
    limit 1;

    if current_udt is distinct from 'task_item_status' then
      -- Remove default before type cast
      begin
        alter table public.task_items alter column status drop default;
      exception when others then
        -- ignore
      end;

      alter table public.task_items
        alter column status type public.task_item_status
        using (
          case upper(status::text)
            when 'PENDING' then 'Pending'::public.task_item_status
            when 'IN_PROGRESS' then 'Ongoing'::public.task_item_status
            when 'ONGOING' then 'Ongoing'::public.task_item_status
            when 'DONE' then 'Completed'::public.task_item_status
            when 'COMPLETED' then 'Completed'::public.task_item_status
            when 'WITH_PROBLEM' then 'With Problem'::public.task_item_status
            when 'WITH PROBLEM' then 'With Problem'::public.task_item_status
            else 'Pending'::public.task_item_status
          end
        );
    end if;
  else
    alter table public.task_items
      add column status public.task_item_status not null default 'Pending';
  end if;
end $$;

-- Backfill + enforce defaults
update public.task_items set status = 'Pending' where status is null;

alter table public.task_items
  alter column status set default 'Pending',
  alter column status set not null;

-- Workload matrix view (matches /api/tasks/workload_matrix expectations)
drop view if exists public.view_team_workload_matrix;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'mums_profiles'
  )
  or exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name = 'mums_profiles'
  ) then
    execute $$
      create view public.view_team_workload_matrix
      with (security_invoker = true)
      as
      select
        ti.id as task_item_id,
        ti.status as task_status,
        td.title as distribution_title,
        coalesce(mp.name, mp.username, mp.user_id::text) as member_name,
        mp.duty as member_shift,
        coalesce(ti.updated_at, ti.created_at) as last_update
      from public.task_items ti
      join public.task_distributions td on td.id = ti.distribution_id
      left join public.mums_profiles mp on mp.user_id = ti.assigned_to;
    $$;
  else
    execute $$
      create view public.view_team_workload_matrix
      with (security_invoker = true)
      as
      select
        ti.id as task_item_id,
        ti.status as task_status,
        td.title as distribution_title,
        ti.assigned_to::text as member_name,
        null::text as member_shift,
        coalesce(ti.updated_at, ti.created_at) as last_update
      from public.task_items ti
      join public.task_distributions td on td.id = ti.distribution_id;
    $$;
  end if;
end $$;


-- ===========================================================================
-- Migration: 20260223_global_theme_settings.sql
-- ===========================================================================

-- Global Theme Settings Migration
-- Purpose: Allow Super Admin to set default theme for all users
-- Date: 2026-02-23

-- Create global settings table
CREATE TABLE IF NOT EXISTS public.mums_global_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default theme setting
INSERT INTO public.mums_global_settings (setting_key, setting_value)
VALUES ('default_theme', '"aurora_midnight"'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- Enable RLS
ALTER TABLE public.mums_global_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone authenticated can read global settings
CREATE POLICY "Anyone can read global settings"
  ON public.mums_global_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only service role can write (Super Admin via API)
CREATE POLICY "Service role can write global settings"
  ON public.mums_global_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add theme_preference column to profiles (user override)
ALTER TABLE public.mums_profiles 
ADD COLUMN IF NOT EXISTS theme_preference TEXT DEFAULT NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_mums_profiles_theme_preference 
ON public.mums_profiles(theme_preference);

-- Comment for documentation
COMMENT ON TABLE public.mums_global_settings IS 'Global application settings managed by Super Admin';
COMMENT ON COLUMN public.mums_profiles.theme_preference IS 'User theme override (NULL = use global default)';


-- ===========================================================================
-- Migration: 20260226_01_fix_profiles_policy_recursion.sql
-- ===========================================================================

-- 2026-02-26: Fix infinite recursion in mums_profiles RLS policies
--
-- Root cause:
--   Policy expressions queried public.mums_profiles from within policies on the
--   same table, which can recurse during RLS evaluation.
--
-- Fix:
--   Route SUPER_ADMIN checks through a SECURITY DEFINER helper.

create or replace function public.mums_is_super_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.mums_profiles p
    where p.user_id = p_uid
      and p.role = 'SUPER_ADMIN'
  );
$$;

drop policy if exists "profiles_select_superadmin" on public.mums_profiles;
create policy "profiles_select_superadmin" on public.mums_profiles
for select to authenticated
using (public.mums_is_super_admin(auth.uid()));

drop policy if exists "override_update_superadmin" on public.mums_mailbox_override;
create policy "override_update_superadmin" on public.mums_mailbox_override
for update to authenticated
using (public.mums_is_super_admin(auth.uid()))
with check (public.mums_is_super_admin(auth.uid()));


-- ===========================================================================
-- Migration: 20260226_02_profiles_quickbase_columns.sql
-- ===========================================================================

-- 2026-02-26: Ensure Quickbase configuration columns exist on mums_profiles
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists qb_token text,
  add column if not exists qb_realm text,
  add column if not exists qb_table_id text,
  add column if not exists qb_qid text,
  add column if not exists qb_report_link text;


-- ===========================================================================
-- Migration: 20260228_03_mums_profiles_quickbase_extended_columns.sql
-- ===========================================================================

-- 2026-02-28: Ensure full Quickbase settings persistence columns exist on mums_profiles
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists quickbase_config jsonb,
  add column if not exists quickbase_settings jsonb,
  add column if not exists qb_custom_columns text[],
  add column if not exists qb_custom_filters jsonb,
  add column if not exists qb_filter_match text;


-- ===========================================================================
-- Migration: 20260228_04_user_quickbase_settings_rls.sql
-- ===========================================================================

-- 2026-02-28: Security Advisor fix for public.user_quickbase_settings
-- Enables RLS and adds owner-scoped policies when table exists.
-- Safe to run multiple times.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_quickbase_settings'
  ) then
    execute 'alter table public.user_quickbase_settings enable row level security';

    execute 'drop policy if exists "user_quickbase_settings_select_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_select_own" on public.user_quickbase_settings for select using (auth.uid() = user_id)';

    execute 'drop policy if exists "user_quickbase_settings_insert_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_insert_own" on public.user_quickbase_settings for insert with check (auth.uid() = user_id)';

    execute 'drop policy if exists "user_quickbase_settings_update_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_update_own" on public.user_quickbase_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id)';

    execute 'drop policy if exists "user_quickbase_settings_delete_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_delete_own" on public.user_quickbase_settings for delete using (auth.uid() = user_id)';
  end if;
end $$;


-- ===========================================================================
-- Migration: 20260302_01_mums_profiles_add_qb_dashboard_counters.sql
-- ===========================================================================

-- 2026-03-02: Ensure dashboard counters column exists for cross-device Quickbase widget persistence
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists qb_dashboard_counters jsonb;


-- ===========================================================================
-- Migration: 20260303_02_add_quickbase_settings_jsonb.sql
-- ===========================================================================

-- 2026-03-03: Ensure mums_profiles.quickbase_settings exists as JSONB for multi-tab sync payloads
-- Safe to run multiple times.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mums_profiles'
      and column_name = 'quickbase_settings'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'mums_profiles'
        and column_name = 'quickbase_settings'
        and data_type <> 'jsonb'
    ) then
      execute 'alter table public.mums_profiles alter column quickbase_settings type jsonb using to_jsonb(quickbase_settings)';
    end if;
  else
    execute 'alter table public.mums_profiles add column quickbase_settings jsonb';
  end if;
end $$;


-- ===========================================================================
-- Migration: 20260303_02_quickbase_settings_jsonb_fix.sql
-- ===========================================================================

-- Fix Quickbase Settings Persistence
-- Ensures quickbase_settings column exists on mums_profiles with proper JSONB type

BEGIN;

-- Step 1: Ensure quickbase_settings column exists and is JSONB
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'mums_profiles'
    AND column_name = 'quickbase_settings'
  ) THEN
    ALTER TABLE public.mums_profiles
    ADD COLUMN quickbase_settings JSONB DEFAULT '{}'::jsonb;
  ELSE
    -- Convert to JSONB if it's TEXT
    ALTER TABLE public.mums_profiles
    ALTER COLUMN quickbase_settings TYPE JSONB USING
      CASE
        WHEN quickbase_settings IS NULL THEN '{}'::jsonb
        WHEN quickbase_settings::text = '' THEN '{}'::jsonb
        ELSE quickbase_settings::jsonb
      END;
  END IF;
END $$;

-- Step 2: Set default value for existing NULL records
UPDATE public.mums_profiles
SET quickbase_settings = '{}'::jsonb
WHERE quickbase_settings IS NULL;

-- Step 3: Migrate legacy quickbase_config to quickbase_settings if not already migrated
UPDATE public.mums_profiles mp
SET quickbase_settings = COALESCE(mp.quickbase_config, '{}'::jsonb)
WHERE (mp.quickbase_settings IS NULL OR mp.quickbase_settings = '{}'::jsonb)
  AND mp.quickbase_config IS NOT NULL
  AND mp.quickbase_config != '{}'::jsonb;

-- Step 4: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_mums_profiles_quickbase_settings
ON public.mums_profiles USING GIN (quickbase_settings);

-- Step 5: Ensure RLS allows users to update their own quickbase_settings
DROP POLICY IF EXISTS "Users can update own quickbase_settings" ON public.mums_profiles;
CREATE POLICY "Users can update own quickbase_settings"
ON public.mums_profiles
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMIT;


-- ===========================================================================
-- Migration: 20260303_create_quickbase_tabs.sql
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.quickbase_tabs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  tab_name TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quickbase_user_tab
  ON public.quickbase_tabs (user_id, tab_id);

COMMIT;


-- ===========================================================================
-- Migration: 20260305_01_quickbase_tabs_upsert_constraint.sql
-- ===========================================================================

-- Fix: Add a proper UNIQUE CONSTRAINT (in addition to the existing unique index)
-- so PostgREST on_conflict upsert works correctly.
-- PostgREST requires a named unique CONSTRAINT for on_conflict resolution,
-- not just a unique index, in certain Supabase/PostgREST versions.

-- Create table if not yet created (safe no-op if already exists)
CREATE TABLE IF NOT EXISTS public.quickbase_tabs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  tab_name TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Drop old index if it exists (we'll replace with a proper constraint)
DROP INDEX IF EXISTS public.uq_quickbase_user_tab;

-- Add proper UNIQUE CONSTRAINT so PostgREST on_conflict works
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_quickbase_user_tab'
      AND conrelid = 'public.quickbase_tabs'::regclass
  ) THEN
    ALTER TABLE public.quickbase_tabs
      ADD CONSTRAINT uq_quickbase_user_tab UNIQUE (user_id, tab_id);
  END IF;
END $$;

-- Enable RLS (safe no-op if already enabled)
ALTER TABLE public.quickbase_tabs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by Vercel API)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'quickbase_tabs' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.quickbase_tabs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ===========================================================================
-- Migration: 20260306_02_login_mode_trigger_guard.sql
-- ===========================================================================

-- 2026-03-06: Login Mode aware auth guard
--
-- Modifies mums_link_auth_user_to_profile() so that the invite-only check
-- can be bypassed when the Super Admin has set login_mode to 'password' or 'both'.
--
-- When mode = 'microsoft' : original strict behaviour (profile must exist before auth user)
-- When mode = 'password'  : trigger still links auth→profile when found; skips block if
--                           profile was pre-inserted by the admin create endpoint
-- When mode = 'both'      : same as password (permissive; admin manages profiles)
-- Default (no row)        : treated as 'both' (safe fallback)
--
-- IMPORTANT: The trigger is still required in ALL modes to link auth.users.id to
-- mums_profiles.user_id when the admin create endpoint inserts the profile first.

create or replace function public.mums_link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email        text;
  v_profile_exists boolean;
  v_login_mode   text := 'both';  -- default: permissive
begin
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    -- No email on the auth user — only block in strict Microsoft mode
    begin
      select lower(trim(coalesce((value->>'mode'), 'both')))
        into v_login_mode
        from public.mums_documents
       where key = 'mums_login_mode_settings'
       limit 1;
    exception when others then
      v_login_mode := 'both';
    end;

    if v_login_mode = 'microsoft' then
      raise exception using
        errcode = 'P0001',
        message = 'Invite-only login denied: missing email.';
    end if;
    return new;
  end if;

  -- Read current login mode from mums_documents (safe fallback to 'both')
  begin
    select lower(trim(coalesce((value->>'mode'), 'both')))
      into v_login_mode
      from public.mums_documents
     where key = 'mums_login_mode_settings'
     limit 1;
  exception when others then
    v_login_mode := 'both';
  end;

  -- Check if a whitelisted profile exists for this email
  select exists (
    select 1
    from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  )
  into v_profile_exists;

  if v_profile_exists then
    -- Profile found: link auth.users.id into the profile row
    update public.mums_profiles p
    set user_id   = new.id,
        updated_at = now()
    where lower(trim(coalesce(p.email::text, ''))) = v_email;
  else
    -- No profile found: only block in strict Microsoft-only mode
    if v_login_mode = 'microsoft' then
      raise exception using
        errcode = 'P0001',
        message = format('Invite-only login denied for email: %s', v_email);
    end if;
    -- In 'password' or 'both' mode: allow the insert without blocking
    -- (the admin create endpoint will have pre-inserted the profile row,
    --  or this is a self-signup that ensure_profile will handle)
  end if;

  return new;
end;
$$;

-- Re-apply the trigger (idempotent)
drop trigger if exists trg_mums_link_auth_user_to_profile on auth.users;

create trigger trg_mums_link_auth_user_to_profile
after insert on auth.users
for each row
execute function public.mums_link_auth_user_to_profile();


-- ===========================================================================
-- 2026-03-19: Disk IO Optimization (WAL reduction for Supabase Free Plan)
-- Run: supabase/migrations/20260319_01_disk_io_optimization.sql
-- ===========================================================================
-- mums_presence SET UNLOGGED (no WAL for presence writes - no Realtime sub)
-- mums_documents REPLICA IDENTITY DEFAULT (smaller WAL per UPSERT)
-- mums_sync_log + heartbeat auto-cleanup triggers


-- ===========================================================================
-- 2026-04-10: Free Tier IO Rescue + RLS Security Fix
-- Run: supabase/migrations/20260410_01_free_tier_io_rescue.sql
--      supabase/migrations/20260410_02_rls_security_fix.sql
-- ===========================================================================
-- mums_presence + heartbeat UNLOGGED, heartbeat single-row UPSERT
-- mums_documents + mums_sync_log REPLICA IDENTITY DEFAULT
-- RLS enabled on mums_presence, mums_sync_log, task_distributions, task_items


-- ===========================================================================
-- 2026-04-11: daily_passwords Free Tier Fix (v3.9.30)
-- Run: supabase/migrations/20260411_01_daily_passwords_free_tier_fix.sql
-- ===========================================================================
-- daily_passwords REPLICA IDENTITY DEFAULT (was FULL — doubled WAL per UPDATE)
-- RLS policy updated: auth.uid() IS NOT NULL (eliminates schema cache probe)
-- Realtime publication registration verified (idempotent)


-- ===========================================================================
-- END: Reload PostgREST schema cache
-- ===========================================================================
NOTIFY pgrst, 'reload schema';


-- ===========================================================================
-- Migration: 2026-02-28-add-quickbase-settings.sql
-- ===========================================================================

BEGIN;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS quickbase_settings JSONB;
COMMIT;

-- UPDATE public.users SET quickbase_settings = quickbase_config
-- WHERE quickbase_settings IS NULL AND quickbase_config IS NOT NULL;


-- ===========================================================================
-- Migration: 20260217_02_phase1_task_distribution_monitoring - Copy.sql
-- ===========================================================================

-- -----------------------------------------------------------------------------
-- 2026-02-17: Phase 1 Foundation — Task Distribution & Monitoring
--
-- Why:
-- - Support richer per-task tracking (status enum, problem notes, audit fields)
-- - Support distribution-level opt-in for daily reminders
--
-- Safe to run multiple times.
-- -----------------------------------------------------------------------------

-- Distribution-level toggle
alter table if exists public.task_distributions
  add column if not exists enable_daily_alerts boolean not null default false;

-- Canonical task status enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_item_status') then
    create type public.task_item_status as enum ('Pending', 'Ongoing', 'Completed', 'With Problem');
  end if;
end $$;

-- New audit/problem fields
alter table if exists public.task_items
  add column if not exists problem_notes text,
  add column if not exists assigned_by uuid,
  add column if not exists transferred_from uuid;

-- Ensure task_items.status uses the enum (migrates legacy values safely)
do $$
declare
  current_udt text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'status'
  ) then
    select udt_name into current_udt
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'status'
    limit 1;

    if current_udt is distinct from 'task_item_status' then
      -- Remove default before type cast
      begin
        alter table public.task_items alter column status drop default;
      exception when others then
        -- ignore
      end;

      alter table public.task_items
        alter column status type public.task_item_status
        using (
          case upper(status::text)
            when 'PENDING' then 'Pending'::public.task_item_status
            when 'IN_PROGRESS' then 'Ongoing'::public.task_item_status
            when 'ONGOING' then 'Ongoing'::public.task_item_status
            when 'DONE' then 'Completed'::public.task_item_status
            when 'COMPLETED' then 'Completed'::public.task_item_status
            when 'WITH_PROBLEM' then 'With Problem'::public.task_item_status
            when 'WITH PROBLEM' then 'With Problem'::public.task_item_status
            else 'Pending'::public.task_item_status
          end
        );
    end if;
  else
    alter table public.task_items
      add column status public.task_item_status not null default 'Pending';
  end if;
end $$;

-- Backfill + enforce defaults
update public.task_items set status = 'Pending' where status is null;

alter table public.task_items
  alter column status set default 'Pending',
  alter column status set not null;

-- Workload matrix view (matches /api/tasks/workload_matrix expectations)
drop view if exists public.view_team_workload_matrix;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'mums_profiles'
  )
  or exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name = 'mums_profiles'
  ) then
    execute $$
      create view public.view_team_workload_matrix
      with (security_invoker = true)
      as
      select
        ti.id as task_item_id,
        ti.status as task_status,
        td.title as distribution_title,
        coalesce(mp.name, mp.username, mp.user_id::text) as member_name,
        mp.duty as member_shift,
        coalesce(ti.updated_at, ti.created_at) as last_update
      from public.task_items ti
      join public.task_distributions td on td.id = ti.distribution_id
      left join public.mums_profiles mp on mp.user_id = ti.assigned_to;
    $$;
  else
    execute $$
      create view public.view_team_workload_matrix
      with (security_invoker = true)
      as
      select
        ti.id as task_item_id,
        ti.status as task_status,
        td.title as distribution_title,
        ti.assigned_to::text as member_name,
        null::text as member_shift,
        coalesce(ti.updated_at, ti.created_at) as last_update
      from public.task_items ti
      join public.task_distributions td on td.id = ti.distribution_id;
    $$;
  end if;
end $$;


-- ===========================================================================
-- Migration: 20260312_01_qb_name_global_quickbase.sql
-- ===========================================================================

-- 2026-03-12: Add qb_name to mums_profiles + global quickbase settings support

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add qb_name column to mums_profiles
--    This is the "Assigned To" name value used to filter QB records per user.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.mums_profiles
  ADD COLUMN IF NOT EXISTS qb_name text DEFAULT '' NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ensure mums_documents table exists (already exists, but safe)
--    Global QB settings are stored as a key/value doc with key:
--    'mums_global_quickbase_settings'
-- ─────────────────────────────────────────────────────────────────────────
-- mums_documents already exists from schema.sql — no create needed.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Index for fast qb_name lookups
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mums_profiles_qb_name
  ON public.mums_profiles (qb_name);

NOTIFY pgrst, 'reload schema';


-- ===========================================================================
-- Migration: 20260316_01_support_catalog.sql
-- ===========================================================================

-- Support Catalog: Product Knowledge Base
-- Table 1: Items
create table if not exists support_catalog (
  id               uuid primary key default gen_random_uuid(),
  item_code        text not null unique,
  name             text not null,
  category         text not null default 'Controller',
  brand            text,
  part_number      text,
  specs            text,
  user_guide       text,
  troubleshooting  text,
  compatible_units text,
  status           text not null default 'Active',
  assigned_to      uuid references mums_profiles(user_id) on delete set null,
  assigned_to_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Table 2: Comments
create table if not exists support_catalog_comments (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references support_catalog(id) on delete cascade,
  user_id           uuid not null,
  user_name         text not null,
  comment           text not null,
  is_acknowledged   boolean not null default false,
  acknowledged_by   uuid,
  acknowledged_name text,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now()
);

-- Table 3: Edit history
create table if not exists support_catalog_history (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references support_catalog(id) on delete cascade,
  edited_by     uuid not null,
  edited_by_name text not null,
  field_changed text not null,
  old_value     text,
  new_value     text,
  edited_at     timestamptz not null default now()
);

-- Sample data
insert into support_catalog (item_code, name, category, brand, part_number, specs, status)
values
  ('CTR-001','Product Item 1','Controller','','','','Active'),
  ('CTR-002','Product Item 2','Controller','','','','Active'),
  ('SEN-001','Product Item 3','Sensor','','','','Active'),
  ('SEN-002','Product Item 4','Sensor','','','','Active'),
  ('VLV-001','Product Item 5','Valve','','','','Active')
on conflict (item_code) do nothing;

-- RLS: allow authenticated reads, service role writes
alter table support_catalog enable row level security;
alter table support_catalog_comments enable row level security;
alter table support_catalog_history enable row level security;

create policy "catalog_read" on support_catalog for select using (true);
create policy "catalog_write" on support_catalog for all using (true);
create policy "comments_read" on support_catalog_comments for select using (true);
create policy "comments_write" on support_catalog_comments for all using (true);
create policy "history_read" on support_catalog_history for select using (true);
create policy "history_write" on support_catalog_history for all using (true);


-- ===========================================================================
-- Migration: 20260316_02_catalog_subtree.sql
-- ===========================================================================

-- Support Catalog: Add sub-item / tree hierarchy support
-- Adds parent_id FK so items can have children (sub-items / series variants)

alter table support_catalog
  add column if not exists parent_id uuid
  references support_catalog(id)
  on delete cascade;

-- Index for fast child lookups
create index if not exists idx_catalog_parent_id on support_catalog(parent_id);

-- Update existing items to ensure parent_id is null (clean state)
update support_catalog set parent_id = null where parent_id is null;


-- ===========================================================================
-- Migration: 20260316_03_cleanup_dirty_catalog_codes.sql
-- ===========================================================================

-- Cleanup dirty support_catalog item codes created by the trailing-dash bug
-- Removes records with codes ending in '-' or containing '--' (e.g. CTR-001-, CTR-001--)
-- These were created when the Add Sub-Item button was clicked before a suffix was typed.
-- Safe to run multiple times (idempotent).

-- Step 1: Show what will be deleted (for audit — remove this in prod if not needed)
-- SELECT id, item_code, name, parent_id FROM support_catalog
-- WHERE item_code ~ '-$' OR item_code ~ '--';

-- Step 2: Delete cascades to support_catalog_comments and support_catalog_history
-- via ON DELETE CASCADE foreign keys set up in the original migration.

DELETE FROM support_catalog
WHERE item_code ~ '-$'        -- codes ending in dash:  CTR-001-
   OR item_code ~ '--';       -- codes with double dash: CTR-001--

-- Step 3: Add a CHECK constraint to prevent future dirty codes at DB level
ALTER TABLE support_catalog
  DROP CONSTRAINT IF EXISTS chk_item_code_no_trailing_dash;

ALTER TABLE support_catalog
  ADD CONSTRAINT chk_item_code_no_trailing_dash
  CHECK (
    item_code !~ '-$'   -- no trailing dash
    AND item_code !~ '--' -- no double dash
    AND length(trim(item_code)) > 0  -- not empty
  );


-- ===========================================================================
-- Migration: 20260319_01_disk_io_optimization.sql
-- ===========================================================================

-- =============================================================================
-- 2026-03-19: Disk IO Optimization for Supabase Free Plan (Nano)
-- =============================================================================
-- Problem: Disk IO burst budget exhausted due to WAL overhead from:
--   1. mums_presence — upserted every 45s per user (30 users = ~14,400 writes/day)
--      WAL writes per upsert even though no Realtime subscription exists on this table.
--   2. mums_documents — WAL includes full old-row on UPDATE (REPLICA IDENTITY DEFAULT
--      may already be correct; this migration explicitly confirms it).
--   3. mums_sync_log / heartbeat — unbounded row growth → index bloat → IO.
--
-- All changes are safe to run multiple times (idempotent).
-- Zero downtime. No schema breaking changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FIX 1: Make mums_presence UNLOGGED
-- -----------------------------------------------------------------------------
-- UNLOGGED tables skip WAL entirely. Saves ~14,400 WAL writes/day on a 30-user team.
-- SAFE BECAUSE:
--   a) mums_presence has NO Supabase Realtime (postgres_changes) subscription.
--      realtime.js only subscribes to mums_documents + mums_sync_log.
--   b) Presence data is ephemeral (TTL 360s). On server restart, rows are simply
--      stale — clients re-heartbeat and the table self-heals within 45s.
--   c) No foreign key constraints point TO mums_presence.
-- NOTE: UNLOGGED tables cannot be read by logical replication. Since we have no
--       subscription on this table, this has zero functional impact.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_presence'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND relpersistence = 'p'  -- 'p' = permanent (logged), 'u' = unlogged
  ) THEN
    ALTER TABLE public.mums_presence SET UNLOGGED;
    RAISE NOTICE 'mums_presence: set UNLOGGED (WAL writes eliminated)';
  ELSE
    RAISE NOTICE 'mums_presence: already UNLOGGED or does not exist, skipping';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- FIX 2: Set REPLICA IDENTITY DEFAULT on mums_documents
-- -----------------------------------------------------------------------------
-- DEFAULT: WAL only stores the PRIMARY KEY for the old row on UPDATE/DELETE.
-- FULL: WAL stores ALL columns for the old row — includes the large JSONB
--       value column on every update, even when the Realtime payload only
--       needs a notification trigger.
-- This halves WAL size for every mums_documents UPSERT while keeping
-- Realtime postgres_changes fully functional.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_documents'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.mums_documents REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'mums_documents: REPLICA IDENTITY set to DEFAULT';
  END IF;
END
$$;

-- Also explicitly set on mums_sync_log (Realtime subscriber, INSERT only — FULL not needed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_sync_log'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.mums_sync_log REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'mums_sync_log: REPLICA IDENTITY set to DEFAULT';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- FIX 3: Auto-cleanup mums_sync_log (keep last 200 rows)
-- -----------------------------------------------------------------------------
-- mums_sync_log is written when mailbox time override is changed.
-- Without cleanup, the table grows indefinitely → index bloat → more IO.
-- The Realtime subscription on this table only needs the INSERT event trigger;
-- historical rows have no app value. Keep 200 rows for diagnostics.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mums_sync_log_trim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only trim when table exceeds 300 rows to avoid per-insert overhead
  IF (SELECT count(*) FROM public.mums_sync_log) > 300 THEN
    DELETE FROM public.mums_sync_log
    WHERE id NOT IN (
      SELECT id FROM public.mums_sync_log
      ORDER BY id DESC
      LIMIT 200
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mums_sync_log_trim ON public.mums_sync_log;
CREATE TRIGGER trg_mums_sync_log_trim
  AFTER INSERT ON public.mums_sync_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mums_sync_log_trim();

-- -----------------------------------------------------------------------------
-- FIX 4: Auto-cleanup heartbeat table (keep last 100 rows)
-- -----------------------------------------------------------------------------
-- heartbeat is a keep-alive table; only the latest insertion matters.
-- Old rows consume storage and make index scans slower.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heartbeat_trim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.heartbeat) > 200 THEN
    DELETE FROM public.heartbeat
    WHERE id NOT IN (
      SELECT id FROM public.heartbeat
      ORDER BY timestamp DESC
      LIMIT 100
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heartbeat_trim ON public.heartbeat;
CREATE TRIGGER trg_heartbeat_trim
  AFTER INSERT ON public.heartbeat
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.heartbeat_trim();

-- -----------------------------------------------------------------------------
-- FIX 5: Immediate cleanup of stale rows (one-time on migration run)
-- -----------------------------------------------------------------------------
-- Remove presence rows older than 10 minutes (stale at boot)
DELETE FROM public.mums_presence
WHERE last_seen < NOW() - INTERVAL '10 minutes';

-- Trim sync_log to last 200 rows immediately
DELETE FROM public.mums_sync_log
WHERE id NOT IN (
  SELECT id FROM public.mums_sync_log
  ORDER BY id DESC
  LIMIT 200
);

-- Trim heartbeat to last 100 rows immediately
DELETE FROM public.heartbeat
WHERE id NOT IN (
  SELECT id FROM public.heartbeat
  ORDER BY timestamp DESC
  LIMIT 100
);

-- =============================================================================
-- END OF MIGRATION
-- Expected IO savings:
--   mums_presence UNLOGGED : ~14,400 WAL writes/day eliminated (biggest win)
--   REPLICA IDENTITY DEFAULT: ~50% WAL size reduction per mums_documents UPSERT
--   Table cleanup            : prevents index bloat IO over time
--   Total est. reduction     : >80% of WAL-related Disk IO on normal workloads
-- =============================================================================


-- ===========================================================================
-- Migration: 20260321_01_security_pin.sql
-- ===========================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- MUMS Security PIN Feature Migration
-- Run in Supabase SQL editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add PIN columns to mums_profiles
ALTER TABLE public.mums_profiles
  ADD COLUMN IF NOT EXISTS pin_hash            text             DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_set_at          timestamptz      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_last_used_at    timestamptz      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_fail_count      integer          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_last_fail_at    timestamptz      DEFAULT NULL;

-- 2. Global PIN policy settings stored in mums_documents
-- Key: 'mums_pin_policy'
-- This table already exists; we just use a new key.
-- Insert default policy (all features enabled)
INSERT INTO public.mums_documents (key, value)
VALUES (
  'mums_pin_policy',
  '{
    "enabled": true,
    "requireOnLogin": true,
    "enforceOnFirstLogin": true,
    "sessionExpiryHours": 3,
    "autoLogoutOnFailures": true,
    "maxFailedAttempts": 3
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 3. Index for faster profile lookups
CREATE INDEX IF NOT EXISTS idx_mums_profiles_pin_hash ON public.mums_profiles (pin_hash) WHERE pin_hash IS NOT NULL;

-- ── Notes ────────────────────────────────────────────────────────────────────
-- pin_hash: bcrypt-hashed 4-digit PIN (server-side only, never sent to client)
-- pin_set_at: when PIN was last created/changed
-- pin_last_used_at: last successful PIN auth
-- pin_fail_count: resets to 0 on successful auth (NOT persistent lockout)
-- pin_last_fail_at: timestamp of last failure (for UI display only)


-- ===========================================================================
-- Migration: 20260323_01_studio_qb_settings_upsert_guard.sql
-- ===========================================================================

-- 2026-03-23: Studio QB Settings — ensure mums_documents upsert is safe for token storage.
-- The key `ss_qb_settings_{userId}` is written via service role; this migration:
--   1. Confirms the primary key constraint exists on mums_documents.key
--   2. Ensures no stale/conflicting policies block service-role writes
-- Safe to run multiple times.

do $$
begin
  -- Verify primary key on mums_documents.key exists (should be there from schema.sql)
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema   = kcu.table_schema
    where tc.table_schema    = 'public'
      and tc.table_name      = 'mums_documents'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name    = 'key'
  ) then
    alter table public.mums_documents add primary key (key);
    raise notice 'mums_documents: primary key on (key) added.';
  else
    raise notice 'mums_documents: primary key already exists — no change.';
  end if;
end $$;

-- Ensure service role (used by server) can always write — no RLS block.
-- NOTE: RLS only applies to anon/authenticated; service_role bypasses RLS by default.
-- This is a no-op guard comment — service_role already bypasses RLS in Supabase.
-- If you have custom RLS that restricts service_role, add BYPASSRLS to your service role.


-- ===========================================================================
-- Migration: 20260324_01_apex_forced_defaults.sql
-- ===========================================================================

-- =====================================================
-- Migration: 20260324_01_apex_forced_defaults.sql
-- Purpose:   Add forced theme/brightness support to
--            mums_global_theme_settings document.
--            The JSONB value column already supports
--            arbitrary keys; no schema change needed.
--            This migration ensures the default document
--            row exists with APEX + 130% as defaults.
-- =====================================================

-- Upsert the global theme settings document with
-- APEX as default theme and 130% as default brightness.
-- forcedTheme/forcedBrightness start as false —
-- Super Admin must explicitly press "Force All Users".
INSERT INTO mums_documents (key, value, updated_at, updated_by_name, updated_by_user_id)
VALUES (
  'mums_global_theme_settings',
  '{
    "defaultTheme":    "apex",
    "brightness":      130,
    "contrast":        100,
    "scale":           100,
    "sidebarOpacity":  100,
    "forcedTheme":     false,
    "forcedBrightness":false,
    "forcedAt":        null,
    "forcedByName":    null
  }'::jsonb,
  NOW(),
  'System Migration',
  NULL
)
ON CONFLICT (key) DO UPDATE SET
  value = mums_documents.value ||
    '{"defaultTheme":"apex","brightness":130}'::jsonb,
  updated_at = NOW()
WHERE
  -- Only update if still using old defaults (don't overwrite if admin already customized)
  (mums_documents.value->>'defaultTheme' IN ('aurora_midnight','mums_dark') OR
   mums_documents.value->>'defaultTheme' IS NULL);

-- Comment: After running this migration:
--   1. All NEW users will get APEX theme + 130% brightness automatically.
--   2. EXISTING users retain their saved localStorage preferences
--      UNLESS Super Admin uses "Force All Users" in Main Settings.


-- ===========================================================================
-- Migration: 20260331_daily_passwords.sql
-- ===========================================================================

-- =====================================================================
-- MIGRATION: daily_passwords table
-- Purpose: Store one-day passwords per date, broadcast to all users
-- Manila Time (Asia/Manila = UTC+8) based dates
-- =====================================================================

CREATE TABLE IF NOT EXISTS daily_passwords (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE        NOT NULL UNIQUE,
  password    TEXT        NOT NULL DEFAULT '',
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast date lookups
CREATE INDEX IF NOT EXISTS daily_passwords_date_idx ON daily_passwords(date DESC);

-- RLS: All authenticated users can read
-- All authenticated users can insert/upsert (anyone can broadcast)
ALTER TABLE daily_passwords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dp_read_all"    ON daily_passwords;
DROP POLICY IF EXISTS "dp_write_authed" ON daily_passwords;

CREATE POLICY "dp_read_all" ON daily_passwords
  FOR SELECT USING (true);

CREATE POLICY "dp_write_authed" ON daily_passwords
  FOR ALL USING (auth.role() = 'authenticated');

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE daily_passwords;

COMMENT ON TABLE daily_passwords IS 'One-day passwords broadcast to all users. Date is Manila Time (UTC+8).';


-- ===========================================================================
-- Migration: 20260410_01_free_tier_io_rescue.sql
-- ===========================================================================

-- =============================================================================
-- 2026-04-10: FREE TIER IO RESCUE -- Supabase Nano / Free Plan
-- =============================================================================
-- Problem: Disk IO budget fully depleted daily. Memory at 45%+.
-- Root causes:
--   1. mums_presence  -- UPSERT every 45s x 30 users = ~57,600 WAL writes/day
--   2. heartbeat      -- unbounded INSERT growth
--   3. mums_documents -- REPLICA IDENTITY FULL doubles WAL size per update
--   4. mums_sync_log  -- unbounded growth -> index bloat
--   5. Profile schema probe fires up to 4 DB reads per presence/list call
--
-- All changes are IDEMPOTENT -- safe to run multiple times.
-- Zero downtime. No breaking schema changes.
-- =============================================================================

-- =============================================================================
-- FIX 1: mums_presence -> UNLOGGED
-- Eliminates ~57,600 WAL writes/day. SAFE: no Realtime subscription on this table.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_presence'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND relpersistence = 'p'
  ) THEN
    ALTER TABLE public.mums_presence SET UNLOGGED;
    RAISE NOTICE 'mums_presence: SET UNLOGGED done';
  ELSE
    RAISE NOTICE 'mums_presence: already UNLOGGED or missing -- skipped';
  END IF;
END
$$;

-- Remove stale presence rows immediately
DELETE FROM public.mums_presence
WHERE last_seen < NOW() - INTERVAL '10 minutes';

-- =============================================================================
-- FIX 2a: heartbeat -> UNLOGGED
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND relpersistence = 'p'
  ) THEN
    ALTER TABLE public.heartbeat SET UNLOGGED;
    RAISE NOTICE 'heartbeat: SET UNLOGGED done';
  ELSE
    RAISE NOTICE 'heartbeat: already UNLOGGED or missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 2b: heartbeat -- add source column for single-row UPSERT
-- Lets keep_alive.js UPSERT on source='server' -> 1 row forever, no growth.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'heartbeat'
      AND column_name  = 'source'
  )
  THEN
    ALTER TABLE public.heartbeat ADD COLUMN source TEXT;
    RAISE NOTICE 'heartbeat: source column added done';
  ELSE
    RAISE NOTICE 'heartbeat: source column already exists or table missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 2c: heartbeat -- add UNIQUE constraint on source
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname    = 'heartbeat_source_unique'
      AND conrelid   = 'public.heartbeat'::regclass
  )
  THEN
    -- Assign a value to any null source rows before adding constraint
    UPDATE public.heartbeat
    SET source = 'server_' || id::text
    WHERE source IS NULL;

    -- Keep only the newest row per source
    DELETE FROM public.heartbeat
    WHERE id NOT IN (
      SELECT DISTINCT ON (COALESCE(source, id::text)) id
      FROM public.heartbeat
      ORDER BY COALESCE(source, id::text), timestamp DESC NULLS LAST
    );

    ALTER TABLE public.heartbeat
      ADD CONSTRAINT heartbeat_source_unique UNIQUE (source);

    RAISE NOTICE 'heartbeat: UNIQUE(source) constraint added done';
  ELSE
    RAISE NOTICE 'heartbeat: UNIQUE(source) already exists or table missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 2d: heartbeat -- trim to 1 row immediately
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    DELETE FROM public.heartbeat
    WHERE id NOT IN (
      SELECT id FROM public.heartbeat
      ORDER BY timestamp DESC NULLS LAST
      LIMIT 1
    );
    RAISE NOTICE 'heartbeat: trimmed to 1 row done';
  END IF;
END
$$;

-- Replace trim trigger to permanently cap the table at 1 row
CREATE OR REPLACE FUNCTION public.heartbeat_trim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.heartbeat
  WHERE id NOT IN (
    SELECT id FROM public.heartbeat
    ORDER BY timestamp DESC NULLS LAST
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heartbeat_trim ON public.heartbeat;
CREATE TRIGGER trg_heartbeat_trim
  AFTER INSERT OR UPDATE ON public.heartbeat
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.heartbeat_trim();

-- =============================================================================
-- FIX 3: mums_documents -> REPLICA IDENTITY DEFAULT
-- DEFAULT = WAL stores only the PK on UPDATE/DELETE (was FULL = all columns).
-- Gives approx 50 pct reduction in WAL size per upsert.
-- Realtime postgres_changes subscription is unaffected.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_documents'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.mums_documents REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'mums_documents: REPLICA IDENTITY DEFAULT done';
  ELSE
    RAISE NOTICE 'mums_documents: table not found -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 4: mums_sync_log -- REPLICA IDENTITY DEFAULT + tighter trim
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_sync_log'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.mums_sync_log REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'mums_sync_log: REPLICA IDENTITY DEFAULT done';
  ELSE
    RAISE NOTICE 'mums_sync_log: table not found -- skipped';
  END IF;
END
$$;

-- Tighten sync_log trim: keep 100 rows (was 200)
CREATE OR REPLACE FUNCTION public.mums_sync_log_trim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.mums_sync_log) > 150 THEN
    DELETE FROM public.mums_sync_log
    WHERE id NOT IN (
      SELECT id FROM public.mums_sync_log
      ORDER BY id DESC
      LIMIT 100
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mums_sync_log_trim ON public.mums_sync_log;
CREATE TRIGGER trg_mums_sync_log_trim
  AFTER INSERT ON public.mums_sync_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mums_sync_log_trim();

-- Immediate sync_log trim
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_sync_log'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    DELETE FROM public.mums_sync_log
    WHERE id NOT IN (
      SELECT id FROM public.mums_sync_log
      ORDER BY id DESC
      LIMIT 100
    );
    RAISE NOTICE 'mums_sync_log: trimmed to 100 rows done';
  END IF;
END
$$;

-- =============================================================================
-- FIX 5: Index on mums_presence(last_seen DESC)
-- presence/list.js queries WHERE last_seen >= cutoff every 90s per user.
-- Without this index every query is a full table scan.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_presence'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'mums_presence'
      AND indexname  = 'idx_mums_presence_last_seen'
  )
  THEN
    CREATE INDEX idx_mums_presence_last_seen
      ON public.mums_presence(last_seen DESC);
    RAISE NOTICE 'mums_presence: index on last_seen created done';
  ELSE
    RAISE NOTICE 'mums_presence: last_seen index already exists or table missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- ALL DONE
--
-- Run these separately in a new SQL editor tab (VACUUM cannot run in a DO block):
--   VACUUM ANALYZE public.mums_presence;
--   VACUUM ANALYZE public.heartbeat;
--   VACUUM ANALYZE public.mums_documents;
--   VACUUM ANALYZE public.mums_sync_log;
--
-- Expected results after running this migration:
--   mums_presence UNLOGGED : ~57,600 WAL writes/day eliminated
--   heartbeat single-row   : was growing unbounded, now permanently 1 row
--   REPLICA IDENTITY DEFAULT: approx 50 pct WAL reduction per mums_documents upsert
--   last_seen index        : full table scan replaced by fast index scan
--   Estimated total Disk IO reduction: more than 85 pct
-- =============================================================================


-- ===========================================================================
-- Migration: 20260410_02_rls_security_fix.sql
-- ===========================================================================

-- =============================================================================
-- 2026-04-10: RLS SECURITY FIX -- Fixes all 4 Security Advisor errors
-- =============================================================================
-- Errors being fixed:
--   1. RLS Disabled in Public: public.mums_presence
--   2. RLS Disabled in Public: public.mums_sync_log
--   3. RLS Disabled in Public: public.task_distributions
--   4. RLS Disabled in Public: public.task_items
--
-- Safe to run multiple times (fully idempotent).
-- Service role always bypasses RLS -- server-side routes are unaffected.
-- =============================================================================


-- =============================================================================
-- HELPER: Ensure mums_is_super_admin function exists before using it in policies.
-- This is defined in MASTER_MIGRATION but we re-create it here defensively
-- in case only this patch file is run on a fresh database.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mums_is_super_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mums_profiles
    WHERE user_id = p_uid
      AND UPPER(REPLACE(role, ' ', '_')) IN ('SUPER_ADMIN', 'SUPERADMIN', 'SA')
  );
$$;


-- =============================================================================
-- FIX 1: mums_presence -- Enable RLS
-- =============================================================================
-- Presence is written exclusively by the server (service role bypasses RLS).
-- Authenticated users need SELECT to render the online roster.
-- No client INSERT/UPDATE/DELETE allowed.
-- =============================================================================
ALTER TABLE public.mums_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presence_read"         ON public.mums_presence;
DROP POLICY IF EXISTS "presence_write"        ON public.mums_presence;
DROP POLICY IF EXISTS "presence_select"       ON public.mums_presence;
DROP POLICY IF EXISTS "presence_authed_read"  ON public.mums_presence;

CREATE POLICY "presence_read" ON public.mums_presence
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies = blocked for all non-service-role clients.


-- =============================================================================
-- FIX 2: mums_sync_log -- Enable RLS
-- =============================================================================
-- Sync log is written by the server only (service role).
-- SUPER_ADMIN can read for audit. Regular users: no direct access needed.
-- =============================================================================
ALTER TABLE public.mums_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_log_read_superadmin" ON public.mums_sync_log;
DROP POLICY IF EXISTS "sync_log_read"            ON public.mums_sync_log;

CREATE POLICY "sync_log_read_superadmin" ON public.mums_sync_log
  FOR SELECT
  TO authenticated
  USING (public.mums_is_super_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies = service role only writes.


-- =============================================================================
-- FIX 3: task_distributions -- Enable RLS
-- =============================================================================
-- All authenticated users can read distributions (needed for task dashboard).
-- Writes are via server API only (service role).
-- =============================================================================
ALTER TABLE public.task_distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_distributions_read"         ON public.task_distributions;
DROP POLICY IF EXISTS "task_distributions_write"        ON public.task_distributions;
DROP POLICY IF EXISTS "task_distributions_service_write" ON public.task_distributions;

-- All authenticated users can read all task distributions
CREATE POLICY "task_distributions_read" ON public.task_distributions
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role handles all writes (no client-side writes needed)
CREATE POLICY "task_distributions_service_write" ON public.task_distributions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- FIX 4: task_items -- Enable RLS
-- =============================================================================
-- All authenticated users can read task items (for task dashboard + workload).
-- Writes are via server API only (service role).
-- =============================================================================
ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_items_read"          ON public.task_items;
DROP POLICY IF EXISTS "task_items_write"         ON public.task_items;
DROP POLICY IF EXISTS "task_items_service_write" ON public.task_items;

-- All authenticated users can read all task items
CREATE POLICY "task_items_read" ON public.task_items
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role handles all writes
CREATE POLICY "task_items_service_write" ON public.task_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- BONUS: Also enable RLS on support_catalog tables if they exist
-- (prevents future Security Advisor warnings as the catalog grows)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'support_catalog'
  ) THEN
    ALTER TABLE public.support_catalog         ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.support_catalog_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.support_catalog_history  ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "catalog_read"   ON public.support_catalog;
    DROP POLICY IF EXISTS "catalog_write"  ON public.support_catalog;
    DROP POLICY IF EXISTS "comments_read"  ON public.support_catalog_comments;
    DROP POLICY IF EXISTS "comments_write" ON public.support_catalog_comments;
    DROP POLICY IF EXISTS "history_read"   ON public.support_catalog_history;
    DROP POLICY IF EXISTS "history_write"  ON public.support_catalog_history;

    CREATE POLICY "catalog_read"   ON public.support_catalog          FOR SELECT TO authenticated USING (true);
    CREATE POLICY "catalog_write"  ON public.support_catalog          FOR ALL    TO service_role  USING (true) WITH CHECK (true);
    CREATE POLICY "comments_read"  ON public.support_catalog_comments FOR SELECT TO authenticated USING (true);
    CREATE POLICY "comments_write" ON public.support_catalog_comments FOR ALL    TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "history_read"   ON public.support_catalog_history  FOR SELECT TO authenticated USING (true);
    CREATE POLICY "history_write"  ON public.support_catalog_history  FOR ALL    TO service_role  USING (true) WITH CHECK (true);

    RAISE NOTICE 'support_catalog tables: RLS enabled and policies created done';
  ELSE
    RAISE NOTICE 'support_catalog tables: not found -- skipped';
  END IF;
END
$$;


-- =============================================================================
-- BONUS: heartbeat -- ensure RLS stays enabled after UNLOGGED conversion
-- (Converting a table to UNLOGGED does not disable RLS, but we re-assert
-- it here to guarantee the Security Advisor never flags it.)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.heartbeat ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "User can read own heartbeat"   ON public.heartbeat;
    DROP POLICY IF EXISTS "User can insert own heartbeat" ON public.heartbeat;
    DROP POLICY IF EXISTS "User can update own heartbeat" ON public.heartbeat;
    DROP POLICY IF EXISTS "heartbeat_service_all"         ON public.heartbeat;

    -- Service role only -- heartbeat is a server keep-alive, never touched by clients
    CREATE POLICY "heartbeat_service_all" ON public.heartbeat
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);

    RAISE NOTICE 'heartbeat: RLS enabled, service-role-only policy done';
  END IF;
END
$$;


-- =============================================================================
-- Reload PostgREST schema cache so new policies take effect immediately
-- =============================================================================
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DONE
-- Go to Supabase Security Advisor and click Refresh.
-- All 4 RLS errors should be gone.
--
-- If the WARNING "Leaked Password Protection Disabled" still shows:
--   Fix manually: Auth -> Settings -> Enable "Leaked Password Protection"
--   (This is an Auth dashboard toggle, cannot be set via SQL)
-- =============================================================================


-- ===========================================================================
-- Migration: 20260411_01_daily_passwords_free_tier_fix.sql
-- ===========================================================================

-- =============================================================================
-- 2026-04-11: daily_passwords FREE TIER FIX
-- =============================================================================
-- Problems fixed:
--   1. daily_passwords uses REPLICA IDENTITY FULL (default for tables added to
--      supabase_realtime) — every UPDATE writes ALL columns to WAL (high IO).
--      Fix: set REPLICA IDENTITY DEFAULT → only PK in WAL on UPDATE/DELETE.
--
--   2. RLS policy "dp_write_authed" uses deprecated auth.role() which returns
--      'authenticated' string — this works but triggers a schema cache hit on
--      every write. Use auth.uid() IS NOT NULL instead (no schema probe).
--
--   3. The publication registration (ALTER PUBLICATION ... ADD TABLE) is safe
--      to re-assert — it is idempotent if already registered.
--
--   4. Token refresh: ODP dedicated Supabase client now calls setAuth(token)
--      after createClient — this is a JS-side fix (odp.js) but documented here
--      for the migration audit trail.
--
-- Safe to run multiple times (fully idempotent).
-- =============================================================================


-- =============================================================================
-- FIX 1: REPLICA IDENTITY DEFAULT → reduces WAL size per UPDATE by ~50-80%
-- FULL = WAL stores every column on each UPDATE (was default when added to publication)
-- DEFAULT = WAL stores only the PK — sufficient for Realtime postgres_changes
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.daily_passwords REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'daily_passwords: REPLICA IDENTITY DEFAULT set — WAL size reduced';
  ELSE
    RAISE NOTICE 'daily_passwords: table not found — skipped';
  END IF;
END
$$;


-- =============================================================================
-- FIX 2: Drop and recreate RLS policies using auth.uid() instead of auth.role()
-- auth.role() = 'authenticated' works but probes the schema cache on every eval.
-- auth.uid() IS NOT NULL is cheaper and semantically equivalent for authenticated users.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN

    -- Drop old policies
    DROP POLICY IF EXISTS "dp_read_all"     ON public.daily_passwords;
    DROP POLICY IF EXISTS "dp_write_authed" ON public.daily_passwords;

    -- SELECT: allow all (including anon for public read — passwords are broadcast)
    CREATE POLICY "dp_read_all" ON public.daily_passwords
      FOR SELECT
      USING (true);

    -- INSERT/UPDATE/DELETE: require authenticated session via uid check (cheaper than role())
    CREATE POLICY "dp_write_authed" ON public.daily_passwords
      FOR ALL
      TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL);

    RAISE NOTICE 'daily_passwords: RLS policies updated (auth.uid() IS NOT NULL)';
  END IF;
END
$$;


-- =============================================================================
-- FIX 3: Ensure Realtime publication is registered (idempotent)
-- If already registered, Postgres silently ignores the ADD TABLE command.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'daily_passwords'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_passwords;
    RAISE NOTICE 'daily_passwords: added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'daily_passwords: already in supabase_realtime publication or table missing — skipped';
  END IF;
END
$$;


-- =============================================================================
-- FIX 4: Add updated_at index for efficient range queries
-- (ODP fetches by month — date DESC index already exists from original migration)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'daily_passwords'
      AND indexname  = 'daily_passwords_date_idx'
  ) THEN
    CREATE INDEX daily_passwords_date_idx ON public.daily_passwords(date DESC);
    RAISE NOTICE 'daily_passwords: date_idx created';
  ELSE
    RAISE NOTICE 'daily_passwords: date_idx already exists — skipped';
  END IF;
END
$$;


-- =============================================================================
-- Reload PostgREST schema cache so updated policies take effect immediately
-- =============================================================================
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DONE — Run these in a separate SQL editor tab after this migration:
--   VACUUM ANALYZE public.daily_passwords;
--
-- Expected IO improvements:
--   REPLICA IDENTITY DEFAULT : ~50-80% WAL reduction per UPDATE
--   auth.uid() policy        : eliminates schema cache probe on every write
--   Net: significant reduction in daily IO budget consumption for daily_passwords
-- =============================================================================


-- ===========================================================================
-- Migration: 20260413_01_complete_free_tier_hardening.sql
-- ===========================================================================

-- =============================================================================
-- 2026-04-13: COMPLETE FREE TIER HARDENING — Consolidates all IO + Auth fixes
-- =============================================================================
-- Root causes resolved:
--   AUTH:  getUserFromJwt() called on every heartbeat → 2,400 Auth API hits/hr
--          Fix: Server-side JWT cache (4min TTL) in server/lib/supabase.js
--   IO:    mums_presence LOGGED → 57,600 WAL writes/day
--          Fix: SET UNLOGGED (already in 20260410 but re-asserted here)
--   IO:    REPLICA IDENTITY FULL on multiple tables → 2× WAL per update
--          Fix: REPLICA IDENTITY DEFAULT on all real-time subscribed tables
--   IO:    heartbeat growing unbounded → index bloat
--          Fix: Single-row UPSERT on source='server'
--   POLL:  MAILBOX_OVERRIDE_POLL_MS=10000 → 10,800 DB reads/hr when active
--          Fix: Changed to 60000 (60s) in api/env.js + functions/api/env.js
-- =============================================================================
-- See: server/lib/supabase.js — JWT cache + profile cache (JS-side fixes)
-- See: supabase/FREE_TIER_APPLY_NOW.sql — run in dashboard SQL editor
-- All SQL idempotent. Zero downtime.
-- =============================================================================
SELECT 'See FREE_TIER_APPLY_NOW.sql — run that file in the Supabase SQL editor for all DB-side fixes.' AS instruction;


-- ===========================================================================
-- Migration: 20260419_02_perf_indexes.sql
-- ===========================================================================

-- Performance indexes for sync/pull and sync/push endpoints.
-- Safe additive migration: indexes only, no drops.

CREATE INDEX IF NOT EXISTS idx_mums_documents_updated_at
  ON public.mums_documents(updated_at);

CREATE INDEX IF NOT EXISTS idx_mums_documents_updated_by_user_id
  ON public.mums_documents(updated_by_user_id);

CREATE INDEX IF NOT EXISTS idx_mums_documents_key
  ON public.mums_documents(key);

CREATE INDEX IF NOT EXISTS idx_mums_documents_updated_by_user_id_updated_at_desc
  ON public.mums_documents(updated_by_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mums_profiles_user_id
  ON public.mums_profiles(user_id);


-- ===========================================================================
-- Migration: 20260420_02_services_treeview_repair.sql
-- ===========================================================================

-- Services TreeView repair migration
-- Purpose: ensure services_treeview_folders exists in environments where
-- prior migration was not applied.

create table if not exists public.services_treeview_folders (
  id              uuid primary key default gen_random_uuid(),
  sheet_id         uuid not null references public.services_sheets(id) on delete cascade,
  name             text not null,
  icon             text not null default '📁',
  color            text not null default '#22D3EE',
  condition_field  text,
  condition_op     text not null default 'eq',
  condition_value  text,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists idx_svc_tv_folders_sheet
  on public.services_treeview_folders(sheet_id, sort_order);

alter table public.services_treeview_folders enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'services_treeview_folders'
      and policyname = 'svc_tv_folders_read'
  ) then
    create policy "svc_tv_folders_read"
      on public.services_treeview_folders
      for select using (auth.role() = 'authenticated');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'services_treeview_folders'
      and policyname = 'svc_tv_folders_write'
  ) then
    create policy "svc_tv_folders_write"
      on public.services_treeview_folders
      for all using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.services_treeview_folders;
exception
  when duplicate_object then
    null;
end $$;


-- ===========================================================================
-- Migration: 20260420_services_schema.sql
-- ===========================================================================

-- ============================================================
-- Services Workspace — Sheets + Cells + Collaboration
-- v2: Added unique constraint on (sheet_id, row_index) for
--     true single-query UPSERT. Without this, every cell save
--     required 2 round-trips (SELECT then INSERT/UPDATE),
--     doubling PostgREST load on the free tier.
-- ============================================================

-- Table: services_sheets
create table if not exists public.services_sheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  title text not null default 'Untitled Sheet',
  icon text default '📄',
  color text default '#22D3EE',
  sort_order int default 0,
  column_defs jsonb not null default '[
    {"key":"col_a","label":"Column A","type":"text","width":160},
    {"key":"col_b","label":"Column B","type":"text","width":160},
    {"key":"col_c","label":"Column C","type":"text","width":160}
  ]'::jsonb,
  row_count int default 0,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Table: services_rows
create table if not exists public.services_rows (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid references public.services_sheets(id) on delete cascade,
  row_index int not null,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- KEY FIX: unique constraint enables single-query ON CONFLICT upsert
  -- Without this every cell write required SELECT + INSERT/UPDATE = 2 queries
  constraint uq_services_rows_sheet_row unique (sheet_id, row_index)
);

-- Indexes
create index if not exists idx_services_rows_sheet
  on public.services_rows(sheet_id, row_index);

create index if not exists idx_services_sheets_owner
  on public.services_sheets(owner_id, is_archived);

-- If table already exists and constraint is missing, add it safely
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_services_rows_sheet_row'
  ) then
    alter table public.services_rows
      add constraint uq_services_rows_sheet_row unique (sheet_id, row_index);
  end if;
end $$;

-- RLS
alter table public.services_sheets enable row level security;
alter table public.services_rows enable row level security;

create policy if not exists "services_sheets_read_all" on public.services_sheets
  for select using (auth.role() = 'authenticated');

create policy if not exists "services_rows_read_all" on public.services_rows
  for select using (auth.role() = 'authenticated');

create policy if not exists "services_sheets_write_all" on public.services_sheets
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy if not exists "services_rows_write_all" on public.services_rows
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Auto-update updated_at
create or replace function public.touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_touch_sheets on public.services_sheets;
create trigger trg_touch_sheets before update on public.services_sheets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_rows on public.services_rows;
create trigger trg_touch_rows before update on public.services_rows
  for each row execute function public.touch_updated_at();

-- Realtime
alter publication supabase_realtime add table public.services_sheets;
alter publication supabase_realtime add table public.services_rows;


-- ===========================================================================
-- Migration: 20260421_02_services_backups.sql
-- ===========================================================================

create table if not exists public.services_backups (
  id uuid default gen_random_uuid() primary key,
  sheet_id uuid references public.services_sheets(id) on delete cascade,
  user_id uuid references auth.users(id),
  name text not null,
  data jsonb not null,
  row_count int,
  created_at timestamp with time zone default now()
);

alter table public.services_backups enable row level security;

drop policy if exists "Users can manage own backups" on public.services_backups;
create policy "Users can manage own backups"
  on public.services_backups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ===========================================================================
-- Migration: 20260421_add_backups.sql
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'services_backups'
  ) THEN
    CREATE TABLE public.services_backups (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      sheet_id uuid REFERENCES public.services_sheets(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id),
      name text NOT NULL,
      snapshot jsonb NOT NULL,
      row_count integer,
      created_at timestamptz DEFAULT now()
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services_backups' AND column_name = 'data'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services_backups' AND column_name = 'snapshot'
  ) THEN
    ALTER TABLE public.services_backups RENAME COLUMN data TO snapshot;
  END IF;
END$$;

ALTER TABLE public.services_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_backups" ON public.services_backups;
CREATE POLICY "users_manage_own_backups" ON public.services_backups
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_backups_sheet ON public.services_backups(sheet_id, created_at DESC);


-- ===========================================================================
-- Migration: 20260421_services_treeview.sql
-- ===========================================================================

-- ============================================================
-- Services Workspace — TreeView Folders
-- v1: Adds per-sheet treeview folder definitions with optional
--     row-filter conditions. Each sheet can have N folders;
--     the "All Records" virtual node is NOT stored — it is
--     always rendered first by the UI.
-- ============================================================

create table if not exists public.services_treeview_folders (
  id           uuid        primary key default gen_random_uuid(),
  sheet_id     uuid        not null references public.services_sheets(id) on delete cascade,
  name         text        not null,
  icon         text        not null default '📁',
  color        text        not null default '#22D3EE',

  -- Condition (null condition_field = show all rows — used for "custom" catch-all folders)
  condition_field  text,          -- column key from sheet.column_defs
  condition_op     text           not null default 'eq',
                                  -- eq | neq | contains | starts | ends | empty | notempty
  condition_value  text,          -- value to compare (NULL allowed for empty/notempty ops)

  sort_order   int         not null default 0,
  created_at   timestamptz not null default now()
);

-- Index for fast sheet lookup
create index if not exists idx_svc_tv_folders_sheet
  on public.services_treeview_folders(sheet_id, sort_order);

-- RLS — same pattern as sheets/rows: authenticated users have full access
alter table public.services_treeview_folders enable row level security;

create policy if not exists "svc_tv_folders_read"
  on public.services_treeview_folders
  for select using (auth.role() = 'authenticated');

create policy if not exists "svc_tv_folders_write"
  on public.services_treeview_folders
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Realtime (for multi-user folder sync)
alter publication supabase_realtime add table public.services_treeview_folders;


-- ===========================================================================
-- Migration: 20260422_01_services_sheet_column_state.sql
-- ===========================================================================

ALTER TABLE public.services_sheets
ADD COLUMN IF NOT EXISTS column_state jsonb DEFAULT '{"widths": {}, "hidden": []}'::jsonb;

COMMENT ON COLUMN public.services_sheets.column_state IS 'Stores column widths and visibility per user';


-- ===========================================================================
-- Migration: 20260425_pause_session_settings.sql
-- ===========================================================================

-- Pause Session global setting bootstrap
-- Ensures mums_global_settings exists and seeds pause_session default.

CREATE TABLE IF NOT EXISTS public.mums_global_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_by_name TEXT,
  updated_by_user_id UUID
);

INSERT INTO public.mums_global_settings (setting_key, setting_value)
VALUES (
  'pause_session',
  '{"enabled": true, "timeout_minutes": 10}'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;


-- ===========================================================================
-- Migration: 20260426_my_notes.sql
-- ===========================================================================

create table if not exists public.mums_notes (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workspace text not null default 'personal', title text not null default 'Untitled Note', content text not null default '', created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists mums_notes_user_ws on public.mums_notes(user_id, workspace);
alter table public.mums_notes enable row level security;
drop policy if exists "notes_owner" on public.mums_notes;
create policy "notes_owner" on public.mums_notes for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);


-- ===========================================================================
-- Migration: 20260426_my_notes_workspaces.sql
-- ===========================================================================

-- Custom workspaces for My Notes (user-defined folders in addition to Personal/Team/Projects)
create table if not exists public.mums_notes_workspaces (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  emoji      text not null default '📁',
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists mums_notes_ws_user on public.mums_notes_workspaces(user_id, sort_order);
alter table public.mums_notes_workspaces enable row level security;
drop policy if exists "ws_owner" on public.mums_notes_workspaces;
create policy "ws_owner" on public.mums_notes_workspaces
  for all to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add updated_at trigger so it auto-stamps on every update
create or replace function public._set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_notes_updated_at on public.mums_notes;
create trigger trg_notes_updated_at
  before update on public.mums_notes
  for each row execute procedure public._set_updated_at();


-- ===========================================================================
-- Migration: 20260428_my_notes_workspaces_FINAL.sql
-- ===========================================================================

-- ═══════════════════════════════════════════════════════════════════════════
--  My Notes Workspaces — FINAL ONE-SHOT MIGRATION
--  Run this ONCE in Supabase SQL Editor → fixes all workspace persistence.
--  Safe to run multiple times (all statements are idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create the table if it doesn't exist at all
create table if not exists public.mums_notes_workspaces (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Untitled',
  emoji      text not null default '📁',
  sort_order int  not null default 0,
  parent_key text default null,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- 2. Add columns if they are missing (safe on existing tables)
alter table public.mums_notes_workspaces
  add column if not exists parent_key text default null;

alter table public.mums_notes_workspaces
  add column if not exists updated_at timestamptz default now();

alter table public.mums_notes_workspaces
  add column if not exists created_at timestamptz default now();

-- 3. Indexes
create index if not exists idx_mn_ws_user_order
  on public.mums_notes_workspaces(user_id, sort_order);

-- 4. Row Level Security — users see only their own rows
alter table public.mums_notes_workspaces enable row level security;

drop policy if exists "ws_owner"       on public.mums_notes_workspaces;
drop policy if exists "notes_ws_owner" on public.mums_notes_workspaces;

create policy "notes_ws_owner" on public.mums_notes_workspaces
  for all to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. Auto-stamp updated_at on every row update
create or replace function public._mn_ws_stamp_updated()
returns trigger language plpgsql security definer as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mn_ws_updated on public.mums_notes_workspaces;
create trigger trg_mn_ws_updated
  before update on public.mums_notes_workspaces
  for each row execute procedure public._mn_ws_stamp_updated();

-- 6. Also ensure mums_notes has updated_at trigger (notes table)
create or replace function public._mn_notes_stamp_updated()
returns trigger language plpgsql security definer as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mn_notes_updated on public.mums_notes;
create trigger trg_mn_notes_updated
  before update on public.mums_notes
  for each row execute procedure public._mn_notes_stamp_updated();

-- Done. Verify with:
-- select column_name from information_schema.columns
-- where table_name = 'mums_notes_workspaces' order by ordinal_position;


-- ===========================================================================
-- Migration: 20260428_my_notes_workspaces_v2.sql
-- ===========================================================================

-- ─── My Notes Workspaces v2 — add missing columns + fix RLS ────────────────
-- Adds parent_key and fixes sort_order so the JS tree model matches the schema

-- 1. Add parent_key column (stores the parent workspace key for sub-folders)
alter table public.mums_notes_workspaces
  add column if not exists parent_key text default null;

-- 2. Add updated_at so we can track when rows change cross-device
alter table public.mums_notes_workspaces
  add column if not exists updated_at timestamptz default now();

-- 3. Auto-stamp updated_at on every update
create or replace function public._mn_ws_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_mn_ws_updated_at on public.mums_notes_workspaces;
create trigger trg_mn_ws_updated_at
  before update on public.mums_notes_workspaces
  for each row execute procedure public._mn_ws_updated_at();

-- 4. Recreate index to include updated_at for efficient cross-device polling
drop index if exists mums_notes_ws_user;
create index if not exists mums_notes_ws_user
  on public.mums_notes_workspaces(user_id, sort_order, updated_at);

-- 5. Ensure RLS policy is correct (in case it was dropped)
alter table public.mums_notes_workspaces enable row level security;
drop policy if exists "ws_owner" on public.mums_notes_workspaces;
create policy "ws_owner" on public.mums_notes_workspaces
  for all to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ===========================================================================
-- Migration: 20260430_pause_session_columns_fix.sql
-- ===========================================================================

-- ============================================================================
-- FIX: 20260430_pause_session_columns_fix.sql
-- Root Cause: 20260425_pause_session_settings.sql used CREATE TABLE IF NOT EXISTS
-- which silently skips column additions when the table already exists from the
-- MASTER_MIGRATION. The audit columns (updated_by_name, updated_by_user_id) were
-- never added to live DBs that already had the table → upsert returns 400.
-- This migration safely adds the missing columns using ADD COLUMN IF NOT EXISTS.
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- Add missing audit columns if they don't already exist
ALTER TABLE public.mums_global_settings
  ADD COLUMN IF NOT EXISTS updated_by_name     TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id  UUID;

-- Ensure updated_at column is present (base schema has it but guard anyway)
ALTER TABLE public.mums_global_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure the pause_session seed row exists (idempotent)
INSERT INTO public.mums_global_settings (setting_key, setting_value, updated_at)
VALUES (
  'pause_session',
  '{"enabled": true, "timeout_minutes": 10}'::jsonb,
  NOW()
)
ON CONFLICT (setting_key) DO NOTHING;


-- ===========================================================================
-- Migration: 20260502_01_feature_sql_parity_global_settings_and_qb_tokens.sql
-- ===========================================================================

-- 2026-05-02: Feature SQL parity hardening
-- Ensures legacy feature tables referenced by runtime code exist in migration history.

-- -----------------------------------------------------------------------------
-- Global theme legacy table used by /api/settings/global-theme.js
-- -----------------------------------------------------------------------------
create table if not exists public.mums_global_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists mums_global_settings_updated_at_idx
  on public.mums_global_settings (updated_at desc);

alter table public.mums_global_settings enable row level security;

-- Read access for authenticated users (global theme read path).
drop policy if exists "mums_global_settings_read_auth" on public.mums_global_settings;
create policy "mums_global_settings_read_auth"
  on public.mums_global_settings
  for select
  to authenticated
  using (true);

-- Write access limited to service role/API adapters.
-- No insert/update/delete policies for authenticated users on purpose.

-- -----------------------------------------------------------------------------
-- QuickBase token heartbeat marker table used by Services QB sync probes.
-- -----------------------------------------------------------------------------
create table if not exists public.qb_tokens (
  id bigserial primary key,
  updated_at timestamptz not null default now()
);

create index if not exists qb_tokens_updated_at_idx
  on public.qb_tokens (updated_at desc);

alter table public.qb_tokens enable row level security;

-- Authenticated read probe support for client freshness checks.
drop policy if exists "qb_tokens_read_auth" on public.qb_tokens;
create policy "qb_tokens_read_auth"
  on public.qb_tokens
  for select
  to authenticated
  using (true);

-- Writes remain API/service-role controlled by default (no write policy).
