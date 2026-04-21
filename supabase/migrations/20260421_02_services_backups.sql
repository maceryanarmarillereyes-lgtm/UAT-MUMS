create table if not exists public.services_backups (
  id uuid default gen_random_uuid() primary key,
  sheet_id uuid references public.services_sheets(id) on delete cascade,
  user_id uuid references auth.users(id),
  name text not null,
  data jsonb not null,
  row_count int,
  created_at timestamp with time zone default now()
);

alter table public.services_backups enable row level security;

drop policy if exists "Users can manage own backups" on public.services_backups;
create policy "Users can manage own backups"
  on public.services_backups
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
