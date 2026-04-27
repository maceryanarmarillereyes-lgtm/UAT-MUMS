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
