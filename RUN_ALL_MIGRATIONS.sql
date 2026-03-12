-- =============================================================================
-- RUN_ALL_MIGRATIONS.sql (COMPLETE — Phase 637 / QBTabBugFix)
-- Generated: 2026-03-12 (v5 — all 4 bugs fixed)
-- FIX 1: schema.sql prepended (was missing — caused mums_profiles not found)
-- FIX 2: nested $$ → $sql$ in execute blocks
-- FIX 3: 20260216 (CREATE task_items) moved before 20260215 (ALTER task_items)
-- FIX 4: DROP VIEW moved before ALTER COLUMN TYPE in 20260217_02
-- =============================================================================

-- ===========================================================================
-- STEP 0: BASE SCHEMA — creates mums_profiles, mums_mailbox_override,
--         mums_presence, mums_documents. MUST run before all migrations.
-- ===========================================================================

-- MUMS Supabase schema (Vercel-ready)
-- Run in Supabase SQL editor.

-- 1) Profiles (authoritative user directory)
create table if not exists public.mums_profiles (
  user_id uuid primary key,
  username text unique not null,
  name text not null,
  role text not null check (role in ('SUPER_ADMIN','TEAM_LEAD','ADMIN','MEMBER')),
  team_id text,
  duty text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_updated_at on public.mums_profiles;
create trigger trg_profiles_updated_at
before update on public.mums_profiles
for each row execute function public.set_updated_at();

-- 2) Cloud-global mailbox override
create table if not exists public.mums_mailbox_override (
  scope text not null check (scope in ('global','superadmin')),
  enabled boolean not null default false,
  is_frozen boolean not null default true,
  override_iso text not null default '',
  updated_by uuid,
  updated_at timestamptz default now(),
  primary key (scope)
);

drop trigger if exists trg_mailbox_override_updated_at on public.mums_mailbox_override;
create trigger trg_mailbox_override_updated_at
before update on public.mums_mailbox_override
for each row execute function public.set_updated_at();

insert into public.mums_mailbox_override (scope, enabled, is_frozen, override_iso)
values ('global', false, true, ''), ('superadmin', false, true, '')
on conflict (scope) do nothing;

-- --------------------
-- RLS / Policies
-- --------------------
alter table public.mums_profiles enable row level security;
alter table public.mums_mailbox_override enable row level security;

-- SECURITY DEFINER helper avoids recursive RLS evaluation inside policies.
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

-- Allow users to read their own profile
drop policy if exists "profiles_select_own" on public.mums_profiles;
create policy "profiles_select_own" on public.mums_profiles
for select to authenticated
using (auth.uid() = user_id);

-- Allow SUPER_ADMIN to read all profiles (for UI directory)
drop policy if exists "profiles_select_superadmin" on public.mums_profiles;
create policy "profiles_select_superadmin" on public.mums_profiles
for select to authenticated
using (public.mums_is_super_admin(auth.uid()));

-- Mailbox override: any authenticated user can read global override
drop policy if exists "override_select_auth" on public.mums_mailbox_override;
create policy "override_select_auth" on public.mums_mailbox_override
for select to authenticated
using (true);

-- Mailbox override: only SUPER_ADMIN can update
drop policy if exists "override_update_superadmin" on public.mums_mailbox_override;
create policy "override_update_superadmin" on public.mums_mailbox_override
for update to authenticated
using (public.mums_is_super_admin(auth.uid()))
with check (public.mums_is_super_admin(auth.uid()));

-- NOTE: Presence tables are created by the app; you may optionally enable RLS there too.

-- =====================================================================
-- ADDITIONS (Realtime collaboration)
-- =====================================================================

-- Ensure role constraint supports SUPER_USER as well.
alter table if exists public.mums_profiles
  drop constraint if exists mums_profiles_role_check;
alter table if exists public.mums_profiles
  add constraint mums_profiles_role_check
  check (role in ('SUPER_ADMIN', 'SUPER_USER', 'ADMIN', 'TEAM_LEAD', 'MEMBER'));

-- Presence table (used for online user overlay). Keep RLS disabled.
create table if not exists public.mums_presence (
  client_id text primary key,
  user_id text not null,
  name text,
  role text,
  team_id text,
  route text,
  last_seen timestamptz not null default now()
);
create index if not exists mums_presence_last_seen_idx on public.mums_presence (last_seen desc);


-- Collaborative documents store (server-managed; clients pull via /api/sync/*)
create table if not exists public.mums_documents (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid,
  updated_by_name text,
  updated_by_client_id text
);
create index if not exists mums_documents_updated_at_idx on public.mums_documents (updated_at desc);

-- Maintain updated_at on updates.
create or replace function public.mums_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists mums_documents_set_updated_at on public.mums_documents;
create trigger mums_documents_set_updated_at
before update on public.mums_documents
for each row execute function public.mums_set_updated_at();

-- Secure documents from direct client access (server functions use SERVICE ROLE and bypass RLS).
alter table public.mums_documents enable row level security;

-- Authenticated users may read (global read).
drop policy if exists "mums_documents_read" on public.mums_documents;
create policy "mums_documents_read" on public.mums_documents
for select to authenticated using (true);

-- No insert/update/delete policies -> denied by default for anon/authenticated.


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
-- FIXED (v4): DROP VIEW moved before ALTER COLUMN to avoid dependency block.
-- -----------------------------------------------------------------------------

-- Distribution-level toggle
alter table if exists public.task_distributions
  add column if not exists enable_daily_alerts boolean not null default false;

-- MUST drop view FIRST before altering task_items.status type.
-- view_team_workload_matrix (created in 20260216) depends on the status column.
-- PostgreSQL will refuse ALTER COLUMN TYPE while any view/rule references it.
drop view if exists public.view_team_workload_matrix;

-- New audit/problem fields
alter table if exists public.task_items
  add column if not exists problem_notes text,
  add column if not exists assigned_by uuid,
  add column if not exists transferred_from uuid;

-- Canonical task status enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_item_status') then
    create type public.task_item_status as enum ('Pending', 'Ongoing', 'Completed', 'With Problem');
  end if;
end $$;

-- Ensure task_items.status uses the enum (migrates legacy text values safely)
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

-- Recreate workload matrix view (view was dropped above before status type change)
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
    execute $sql$
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
    $sql$;
  else
    execute $sql$
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
    $sql$;
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
-- END: Reload PostgREST schema cache
-- ===========================================================================
NOTIFY pgrst, 'reload schema';
