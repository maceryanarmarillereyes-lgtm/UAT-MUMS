-- ============================================================
-- FIX: mums_documents write policy for service_role
-- Run this once in Supabase SQL Editor.
--
-- Issue:  mums_documents only had a SELECT policy for authenticated.
--         service_role bypasses RLS by default in Supabase, so writes
--         from the server were already working — but this policy makes
--         it explicit and consistent with other tables in the schema.
--         Also adds a write policy so Super Admins can directly manage
--         document rows if needed in future.
-- ============================================================

-- Allow service_role full access (server-side upserts via SUPABASE_SERVICE_ROLE_KEY)
drop policy if exists "mums_documents_service_role" on public.mums_documents;
create policy "mums_documents_service_role"
  on public.mums_documents
  for all
  to service_role
  using (true)
  with check (true);

-- Allow authenticated Super Admins to write (direct admin operations)
drop policy if exists "mums_documents_superadmin_write" on public.mums_documents;
create policy "mums_documents_superadmin_write"
  on public.mums_documents
  for all
  to authenticated
  using (public.mums_is_super_admin(auth.uid()))
  with check (public.mums_is_super_admin(auth.uid()));

-- Verify
select policyname, cmd, roles
from pg_policies
where tablename = 'mums_documents'
order by policyname;
