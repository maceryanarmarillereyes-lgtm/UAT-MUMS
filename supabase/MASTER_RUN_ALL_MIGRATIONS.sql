-- ═══════════════════════════════════════════════════════════════════════════
--  MUMS — MASTER RUN ALL MIGRATIONS
--  Fresh Supabase Organization Setup
--  Generated: 2026-05-03
--
--  INSTRUCTIONS:
--    1. Open Supabase Dashboard → SQL Editor
--    2. Paste this entire file and run it.
--    3. After it completes, run the VACUUM block at the very bottom
--       in a SEPARATE SQL editor tab.
--    4. Enable Realtime for the listed tables in:
--       Supabase Dashboard → Database → Replication → supabase_realtime
--
--  SAFE TO RE-RUN: All statements use IF NOT EXISTS / OR REPLACE / ON CONFLICT.
--  ZERO DATA LOSS: Pure schema creation + idempotent seeds only.
--  ORDER:  Extensions → Functions → Core Tables → Feature Tables →
--          IO Optimizations → RLS Policies → Indexes → Realtime
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: EXTENSIONS
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create extension if not exists citext;
create schema if not exists extensions;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: SHARED UTILITY FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Generic updated_at stamper (used by profiles, documents, etc.)
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
  new.updated_at := now();
  return new;
end;
$$;

-- Generic touch_updated_at (used by services tables)
create or replace function public.touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3: CORE TABLES — PROFILES + MAILBOX OVERRIDE
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mums_profiles ───────────────────────────────────────────────────────
create table if not exists public.mums_profiles (
  user_id          uuid        primary key,
  username         text        unique not null,
  name             text        not null,
  role             text        not null,
  team_id          text,
  duty             text        default '',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Full role constraint (includes all roles incl. SUPER_USER)
alter table if exists public.mums_profiles
  drop constraint if exists mums_profiles_role_check;
alter table if exists public.mums_profiles
  add constraint mums_profiles_role_check
  check (role in ('SUPER_ADMIN','SUPER_USER','ADMIN','TEAM_LEAD','MEMBER'));

-- Profile columns added over time
alter table if exists public.mums_profiles
  add column if not exists avatar_url          text,
  add column if not exists team_override       boolean          not null default false,
  add column if not exists email               citext,
  add column if not exists theme_preference    text             default null,
  add column if not exists qb_token            text,
  add column if not exists qb_realm            text,
  add column if not exists qb_table_id         text,
  add column if not exists qb_qid              text,
  add column if not exists qb_report_link      text,
  add column if not exists quickbase_config    jsonb,
  add column if not exists quickbase_settings  jsonb            default '{}'::jsonb,
  add column if not exists qb_custom_columns   text[],
  add column if not exists qb_custom_filters   jsonb,
  add column if not exists qb_filter_match     text,
  add column if not exists qb_dashboard_counters jsonb,
  add column if not exists qb_name             text             not null default '',
  add column if not exists pin_hash            text             default null,
  add column if not exists pin_set_at          timestamptz      default null,
  add column if not exists pin_last_used_at    timestamptz      default null,
  add column if not exists pin_fail_count      integer          not null default 0,
  add column if not exists pin_last_fail_at    timestamptz      default null;

-- Unique constraint on email
alter table if exists public.mums_profiles
  drop constraint if exists mums_profiles_email_unique;
alter table if exists public.mums_profiles
  add constraint mums_profiles_email_unique unique (email);

-- updated_at trigger
drop trigger if exists trg_profiles_updated_at on public.mums_profiles;
create trigger trg_profiles_updated_at
  before update on public.mums_profiles
  for each row execute function public.set_updated_at();

-- ── mums_mailbox_override ────────────────────────────────────────────────
create table if not exists public.mums_mailbox_override (
  scope       text        not null check (scope in ('global','superadmin')),
  enabled     boolean     not null default false,
  is_frozen   boolean     not null default true,
  override_iso text       not null default '',
  updated_by  uuid,
  updated_at  timestamptz default now(),
  primary key (scope)
);

drop trigger if exists trg_mailbox_override_updated_at on public.mums_mailbox_override;
create trigger trg_mailbox_override_updated_at
  before update on public.mums_mailbox_override
  for each row execute function public.set_updated_at();

insert into public.mums_mailbox_override (scope, enabled, is_frozen, override_iso)
values ('global', false, true, ''), ('superadmin', false, true, '')
on conflict (scope) do nothing;

-- ── mums_is_super_admin — MUST be defined AFTER mums_profiles table ──────
-- SECURITY DEFINER helper — avoids recursive RLS evaluation on mums_profiles.
-- Placed here (post table creation) because LANGUAGE sql validates the
-- referenced table at function-creation time.
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


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4: STORAGE BUCKET
-- ═══════════════════════════════════════════════════════════════════════════

-- Public bucket for profile avatars (server-side upload only)
insert into storage.buckets (id, name, public)
values ('public', 'public', true)
on conflict (id) do update set public = true;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5: AUTH TRIGGER — INVITE-ONLY / LOGIN MODE GUARD
-- ═══════════════════════════════════════════════════════════════════════════

-- Links auth.users.id to mums_profiles.user_id on first sign-in.
-- Respects mums_login_mode_settings (microsoft = strict, password/both = permissive).
create or replace function public.mums_link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
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

  begin
    select lower(trim(coalesce((value->>'mode'), 'both')))
      into v_login_mode
      from public.mums_documents
     where key = 'mums_login_mode_settings'
     limit 1;
  exception when others then
    v_login_mode := 'both';
  end;

  select exists (
    select 1 from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  ) into v_profile_exists;

  if v_profile_exists then
    update public.mums_profiles p
    set user_id    = new.id,
        updated_at = now()
    where lower(trim(coalesce(p.email::text, ''))) = v_email;
  else
    if v_login_mode = 'microsoft' then
      raise exception using
        errcode = 'P0001',
        message = format('Invite-only login denied for email: %s', v_email);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mums_link_auth_user_to_profile on auth.users;
create trigger trg_mums_link_auth_user_to_profile
  after insert on auth.users
  for each row execute function public.mums_link_auth_user_to_profile();


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6: REALTIME SYNC TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mums_presence (UNLOGGED — ephemeral, no WAL needed) ─────────────────
create table if not exists public.mums_presence (
  client_id text        primary key,
  user_id   text        not null,
  name      text,
  role      text,
  team_id   text,
  route     text,
  last_seen timestamptz not null default now()
);

-- Make UNLOGGED immediately to eliminate WAL overhead (~57,600 writes/day saved)
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'mums_presence'
      and relnamespace = (select oid from pg_namespace where nspname = 'public')
      and relpersistence = 'p'
  ) then
    alter table public.mums_presence set unlogged;
  end if;
