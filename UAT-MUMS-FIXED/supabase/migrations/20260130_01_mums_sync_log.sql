--------------------------------------------------------------------------------
-- 2026-01-30: MUMS - Audit log for mailbox override changes (safe migration)
-- Creates mums_sync_log if it does not exist.
-- Required constraints:
--   - user_id is NOT NULL
--------------------------------------------------------------------------------

create table if not exists public.mums_sync_log (
  id bigserial primary key,
  user_id uuid not null,
  scope text not null check (scope in ('global','superadmin')),
  "timestamp" timestamptz not null default now(),
  effective_time timestamptz,
  action text not null
);

create index if not exists mums_sync_log_timestamp_idx
  on public.mums_sync_log ("timestamp" desc);

create index if not exists mums_sync_log_scope_idx
  on public.mums_sync_log (scope);

--------------------------------------------------------------------------------
-- NOTE:
-- RLS is not enabled here. If you enable RLS in the future, ensure that:
--   - Only SUPER_ADMIN can insert rows (server already enforces).
--   - Read permissions are aligned with your audit visibility requirements.
--------------------------------------------------------------------------------
