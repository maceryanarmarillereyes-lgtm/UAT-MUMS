-- =============================================================================
-- MUMS SUPPORT STUDIO — MASTER MIGRATION (v3.9.23)
-- =============================================================================
-- ONE FILE. ONE PASTE. ONE RUN.
-- Use this for a fresh Supabase project (DEV, UAT, PROD).
--
-- Instructions:
--   1. Supabase Dashboard → SQL Editor → New Query
--   2. Paste this entire file
--   3. Click RUN
--   4. Done. All tables, policies, triggers, and optimizations applied.
--
-- All statements are idempotent (safe to run multiple times).
-- Generated: 2026-03-19 | Phase 637 / v3.9.23
-- =============================================================================


-- =============================================================================
-- SECTION 1: SCHEMA — Core tables
-- =============================================================================

-- 1a) Role constraint helper (applied after table create)
-- Defer role check until after the constraint is added below.

-- 1) Profiles (authoritative user directory)
create table if not exists public.mums_profiles (
  user_id    uuid primary key,
  username   text unique not null,
  name       text not null,
  role       text not null default 'MEMBER',
  team_id    text,
  duty       text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Drop old constraint and re-add with full role list (idempotent)
alter table public.mums_profiles
  drop constraint if exists mums_profiles_role_check;
alter table public.mums_profiles
  add constraint mums_profiles_role_check
  check (role in ('SUPER_ADMIN', 'SUPER_USER', 'ADMIN', 'TEAM_LEAD', 'MEMBER'));

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public, extensions
as $$
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
  scope        text not null check (scope in ('global','superadmin')),
  enabled      boolean not null default false,
  is_frozen    boolean not null default true,
  override_iso text not null default '',
  updated_by   uuid,
  updated_at   timestamptz default now(),
  primary key (scope)
);

drop trigger if exists trg_mailbox_override_updated_at on public.mums_mailbox_override;
create trigger trg_mailbox_override_updated_at
before update on public.mums_mailbox_override
for each row execute function public.set_updated_at();

insert into public.mums_mailbox_override (scope, enabled, is_frozen, override_iso)
values ('global', false, true, ''), ('superadmin', false, true, '')
on conflict (scope) do nothing;

-- 3) Presence table (ephemeral — will be set UNLOGGED in IO section)
create table if not exists public.mums_presence (
  client_id text primary key,
  user_id   text not null,
  name      text,
  role      text,
  team_id   text,
  route     text,
  last_seen timestamptz not null default now()
);
create index if not exists mums_presence_last_seen_idx
  on public.mums_presence (last_seen desc);

-- 4) Collaborative documents store
create table if not exists public.mums_documents (
  key                  text primary key,
  value                jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now(),
  updated_by_user_id   uuid,
  updated_by_name      text,
  updated_by_client_id text
);
create index if not exists mums_documents_updated_at_idx
  on public.mums_documents (updated_at desc);

create or replace function public.mums_set_updated_at()
returns trigger language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists mums_documents_set_updated_at on public.mums_documents;
create trigger mums_documents_set_updated_at
before update on public.mums_documents
for each row execute function public.mums_set_updated_at();

alter table public.mums_documents enable row level security;

drop policy if exists "mums_documents_read" on public.mums_documents;
create policy "mums_documents_read" on public.mums_documents
for select to authenticated using (true);


-- =============================================================================
-- SECTION 2: RLS & POLICIES
-- =============================================================================

alter table public.mums_profiles       enable row level security;
alter table public.mums_mailbox_override enable row level security;

-- SECURITY DEFINER helper (avoids recursive RLS)
create or replace function public.mums_is_super_admin(p_uid uuid)
returns boolean language sql stable security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1 from public.mums_profiles p
    where p.user_id = p_uid and p.role = 'SUPER_ADMIN'
  );
$$;

drop policy if exists "profiles_select_own"        on public.mums_profiles;
drop policy if exists "profiles_select_superadmin" on public.mums_profiles;

create policy "profiles_select_own" on public.mums_profiles
for select to authenticated
using (user_id = (select auth.uid()));

create policy "profiles_select_superadmin" on public.mums_profiles
for select to authenticated
using (public.mums_is_super_admin(auth.uid()));

drop policy if exists "Users can update own quickbase_settings" on public.mums_profiles;
create policy "Users can update own quickbase_settings" on public.mums_profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "override_select_auth"      on public.mums_mailbox_override;
drop policy if exists "override_update_superadmin" on public.mums_mailbox_override;

