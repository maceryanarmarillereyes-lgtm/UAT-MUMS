# Step 2 – Deduplicate Super Mace Account

## What this fixes
Your current `public.mums_profiles` table does **not** have an `email` column (your screenshot shows only:
`user_id, username, name, role, team_id, duty, created_at, updated_at`).

Because of that:
- Queries like `select lower(email) ... from public.mums_profiles` fail.
- You cannot apply a unique constraint on email yet.

This step adds `mums_profiles.email`, backfills it from `auth.users.email`, deletes any duplicate *profile* rows per email (keeping the most privileged / most recently updated), and then adds a unique constraint.

## Apply
Run the migration:
- `supabase/migrations/20260128_02_deduplicate_supermace.sql`

You can run it via:
- Supabase SQL Editor (role: `postgres`), or
- Supabase CLI migrations.

## Verification queries (copy/paste)

### A) Confirm only one Auth user exists for Super Mace
```sql
select lower(email) as email_norm, count(*) as n
from auth.users
where lower(email) = 'supermace@mums.local'
group by 1;
```
Expected: `n = 1`

### B) Before/after migration: check profile rows tied to Super Mace email
(Works even if `mums_profiles.email` does not exist yet.)
```sql
select
  p.user_id,
  p.username,
  p.name,
  p.role,
  p.team_id,
  p.duty,
  p.created_at,
  p.updated_at,
  u.email
from public.mums_profiles p
join auth.users u on u.id = p.user_id
where lower(u.email) = 'supermace@mums.local'
order by p.updated_at desc nulls last, p.created_at desc;
```

### C) After migration: check duplicates by email in mums_profiles
```sql
select lower(email::text) as email_norm, count(*) as n
from public.mums_profiles
where email is not null
group by 1
having count(*) > 1
order by n desc, email_norm asc;
```
Expected: no rows.

### D) Confirm the unique constraint exists
```sql
select conname
from pg_constraint
where conrelid = 'public.mums_profiles'::regclass
  and contype = 'u';
```
Expected: includes `mums_profiles_email_unique`.

## Note about `team_override`
If you see errors like `column team_override does not exist`, that is **Step 1** (team override) not being applied yet.
This Step 2 package is intentionally independent of that column.
