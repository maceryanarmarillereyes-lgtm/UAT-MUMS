# MUMS – Step 1: Super Admin Team Override

This ZIP contains the **Step 1** implementation for the MUMS User Management System.

## What it adds
- SUPER_ADMIN can update their own team assignment (Morning / Mid / Night) or default to **Developer Access**.
- Developer Access is represented as **team_id = NULL** in the database, and as an empty string in the client.
- Adds a database migration introducing `team_override`.

## Files included
- `server/routes/users/update_me.js`
- `server/routes/users/me.js`
- `server/routes/users/list.js`
- `server/routes/presence/heartbeat.js`
- `server/routes/presence/list.js`
- `public/js/app.js`
- `public/js/cloud_users.js`
- `public/js/store.js`
- `supabase/migrations/20260128_01_profiles_team_override.sql`

## Apply
1. Copy these files into your project (preserving paths).
2. Run Supabase migrations (or apply the SQL) to add `team_override`.
3. Deploy to Vercel.
