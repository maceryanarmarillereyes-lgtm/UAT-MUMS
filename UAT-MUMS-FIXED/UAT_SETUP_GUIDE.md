# NEWMACE — UAT Environment Setup Guide
# Phase 637 | QBTabBugFix
# Generated: 2026-03-12
# ============================================================

## OVERVIEW: HOW PROD vs UAT WORKS

```
SAME ZIP / SAME GITHUB REPO
         |
         |--- PROD branch  → Cloudflare PROD project → PROD Supabase
         |--- UAT  branch  → Cloudflare UAT project  → UAT  Supabase
```

Zero code changes between environments.
Only the **env vars** in the hosting dashboard differ.

---

## STEP 1: CREATE UAT SUPABASE PROJECT

1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Name it: `newmace-uat` (or similar)
4. Choose the same region as PROD
5. Note down:
   - **Project URL** (SUPABASE_URL)
   - **anon public key** (SUPABASE_ANON_KEY)
   - **service_role secret key** (SUPABASE_SERVICE_ROLE_KEY)
   - **Project Reference ID** (found in Project Settings > General)

---

## STEP 2: RUN MIGRATIONS ON UAT SUPABASE

1. Open UAT Supabase dashboard → **SQL Editor**
2. Make sure role is: **postgres**
3. Open file: `supabase/RUN_ALL_MIGRATIONS.sql` (root of this zip)
4. Paste ALL contents → Click **Run**
5. Verify last line executed: `NOTIFY pgrst, 'reload schema';`

### Verify schema after migration:
```sql
-- Check all critical tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Expected tables (minimum):
-- mums_profiles, mums_global_settings, quickbase_tabs,
-- task_distributions, task_items, mums_sync_log,
-- mums_heartbeat, mums_mailbox_override
```

---

## STEP 3: CREATE UAT STORAGE BUCKET

1. UAT Supabase → **Storage**
2. Click **New Bucket**
3. Name: `public`
4. Toggle: **Public bucket** → ON
5. Click **Create**

---

## STEP 4: CREATE UAT GITHUB REPO (or branch)

### Option A: Separate Repo (Recommended — cleanest isolation)
```
github.com/yourorg/newmace-uat
```
Push the same zip contents to this repo.

### Option B: Same Repo, Different Branch
```
main   → PROD
uat    → UAT
```
In Cloudflare Pages, set the **Production branch** separately per project.

---

## STEP 5: CLOUDFLARE PAGES — UAT PROJECT

1. Go to Cloudflare Dashboard → **Pages**
2. Click **Create application** → **Connect to Git**
3. Select your UAT repo (or UAT branch)
4. Project name: `newmace-uat`
5. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `public`
6. Click **Save and Deploy**
7. After first deploy, go to **Settings → Environment Variables**
8. Add these variables (UAT Supabase values):

| Variable | Value |
|---|---|
| SUPABASE_URL | Your UAT Supabase URL |
| SUPABASE_ANON_KEY | Your UAT anon key |
| SUPABASE_SERVICE_ROLE_KEY | Your UAT service_role key |
| USERNAME_EMAIL_DOMAIN | mums.local (or your domain) |
| SUPERADMIN_EMAIL | your-uat-admin@domain.com |
| SUPABASE_PUBLIC_BUCKET | public |
| SYNC_ENABLE_SUPABASE_REALTIME | true |

9. Trigger a new deploy after adding env vars.

---

## STEP 6: VERCEL — UAT PROJECT (Alternative to Cloudflare)

1. Go to https://vercel.com → **New Project**
2. Import from GitHub → Select UAT repo/branch
3. Framework: **Other**
4. Root directory: `/` (default)
5. Add same env vars as above in **Environment Variables** section
6. Deploy

---

## STEP 7: CREATE UAT SUPER ADMIN USER

After deploy, create the first admin user via Supabase Auth:

1. UAT Supabase → **Authentication → Users**
2. Click **Invite user** or **Add user**
3. Email: same as SUPERADMIN_EMAIL env var
4. After user is created, run in SQL Editor:

```sql
-- Set the UAT super admin
UPDATE public.mums_profiles
SET role = 'SUPER_ADMIN'
WHERE email = 'your-uat-admin@domain.com';
```

---

## PROD → UAT: WHAT SQL TO RUN WHEN UPDATING PROD SUPABASE

When your UAT is tested and approved, and you want to sync PROD:

### Check what's already in PROD (run in PROD SQL Editor):
```sql
-- Check which tables already exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check quickbase_tabs exists (newest migration)
SELECT to_regclass('public.quickbase_tabs') as quickbase_tabs;

-- Check global settings exists
SELECT to_regclass('public.mums_global_settings') as mums_global_settings;
```

### If tables are MISSING from PROD, run ONLY the missing migrations:
The full `RUN_ALL_MIGRATIONS.sql` is **safe to run on PROD** — all statements use
`IF NOT EXISTS` / `CREATE OR REPLACE`. It will skip what already exists and only
apply what's missing.

**Safest approach for PROD:**
1. Backup PROD Supabase (Project Settings → Backups or pg_dump)
2. Run `RUN_ALL_MIGRATIONS.sql` in PROD SQL Editor
3. Verify with the check queries above

---

## ENVIRONMENT VARIABLE SUMMARY

| Variable | PROD | UAT |
|---|---|---|
| SUPABASE_URL | prod project URL | uat project URL |
| SUPABASE_ANON_KEY | prod anon key | uat anon key |
| SUPABASE_SERVICE_ROLE_KEY | prod service key | uat service key |
| USERNAME_EMAIL_DOMAIN | your domain | your domain (same or diff) |
| SUPERADMIN_EMAIL | prod admin email | uat admin email |
| SUPABASE_PUBLIC_BUCKET | public | public |
| SYNC_ENABLE_SUPABASE_REALTIME | true | true |

**The app code is IDENTICAL between PROD and UAT. Zero code changes needed.**

---

## WORKFLOW: TESTING THEN PROMOTING TO PROD

```
1. Test feature on UAT → All pass
2. git push to PROD branch/repo (same code, zero changes)
3. Cloudflare PROD auto-deploys
4. Run any MISSING migrations on PROD Supabase (RUN_ALL_MIGRATIONS.sql is safe)
5. Done.
```

---

## ROLLBACK

If something breaks on PROD after deploy:
1. Cloudflare Pages → **Deployments** → Select previous deployment → **Rollback**
2. SQL rollback (if schema changed): See `ROLLBACK.md` in this zip.

