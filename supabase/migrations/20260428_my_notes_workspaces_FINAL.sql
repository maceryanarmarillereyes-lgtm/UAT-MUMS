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
