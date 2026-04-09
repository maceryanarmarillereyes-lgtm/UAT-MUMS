-- =============================================================================
-- 2026-04-10: RLS SECURITY FIX -- Fixes all 4 Security Advisor errors
-- =============================================================================
-- Errors being fixed:
--   1. RLS Disabled in Public: public.mums_presence
--   2. RLS Disabled in Public: public.mums_sync_log
--   3. RLS Disabled in Public: public.task_distributions
--   4. RLS Disabled in Public: public.task_items
--
-- Safe to run multiple times (fully idempotent).
-- Service role always bypasses RLS -- server-side routes are unaffected.
-- =============================================================================


-- =============================================================================
-- HELPER: Ensure mums_is_super_admin function exists before using it in policies.
-- This is defined in MASTER_MIGRATION but we re-create it here defensively
-- in case only this patch file is run on a fresh database.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mums_is_super_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mums_profiles
    WHERE user_id = p_uid
      AND UPPER(REPLACE(role, ' ', '_')) IN ('SUPER_ADMIN', 'SUPERADMIN', 'SA')
  );
$$;


-- =============================================================================
-- FIX 1: mums_presence -- Enable RLS
-- =============================================================================
-- Presence is written exclusively by the server (service role bypasses RLS).
-- Authenticated users need SELECT to render the online roster.
-- No client INSERT/UPDATE/DELETE allowed.
-- =============================================================================
ALTER TABLE public.mums_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presence_read"         ON public.mums_presence;
DROP POLICY IF EXISTS "presence_write"        ON public.mums_presence;
DROP POLICY IF EXISTS "presence_select"       ON public.mums_presence;
DROP POLICY IF EXISTS "presence_authed_read"  ON public.mums_presence;

CREATE POLICY "presence_read" ON public.mums_presence
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies = blocked for all non-service-role clients.


-- =============================================================================
-- FIX 2: mums_sync_log -- Enable RLS
-- =============================================================================
-- Sync log is written by the server only (service role).
-- SUPER_ADMIN can read for audit. Regular users: no direct access needed.
-- =============================================================================
ALTER TABLE public.mums_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_log_read_superadmin" ON public.mums_sync_log;
DROP POLICY IF EXISTS "sync_log_read"            ON public.mums_sync_log;

CREATE POLICY "sync_log_read_superadmin" ON public.mums_sync_log
  FOR SELECT
  TO authenticated
  USING (public.mums_is_super_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies = service role only writes.


-- =============================================================================
-- FIX 3: task_distributions -- Enable RLS
-- =============================================================================
-- All authenticated users can read distributions (needed for task dashboard).
-- Writes are via server API only (service role).
-- =============================================================================
ALTER TABLE public.task_distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_distributions_read"         ON public.task_distributions;
DROP POLICY IF EXISTS "task_distributions_write"        ON public.task_distributions;
DROP POLICY IF EXISTS "task_distributions_service_write" ON public.task_distributions;

-- All authenticated users can read all task distributions
CREATE POLICY "task_distributions_read" ON public.task_distributions
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role handles all writes (no client-side writes needed)
CREATE POLICY "task_distributions_service_write" ON public.task_distributions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- FIX 4: task_items -- Enable RLS
-- =============================================================================
-- All authenticated users can read task items (for task dashboard + workload).
-- Writes are via server API only (service role).
-- =============================================================================
ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_items_read"          ON public.task_items;
DROP POLICY IF EXISTS "task_items_write"         ON public.task_items;
DROP POLICY IF EXISTS "task_items_service_write" ON public.task_items;

-- All authenticated users can read all task items
CREATE POLICY "task_items_read" ON public.task_items
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role handles all writes
CREATE POLICY "task_items_service_write" ON public.task_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- BONUS: Also enable RLS on support_catalog tables if they exist
-- (prevents future Security Advisor warnings as the catalog grows)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'support_catalog'
  ) THEN
    ALTER TABLE public.support_catalog         ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.support_catalog_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.support_catalog_history  ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "catalog_read"   ON public.support_catalog;
    DROP POLICY IF EXISTS "catalog_write"  ON public.support_catalog;
    DROP POLICY IF EXISTS "comments_read"  ON public.support_catalog_comments;
    DROP POLICY IF EXISTS "comments_write" ON public.support_catalog_comments;
    DROP POLICY IF EXISTS "history_read"   ON public.support_catalog_history;
    DROP POLICY IF EXISTS "history_write"  ON public.support_catalog_history;

    CREATE POLICY "catalog_read"   ON public.support_catalog          FOR SELECT TO authenticated USING (true);
    CREATE POLICY "catalog_write"  ON public.support_catalog          FOR ALL    TO service_role  USING (true) WITH CHECK (true);
    CREATE POLICY "comments_read"  ON public.support_catalog_comments FOR SELECT TO authenticated USING (true);
    CREATE POLICY "comments_write" ON public.support_catalog_comments FOR ALL    TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "history_read"   ON public.support_catalog_history  FOR SELECT TO authenticated USING (true);
    CREATE POLICY "history_write"  ON public.support_catalog_history  FOR ALL    TO service_role  USING (true) WITH CHECK (true);

    RAISE NOTICE 'support_catalog tables: RLS enabled and policies created done';
  ELSE
    RAISE NOTICE 'support_catalog tables: not found -- skipped';
  END IF;
END
$$;


-- =============================================================================
-- BONUS: heartbeat -- ensure RLS stays enabled after UNLOGGED conversion
-- (Converting a table to UNLOGGED does not disable RLS, but we re-assert
-- it here to guarantee the Security Advisor never flags it.)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.heartbeat ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "User can read own heartbeat"   ON public.heartbeat;
    DROP POLICY IF EXISTS "User can insert own heartbeat" ON public.heartbeat;
    DROP POLICY IF EXISTS "User can update own heartbeat" ON public.heartbeat;
    DROP POLICY IF EXISTS "heartbeat_service_all"         ON public.heartbeat;

    -- Service role only -- heartbeat is a server keep-alive, never touched by clients
    CREATE POLICY "heartbeat_service_all" ON public.heartbeat
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);

    RAISE NOTICE 'heartbeat: RLS enabled, service-role-only policy done';
  END IF;
END
$$;


-- =============================================================================
-- Reload PostgREST schema cache so new policies take effect immediately
-- =============================================================================
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DONE
-- Go to Supabase Security Advisor and click Refresh.
-- All 4 RLS errors should be gone.
--
-- If the WARNING "Leaked Password Protection Disabled" still shows:
--   Fix manually: Auth -> Settings -> Enable "Leaked Password Protection"
--   (This is an Auth dashboard toggle, cannot be set via SQL)
-- =============================================================================
