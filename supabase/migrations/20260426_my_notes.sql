create table if not exists public.mums_notes (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, workspace text not null default 'personal', title text not null default 'Untitled Note', content text not null default '', created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists mums_notes_user_ws on public.mums_notes(user_id, workspace);
alter table public.mums_notes enable row level security;
drop policy if exists "notes_owner" on public.mums_notes;
create policy "notes_owner" on public.mums_notes for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
