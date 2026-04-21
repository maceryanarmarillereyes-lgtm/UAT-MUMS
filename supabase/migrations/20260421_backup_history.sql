create table if not exists public.services_backups (
  id uuid default gen_random_uuid() primary key,
  sheet_id uuid not null references public.services_sheets(id) on delete cascade,
  user_id uuid references auth.users(id),
  name text not null,
  snapshot jsonb not null,
  row_count integer,
  created_at timestamp with time zone default now()
);
create index idx_backups_sheet_created on public.services_backups(sheet_id, created_at desc);
alter table public.services_backups enable row level security;
create policy "Users can manage own backups" on public.services_backups for all using (auth.uid() = user_id);
