# Step 3 – Fix New User Login (Invalid login credentials)

## Goal
Newly created users should be able to log in immediately (no "Invalid login credentials").

This patch addresses the most common root causes:
1) **Request body parsing drift** across runtimes (Vercel / local proxy / Express) that can silently drop fields.
2) **Auth user creation** performed via an API path that can behave differently depending on GoTrue settings.
3) **Profile row creation** missing or failing, leaving users without a directory profile.

## What this ZIP contains
### Server
- `server/routes/users/create.js`
  - Robust JSON body parsing:
    - Supports `req.body` (object or string) and raw stream parsing.
    - Supports urlencoded fallback.
  - Creates auth users via the **public sign-up endpoint** (`/auth/v1/signup`) — equivalent to `supabase.auth.signUp()`.
  - Auto-confirms the new user via **admin update** (`/auth/v1/admin/users/:id`) so login works immediately.
  - Upserts a `mums_profiles` row (idempotent) so auth + profile always exist together.
  - On profile failure, rolls back the auth user to avoid orphaned accounts.

### Client
- `public/js/pages/users.js`
  - After creating a user in local mode, refreshes the roster via `renderRows()` (instead of full page reload).

## Install / Apply
1) Copy (overwrite) the included files into your repo:
   - `server/routes/users/create.js`
   - `public/js/pages/users.js`

2) Deploy (Vercel) or restart your dev server.

## Verification
### A) Create a user
- As SUPER_ADMIN or TEAM_LEAD, create a new user via the UI.

### B) Confirm auth user exists
Run in Supabase SQL editor:
```sql
select id, email, created_at
from auth.users
where lower(email) = 'newuser@mums.local';
```

### C) Confirm profile row exists
```sql
select p.user_id, p.username, p.name, p.role, p.team_id, p.created_at, p.updated_at
from public.mums_profiles p
join auth.users u on u.id = p.user_id
where lower(u.email) = 'newuser@mums.local';
```

### D) Log in
- Log out.
- Log in using:
  - Username: `newuser` (or)
  - Email: `newuser@mums.local`
- Use the password you set at creation.

If login still fails, the next diagnostic is GoTrue configuration (password grant enabled) and the app's `USERNAME_EMAIL_DOMAIN` consistency across client + server.
