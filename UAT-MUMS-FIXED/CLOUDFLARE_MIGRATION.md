# CLOUDFLARE-ONLY MIGRATION GUIDE
Generated: 2026-03-19 | Version: v3.9.23

## TL;DR
Drop Vercel. Use Cloudflare Pages exclusively.
Only 1 code fix was needed (tasks/distribution_export missing from CF router).
Everything else was already complete.

---

## WHY CLOUDFLARE > VERCEL FOR YOUR SETUP

| Feature | Vercel Hobby (Free) | Cloudflare Pages (Free) | Winner |
|---------|-------------------|------------------------|--------|
| Bandwidth | 100 GB/month hard limit | **UNLIMITED** | ✅ CF |
| Function invocations | 100K/day | **100K/day** | Tie |
| Cold starts | ~300–800ms (Node.js) | **~5–50ms (V8 isolates)** | ✅ CF |
| Function count limit | 12 max (was your bottleneck) | **Unlimited** | ✅ CF |
| Custom domains | 1 free | Unlimited free | ✅ CF |
| DDoS protection | Basic | **Enterprise-grade (built-in)** | ✅ CF |
| Deployment speed | ~30–60s | **~10–20s** | ✅ CF |
| Node.js compat | Native | Via `nodejs_compat` flag ✅ (already set in wrangler.toml) | Tie |

**Your wrangler.toml already has `nodejs_compat` set. CF is ready.**

---

## WHAT WAS FIXED IN v3.9.23

### `functions/api/[[path]].js` — Added missing route
```diff
+ 'tasks/distribution_export': unwrapCjs(await import('../../server/routes/tasks/distribution_export.js')),
```
Distribution task export was the only route present in Vercel but missing from CF.

### Bonus: CF already had routes that Vercel was MISSING
- `settings/global_quickbase` — QuickBase global settings (broken on Vercel!)
- `quickbase/assigned_to_names` — QB name resolution (broken on Vercel!)

So CF actually has better route coverage than Vercel right now.

---

## MIGRATION STEPS

### STEP 1 — Connect GitHub repo to Cloudflare Pages
1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. Select your GitHub repo
3. Build settings:
   - Framework preset: **None**
   - Build command: **(leave blank)**
   - Build output directory: **public**

### STEP 2 — Set Environment Variables in Cloudflare
Cloudflare Dashboard → Your Project → Settings → Environment Variables

**Production environment:**
```
SUPABASE_URL                  = https://mqagqbskgqsrluoctxco.supabase.co
SUPABASE_ANON_KEY             = (your anon key)
SUPABASE_SERVICE_ROLE_KEY     = (your service role key)
SUPERADMIN_EMAIL              = (your admin email)
USERNAME_EMAIL_DOMAIN         = mums.local
PRESENCE_TTL_SECONDS          = 360
PRESENCE_POLL_MS              = 45000
PRESENCE_LIST_POLL_MS         = 90000
MAILBOX_OVERRIDE_POLL_MS      = 10000
SYNC_RECONCILE_MS             = 90000
```

⚠️ Set the same variables for **Preview environment** (for your UAT branch).

### STEP 3 — Update wrangler.toml (already done)
Your existing wrangler.toml is correct:
```toml
name = "newmace"
compatibility_date = "2026-02-06"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "public"
```
No changes needed.

### STEP 4 — Remove Vercel
1. Vercel Dashboard → Your Project → Settings → Advanced → Delete Project
2. Update your GitHub deployment action (if any) to only trigger Cloudflare

### STEP 5 — Update custom domain (if applicable)
1. Cloudflare Pages → Your project → Custom domains → Set up a custom domain
2. Since your domain DNS is already on Cloudflare, it will auto-configure

---

## VERIFY AFTER DEPLOY

Test these endpoints (replace with your CF Pages URL):
```
GET  /api/health                    → { ok: true }
GET  /api/env                       → { SUPABASE_URL: "...", ... }
POST /api/presence/heartbeat        → { ok: true }
GET  /api/presence/list             → { ok: true, rows: [...] }
GET  /api/users/me                  → { ok: true, profile: {...} }
GET  /api/tasks/distribution_export → (was broken on old CF, now fixed)
```

---

## ARCHITECTURE AFTER MIGRATION

```
GitHub (source)
    │
    ▼
Cloudflare Pages (everything)
    ├── /public/*          → Static files (HTML, CSS, JS)
    ├── /functions/api/*   → All API routes (Workers runtime)
    └── wrangler.toml      → nodejs_compat enabled
    │
    ▼
Supabase (database + auth)
    ├── Auth (login)
    ├── PostgreSQL (data)
    └── Realtime (subscriptions) ← STAYS ON
```

Clean. One platform. Zero Vercel.
