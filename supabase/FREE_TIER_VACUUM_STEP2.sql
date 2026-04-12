-- =============================================================================
-- FREE TIER FIX — STEP 2: VACUUM (run in a SEPARATE SQL editor tab)
-- Must be run AFTER FREE_TIER_APPLY_NOW.sql
-- VACUUM cannot run inside a transaction block — use a fresh SQL editor tab.
-- =============================================================================

VACUUM ANALYZE public.mums_presence;
VACUUM ANALYZE public.heartbeat;
VACUUM ANALYZE public.mums_documents;
VACUUM ANALYZE public.mums_sync_log;
VACUUM ANALYZE public.daily_passwords;
VACUUM ANALYZE public.mums_profiles;

-- =============================================================================
-- After VACUUM, check table sizes:
-- SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total_size
-- FROM pg_catalog.pg_statio_user_tables
-- ORDER BY pg_total_relation_size(relid) DESC;
-- =============================================================================
