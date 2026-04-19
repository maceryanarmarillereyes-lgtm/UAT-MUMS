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
