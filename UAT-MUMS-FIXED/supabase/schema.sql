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
