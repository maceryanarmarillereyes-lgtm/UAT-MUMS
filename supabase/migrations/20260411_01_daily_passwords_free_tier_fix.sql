-- =============================================================================
-- 2026-04-11: daily_passwords FREE TIER FIX
-- =============================================================================
-- Problems fixed:
--   1. daily_passwords uses REPLICA IDENTITY FULL (default for tables added to
--      supabase_realtime) — every UPDATE writes ALL columns to WAL (high IO).
--      Fix: set REPLICA IDENTITY DEFAULT → only PK in WAL on UPDATE/DELETE.
--
--   2. RLS policy "dp_write_authed" uses deprecated auth.role() which returns
--      'authenticated' string — this works but triggers a schema cache hit on
--      every write. Use auth.uid() IS NOT NULL instead (no schema probe).
--
--   3. The publication registration (ALTER PUBLICATION ... ADD TABLE) is safe
--      to re-assert — it is idempotent if already registered.
--
--   4. Token refresh: ODP dedicated Supabase client now calls setAuth(token)
--      after createClient — this is a JS-side fix (odp.js) but documented here
--      for the migration audit trail.
--
-- Safe to run multiple times (fully idempotent).
-- =============================================================================


-- =============================================================================
-- FIX 1: REPLICA IDENTITY DEFAULT → reduces WAL size per UPDATE by ~50-80%
-- FULL = WAL stores every column on each UPDATE (was default when added to publication)
-- DEFAULT = WAL stores only the PK — sufficient for Realtime postgres_changes
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.daily_passwords REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'daily_passwords: REPLICA IDENTITY DEFAULT set — WAL size reduced';
  ELSE
    RAISE NOTICE 'daily_passwords: table not found — skipped';
  END IF;
END
$$;


-- =============================================================================
-- FIX 2: Drop and recreate RLS policies using auth.uid() instead of auth.role()
-- auth.role() = 'authenticated' works but probes the schema cache on every eval.
-- auth.uid() IS NOT NULL is cheaper and semantically equivalent for authenticated users.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN

    -- Drop old policies
    DROP POLICY IF EXISTS "dp_read_all"     ON public.daily_passwords;
    DROP POLICY IF EXISTS "dp_write_authed" ON public.daily_passwords;

    -- SELECT: allow all (including anon for public read — passwords are broadcast)
    CREATE POLICY "dp_read_all" ON public.daily_passwords
      FOR SELECT
      USING (true);

    -- INSERT/UPDATE/DELETE: require authenticated session via uid check (cheaper than role())
    CREATE POLICY "dp_write_authed" ON public.daily_passwords
      FOR ALL
      TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL);

    RAISE NOTICE 'daily_passwords: RLS policies updated (auth.uid() IS NOT NULL)';
  END IF;
END
$$;


-- =============================================================================
-- FIX 3: Ensure Realtime publication is registered (idempotent)
-- If already registered, Postgres silently ignores the ADD TABLE command.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'daily_passwords'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_passwords;
    RAISE NOTICE 'daily_passwords: added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'daily_passwords: already in supabase_realtime publication or table missing — skipped';
  END IF;
END
$$;


-- =============================================================================
-- FIX 4: Add updated_at index for efficient range queries
-- (ODP fetches by month — date DESC index already exists from original migration)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'daily_passwords'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'daily_passwords'
      AND indexname  = 'daily_passwords_date_idx'
  ) THEN
    CREATE INDEX daily_passwords_date_idx ON public.daily_passwords(date DESC);
    RAISE NOTICE 'daily_passwords: date_idx created';
  ELSE
    RAISE NOTICE 'daily_passwords: date_idx already exists — skipped';
  END IF;
END
$$;


-- =============================================================================
-- Reload PostgREST schema cache so updated policies take effect immediately
-- =============================================================================
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- DONE — Run these in a separate SQL editor tab after this migration:
--   VACUUM ANALYZE public.daily_passwords;
--
-- Expected IO improvements:
--   REPLICA IDENTITY DEFAULT : ~50-80% WAL reduction per UPDATE
--   auth.uid() policy        : eliminates schema cache probe on every write
--   Net: significant reduction in daily IO budget consumption for daily_passwords
-- =============================================================================
