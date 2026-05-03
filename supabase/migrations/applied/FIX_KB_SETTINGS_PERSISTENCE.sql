-- ============================================================
-- FIX_KB_SETTINGS_PERSISTENCE.sql
-- ROOT CAUSE FIX for KB Settings not saving across devices/logins
--
-- PROBLEM: mums_documents only had a SELECT policy for authenticated.
--          Without an explicit write policy, Supabase may block
--          INSERT/UPDATE even for service_role on some configurations.
--
-- RUN THIS ONCE in Supabase SQL Editor → Run
-- ============================================================

-- 1. Ensure mums_documents exists with correct schema
CREATE TABLE IF NOT EXISTS public.mums_documents (
  key              TEXT PRIMARY KEY,
  value            JSONB,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  updated_by_name  TEXT,
  updated_by_user_id TEXT
);

-- 2. Read policy: any authenticated user can read (for KB sync read)
DROP POLICY IF EXISTS "mums_documents_read" ON public.mums_documents;
CREATE POLICY "mums_documents_read"
  ON public.mums_documents
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Write policy: service_role full access (server-side upserts)
DROP POLICY IF EXISTS "mums_documents_service_role" ON public.mums_documents;
CREATE POLICY "mums_documents_service_role"
  ON public.mums_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Write policy: Super Admins can also write directly if needed
DROP POLICY IF EXISTS "mums_documents_superadmin_write" ON public.mums_documents;
DO $$
BEGIN
  -- Only create this policy if mums_is_super_admin function exists
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mums_is_super_admin'
  ) THEN
    CREATE POLICY "mums_documents_superadmin_write"
      ON public.mums_documents
      FOR ALL
      TO authenticated
      USING (public.mums_is_super_admin(auth.uid()))
      WITH CHECK (public.mums_is_super_admin(auth.uid()));
  END IF;
END $$;

-- 5. Ensure RLS is enabled
ALTER TABLE public.mums_documents ENABLE ROW LEVEL SECURITY;

-- 6. Ensure updated_by_user_id column is TEXT (not UUID/int — prevents type mismatch)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'mums_documents'
      AND column_name  = 'updated_by_user_id'
  ) THEN
    -- Check if column is not already TEXT
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'mums_documents'
        AND column_name  = 'updated_by_user_id'
        AND data_type    = 'text'
    ) THEN
      ALTER TABLE public.mums_documents
        ALTER COLUMN updated_by_user_id TYPE TEXT USING updated_by_user_id::TEXT;
      RAISE NOTICE 'mums_documents.updated_by_user_id converted to TEXT';
    END IF;
  ELSE
    ALTER TABLE public.mums_documents
      ADD COLUMN updated_by_user_id TEXT;
    RAISE NOTICE 'mums_documents.updated_by_user_id column added';
  END IF;
END $$;

-- 7. Verify current policies
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'mums_documents'
ORDER BY policyname;

-- Expected output:
--   mums_documents_read           | SELECT | {authenticated}
--   mums_documents_service_role   | ALL    | {service_role}
--   mums_documents_superadmin_write | ALL  | {authenticated}  (if function exists)