create policy "override_select_auth" on public.mums_mailbox_override
for select to authenticated using (true);

create policy "override_update_superadmin" on public.mums_mailbox_override
for update to authenticated
using (public.mums_is_super_admin(auth.uid()))
with check (public.mums_is_super_admin(auth.uid()));


-- =============================================================================
-- SECTION 3: EXTENSIONS
-- =============================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;
create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'citext') then
    if (select n.nspname from pg_extension e
        join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'citext') = 'public' then
      execute 'alter extension citext set schema extensions';
    end if;
  end if;
exception when others then null;
end$$;


-- =============================================================================
-- SECTION 4: PROFILE COLUMNS (all migrations combined)
-- =============================================================================

-- avatar_url (20260127)
alter table public.mums_profiles add column if not exists avatar_url text;

-- team_override (20260128)
alter table public.mums_profiles add column if not exists team_override boolean not null default false;

-- email / citext (20260128 deduplicate)
alter table public.mums_profiles add column if not exists email extensions.citext;

-- Backfill email from auth.users
update public.mums_profiles p
set email = lower(trim(u.email))::extensions.citext
from auth.users u
where u.id = p.user_id and u.email is not null;

update public.mums_profiles
set email = null
where email is not null and btrim(email::text) = '';

-- Deduplicate by email (keep best candidate per email)
with ranked as (
  select user_id, lower(email::text) as email_key,
    row_number() over (
      partition by lower(email::text)
      order by
        (upper(coalesce(role,'')) = 'SUPER_ADMIN') desc,
        (upper(coalesce(role,'')) = 'SUPER_USER') desc,
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.mums_profiles where email is not null
)
delete from public.mums_profiles p
using ranked r
where p.user_id = r.user_id and r.rn > 1;

alter table public.mums_profiles
  drop constraint if exists mums_profiles_email_unique;
alter table public.mums_profiles
  add constraint mums_profiles_email_unique unique (email);

-- QuickBase columns (20260226, 20260228, 20260302, 20260303, 20260312)
alter table public.mums_profiles
  add column if not exists qb_token             text,
  add column if not exists qb_realm             text,
  add column if not exists qb_table_id          text,
  add column if not exists qb_qid               text,
  add column if not exists qb_report_link        text,
  add column if not exists quickbase_config      jsonb,
  add column if not exists quickbase_settings    jsonb,
  add column if not exists qb_custom_columns     text[],
  add column if not exists qb_custom_filters     jsonb,
  add column if not exists qb_filter_match       text,
  add column if not exists qb_dashboard_counters jsonb,
  add column if not exists qb_name               text not null default '';

-- theme_preference (20260223)
alter table public.mums_profiles
  add column if not exists theme_preference text default null;

-- Ensure quickbase_settings is JSONB (not text)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mums_profiles'
      and column_name = 'quickbase_settings' and data_type <> 'jsonb'
  ) then
    execute 'alter table public.mums_profiles alter column quickbase_settings type jsonb using to_jsonb(quickbase_settings)';
  end if;
end $$;

update public.mums_profiles set quickbase_settings = '{}'::jsonb where quickbase_settings is null;

-- Migrate quickbase_config → quickbase_settings if empty
update public.mums_profiles mp
set quickbase_settings = coalesce(mp.quickbase_config, '{}'::jsonb)
where (mp.quickbase_settings is null or mp.quickbase_settings = '{}'::jsonb)
  and mp.quickbase_config is not null
  and mp.quickbase_config != '{}'::jsonb;

-- Indexes
create index if not exists idx_mums_profiles_quickbase_settings
  on public.mums_profiles using gin (quickbase_settings);
create index if not exists idx_mums_profiles_theme_preference
  on public.mums_profiles (theme_preference);
create index if not exists idx_mums_profiles_qb_name
  on public.mums_profiles (qb_name);

-- SUPER_ADMIN backfill
update public.mums_profiles
set team_override = (team_id is not null)
where upper(coalesce(role,'')) in ('SUPER_ADMIN','SUPER_USER');

update public.mums_profiles
set team_id = null
where upper(coalesce(role,'')) in ('SUPER_ADMIN','SUPER_USER')
  and team_override = false;


-- =============================================================================
-- SECTION 5: STORAGE BUCKET
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('public', 'public', true)
on conflict (id) do update set public = true;


-- =============================================================================
-- SECTION 6: HEARTBEAT TABLE
-- =============================================================================

create table if not exists public.heartbeat (
  id        uuid primary key default gen_random_uuid(),
  uid       uuid,
  timestamp timestamptz default now()
);

