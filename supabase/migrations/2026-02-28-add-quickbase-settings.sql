BEGIN;
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS quickbase_settings JSONB;
COMMIT;

-- UPDATE public.users SET quickbase_settings = quickbase_config
-- WHERE quickbase_settings IS NULL AND quickbase_config IS NOT NULL;
