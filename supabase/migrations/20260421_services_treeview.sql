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