alter table public.heartbeat enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='heartbeat' and policyname='User can read own heartbeat') then
    create policy "User can read own heartbeat" on public.heartbeat for select using (auth.uid() = uid);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='heartbeat' and policyname='User can insert own heartbeat') then
    create policy "User can insert own heartbeat" on public.heartbeat for insert with check (auth.uid() = uid);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='heartbeat' and policyname='User can update own heartbeat') then
    create policy "User can update own heartbeat" on public.heartbeat for update using (auth.uid() = uid) with check (auth.uid() = uid);
  end if;
end $$;


-- =============================================================================
-- SECTION 7: MUMS SYNC LOG
-- =============================================================================

create table if not exists public.mums_sync_log (
  id             bigserial primary key,
  user_id        uuid not null,
  scope          text not null check (scope in ('global','superadmin')),
  "timestamp"    timestamptz not null default now(),
  effective_time timestamptz,
  action         text not null
);

create index if not exists mums_sync_log_timestamp_idx on public.mums_sync_log ("timestamp" desc);
create index if not exists mums_sync_log_scope_idx     on public.mums_sync_log (scope);


-- =============================================================================
-- SECTION 8: TASK ORCHESTRATION
-- =============================================================================

create table if not exists public.task_distributions (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  created_by          uuid not null,
  title               text not null,
  description         text,
  reference_url       text,
  status              text not null default 'ONGOING',
  enable_daily_alerts boolean not null default false
);
create index if not exists task_distributions_created_by_idx on public.task_distributions (created_by);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_item_status') then
    create type public.task_item_status as enum ('Pending', 'Ongoing', 'Completed', 'With Problem');
  end if;
end $$;

create table if not exists public.task_items (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  distribution_id  uuid not null references public.task_distributions(id) on delete cascade,
  case_number      text not null,
  site             text not null,
  assigned_to      uuid not null,
  task_description text not null,
  description      text,
  remarks          text,
  reference_url    text,
  problem_notes    text,
  assigned_by      uuid,
  transferred_from uuid,
  status           public.task_item_status not null default 'Pending'
);

create index if not exists task_items_distribution_id_idx on public.task_items (distribution_id);
create index if not exists task_items_assigned_to_idx     on public.task_items (assigned_to);

-- RLS for task tables
alter table public.task_distributions enable row level security;
drop policy if exists "task_distributions_read"  on public.task_distributions;
drop policy if exists "task_distributions_write" on public.task_distributions;
create policy "task_distributions_read"  on public.task_distributions for select to authenticated using (true);
create policy "task_distributions_write" on public.task_distributions for all to service_role using (true) with check (true);

alter table public.task_items enable row level security;
drop policy if exists "task_items_read"  on public.task_items;
drop policy if exists "task_items_write" on public.task_items;
create policy "task_items_read"  on public.task_items for select to authenticated using (true);
create policy "task_items_write" on public.task_items for all to service_role using (true) with check (true);

drop view if exists public.view_team_workload_matrix;
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


-- =============================================================================
-- SECTION 9: GLOBAL SETTINGS
-- =============================================================================

create table if not exists public.mums_global_settings (
  id            uuid primary key default gen_random_uuid(),
  setting_key   text not null unique,
  setting_value jsonb not null,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);

insert into public.mums_global_settings (setting_key, setting_value)
values ('default_theme', '"aurora_midnight"'::jsonb)
on conflict (setting_key) do nothing;

alter table public.mums_global_settings enable row level security;

drop policy if exists "Anyone can read global settings"          on public.mums_global_settings;
drop policy if exists "Service role can write global settings"   on public.mums_global_settings;

create policy "Anyone can read global settings"
  on public.mums_global_settings for select to authenticated using (true);
create policy "Service role can write global settings"
  on public.mums_global_settings for all to service_role using (true) with check (true);


-- =============================================================================
-- SECTION 10: QUICKBASE TABS
-- =============================================================================

create table if not exists public.quickbase_tabs (
  id            bigserial primary key,
  user_id       text not null,
  tab_id        text not null,
  tab_name      text,
  settings_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

drop index if exists public.uq_quickbase_user_tab;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_quickbase_user_tab'
      and conrelid = 'public.quickbase_tabs'::regclass
  ) then
    alter table public.quickbase_tabs
      add constraint uq_quickbase_user_tab unique (user_id, tab_id);
  end if;
end $$;

alter table public.quickbase_tabs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='quickbase_tabs' and policyname='service_role_all') then
    create policy service_role_all on public.quickbase_tabs
      for all to service_role using (true) with check (true);
  end if;
