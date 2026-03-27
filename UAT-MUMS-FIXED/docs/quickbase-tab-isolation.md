# Quickbase Tab Isolation Fix

## Summary
- Added a dedicated `TabManager` module that assigns unique `tab_id` values, deep-clones default settings, and stores isolated per-tab state.
- Added a new backend route for tab-scoped persistence (`/api/quickbase_tabs`, `/api/quickbase_tabs/:tab_id`, `/api/quickbase_tabs/upsert`).
- Added additive migration introducing `quickbase_tabs` table with unique `(user_id, tab_id)` index.

## Rollback
1. Revert commit containing:
   - `public/js/pages/my_quickbase_tab_manager.js`
   - `server/routes/quickbase_tabs.js`
   - router mappings in `api/handler.js` and `functions/api/[[path]].js`
   - migration `supabase/migrations/20260303_create_quickbase_tabs.sql`
2. Optionally keep the `quickbase_tabs` table in DB (safe additive artifact) or drop explicitly if needed:
   ```sql
   DROP TABLE IF EXISTS public.quickbase_tabs;
   ```

## Safe data backfill snippet (if migrating legacy per-user single config)
```sql
INSERT INTO public.quickbase_tabs (user_id, tab_id, tab_name, settings_json, created_at, updated_at)
SELECT
  user_id,
  'default-' || extract(epoch from now())::bigint || '-' || substr(md5(user_id), 1, 6) as tab_id,
  'Main Report',
  COALESCE(quickbase_settings::jsonb, '{}'::jsonb),
  now(),
  now()
FROM public.mums_profiles
WHERE quickbase_settings IS NOT NULL;
```
