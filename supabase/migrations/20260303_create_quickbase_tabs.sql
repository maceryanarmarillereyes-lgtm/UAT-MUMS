BEGIN;

CREATE TABLE IF NOT EXISTS public.quickbase_tabs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  tab_name TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quickbase_user_tab
  ON public.quickbase_tabs (user_id, tab_id);

COMMIT;
