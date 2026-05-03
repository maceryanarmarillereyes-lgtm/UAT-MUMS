-- 2026-05-02: Feature SQL parity hardening
-- Ensures legacy feature tables referenced by runtime code exist in migration history.

-- -----------------------------------------------------------------------------
-- Global theme legacy table used by /api/settings/global-theme.js
-- -----------------------------------------------------------------------------
create table if not exists public.mums_global_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists mums_global_settings_updated_at_idx
  on public.mums_global_settings (updated_at desc);

alter table public.mums_global_settings enable row level security;

-- Read access for authenticated users (global theme read path).
drop policy if exists "mums_global_settings_read_auth" on public.mums_global_settings;
create policy "mums_global_settings_read_auth"
  on public.mums_global_settings
  for select
  to authenticated
  using (true);

-- Write access limited to service role/API adapters.
-- No insert/update/delete policies for authenticated users on purpose.

-- -----------------------------------------------------------------------------
-- QuickBase token heartbeat marker table used by Services QB sync probes.
-- -----------------------------------------------------------------------------
create table if not exists public.qb_tokens (
  id bigserial primary key,
  updated_at timestamptz not null default now()
);

create index if not exists qb_tokens_updated_at_idx
  on public.qb_tokens (updated_at desc);

alter table public.qb_tokens enable row level security;

-- Authenticated read probe support for client freshness checks.
drop policy if exists "qb_tokens_read_auth" on public.qb_tokens;
create policy "qb_tokens_read_auth"
  on public.qb_tokens
  for select
  to authenticated
  using (true);

-- Writes remain API/service-role controlled by default (no write policy).
