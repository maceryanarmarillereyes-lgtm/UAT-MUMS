-- 2026-03-23: Studio QB Settings — ensure mums_documents upsert is safe for token storage.
-- The key `ss_qb_settings_{userId}` is written via service role; this migration:
--   1. Confirms the primary key constraint exists on mums_documents.key
--   2. Ensures no stale/conflicting policies block service-role writes
-- Safe to run multiple times.

do $$
begin
  -- Verify primary key on mums_documents.key exists (should be there from schema.sql)
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema   = kcu.table_schema
    where tc.table_schema    = 'public'
      and tc.table_name      = 'mums_documents'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name    = 'key'
  ) then
    alter table public.mums_documents add primary key (key);
    raise notice 'mums_documents: primary key on (key) added.';
  else
    raise notice 'mums_documents: primary key already exists — no change.';
  end if;
end $$;

-- Ensure service role (used by server) can always write — no RLS block.
-- NOTE: RLS only applies to anon/authenticated; service_role bypasses RLS by default.
-- This is a no-op guard comment — service_role already bypasses RLS in Supabase.
-- If you have custom RLS that restricts service_role, add BYPASSRLS to your service role.