end $$;


-- =============================================================================
-- SECTION 11: USER QUICKBASE SETTINGS RLS (if table exists)
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='user_quickbase_settings') then
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


-- =============================================================================
-- SECTION 12: SUPPORT CATALOG
-- =============================================================================

create table if not exists public.support_catalog (
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
  assigned_to      uuid references public.mums_profiles(user_id) on delete set null,
  assigned_to_name text,
  parent_id        uuid references public.support_catalog(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_catalog_parent_id on public.support_catalog (parent_id);

-- Prevent dirty codes (trailing dash / double dash)
alter table public.support_catalog
  drop constraint if exists chk_item_code_no_trailing_dash;
alter table public.support_catalog
  add constraint chk_item_code_no_trailing_dash
  check (
    item_code !~ '-$'
    and item_code !~ '--'
    and length(trim(item_code)) > 0
  );

-- Clean up any pre-existing dirty codes
delete from public.support_catalog
where item_code ~ '-$' or item_code ~ '--';

create table if not exists public.support_catalog_comments (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references public.support_catalog(id) on delete cascade,
  user_id           uuid not null,
  user_name         text not null,
  comment           text not null,
  is_acknowledged   boolean not null default false,
  acknowledged_by   uuid,
  acknowledged_name text,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists public.support_catalog_history (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.support_catalog(id) on delete cascade,
  edited_by      uuid not null,
  edited_by_name text not null,
  field_changed  text not null,
  old_value      text,
  new_value      text,
  edited_at      timestamptz not null default now()
);

-- Sample data (5 items, skip if already exist)
insert into public.support_catalog (item_code, name, category, status)
values
  ('CTR-001', 'Product Item 1', 'Controller', 'Active'),
  ('CTR-002', 'Product Item 2', 'Controller', 'Active'),
  ('SEN-001', 'Product Item 3', 'Sensor',     'Active'),
  ('SEN-002', 'Product Item 4', 'Sensor',     'Active'),
  ('VLV-001', 'Product Item 5', 'Valve',      'Active')
on conflict (item_code) do nothing;

alter table public.support_catalog          enable row level security;
alter table public.support_catalog_comments enable row level security;
alter table public.support_catalog_history  enable row level security;

drop policy if exists "catalog_read"    on public.support_catalog;
drop policy if exists "catalog_write"   on public.support_catalog;
drop policy if exists "comments_read"   on public.support_catalog_comments;
drop policy if exists "comments_write"  on public.support_catalog_comments;
drop policy if exists "history_read"    on public.support_catalog_history;
drop policy if exists "history_write"   on public.support_catalog_history;

create policy "catalog_read"   on public.support_catalog          for select using (true);
create policy "catalog_write"  on public.support_catalog          for all    using (true);
create policy "comments_read"  on public.support_catalog_comments for select using (true);
create policy "comments_write" on public.support_catalog_comments for all    using (true);
create policy "history_read"   on public.support_catalog_history  for select using (true);
create policy "history_write"  on public.support_catalog_history  for all    using (true);


-- =============================================================================
-- SECTION 13: AUTH TRIGGER — Login mode aware invite guard
-- =============================================================================

create or replace function public.mums_link_auth_user_to_profile()
returns trigger language plpgsql security definer
set search_path = public, auth, extensions
as $$
declare
  v_email          text;
  v_profile_exists boolean;
  v_login_mode     text := 'both';
begin
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    begin
      select lower(trim(coalesce((value->>'mode'), 'both')))
        into v_login_mode
        from public.mums_documents
       where key = 'mums_login_mode_settings' limit 1;
    exception when others then v_login_mode := 'both'; end;
    if v_login_mode = 'microsoft' then
      raise exception using errcode = 'P0001',
        message = 'Invite-only login denied: missing email.';
    end if;
    return new;
  end if;

  begin
    select lower(trim(coalesce((value->>'mode'), 'both')))
      into v_login_mode
      from public.mums_documents
     where key = 'mums_login_mode_settings' limit 1;
  exception when others then v_login_mode := 'both'; end;

  select exists (
    select 1 from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  ) into v_profile_exists;

  if v_profile_exists then
    update public.mums_profiles p
    set user_id = new.id, updated_at = now()
    where lower(trim(coalesce(p.email::text, ''))) = v_email;
  else
    if v_login_mode = 'microsoft' then
      raise exception using errcode = 'P0001',
        message = format('Invite-only login denied for email: %s', v_email);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mums_link_auth_user_to_profile on auth.users;
create trigger trg_mums_link_auth_user_to_profile
after insert on auth.users
for each row
execute function public.mums_link_auth_user_to_profile();


-- =============================================================================
-- SECTION 14: DISK IO OPTIMIZATION (v3.9.23)
-- =============================================================================

-- FIX 1: mums_presence → UNLOGGED (no WAL, no Realtime sub = pure win)
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'mums_presence'
      and relnamespace = (select oid from pg_namespace where nspname = 'public')
      and relpersistence = 'p'
  ) then
    alter table public.mums_presence set unlogged;
    raise notice 'mums_presence: set UNLOGGED (WAL writes eliminated)';
  else
    raise notice 'mums_presence: already UNLOGGED or does not exist, skipping';
  end if;
end $$;

-- RLS for mums_presence (read-only for authenticated, writes via service role only)
alter table public.mums_presence enable row level security;
drop policy if exists "presence_read" on public.mums_presence;
create policy "presence_read" on public.mums_presence for select to authenticated using (true);

-- RLS for mums_sync_log (SUPER_ADMIN read only, writes via service role)
alter table public.mums_sync_log enable row level security;
drop policy if exists "sync_log_read_superadmin" on public.mums_sync_log;
create policy "sync_log_read_superadmin" on public.mums_sync_log
  for select to authenticated using (public.mums_is_super_admin(auth.uid()));

-- FIX 2: mums_documents REPLICA IDENTITY DEFAULT (smaller WAL per sync UPSERT)
do $$
begin
  if exists (select 1 from pg_class where relname='mums_documents'
             and relnamespace=(select oid from pg_namespace where nspname='public')) then
    alter table public.mums_documents replica identity default;
    raise notice 'mums_documents: REPLICA IDENTITY set to DEFAULT';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_class where relname='mums_sync_log'
             and relnamespace=(select oid from pg_namespace where nspname='public')) then
    alter table public.mums_sync_log replica identity default;
    raise notice 'mums_sync_log: REPLICA IDENTITY set to DEFAULT';
  end if;
end $$;

-- FIX 3: Auto-trim mums_sync_log (keep 200 rows max)
create or replace function public.mums_sync_log_trim()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.mums_sync_log) > 300 then
    delete from public.mums_sync_log
    where id not in (
      select id from public.mums_sync_log order by id desc limit 200
    );
  end if;
  return new;
