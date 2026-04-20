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

create policy if not exists "svc_tv_folders_read"
  on public.services_treeview_folders
  for select using (auth.role() = 'authenticated');

create policy if not exists "svc_tv_folders_write"
  on public.services_treeview_folders
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

do $$
begin
  alter publication supabase_realtime add table public.services_treeview_folders;
exception
  when duplicate_object then
    null;
end $$;
