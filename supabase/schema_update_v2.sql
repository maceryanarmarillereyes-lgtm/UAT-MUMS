-- MUMS incremental schema update (2026-01-25)
-- Safe to run on an existing Supabase project.

-- Expand role constraint to include SUPER_USER.
alter table if exists public.mums_profiles
  drop constraint if exists mums_profiles_role_check;
alter table if exists public.mums_profiles
  add constraint mums_profiles_role_check
  check (role in ('SUPER_ADMIN','SUPER_USER','ADMIN','TEAM_LEAD','MEMBER'));

-- Presence (online users)
create table if not exists public.mums_presence(
  client_id text primary key,
  user_id text not null,
  name text,
  role text,
  team_id text,
  route text,
  last_seen timestamptz not null default now()
);
create index if not exists mums_presence_last_seen_idx on public.mums_presence(last_seen desc);

-- Collaborative documents store (shared state sync)
create table if not exists public.mums_documents(
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null,
  updated_by_name text null,
  updated_by_client_id text null
);
create index if not exists mums_documents_updated_at_idx on public.mums_documents(updated_at);

alter table public.mums_documents enable row level security;

-- Allow authenticated users to read documents (writes go through server-side API only).
drop policy if exists mums_documents_select_authenticated on public.mums_documents;
create policy mums_documents_select_authenticated
  on public.mums_documents
  for select
  to authenticated
  using (true);

-- Ensure Supabase Realtime replication is enabled for mums_documents.
-- (If already enabled, this is a no-op.)
do $$
begin
  execute 'alter publication supabase_realtime add table public.mums_documents';
exception when others then
  -- Ignore errors (publication missing, already added, insufficient privileges).
  null;
end $$;
