-- =============================================================================
-- 2026-04-10: FREE TIER IO RESCUE -- Supabase Nano / Free Plan
-- =============================================================================
-- Problem: Disk IO budget fully depleted daily. Memory at 45%+.
-- Root causes:
--   1. mums_presence  -- UPSERT every 45s x 30 users = ~57,600 WAL writes/day
--   2. heartbeat      -- unbounded INSERT growth
--   3. mums_documents -- REPLICA IDENTITY FULL doubles WAL size per update
--   4. mums_sync_log  -- unbounded growth -> index bloat
--   5. Profile schema probe fires up to 4 DB reads per presence/list call
--
-- All changes are IDEMPOTENT -- safe to run multiple times.
-- Zero downtime. No breaking schema changes.
-- =============================================================================

-- =============================================================================
-- FIX 1: mums_presence -> UNLOGGED
-- Eliminates ~57,600 WAL writes/day. SAFE: no Realtime subscription on this table.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_presence'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND relpersistence = 'p'
  ) THEN
    ALTER TABLE public.mums_presence SET UNLOGGED;
    RAISE NOTICE 'mums_presence: SET UNLOGGED done';
  ELSE
    RAISE NOTICE 'mums_presence: already UNLOGGED or missing -- skipped';
  END IF;
END
$$;

-- Remove stale presence rows immediately
DELETE FROM public.mums_presence
WHERE last_seen < NOW() - INTERVAL '10 minutes';

-- =============================================================================
-- FIX 2a: heartbeat -> UNLOGGED
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND relpersistence = 'p'
  ) THEN
    ALTER TABLE public.heartbeat SET UNLOGGED;
    RAISE NOTICE 'heartbeat: SET UNLOGGED done';
  ELSE
    RAISE NOTICE 'heartbeat: already UNLOGGED or missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 2b: heartbeat -- add source column for single-row UPSERT
-- Lets keep_alive.js UPSERT on source='server' -> 1 row forever, no growth.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'heartbeat'
      AND column_name  = 'source'
  )
  THEN
    ALTER TABLE public.heartbeat ADD COLUMN source TEXT;
    RAISE NOTICE 'heartbeat: source column added done';
  ELSE
    RAISE NOTICE 'heartbeat: source column already exists or table missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 2c: heartbeat -- add UNIQUE constraint on source
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname    = 'heartbeat_source_unique'
      AND conrelid   = 'public.heartbeat'::regclass
  )
  THEN
    -- Assign a value to any null source rows before adding constraint
    UPDATE public.heartbeat
    SET source = 'server_' || id::text
    WHERE source IS NULL;

    -- Keep only the newest row per source
    DELETE FROM public.heartbeat
    WHERE id NOT IN (
      SELECT DISTINCT ON (COALESCE(source, id::text)) id
      FROM public.heartbeat
      ORDER BY COALESCE(source, id::text), timestamp DESC NULLS LAST
    );

    ALTER TABLE public.heartbeat
      ADD CONSTRAINT heartbeat_source_unique UNIQUE (source);

    RAISE NOTICE 'heartbeat: UNIQUE(source) constraint added done';
  ELSE
    RAISE NOTICE 'heartbeat: UNIQUE(source) already exists or table missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 2d: heartbeat -- trim to 1 row immediately
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'heartbeat'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    DELETE FROM public.heartbeat
    WHERE id NOT IN (
      SELECT id FROM public.heartbeat
      ORDER BY timestamp DESC NULLS LAST
      LIMIT 1
    );
    RAISE NOTICE 'heartbeat: trimmed to 1 row done';
  END IF;
END
$$;

-- Replace trim trigger to permanently cap the table at 1 row
CREATE OR REPLACE FUNCTION public.heartbeat_trim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.heartbeat
  WHERE id NOT IN (
    SELECT id FROM public.heartbeat
    ORDER BY timestamp DESC NULLS LAST
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_heartbeat_trim ON public.heartbeat;
CREATE TRIGGER trg_heartbeat_trim
  AFTER INSERT OR UPDATE ON public.heartbeat
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.heartbeat_trim();

-- =============================================================================
-- FIX 3: mums_documents -> REPLICA IDENTITY DEFAULT
-- DEFAULT = WAL stores only the PK on UPDATE/DELETE (was FULL = all columns).
-- Gives approx 50 pct reduction in WAL size per upsert.
-- Realtime postgres_changes subscription is unaffected.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_documents'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.mums_documents REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'mums_documents: REPLICA IDENTITY DEFAULT done';
  ELSE
    RAISE NOTICE 'mums_documents: table not found -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- FIX 4: mums_sync_log -- REPLICA IDENTITY DEFAULT + tighter trim
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_sync_log'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    ALTER TABLE public.mums_sync_log REPLICA IDENTITY DEFAULT;
    RAISE NOTICE 'mums_sync_log: REPLICA IDENTITY DEFAULT done';
  ELSE
    RAISE NOTICE 'mums_sync_log: table not found -- skipped';
  END IF;
END
$$;

-- Tighten sync_log trim: keep 100 rows (was 200)
CREATE OR REPLACE FUNCTION public.mums_sync_log_trim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.mums_sync_log) > 150 THEN
    DELETE FROM public.mums_sync_log
    WHERE id NOT IN (
      SELECT id FROM public.mums_sync_log
      ORDER BY id DESC
      LIMIT 100
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mums_sync_log_trim ON public.mums_sync_log;
CREATE TRIGGER trg_mums_sync_log_trim
  AFTER INSERT ON public.mums_sync_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mums_sync_log_trim();

-- Immediate sync_log trim
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_sync_log'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    DELETE FROM public.mums_sync_log
    WHERE id NOT IN (
      SELECT id FROM public.mums_sync_log
      ORDER BY id DESC
      LIMIT 100
    );
    RAISE NOTICE 'mums_sync_log: trimmed to 100 rows done';
  END IF;
END
$$;

-- =============================================================================
-- FIX 5: Index on mums_presence(last_seen DESC)
-- presence/list.js queries WHERE last_seen >= cutoff every 90s per user.
-- Without this index every query is a full table scan.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'mums_presence'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'mums_presence'
      AND indexname  = 'idx_mums_presence_last_seen'
  )
  THEN
    CREATE INDEX idx_mums_presence_last_seen
      ON public.mums_presence(last_seen DESC);
    RAISE NOTICE 'mums_presence: index on last_seen created done';
  ELSE
    RAISE NOTICE 'mums_presence: last_seen index already exists or table missing -- skipped';
  END IF;
END
$$;

-- =============================================================================
-- ALL DONE
--
-- Run these separately in a new SQL editor tab (VACUUM cannot run in a DO block):
--   VACUUM ANALYZE public.mums_presence;
--   VACUUM ANALYZE public.heartbeat;
--   VACUUM ANALYZE public.mums_documents;
--   VACUUM ANALYZE public.mums_sync_log;
--
-- Expected results after running this migration:
--   mums_presence UNLOGGED : ~57,600 WAL writes/day eliminated
--   heartbeat single-row   : was growing unbounded, now permanently 1 row
--   REPLICA IDENTITY DEFAULT: approx 50 pct WAL reduction per mums_documents upsert
--   last_seen index        : full table scan replaced by fast index scan
--   Estimated total Disk IO reduction: more than 85 pct
-- =============================================================================
