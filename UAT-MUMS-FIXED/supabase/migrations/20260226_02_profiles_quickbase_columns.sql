-- 2026-02-26: Ensure Quickbase configuration columns exist on mums_profiles
-- Safe to run multiple times.

alter table if exists public.mums_profiles
  add column if not exists qb_token text,
  add column if not exists qb_realm text,
  add column if not exists qb_table_id text,
  add column if not exists qb_qid text,
  add column if not exists qb_report_link text;
