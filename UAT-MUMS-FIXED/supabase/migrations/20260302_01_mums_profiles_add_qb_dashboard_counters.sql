-- 2026-03-02: Ensure dashboard counters column exists for cross-device Quickbase widget persistence
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists qb_dashboard_counters jsonb;