end $$;

create index if not exists mums_presence_last_seen_idx
  on public.mums_presence (last_seen desc);

create index if not exists idx_mums_presence_last_seen
  on public.mums_presence (last_seen desc);

-- ── mums_documents (shared state store) ─────────────────────────────────
create table if not exists public.mums_documents (
  key                  text        primary key,
  value                jsonb       not null default '{}'::jsonb,
  updated_at           timestamptz not null default now(),
  updated_by_user_id   uuid,
  updated_by_name      text,
  updated_by_client_id text
);

create index if not exists mums_documents_updated_at_idx
  on public.mums_documents (updated_at desc);
create index if not exists idx_mums_documents_updated_at
  on public.mums_documents (updated_at);
create index if not exists idx_mums_documents_updated_by_user_id
  on public.mums_documents (updated_by_user_id);
create index if not exists idx_mums_documents_key
  on public.mums_documents (key);
create index if not exists idx_mums_documents_updated_by_user_id_updated_at_desc
  on public.mums_documents (updated_by_user_id, updated_at desc);

-- Set REPLICA IDENTITY DEFAULT — WAL stores only PK on UPDATE (halves WAL size)
alter table public.mums_documents replica identity default;

drop trigger if exists mums_documents_set_updated_at on public.mums_documents;
create trigger mums_documents_set_updated_at
  before update on public.mums_documents
  for each row execute function public.mums_set_updated_at();

-- Seed: default global theme settings
insert into public.mums_documents (key, value, updated_at, updated_by_name, updated_by_user_id)
values (
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
  now(), 'System Migration', null
)
on conflict (key) do nothing;

