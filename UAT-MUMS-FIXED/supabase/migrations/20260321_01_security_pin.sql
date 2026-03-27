-- ══════════════════════════════════════════════════════════════════════════════
-- MUMS Security PIN Feature Migration
-- Run in Supabase SQL editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add PIN columns to mums_profiles
ALTER TABLE public.mums_profiles
  ADD COLUMN IF NOT EXISTS pin_hash            text             DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_set_at          timestamptz      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_last_used_at    timestamptz      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_fail_count      integer          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_last_fail_at    timestamptz      DEFAULT NULL;

-- 2. Global PIN policy settings stored in mums_documents
-- Key: 'mums_pin_policy'
-- This table already exists; we just use a new key.
-- Insert default policy (all features enabled)
INSERT INTO public.mums_documents (key, value)
VALUES (
  'mums_pin_policy',
  '{
    "enabled": true,
    "requireOnLogin": true,
    "enforceOnFirstLogin": true,
    "sessionExpiryHours": 3,
    "autoLogoutOnFailures": true,
    "maxFailedAttempts": 3
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 3. Index for faster profile lookups
CREATE INDEX IF NOT EXISTS idx_mums_profiles_pin_hash ON public.mums_profiles (pin_hash) WHERE pin_hash IS NOT NULL;

-- ── Notes ────────────────────────────────────────────────────────────────────
-- pin_hash: bcrypt-hashed 4-digit PIN (server-side only, never sent to client)
-- pin_set_at: when PIN was last created/changed
-- pin_last_used_at: last successful PIN auth
-- pin_fail_count: resets to 0 on successful auth (NOT persistent lockout)
-- pin_last_fail_at: timestamp of last failure (for UI display only)
