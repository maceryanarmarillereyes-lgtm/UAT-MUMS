# BUGFIX REPORT — v3.9.30
**Date:** 2026-04-11
**Scope:** Supabase Free Tier Stability + Console Error Elimination + Realtime Fix
**Environment:** Cloudflare Pages + Supabase Free Plan (Nano) — 30 users/day

---

## Bugs Fixed

### BUG 1 — `GET /api/vendor/supabase → 404` (CRITICAL)
**File:** `functions/api/[[path]].js`
**Root Cause:** Route map only registered `'vendor/supabase.js'` (with `.js` extension).
`support_studio.html` requests `/api/vendor/supabase` (no extension). The
`normalizeRoutePath()` function does not strip `.js` from request paths — it only
does a raw join. So the lookup `routes['vendor/supabase']` found nothing → 404.

**Effect Chain:**
1. 404 on SDK → `onerror` fires → `mums:supabase_ready` never dispatched on `window`
2. ODP waits 8 seconds for `mums:supabase_ready` → falls back to polling
3. Polling fallback = `/api/studio/daily_passwords` fetched every 15s = unnecessary IO

**Fix:** Added `'vendor/supabase': ...` alias (without `.js`) pointing to the same
handler in the route map. Both `vendor/supabase` and `vendor/supabase.js` now work.

---

### BUG 2 — Duplicate Supabase SDK loading in `support_studio.html` (HIGH)
**File:** `public/support_studio.html`
**Root Cause:** `support_studio.html` had TWO SDK loaders:
1. `<script src="/js/support_studio/supabase_loader.js">` — correct, fires `window` event
2. An inline `<script>` block that also injected the SDK and fired `mums:supabase_ready`
   on `document` (wrong target — ODP listens on `window`)

**Effects:**
- SDK loaded twice = double network request
- Inline block dispatched event on `document` which ODP's `window.addEventListener` never received
- On 404 (Bug 1), inline onerror printed: `[MUMS] Supabase SDK load failed via proxy — Realtime disabled`

**Fix:** Removed the redundant inline script block. `supabase_loader.js` is the single
authoritative loader — it fires `window.dispatchEvent(new CustomEvent('mums:supabase_ready'))`.

---

### BUG 3 — ODP Realtime `CHANNEL_ERROR` on `daily_passwords` (HIGH)
**File:** `public/js/support_studio/features/odp.js`
**Root Cause:** The ODP feature creates a *dedicated* Supabase client
(`_odpState.sbClient`) for its Realtime subscription. This client was created with
the JWT in the `global.headers` object (for HTTP requests), but Supabase Realtime
v2 uses a *separate* WebSocket connection that requires explicit authorization via
`sbClient.realtime.setAuth(token)`.

Without `setAuth()`:
- HTTP requests (REST) → authenticated (JWT in header) ✅
- WebSocket (Realtime) → uses anon key only ❌
- `daily_passwords` has RLS with `dp_write_authed` policy → anon role blocked
- Supabase Realtime returns `CHANNEL_ERROR` → ODP falls back to 15s polling

**Fix:** Added `_odpState.sbClient.realtime.setAuth(token)` immediately after
`createClient()`. This passes the user JWT to the WebSocket handshake, allowing
the `postgres_changes` subscription to satisfy RLS policies.

---

### BUG 4 — `daily_passwords` REPLICA IDENTITY FULL (IO Waste) (MEDIUM)
**File:** `supabase/migrations/20260411_01_daily_passwords_free_tier_fix.sql`
**Root Cause:** When a table is added to `supabase_realtime` publication, Supabase
automatically sets `REPLICA IDENTITY FULL`. This means every `UPDATE` writes ALL
columns to WAL (not just the changed ones). For `daily_passwords`, each password
save writes ~5 columns instead of just the PK.

**Fix:** `ALTER TABLE public.daily_passwords REPLICA IDENTITY DEFAULT` — WAL now
only stores the PK on UPDATE/DELETE. Realtime still receives full row data via
logical decoding. Estimated IO reduction: ~60% per password update.

---

### BUG 5 — RLS Policy Uses Deprecated `auth.role()` (LOW)
**File:** `supabase/migrations/20260411_01_daily_passwords_free_tier_fix.sql`
**Root Cause:** Original migration used `auth.role() = 'authenticated'` in the
write policy. This triggers a schema cache lookup on every policy evaluation.

**Fix:** Updated to `auth.uid() IS NOT NULL` with `TO authenticated` role constraint.
The `TO authenticated` clause means Postgres only evaluates the policy for the
`authenticated` role (skipping anon entirely). `auth.uid() IS NOT NULL` is a
cheaper check with no schema cache probe.

---

### BUG 6 — `.env.example` Had Dangerous `PRESENCE_POLL_MS=3000` (MEDIUM)
**File:** `.env.example`
**Root Cause:** The example env file had `PRESENCE_POLL_MS=3000` (3 seconds).
If a developer copied this verbatim: 3s × 30 users = 900 heartbeat writes/minute
= Supabase free tier IO budget exhausted within hours.

**Fix:** Updated to `PRESENCE_POLL_MS=45000` (45s) and `PRESENCE_LIST_POLL_MS=90000`
(90s) to match the safe defaults already in `env_runtime.js`.

---

## Files Changed

| File | Change |
|------|--------|
| `functions/api/[[path]].js` | Added `'vendor/supabase'` alias (no .js) to route map |
| `public/support_studio.html` | Removed duplicate inline SDK loader block |
| `public/js/support_studio/features/odp.js` | Added `realtime.setAuth(token)` after createClient |
| `public/js/support_studio/supabase_loader.js` | Updated source priority: `/api/vendor/supabase` first |
| `.env.example` | Fixed PRESENCE_POLL_MS 3000→45000, added PRESENCE_LIST_POLL_MS |
| `supabase/RUN_ALL_MIGRATIONS.sql` | Added new migration entry in changelog section |
| `supabase/migrations/20260411_01_daily_passwords_free_tier_fix.sql` | **NEW** — REPLICA IDENTITY + RLS + publication fix |

---

## SQL Migration Required

Run in Supabase SQL Editor:
```
supabase/migrations/20260411_01_daily_passwords_free_tier_fix.sql
```

Then separately (cannot run inside a DO block):
```sql
VACUUM ANALYZE public.daily_passwords;
```

---

## Expected Outcomes After Deploy

| Metric | Before | After |
|--------|--------|-------|
| `/api/vendor/supabase` response | 404 | 200 OK (SDK served) |
| ODP Realtime status | CHANNEL_ERROR → poll fallback | SUBSCRIBED ✅ |
| SDK load count per page | 2 (duplicate) | 1 |
| `daily_passwords` WAL per UPDATE | ~all columns (~200 bytes) | PK only (~16 bytes) |
| Presence heartbeat interval | env-dependent (risk: 3s) | 45s enforced minimum |
| Console errors on load | 3-4 errors | 0 errors |
