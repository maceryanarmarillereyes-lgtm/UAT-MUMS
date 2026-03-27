--------------------------------------------------------------------------------
-- 2026-02-03: Heartbeat RLS alignment (uid column + per-user policies)
--
-- Goal:
-- - Add uid column so authenticated clients can write/read their own heartbeat
-- - Enable RLS and enforce per-user access
-- - Keep server-side keep-alive working (service role bypasses RLS)
--------------------------------------------------------------------------------

-- Add user identifier column for RLS enforcement
alter table if exists public.heartbeat
  add column if not exists uid uuid;

-- Enable Row Level Security
alter table public.heartbeat enable row level security;

-- Policies (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heartbeat'
      and policyname = 'User can read own heartbeat'
  ) then
    create policy "User can read own heartbeat"
    on public.heartbeat
    for select
    using (auth.uid() = uid);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heartbeat'
      and policyname = 'User can insert own heartbeat'
  ) then
    create policy "User can insert own heartbeat"
    on public.heartbeat
    for insert
    with check (auth.uid() = uid);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'heartbeat'
      and policyname = 'User can update own heartbeat'
  ) then
    create policy "User can update own heartbeat"
    on public.heartbeat
    for update
    using (auth.uid() = uid)
    with check (auth.uid() = uid);
  end if;
end
$$;
