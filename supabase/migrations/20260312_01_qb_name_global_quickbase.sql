-- 2026-03-12: Add qb_name to mums_profiles + global quickbase settings support

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add qb_name column to mums_profiles
--    This is the "Assigned To" name value used to filter QB records per user.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.mums_profiles
  ADD COLUMN IF NOT EXISTS qb_name text DEFAULT '' NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ensure mums_documents table exists (already exists, but safe)
--    Global QB settings are stored as a key/value doc with key:
--    'mums_global_quickbase_settings'
-- ─────────────────────────────────────────────────────────────────────────
-- mums_documents already exists from schema.sql — no create needed.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Index for fast qb_name lookups
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mums_profiles_qb_name
  ON public.mums_profiles (qb_name);

NOTIFY pgrst, 'reload schema';