-- Seed: Security PIN policy
insert into public.mums_documents (key, value)
values (
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
on conflict (key) do nothing;

-- ── mums_sync_log ────────────────────────────────────────────────────────
create table if not exists public.mums_sync_log (
  id            bigserial   primary key,
  user_id       uuid        not null,
  scope         text        not null check (scope in ('global','superadmin')),
  "timestamp"   timestamptz not null default now(),
  effective_time timestamptz,
  action        text        not null
);

create index if not exists mums_sync_log_timestamp_idx
  on public.mums_sync_log ("timestamp" desc);
create index if not exists mums_sync_log_scope_idx
  on public.mums_sync_log (scope);

alter table public.mums_sync_log replica identity default;

-- Auto-trim sync_log to 100 rows (prevents index bloat)
create or replace function public.mums_sync_log_trim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.mums_sync_log) > 150 then
    delete from public.mums_sync_log
    where id not in (
      select id from public.mums_sync_log
      order by id desc limit 100
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mums_sync_log_trim on public.mums_sync_log;
create trigger trg_mums_sync_log_trim
  after insert on public.mums_sync_log
  for each statement execute function public.mums_sync_log_trim();

-- ── heartbeat (UNLOGGED — single-row keep-alive) ─────────────────────────
create table if not exists public.heartbeat (
  id        uuid        primary key default gen_random_uuid(),
  timestamp timestamptz default now(),
  uid       uuid,
  source    text
);

-- UNLOGGED: heartbeat is pure keep-alive, no durability needed
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'heartbeat'
      and relnamespace = (select oid from pg_namespace where nspname = 'public')
      and relpersistence = 'p'
  ) then
    alter table public.heartbeat set unlogged;
  end if;
end $$;

-- Unique constraint on source for single-row UPSERT
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'heartbeat_source_unique'
      and conrelid = 'public.heartbeat'::regclass
  ) then
    -- Clean up before adding constraint
    update public.heartbeat set source = 'server_' || id::text where source is null;
    delete from public.heartbeat
    where id not in (
      select distinct on (coalesce(source, id::text)) id
      from public.heartbeat
      order by coalesce(source, id::text), timestamp desc nulls last
    );
    alter table public.heartbeat add constraint heartbeat_source_unique unique (source);
  end if;
end $$;

-- Trim to 1 row on every insert
create or replace function public.heartbeat_trim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.heartbeat
  where id not in (
    select id from public.heartbeat
    order by timestamp desc nulls last limit 1
  );
  return new;
end;
$$;

drop trigger if exists trg_heartbeat_trim on public.heartbeat;
create trigger trg_heartbeat_trim
  after insert or update on public.heartbeat
  for each statement execute function public.heartbeat_trim();


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7: TASK ORCHESTRATION
-- ═══════════════════════════════════════════════════════════════════════════

-- ── task_distributions ───────────────────────────────────────────────────
create table if not exists public.task_distributions (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid        not null,
  title       text        not null,
  description text,
  reference_url text,
  status      text        not null default 'ONGOING'
);

create index if not exists task_distributions_created_by_idx
  on public.task_distributions (created_by);

-- ── task_items ────────────────────────────────────────────────────────────
create table if not exists public.task_items (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  distribution_id uuid        not null references public.task_distributions(id) on delete cascade,
  case_number     text        not null,
  site            text        not null,
  assigned_to     uuid        not null,
  task_description text       not null,
  description     text,
  remarks         text,
  reference_url   text,
  status          text        not null default 'PENDING'
);

create index if not exists task_items_distribution_id_idx
  on public.task_items (distribution_id);
create index if not exists task_items_assigned_to_idx
  on public.task_items (assigned_to);

-- ── workload matrix view ──────────────────────────────────────────────────
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


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 8: GLOBAL SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════

-- mums_global_settings — used by theme, pause session, QB count, etc.
-- Note: two CREATE TABLE patterns existed (one UUID PK, one TEXT PK).
-- We use TEXT primary key (setting_key) as the canonical form.
create table if not exists public.mums_global_settings (
  setting_key        text        primary key,
  setting_value      jsonb       not null default '{}'::jsonb,
  updated_by         uuid        references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by_name    text,
  updated_by_user_id uuid
);

create index if not exists mums_global_settings_updated_at_idx
  on public.mums_global_settings (updated_at desc);

