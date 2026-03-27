-- =====================================================
-- Migration: 20260324_01_apex_forced_defaults.sql
-- Purpose:   Add forced theme/brightness support to
--            mums_global_theme_settings document.
--            The JSONB value column already supports
--            arbitrary keys; no schema change needed.
--            This migration ensures the default document
--            row exists with APEX + 130% as defaults.
-- =====================================================

-- Upsert the global theme settings document with
-- APEX as default theme and 130% as default brightness.
-- forcedTheme/forcedBrightness start as false —
-- Super Admin must explicitly press "Force All Users".
INSERT INTO mums_documents (key, value, updated_at, updated_by_name, updated_by_user_id)
VALUES (
  'mums_global_theme_settings',
  '{
    "defaultTheme":    "apex",
    "brightness":      130,
    "contrast":        100,
    "scale":           100,
    "sidebarOpacity":  100,
    "forcedTheme":     false,
    "forcedBrightness":false,
    "forcedAt":        null,
    "forcedByName":    null
  }'::jsonb,
  NOW(),
  'System Migration',
  NULL
)
ON CONFLICT (key) DO UPDATE SET
  value = mums_documents.value ||
    '{"defaultTheme":"apex","brightness":130}'::jsonb,
  updated_at = NOW()
WHERE
  -- Only update if still using old defaults (don't overwrite if admin already customized)
  (mums_documents.value->>'defaultTheme' IN ('aurora_midnight','mums_dark') OR
   mums_documents.value->>'defaultTheme' IS NULL);

-- Comment: After running this migration:
--   1. All NEW users will get APEX theme + 130% brightness automatically.
--   2. EXISTING users retain their saved localStorage preferences
--      UNLESS Super Admin uses "Force All Users" in Main Settings.
