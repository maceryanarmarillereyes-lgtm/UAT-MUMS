-- 2026-03-06: Login Mode aware auth guard
--
-- Modifies mums_link_auth_user_to_profile() so that the invite-only check
-- can be bypassed when the Super Admin has set login_mode to 'password' or 'both'.
--
-- When mode = 'microsoft' : original strict behaviour (profile must exist before auth user)
-- When mode = 'password'  : trigger still links auth→profile when found; skips block if
--                           profile was pre-inserted by the admin create endpoint
-- When mode = 'both'      : same as password (permissive; admin manages profiles)
-- Default (no row)        : treated as 'both' (safe fallback)
--
-- IMPORTANT: The trigger is still required in ALL modes to link auth.users.id to
-- mums_profiles.user_id when the admin create endpoint inserts the profile first.

create or replace function public.mums_link_auth_user_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email        text;
  v_profile_exists boolean;
  v_login_mode   text := 'both';  -- default: permissive
begin
  v_email := lower(trim(coalesce(new.email, '')));

  if v_email = '' then
    -- No email on the auth user — only block in strict Microsoft mode
    begin
      select lower(trim(coalesce((value->>'mode'), 'both')))
        into v_login_mode
        from public.mums_documents
       where key = 'mums_login_mode_settings'
       limit 1;
    exception when others then
      v_login_mode := 'both';
    end;

    if v_login_mode = 'microsoft' then
      raise exception using
        errcode = 'P0001',
        message = 'Invite-only login denied: missing email.';
    end if;
    return new;
  end if;

  -- Read current login mode from mums_documents (safe fallback to 'both')
  begin
    select lower(trim(coalesce((value->>'mode'), 'both')))
      into v_login_mode
      from public.mums_documents
     where key = 'mums_login_mode_settings'
     limit 1;
  exception when others then
    v_login_mode := 'both';
  end;

  -- Check if a whitelisted profile exists for this email
  select exists (
    select 1
    from public.mums_profiles p
    where lower(trim(coalesce(p.email::text, ''))) = v_email
  )
  into v_profile_exists;

  if v_profile_exists then
    -- Profile found: link auth.users.id into the profile row
    update public.mums_profiles p
    set user_id   = new.id,
        updated_at = now()
    where lower(trim(coalesce(p.email::text, ''))) = v_email;
  else
    -- No profile found: only block in strict Microsoft-only mode
    if v_login_mode = 'microsoft' then
      raise exception using
        errcode = 'P0001',
        message = format('Invite-only login denied for email: %s', v_email);
    end if;
    -- In 'password' or 'both' mode: allow the insert without blocking
    -- (the admin create endpoint will have pre-inserted the profile row,
    --  or this is a self-signup that ensure_profile will handle)
  end if;

  return new;
end;
$$;

-- Re-apply the trigger (idempotent)
drop trigger if exists trg_mums_link_auth_user_to_profile on auth.users;

create trigger trg_mums_link_auth_user_to_profile
after insert on auth.users
for each row
execute function public.mums_link_auth_user_to_profile();
