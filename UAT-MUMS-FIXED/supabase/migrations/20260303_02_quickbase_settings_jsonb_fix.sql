-- Fix Quickbase Settings Persistence
-- Ensures quickbase_settings column exists on mums_profiles with proper JSONB type

BEGIN;

-- Step 1: Ensure quickbase_settings column exists and is JSONB
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'mums_profiles'
    AND column_name = 'quickbase_settings'
  ) THEN
    ALTER TABLE public.mums_profiles
    ADD COLUMN quickbase_settings JSONB DEFAULT '{}'::jsonb;
  ELSE
    -- Convert to JSONB if it's TEXT
    ALTER TABLE public.mums_profiles
    ALTER COLUMN quickbase_settings TYPE JSONB USING
      CASE
        WHEN quickbase_settings IS NULL THEN '{}'::jsonb
        WHEN quickbase_settings::text = '' THEN '{}'::jsonb
        ELSE quickbase_settings::jsonb
      END;
  END IF;
END $$;

-- Step 2: Set default value for existing NULL records
UPDATE public.mums_profiles
SET quickbase_settings = '{}'::jsonb
WHERE quickbase_settings IS NULL;

-- Step 3: Migrate legacy quickbase_config to quickbase_settings if not already migrated
UPDATE public.mums_profiles mp
SET quickbase_settings = COALESCE(mp.quickbase_config, '{}'::jsonb)
WHERE (mp.quickbase_settings IS NULL OR mp.quickbase_settings = '{}'::jsonb)
  AND mp.quickbase_config IS NOT NULL
  AND mp.quickbase_config != '{}'::jsonb;

-- Step 4: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_mums_profiles_quickbase_settings
ON public.mums_profiles USING GIN (quickbase_settings);

-- Step 5: Ensure RLS allows users to update their own quickbase_settings
DROP POLICY IF EXISTS "Users can update own quickbase_settings" ON public.mums_profiles;
CREATE POLICY "Users can update own quickbase_settings"
ON public.mums_profiles
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

COMMIT;
