-- =====================================================================
-- MIGRATION: daily_passwords table
-- Purpose: Store one-day passwords per date, broadcast to all users
-- Manila Time (Asia/Manila = UTC+8) based dates
-- =====================================================================

CREATE TABLE IF NOT EXISTS daily_passwords (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE        NOT NULL UNIQUE,
  password    TEXT        NOT NULL DEFAULT '',
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast date lookups
CREATE INDEX IF NOT EXISTS daily_passwords_date_idx ON daily_passwords(date DESC);

-- RLS: All authenticated users can read
-- All authenticated users can insert/upsert (anyone can broadcast)
ALTER TABLE daily_passwords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dp_read_all"    ON daily_passwords;
DROP POLICY IF EXISTS "dp_write_authed" ON daily_passwords;

CREATE POLICY "dp_read_all" ON daily_passwords
  FOR SELECT USING (true);

CREATE POLICY "dp_write_authed" ON daily_passwords
  FOR ALL USING (auth.role() = 'authenticated');

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE daily_passwords;

COMMENT ON TABLE daily_passwords IS 'One-day passwords broadcast to all users. Date is Manila Time (UTC+8).';
