-- Global Theme Settings Migration
-- Purpose: Allow Super Admin to set default theme for all users
-- Date: 2026-02-23

-- Create global settings table
CREATE TABLE IF NOT EXISTS public.mums_global_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default theme setting
INSERT INTO public.mums_global_settings (setting_key, setting_value)
VALUES ('default_theme', '"aurora_midnight"'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- Enable RLS
ALTER TABLE public.mums_global_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone authenticated can read global settings
CREATE POLICY "Anyone can read global settings"
  ON public.mums_global_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Only service role can write (Super Admin via API)
CREATE POLICY "Service role can write global settings"
  ON public.mums_global_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add theme_preference column to profiles (user override)
ALTER TABLE public.mums_profiles 
ADD COLUMN IF NOT EXISTS theme_preference TEXT DEFAULT NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_mums_profiles_theme_preference 
ON public.mums_profiles(theme_preference);

-- Comment for documentation
COMMENT ON TABLE public.mums_global_settings IS 'Global application settings managed by Super Admin';
COMMENT ON COLUMN public.mums_profiles.theme_preference IS 'User theme override (NULL = use global default)';
