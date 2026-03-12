-- 2026-01-27: Add avatar_url to mums_profiles (profile photos stored in Storage public bucket)
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists avatar_url text;

-- Optional: keep updated_at correct (trigger is already created in schema.sql).
