-- 2026-02-28: Ensure full Quickbase settings persistence columns exist on mums_profiles
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists quickbase_config jsonb,
  add column if not exists quickbase_settings jsonb,
  add column if not exists qb_custom_columns text[],
  add column if not exists qb_custom_filters jsonb,
  add column if not exists qb_filter_match text;