-- Seed: default global theme (legacy settings table — mums_documents is primary)
insert into public.mums_global_settings (setting_key, setting_value)
values ('default_theme', '"apex"'::jsonb)
on conflict (setting_key) do nothing;

-- Seed: pause session defaults
insert into public.mums_global_settings (setting_key, setting_value, updated_at)
values (
  'pause_session',
  '{"enabled": true, "timeout_minutes": 10}'::jsonb,
  now()
)
on conflict (setting_key) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 9: QUICKBASE INTEGRATION TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── quickbase_tabs — personal QB iframe tab configs per user ──────────────
create table if not exists public.quickbase_tabs (
  id           bigserial   primary key,
  user_id      text        not null,
  tab_id       text        not null,
  tab_name     text,
  settings_json jsonb      not null default '{}'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Drop legacy unique index if it exists (replaced by constraint below)
drop index if exists public.uq_quickbase_user_tab;

-- Proper unique CONSTRAINT (required for PostgREST ON CONFLICT upsert)
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

-- ── qb_tokens — QB token heartbeat probe ─────────────────────────────────
create table if not exists public.qb_tokens (
  id         bigserial   primary key,
  updated_at timestamptz not null default now()
);

create index if not exists qb_tokens_updated_at_idx
  on public.qb_tokens (updated_at desc);

-- ── quickbase_settings JSONB index on profiles ────────────────────────────
create index if not exists idx_mums_profiles_quickbase_settings
  on public.mums_profiles using gin (quickbase_settings);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 10: SUPPORT CATALOG
-- ═══════════════════════════════════════════════════════════════════════════

-- ── support_catalog ───────────────────────────────────────────────────────
create table if not exists public.support_catalog (
  id               uuid        primary key default gen_random_uuid(),
  item_code        text        not null unique,
  name             text        not null,
  category         text        not null default 'Controller',
  brand            text,
  part_number      text,
  specs            text,
  user_guide       text,
  troubleshooting  text,
  compatible_units text,
  status           text        not null default 'Active',
  assigned_to      uuid        references public.mums_profiles(user_id) on delete set null,
  assigned_to_name text,
  parent_id        uuid        references public.support_catalog(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Prevent trailing-dash codes at DB level
alter table public.support_catalog
  drop constraint if exists chk_item_code_no_trailing_dash;
alter table public.support_catalog
  add constraint chk_item_code_no_trailing_dash
  check (
    item_code !~ '-$'
    and item_code !~ '--'
    and length(trim(item_code)) > 0
  );

create index if not exists idx_catalog_parent_id
  on public.support_catalog (parent_id);

-- ── support_catalog_comments ──────────────────────────────────────────────
create table if not exists public.support_catalog_comments (
  id                uuid        primary key default gen_random_uuid(),
  item_id           uuid        not null references public.support_catalog(id) on delete cascade,
  user_id           uuid        not null,
  user_name         text        not null,
  comment           text        not null,
  is_acknowledged   boolean     not null default false,
  acknowledged_by   uuid,
  acknowledged_name text,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now()
);

-- ── support_catalog_history ───────────────────────────────────────────────
create table if not exists public.support_catalog_history (
  id             uuid        primary key default gen_random_uuid(),
  item_id        uuid        not null references public.support_catalog(id) on delete cascade,
  edited_by      uuid        not null,
  edited_by_name text        not null,
  field_changed  text        not null,
  old_value      text,
  new_value      text,
  edited_at      timestamptz not null default now()
);

-- Seed: sample catalog items (replace with your own)
insert into public.support_catalog (item_code, name, category, status)
values
  ('CTR-001', 'Product Item 1', 'Controller', 'Active'),
  ('CTR-002', 'Product Item 2', 'Controller', 'Active'),
  ('SEN-001', 'Product Item 3', 'Sensor',     'Active'),
  ('SEN-002', 'Product Item 4', 'Sensor',     'Active'),
  ('VLV-001', 'Product Item 5', 'Valve',      'Active')
on conflict (item_code) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 11: DAILY PASSWORDS
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.daily_passwords (
  id         uuid  primary key default gen_random_uuid(),
  date       date  not null unique,
  password   text  not null default '',
  updated_by text,
  updated_at timestamptz default now()
);

create index if not exists daily_passwords_date_idx
  on public.daily_passwords (date desc);

alter table public.daily_passwords replica identity default;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 12: SERVICES WORKSPACE
-- ═══════════════════════════════════════════════════════════════════════════

-- ── services_sheets ───────────────────────────────────────────────────────
create table if not exists public.services_sheets (
  id           uuid    primary key default gen_random_uuid(),
  owner_id     uuid    references auth.users(id) on delete cascade,
  title        text    not null default 'Untitled Sheet',
  icon         text    default '📄',
  color        text    default '#22D3EE',
  sort_order   int     default 0,
  column_defs  jsonb   not null default '[
    {"key":"col_a","label":"Column A","type":"text","width":160},
    {"key":"col_b","label":"Column B","type":"text","width":160},
    {"key":"col_c","label":"Column C","type":"text","width":160}
  ]'::jsonb,
  column_state jsonb   default '{"widths": {}, "hidden": []}'::jsonb,
  row_count    int     default 0,
  is_archived  boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_services_sheets_owner
  on public.services_sheets (owner_id, is_archived);

drop trigger if exists trg_touch_sheets on public.services_sheets;
create trigger trg_touch_sheets
  before update on public.services_sheets
  for each row execute function public.touch_updated_at();

-- ── services_rows ─────────────────────────────────────────────────────────
create table if not exists public.services_rows (
  id         uuid    primary key default gen_random_uuid(),
  sheet_id   uuid    references public.services_sheets(id) on delete cascade,
  row_index  int     not null,
  data       jsonb   not null default '{}'::jsonb,
  updated_by uuid    references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint uq_services_rows_sheet_row unique (sheet_id, row_index)
);

create index if not exists idx_services_rows_sheet
  on public.services_rows (sheet_id, row_index);

drop trigger if exists trg_touch_rows on public.services_rows;
create trigger trg_touch_rows
  before update on public.services_rows
  for each row execute function public.touch_updated_at();

-- ── services_treeview_folders ─────────────────────────────────────────────
create table if not exists public.services_treeview_folders (
  id              uuid        primary key default gen_random_uuid(),
  sheet_id        uuid        not null references public.services_sheets(id) on delete cascade,
  name            text        not null,
  icon            text        not null default '📁',
  color           text        not null default '#22D3EE',
  condition_field text,
  condition_op    text        not null default 'eq',
  condition_value text,
  sort_order      int         not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_svc_tv_folders_sheet
  on public.services_treeview_folders (sheet_id, sort_order);

-- ── services_backups ──────────────────────────────────────────────────────
create table if not exists public.services_backups (
  id         uuid    primary key default gen_random_uuid(),
  sheet_id   uuid    references public.services_sheets(id) on delete cascade,
  user_id    uuid    references auth.users(id),
  name       text    not null,
  snapshot   jsonb   not null,
  row_count  int,
  created_at timestamptz default now()
);

create index if not exists idx_backups_sheet
  on public.services_backups (sheet_id, created_at desc);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 13: MY NOTES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mums_notes ────────────────────────────────────────────────────────────
create table if not exists public.mums_notes (
  id         uuid    primary key default gen_random_uuid(),
  user_id    uuid    not null references auth.users(id) on delete cascade,
  workspace  text    not null default 'personal',
  title      text    not null default 'Untitled Note',
  content    text    not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists mums_notes_user_ws
  on public.mums_notes (user_id, workspace);

-- Auto-stamp updated_at
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

-- ── mums_notes_workspaces ─────────────────────────────────────────────────
create table if not exists public.mums_notes_workspaces (
  id         uuid    primary key default gen_random_uuid(),
  user_id    uuid    not null references auth.users(id) on delete cascade,
  name       text    not null default 'Untitled',
  emoji      text    not null default '📁',
  sort_order int     not null default 0,
  parent_key text    default null,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_mn_ws_user_order
  on public.mums_notes_workspaces (user_id, sort_order);

-- Auto-stamp updated_at
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


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 14: ROW LEVEL SECURITY — ALL TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── mums_profiles ────────────────────────────────────────────────────────
alter table public.mums_profiles enable row level security;

drop policy if exists "profiles_select_own"        on public.mums_profiles;
drop policy if exists "profiles_select_superadmin" on public.mums_profiles;
drop policy if exists "Users can update own quickbase_settings" on public.mums_profiles;

create policy "profiles_select_own" on public.mums_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_select_superadmin" on public.mums_profiles
  for select to authenticated
  using (public.mums_is_super_admin(auth.uid()));

create policy "Users can update own quickbase_settings" on public.mums_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── mums_mailbox_override ─────────────────────────────────────────────────
alter table public.mums_mailbox_override enable row level security;

drop policy if exists "override_select_auth"    on public.mums_mailbox_override;
drop policy if exists "override_update_superadmin" on public.mums_mailbox_override;

create policy "override_select_auth" on public.mums_mailbox_override
  for select to authenticated using (true);

create policy "override_update_superadmin" on public.mums_mailbox_override
  for update to authenticated
  using (public.mums_is_super_admin(auth.uid()))
  with check (public.mums_is_super_admin(auth.uid()));

-- ── mums_documents ────────────────────────────────────────────────────────
alter table public.mums_documents enable row level security;

drop policy if exists "mums_documents_read"                     on public.mums_documents;
drop policy if exists "mums_documents_select_authenticated"     on public.mums_documents;

create policy "mums_documents_read" on public.mums_documents
  for select to authenticated using (true);

-- ── mums_presence ─────────────────────────────────────────────────────────
alter table public.mums_presence enable row level security;

drop policy if exists "presence_read"        on public.mums_presence;
drop policy if exists "presence_authed_read" on public.mums_presence;

create policy "presence_read" on public.mums_presence
  for select to authenticated using (true);
-- No INSERT/UPDATE/DELETE = server-only writes via service role

-- ── mums_sync_log ─────────────────────────────────────────────────────────
alter table public.mums_sync_log enable row level security;

drop policy if exists "sync_log_read_superadmin" on public.mums_sync_log;

create policy "sync_log_read_superadmin" on public.mums_sync_log
  for select to authenticated
  using (public.mums_is_super_admin(auth.uid()));

-- ── heartbeat ─────────────────────────────────────────────────────────────
alter table public.heartbeat enable row level security;

drop policy if exists "User can read own heartbeat"   on public.heartbeat;
drop policy if exists "User can insert own heartbeat" on public.heartbeat;
drop policy if exists "User can update own heartbeat" on public.heartbeat;
drop policy if exists "heartbeat_service_all"         on public.heartbeat;

create policy "heartbeat_service_all" on public.heartbeat
  for all to service_role
  using (true) with check (true);

-- ── task_distributions ────────────────────────────────────────────────────
alter table public.task_distributions enable row level security;

drop policy if exists "task_distributions_read"          on public.task_distributions;
drop policy if exists "task_distributions_service_write" on public.task_distributions;

create policy "task_distributions_read" on public.task_distributions
  for select to authenticated using (true);

create policy "task_distributions_service_write" on public.task_distributions
  for all to service_role using (true) with check (true);

-- ── task_items ────────────────────────────────────────────────────────────
alter table public.task_items enable row level security;

drop policy if exists "task_items_read"          on public.task_items;
drop policy if exists "task_items_service_write" on public.task_items;

create policy "task_items_read" on public.task_items
  for select to authenticated using (true);

create policy "task_items_service_write" on public.task_items
  for all to service_role using (true) with check (true);

-- ── mums_global_settings ─────────────────────────────────────────────────
alter table public.mums_global_settings enable row level security;

drop policy if exists "Anyone can read global settings"         on public.mums_global_settings;
drop policy if exists "Service role can write global settings"  on public.mums_global_settings;
drop policy if exists "mums_global_settings_read_auth"         on public.mums_global_settings;

create policy "mums_global_settings_read_auth" on public.mums_global_settings
  for select to authenticated using (true);

create policy "Service role can write global settings" on public.mums_global_settings
  for all to service_role using (true) with check (true);

-- ── quickbase_tabs ────────────────────────────────────────────────────────
alter table public.quickbase_tabs enable row level security;

drop policy if exists "service_role_all" on public.quickbase_tabs;

create policy "service_role_all" on public.quickbase_tabs
  for all to service_role using (true) with check (true);

-- ── qb_tokens ─────────────────────────────────────────────────────────────
alter table public.qb_tokens enable row level security;

drop policy if exists "qb_tokens_read_auth" on public.qb_tokens;

create policy "qb_tokens_read_auth" on public.qb_tokens
  for select to authenticated using (true);

-- ── support_catalog ───────────────────────────────────────────────────────
alter table public.support_catalog          enable row level security;
alter table public.support_catalog_comments enable row level security;
alter table public.support_catalog_history  enable row level security;

drop policy if exists "catalog_read"   on public.support_catalog;
drop policy if exists "catalog_write"  on public.support_catalog;
drop policy if exists "comments_read"  on public.support_catalog_comments;
drop policy if exists "comments_write" on public.support_catalog_comments;
drop policy if exists "history_read"   on public.support_catalog_history;
drop policy if exists "history_write"  on public.support_catalog_history;

create policy "catalog_read"   on public.support_catalog          for select to authenticated using (true);
create policy "catalog_write"  on public.support_catalog          for all    to service_role  using (true) with check (true);
create policy "comments_read"  on public.support_catalog_comments for select to authenticated using (true);
create policy "comments_write" on public.support_catalog_comments for all    to authenticated using (true) with check (true);
create policy "history_read"   on public.support_catalog_history  for select to authenticated using (true);
create policy "history_write"  on public.support_catalog_history  for all    to service_role  using (true) with check (true);

-- ── daily_passwords ───────────────────────────────────────────────────────
alter table public.daily_passwords enable row level security;

drop policy if exists "dp_read_all"     on public.daily_passwords;
drop policy if exists "dp_write_authed" on public.daily_passwords;

create policy "dp_read_all" on public.daily_passwords
  for select using (true);

create policy "dp_write_authed" on public.daily_passwords
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ── services_sheets ───────────────────────────────────────────────────────
alter table public.services_sheets enable row level security;

drop policy if exists "services_sheets_read_all"  on public.services_sheets;
drop policy if exists "services_sheets_write_all" on public.services_sheets;

create policy "services_sheets_read_all"  on public.services_sheets
  for select using (auth.uid() is not null);

create policy "services_sheets_write_all" on public.services_sheets
  for all using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ── services_rows ─────────────────────────────────────────────────────────
alter table public.services_rows enable row level security;

drop policy if exists "services_rows_read_all"  on public.services_rows;
drop policy if exists "services_rows_write_all" on public.services_rows;

create policy "services_rows_read_all"  on public.services_rows
  for select using (auth.uid() is not null);

create policy "services_rows_write_all" on public.services_rows
  for all using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ── services_treeview_folders ─────────────────────────────────────────────
alter table public.services_treeview_folders enable row level security;

drop policy if exists "svc_tv_folders_read"  on public.services_treeview_folders;
drop policy if exists "svc_tv_folders_write" on public.services_treeview_folders;

create policy "svc_tv_folders_read"  on public.services_treeview_folders
  for select using (auth.uid() is not null);

create policy "svc_tv_folders_write" on public.services_treeview_folders
  for all using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ── services_backups ──────────────────────────────────────────────────────
alter table public.services_backups enable row level security;

drop policy if exists "Users can manage own backups" on public.services_backups;
drop policy if exists "users_manage_own_backups"     on public.services_backups;

create policy "users_manage_own_backups" on public.services_backups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── mums_notes ────────────────────────────────────────────────────────────
alter table public.mums_notes enable row level security;

drop policy if exists "notes_owner" on public.mums_notes;

create policy "notes_owner" on public.mums_notes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── mums_notes_workspaces ─────────────────────────────────────────────────
alter table public.mums_notes_workspaces enable row level security;

drop policy if exists "ws_owner"       on public.mums_notes_workspaces;
drop policy if exists "notes_ws_owner" on public.mums_notes_workspaces;

create policy "notes_ws_owner" on public.mums_notes_workspaces
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 15: PERFORMANCE INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists idx_mums_profiles_user_id
  on public.mums_profiles (user_id);

create index if not exists idx_mums_profiles_theme_preference
  on public.mums_profiles (theme_preference);

create index if not exists idx_mums_profiles_qb_name
  on public.mums_profiles (qb_name);

create index if not exists idx_mums_profiles_pin_hash
  on public.mums_profiles (pin_hash)
  where pin_hash is not null;

create index if not exists idx_mums_profiles_quickbase_settings
  on public.mums_profiles using gin (quickbase_settings);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 16: REALTIME PUBLICATIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- These tables push live updates to connected clients via WebSocket.

do $$
declare
  t text;
begin
  foreach t in array array[
    'public.mums_documents',
    'public.mums_sync_log',
    'public.daily_passwords',
    'public.services_sheets',
    'public.services_rows',
    'public.services_treeview_folders'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table %s', t);
    exception when others then
      -- Already in publication or table doesn't exist yet — safe to ignore
      null;
    end;
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 17: FINAL CLEANUP — IMMEDIATE ONE-TIME TRIMS
-- ═══════════════════════════════════════════════════════════════════════════

-- Remove stale presence rows (fresh project has none, but idempotent)
delete from public.mums_presence
where last_seen < now() - interval '10 minutes';

-- Trim sync_log to 100 rows
delete from public.mums_sync_log
where id not in (
  select id from public.mums_sync_log
  order by id desc limit 100
);

-- Trim heartbeat to 1 row
delete from public.heartbeat
where id not in (
  select id from public.heartbeat
  order by timestamp desc nulls last limit 1
);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ MIGRATION COMPLETE
--
-- TABLES CREATED:
--   mums_profiles             — user directory (all roles, QB config, PIN)
--   mums_mailbox_override     — global / superadmin mailbox time override
--   mums_presence             — real-time online presence (UNLOGGED)
--   mums_documents            — shared state key-value store (Realtime)
--   mums_sync_log             — mailbox override audit log (auto-trim)
--   heartbeat                 — server keep-alive single-row (UNLOGGED)
--   task_distributions        — task batch distributions
--   task_items                — individual task assignments
--   mums_global_settings      — global app settings (theme, pause session)
--   quickbase_tabs            — personal QB iframe tab configs
--   qb_tokens                 — QB token heartbeat probe
--   support_catalog           — product knowledge base
--   support_catalog_comments  — KB item comments with acknowledgment
--   support_catalog_history   — KB item edit history
--   daily_passwords           — per-day broadcast passwords (Realtime)
--   services_sheets           — services workspace sheet definitions
--   services_rows             — services sheet rows (UPSERT-optimised)
--   services_treeview_folders — services treeview folder definitions
--   services_backups          — services sheet snapshot backups
--   mums_notes                — personal rich-text notes
--   mums_notes_workspaces     — notes workspace organization
--
-- VIEWS CREATED:
--   view_team_workload_matrix — per-user open/total task counts
--
-- FUNCTIONS CREATED:
--   set_updated_at()                  — generic updated_at trigger
--   mums_set_updated_at()             — alias for documents trigger
--   touch_updated_at()                — services tables updated_at trigger
--   mums_is_super_admin(uuid)         — RLS helper (SECURITY DEFINER)
--   mums_link_auth_user_to_profile()  — auth.users → mums_profiles linker
--   mums_sync_log_trim()              — auto-trim sync_log to 100 rows
--   heartbeat_trim()                  — auto-trim heartbeat to 1 row
--   _mn_notes_stamp_updated()         — notes updated_at stamper
--   _mn_ws_stamp_updated()            — workspace updated_at stamper
--
-- NEXT STEPS:
--   1. Run this block in a SEPARATE SQL editor tab (cannot run inside DO block):
--        VACUUM ANALYZE public.mums_presence;
--        VACUUM ANALYZE public.heartbeat;
--        VACUUM ANALYZE public.mums_documents;
--        VACUUM ANALYZE public.mums_sync_log;
--        VACUUM ANALYZE public.task_distributions;
--        VACUUM ANALYZE public.task_items;
--
--   2. Create your first SUPER_ADMIN user:
--        INSERT INTO public.mums_profiles (user_id, username, name, role, email)
--        VALUES (
--          gen_random_uuid(),
--          'supermace',
--          'Mace',
--          'SUPER_ADMIN',
--          'supermace@yourdomain.com'
--        );
--      Then sign up via the login page with that email to auto-link the account.
--
--   3. Set environment variables in Vercel/Cloudflare (see .env.example).
-- ═══════════════════════════════════════════════════════════════════════════
