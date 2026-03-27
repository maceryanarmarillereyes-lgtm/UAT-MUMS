-- MUMS Step 2: Deduplicate Super Mace (and any other accidental duplicates) by email
-- Goal:
--   1) Ensure only one mums_profiles row exists for email supermace@mums.local
--   2) Enforce a unique constraint on mums_profiles.email going forward
-- Notes:
--   - Your current mums_profiles schema does NOT include an email column. This migration adds it.
--   - This migration intentionally does NOT touch auth.users (Supabase Auth) records.

-- 1) Enable CITEXT for case-insensitive email.
create extension if not exists citext;

-- 2) Add email column (nullable) to mums_profiles.
alter table if exists public.mums_profiles
  add column if not exists email citext;

-- 3) Backfill/refresh email from auth.users (authoritative source).
--    We overwrite to guarantee alignment.
update public.mums_profiles p
set email = lower(trim(u.email))::citext
from auth.users u
where u.id = p.user_id
  and u.email is not null;

-- Normalize blanks to NULL (defensive).
update public.mums_profiles
set email = null
where email is not null and btrim(email::text) = '';

-- 4) Delete duplicate profile rows by email, keeping the best candidate.
--    Keep order:
--      - SUPER_ADMIN first
--      - then SUPER_USER
--      - then most recently updated
--      - then newest created
with ranked as (
  select
    user_id,
    lower(email::text) as email_key,
    row_number() over (
      partition by lower(email::text)
      order by
        (upper(coalesce(role,'')) = 'SUPER_ADMIN') desc,
        (upper(coalesce(role,'')) = 'SUPER_USER') desc,
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.mums_profiles
  where email is not null
)
delete from public.mums_profiles p
using ranked r
where p.user_id = r.user_id
  and r.rn > 1;

-- 5) Safety check: fail migration if duplicates still exist (should never happen after delete above).
do $$
begin
  if exists (
    select 1
    from public.mums_profiles
    where email is not null
    group by lower(email::text)
    having count(*) > 1
  ) then
    raise exception 'Deduplication failed: duplicate emails still exist in public.mums_profiles.';
  end if;
end $$;

-- 6) Enforce uniqueness on email going forward.
--    (Unique allows multiple NULLs, which is fine; email is populated from auth.users.)
alter table if exists public.mums_profiles
  drop constraint if exists mums_profiles_email_unique;

alter table if exists public.mums_profiles
  add constraint mums_profiles_email_unique unique (email);
