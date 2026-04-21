DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'services_backups'
  ) THEN
    CREATE TABLE public.services_backups (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      sheet_id uuid REFERENCES public.services_sheets(id) ON DELETE CASCADE,
      user_id uuid REFERENCES auth.users(id),
      name text NOT NULL,
      snapshot jsonb NOT NULL,
      row_count integer,
      created_at timestamptz DEFAULT now()
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services_backups' AND column_name = 'data'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services_backups' AND column_name = 'snapshot'
  ) THEN
    ALTER TABLE public.services_backups RENAME COLUMN data TO snapshot;
  END IF;
END$$;

ALTER TABLE public.services_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_backups" ON public.services_backups;
CREATE POLICY "users_manage_own_backups" ON public.services_backups
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_backups_sheet ON public.services_backups(sheet_id, created_at DESC);
