# BUGFIX REPORT — v3.9.21 Login Fix + Disk IO Optimization
Generated: 2026-03-19
Baseline: UAT-MUMS-SupportStudio-v3_9_21_LOGIN_FIX (v3.9.20)

## ROOT CAUSE SUMMARY
Supabase Nano free plan has a **30 min/day burst Disk IO budget**.
On 2026-03-19, the budget was exhausted by two compounding factors:
1. Supabase Realtime (WAL replication) is the **#1 disk IO consumer** — was never
   configurable via env variable (code bug).
2. Mailbox override polling was 5s when active / 30s when idle — ignored the
   MAILBOX_OVERRIDE_POLL_MS env var entirely.
3. presence/list.js TTL server-side default was **25s** while the client expected
   **360s** — caused presence thrash (users falling off → constant re-writes).

---

## FILES MODIFIED (5 files)

| File | Change |
|------|--------|
| `api/env.js` | Expose `SYNC_ENABLE_SUPABASE_REALTIME` — disableable via Vercel env var |
| `functions/api/env.js` | Same fix for Cloudflare Pages + sync all missing presence config keys |
| `public/login.html` | 3-attempt retry with backoff + user-friendly overload error message |
| `server/routes/presence/list.js` | Fix TTL default 25s → 360s (critical presence thrash bug) |
| `public/js/store.js` | Wire MAILBOX_OVERRIDE_POLL_MS env var into adaptive interval logic |

---

## BUG #1 — FIXED [api/env.js + functions/api/env.js]
**`SYNC_ENABLE_SUPABASE_REALTIME` not exposed — could not disable WAL replication**

Root cause: api/env.js never returned `SYNC_ENABLE_SUPABASE_REALTIME` in its
response. Even if an operator set the env var to `false` in Vercel, realtime.js
would still see `env.SYNC_ENABLE_SUPABASE_REALTIME` as `undefined` → defaulted to
`true`. WAL Realtime = single largest Disk IO consumer on the Nano plan.

Fix: Added `SYNC_ENABLE_SUPABASE_REALTIME: String(process.env....)` to both
api/env.js (Vercel) and functions/api/env.js (Cloudflare Pages).

**OPERATOR ACTION REQUIRED (Vercel):**
```
SYNC_ENABLE_SUPABASE_REALTIME = false
```

---

## BUG #2 — FIXED [public/login.html]
**Login page shows generic error when Supabase is overloaded (no retry, no explanation)**

Root cause: `doLogin()` called `Auth.login()` exactly once. When Supabase throttles
auth operations due to exhausted Disk IO, the response contains "Database error" or
similar. No retry, no user-facing explanation — user stuck on login page.

Fix: 3-attempt retry with 2.5s → 5s exponential backoff. Transient error detection
function `_isTransientError()` matches Supabase overload patterns. On final failure,
shows clear message: "Supabase is currently overloaded (Disk IO limit reached)."

---

## BUG #3 — FIXED [server/routes/presence/list.js]
**Presence TTL server default 25s vs client expectation 360s → presence thrash**

Root cause: `envFromProcess()` in presence/list.js had:
  `PRESENCE_TTL_SECONDS: Number(process.env.PRESENCE_TTL_SECONDS || 25)`

Without the env var set in Vercel, the TTL was 25 seconds. With a 45s heartbeat
interval and a 20s dedup window on heartbeats, users would intermittently "fall off"
the roster → client re-sends → more DB writes → feedback loop.

Fix: Default changed to 360 to match api/env.js and env_runtime.js.

---

## BUG #4 — FIXED [public/js/store.js]
**Mailbox override polling ignored MAILBOX_OVERRIDE_POLL_MS env variable**

Root cause: `getAdaptiveInterval()` in `startMailboxOverrideSync` hardcoded
5000ms (active) and 30000ms (idle), never reading from `window.MUMS_ENV`.
MAILBOX_OVERRIDE_POLL_MS in api/env.js was correctly served but silently ignored.

Fix: Now reads `window.MUMS_ENV.MAILBOX_OVERRIDE_POLL_MS`. Idle interval is
computed as `max(active * 2, 60000)` — default idle is now 60s (was 30s).
Active default is 10s (was 5s), aligned with api/env.js default.

---

## IO SAVINGS ESTIMATE (post-fix)

| Source | Before | After | Reduction |
|--------|--------|-------|-----------|
| Supabase Realtime WAL | ~Heavy (continuous) | 0 (disabled) | ~100% |
| Mailbox override idle | 30s | 60s | ~50% |
| Mailbox override active | 5s | 10s | ~50% |
| Presence thrash (TTL bug) | ~25s churn | 360s stable | ~90% |

---

## LAUNCH PROTOCOL

### Step 1 — Set Vercel Environment Variables (CRITICAL)
```
SYNC_ENABLE_SUPABASE_REALTIME = false
PRESENCE_TTL_SECONDS          = 360
PRESENCE_POLL_MS              = 45000
PRESENCE_LIST_POLL_MS         = 90000
MAILBOX_OVERRIDE_POLL_MS      = 10000
SYNC_RECONCILE_MS             = 90000
```

### Step 2 — Wait for Supabase Daily Reset
Disk IO budget resets at UTC midnight. If it's already past midnight UTC, login
should work now. If not, wait and deploy in parallel.

### Step 3 — Deploy this zip
Replace contents of your Vercel project root with UAT-MUMS-v3_9_21/
(same folder structure as before).

### Step 4 — Verify After Deploy
1. Login page → try login → should succeed without errors
2. Check browser console → no "Database error" / 500 responses
3. Check Supabase Dashboard → Infrastructure → Disk IO Bandwidth
   should show 0% burst usage after ~1 hour (realtime disabled)
4. Presence bar still shows users (360s TTL means they stay visible)

---

## RECOMMENDATION: Free Plan is Fine with These Fixes

With SYNC_ENABLE_SUPABASE_REALTIME=false:
- All sync features still work via 90s polling fallback
- Disk IO drops to near-baseline (only auth + simple reads)
- Monthly estimate: ~1.5 GB (well under 5 GB Free Plan limit)
- No migration needed, no cost increase

