-- Pause Session global setting bootstrap
-- Ensures mums_global_settings exists and seeds pause_session default.

CREATE TABLE IF NOT EXISTS public.mums_global_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_by_name TEXT,
  updated_by_user_id UUID
);

INSERT INTO public.mums_global_settings (setting_key, setting_value)
VALUES (
  'pause_session',
  '{"enabled": true, "timeout_minutes": 10}'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;
