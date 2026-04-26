-- Custom workspaces for My Notes (user-defined folders in addition to Personal/Team/Projects)
create table if not exists public.mums_notes_workspaces (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  emoji      text not null default '📁',
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists mums_notes_ws_user on public.mums_notes_workspaces(user_id, sort_order);
alter table public.mums_notes_workspaces enable row level security;
drop policy if exists "ws_owner" on public.mums_notes_workspaces;
create policy "ws_owner" on public.mums_notes_workspaces
  for all to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add updated_at trigger so it auto-stamps on every update
create or replace function public._set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_notes_updated_at on public.mums_notes;
create trigger trg_notes_updated_at
  before update on public.mums_notes
  for each row execute procedure public._set_updated_at();
