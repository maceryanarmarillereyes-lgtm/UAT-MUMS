-- 2026-02-26: Fix infinite recursion in mums_profiles RLS policies
--
-- Root cause:
--   Policy expressions queried public.mums_profiles from within policies on the
--   same table, which can recurse during RLS evaluation.
--
-- Fix:
--   Route SUPER_ADMIN checks through a SECURITY DEFINER helper.

create or replace function public.mums_is_super_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, extensions
as $$
  select exists (
    select 1
    from public.mums_profiles p
    where p.user_id = p_uid
      and p.role = 'SUPER_ADMIN'
  );
$$;

drop policy if exists "profiles_select_superadmin" on public.mums_profiles;
create policy "profiles_select_superadmin" on public.mums_profiles
for select to authenticated
using (public.mums_is_super_admin(auth.uid()));

drop policy if exists "override_update_superadmin" on public.mums_mailbox_override;
create policy "override_update_superadmin" on public.mums_mailbox_override
for update to authenticated
using (public.mums_is_super_admin(auth.uid()))
with check (public.mums_is_super_admin(auth.uid()));