end; $$;

drop trigger if exists trg_mums_sync_log_trim on public.mums_sync_log;
create trigger trg_mums_sync_log_trim
  after insert on public.mums_sync_log
  for each statement execute function public.mums_sync_log_trim();

-- FIX 4: Auto-trim heartbeat (keep 100 rows max)
create or replace function public.heartbeat_trim()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.heartbeat) > 200 then
    delete from public.heartbeat
    where id not in (
      select id from public.heartbeat order by timestamp desc limit 100
    );
  end if;
  return new;
end; $$;

drop trigger if exists trg_heartbeat_trim on public.heartbeat;
create trigger trg_heartbeat_trim
  after insert on public.heartbeat
  for each statement execute function public.heartbeat_trim();

-- FIX 5: One-time cleanup of stale rows
delete from public.mums_presence  where last_seen   < now() - interval '10 minutes';
delete from public.mums_sync_log  where id not in   (select id from public.mums_sync_log order by id desc limit 200);
delete from public.heartbeat      where id not in   (select id from public.heartbeat order by timestamp desc limit 100);


-- =============================================================================
-- SECTION 15: SECURITY ADVISOR HARDENING
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relname='view_team_workload_matrix' and c.relkind='v') then
    execute 'alter view public.view_team_workload_matrix set (security_invoker=true)';
  end if;
exception when others then null;
end$$;


-- =============================================================================
-- SECTION 16: REALTIME PUBLICATION
-- =============================================================================

-- Ensure mums_documents and mums_sync_log are in supabase_realtime publication
-- (required for postgres_changes subscriptions in realtime.js)
do $$
begin
  begin
    alter publication supabase_realtime add table public.mums_documents;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.mums_sync_log;
  exception when duplicate_object then null;
  end;
end $$;


-- =============================================================================
-- END — Reload PostgREST schema cache
-- =============================================================================
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE. Expected output (check for these notices):
--   mums_presence: set UNLOGGED (WAL writes eliminated)
--   mums_documents: REPLICA IDENTITY set to DEFAULT
--   mums_sync_log: REPLICA IDENTITY set to DEFAULT
-- =============================================================================
