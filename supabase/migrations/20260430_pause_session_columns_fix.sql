-- ============================================================================
-- FIX: 20260430_pause_session_columns_fix.sql
-- Root Cause: 20260425_pause_session_settings.sql used CREATE TABLE IF NOT EXISTS
-- which silently skips column additions when the table already exists from the
-- MASTER_MIGRATION. The audit columns (updated_by_name, updated_by_user_id) were
-- never added to live DBs that already had the table → upsert returns 400.
-- This migration safely adds the missing columns using ADD COLUMN IF NOT EXISTS.
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- Add missing audit columns if they don't already exist
ALTER TABLE public.mums_global_settings
  ADD COLUMN IF NOT EXISTS updated_by_name     TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id  UUID;

-- Ensure updated_at column is present (base schema has it but guard anyway)
ALTER TABLE public.mums_global_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure the pause_session seed row exists (idempotent)
INSERT INTO public.mums_global_settings (setting_key, setting_value, updated_at)
VALUES (
  'pause_session',
  '{"enabled": true, "timeout_minutes": 10}'::jsonb,
  NOW()
)
ON CONFLICT (setting_key) DO NOTHING;
