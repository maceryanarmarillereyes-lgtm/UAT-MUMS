-- =============================================================================
-- SUPERADMIN EMAIL FIX — Run in MUMS-UAT2 SQL Editor
-- =============================================================================
-- Ensures the supermace profile has the correct email linked from auth.users.
-- This guarantees login works even if the trigger didn't fire during migration.
-- =============================================================================

-- Step 1: Backfill email from auth.users into mums_profiles
UPDATE public.mums_profiles p
SET email = lower(trim(u.email))::extensions.citext,
    updated_at = now()
FROM auth.users u
WHERE u.id = p.user_id
  AND u.email IS NOT NULL
  AND (p.email IS NULL OR p.email::text = '');

-- Step 2: Verify SUPER_ADMIN role is correct
UPDATE public.mums_profiles
SET role = 'SUPER_ADMIN',
    team_id = NULL,
    team_override = false,
    updated_at = now()
WHERE upper(role) != 'SUPER_ADMIN'
  AND user_id IN (
    SELECT id FROM auth.users
    WHERE lower(email) = lower(trim(current_setting('app.superadmin_email', true)))
  );

-- Step 3: Show current state (verify the fix)
SELECT
  p.user_id,
  p.username,
  p.name,
  p.email,
  p.role,
  u.email as auth_email,
  u.last_sign_in_at
FROM public.mums_profiles p
JOIN auth.users u ON u.id = p.user_id
ORDER BY p.created_at;

-- =============================================================================
-- DONE. You should see supermace with email = supermace@mums.local
-- =============================================================================
