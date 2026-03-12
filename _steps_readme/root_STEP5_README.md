# Step 5 – Add Email to Profile (fix_profile_email)

## Goal
Ensure the **My Profile** modal reliably shows the authenticated user's email (e.g., `supermace@mums.local`) and that cloud roster sync persists email into the local Store.

This step works whether or not your `public.mums_profiles` table already has an `email` column.

## What changed

### 1) Server: `server/routes/users/me.js`
- Guarantees the response includes `email` at the top level **and** `profile.email`.
- Best-effort: persists the canonical auth email into `mums_profiles.email` **if the column exists** (non-blocking; ignored if the column is missing).

### 2) Client: `public/js/cloud_users.js`
- Normalizes `/api/users/me` so callers always see `profile.email` (even if older servers only returned top-level `email`).
- Keeps the roster-to-Store mapping including `email` for each user.

### 3) Frontend: Profile modal (My Profile)
- `public/js/app.js` now fills the Email field using a robust fallback chain:
  1. `user.email`
  2. `Store.getUserById(user.id).email`
  3. `CloudAuth.getUser().email`
  4. `${username}@${Config.USERNAME_EMAIL_DOMAIN || 'mums.local'}`

- `public/index.html` includes the Email input field in the modal markup (if your deployment was missing it).

## Apply
1. Unzip this package into your repo root (allow overwrite).
2. Deploy to Vercel (or run locally).

## Verify
1. Log in as Super Mace.
2. Open **My Profile**.
3. Confirm **Email** shows `supermace@mums.local`.

Optional DB check (only if you have the email column from Step 2):
```sql
select user_id, username, email
from public.mums_profiles
where lower(email) = 'supermace@mums.local';
```
