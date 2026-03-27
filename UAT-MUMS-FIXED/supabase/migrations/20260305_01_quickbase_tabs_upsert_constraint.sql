-- Fix: Add a proper UNIQUE CONSTRAINT (in addition to the existing unique index)
-- so PostgREST on_conflict upsert works correctly.
-- PostgREST requires a named unique CONSTRAINT for on_conflict resolution,
-- not just a unique index, in certain Supabase/PostgREST versions.

-- Create table if not yet created (safe no-op if already exists)
CREATE TABLE IF NOT EXISTS public.quickbase_tabs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  tab_name TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Drop old index if it exists (we'll replace with a proper constraint)
DROP INDEX IF EXISTS public.uq_quickbase_user_tab;

-- Add proper UNIQUE CONSTRAINT so PostgREST on_conflict works
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_quickbase_user_tab'
      AND conrelid = 'public.quickbase_tabs'::regclass
  ) THEN
    ALTER TABLE public.quickbase_tabs
      ADD CONSTRAINT uq_quickbase_user_tab UNIQUE (user_id, tab_id);
  END IF;
END $$;

-- Enable RLS (safe no-op if already enabled)
ALTER TABLE public.quickbase_tabs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by Vercel API)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'quickbase_tabs' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.quickbase_tabs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
