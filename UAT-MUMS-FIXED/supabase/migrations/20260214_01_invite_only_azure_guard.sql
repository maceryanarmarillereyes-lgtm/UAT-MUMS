-- 2026-02-14: Invite-only Azure OAuth guard for auth.users
--
-- Goal:
-- - On new auth.users row insertion, require a pre-existing whitelist row in public.mums_profiles by email.
-- - If matched (case-insensitive), attach auth.users.id to the existing profile row.
-- - If no match, raise an exception to abort signup/login.

create extension if not exists citext;

create or replace function public.mums_link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_profile_exists boolean;
begin
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Invite-only login denied: missing email.';
  end if;

  select exists (
    select 1
    from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  )
  into v_profile_exists;

  if not v_profile_exists then
    raise exception using
      errcode = 'P0001',
      message = format('Invite-only login denied for email: %s', v_email);
  end if;

  update public.mums_profiles p
  set user_id = new.id,
      updated_at = now()
  where lower(trim(coalesce(p.email::text, ''))) = v_email;

  return new;
end;
$$;

drop trigger if exists trg_mums_link_auth_user_to_profile on auth.users;

create trigger trg_mums_link_auth_user_to_profile
after insert on auth.users
for each row
execute function public.mums_link_auth_user_to_profile();
