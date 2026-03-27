-- =============================================================================
-- MUMS-UAT2 COLUMN FIX PATCH
-- Run in: MUMS-UAT2 → SQL Editor → New Query → RUN
-- =============================================================================
-- Adds optional columns that may be missing if MASTER_MIGRATION.sql had
-- issues with the extensions.citext schema on this Supabase instance.
-- All statements are idempotent (safe to run multiple times).
-- =============================================================================

-- Ensure extensions schema exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Ensure citext is available (try both schemas)
CREATE EXTENSION IF NOT EXISTS citext SCHEMA extensions;

-- Core optional columns
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS avatar_url       text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS team_override    boolean NOT NULL DEFAULT false;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_name          text NOT NULL DEFAULT '';
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_token         text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_realm         text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_table_id      text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_qid           text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_report_link   text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS quickbase_config  jsonb;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS quickbase_settings jsonb;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_custom_columns text[];
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_custom_filters jsonb;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_filter_match   text;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS qb_dashboard_counters jsonb;
ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS theme_preference  text DEFAULT NULL;

-- Add email column (try citext, fall back to text if extensions.citext unavailable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mums_profiles' AND column_name = 'email'
  ) THEN
    BEGIN
      ALTER TABLE public.mums_profiles ADD COLUMN email extensions.citext;
    EXCEPTION WHEN OTHERS THEN
      ALTER TABLE public.mums_profiles ADD COLUMN email text;
    END;
  END IF;
END $$;

-- Backfill email from auth.users
UPDATE public.mums_profiles p
SET email = lower(trim(u.email))
FROM auth.users u
WHERE u.id = p.user_id
  AND u.email IS NOT NULL
  AND (p.email IS NULL OR trim(p.email::text) = '');

-- Unique constraint on email (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mums_profiles_email_unique'
      AND conrelid = 'public.mums_profiles'::regclass
  ) THEN
    ALTER TABLE public.mums_profiles ADD CONSTRAINT mums_profiles_email_unique UNIQUE (email);
  END IF;
END $$;

-- Ensure quickbase_settings is JSONB
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mums_profiles'
      AND column_name = 'quickbase_settings' AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE public.mums_profiles
      ALTER COLUMN quickbase_settings TYPE jsonb
      USING to_jsonb(quickbase_settings);
  END IF;
END $$;

UPDATE public.mums_profiles SET quickbase_settings = '{}'::jsonb WHERE quickbase_settings IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mums_profiles_qb_name        ON public.mums_profiles (qb_name);
CREATE INDEX IF NOT EXISTS idx_mums_profiles_theme_preference ON public.mums_profiles (theme_preference);
CREATE INDEX IF NOT EXISTS idx_mums_profiles_quickbase_settings ON public.mums_profiles USING gin (quickbase_settings);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- DONE. Go to User Management → should load users now.
-- =============================================================================
