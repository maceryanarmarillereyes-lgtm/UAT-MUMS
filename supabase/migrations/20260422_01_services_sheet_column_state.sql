ALTER TABLE public.services_sheets
ADD COLUMN IF NOT EXISTS column_state jsonb DEFAULT '{"widths": {}, "hidden": []}'::jsonb;

COMMENT ON COLUMN public.services_sheets.column_state IS 'Stores column widths and visibility per user';
