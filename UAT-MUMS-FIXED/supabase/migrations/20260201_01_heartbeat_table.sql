--------------------------------------------------------------------------------
-- 2026-02-01: Keep-alive heartbeat table (lightweight)
-- Used by /api/keep_alive to prevent Supabase project pausing on free plans.

create table if not exists public.heartbeat (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz default now()
);

-- Keep lightweight: no indexes required.
-- RLS is OFF by default for new tables; keep it disabled.
alter table public.heartbeat disable row level security;
