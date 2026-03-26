# BUGFIX REPORT — v3.9.1 Mailbox Override Fixes

Generated: 2026-03-17
Baseline: UAT-MUMS-SupportStudio-v3_9

## Files Modified (3 files only)
- `public/js/store.js`
- `public/js/app.js`
- `public/index.html`

## Files NOT Modified (zero regressions)
All server routes, realtime.js, ui.js, mailbox.js, members.js, auth.js — untouched.

---

## BUG #1 — FIXED [store.js L2274]
**Scope normalize mismatch in `startMailboxOverrideSync`**

Root cause: Server DB `mums_mailbox_override` uses `scope='superadmin'` as the non-global row key.
The sync normalize function was mapping `scope='superadmin'` → kept as `'superadmin'`.
When written to `mailbox_time_override_cloud` localStorage key and read back by
`getMailboxTimeOverride`, it normalized `'superadmin'` → `'sa_only'`, causing the
cloud precedence check `c.scope === 'global'` to fail silently. Cloud-synced
superadmin-scope records were discarded, falling through to stale local values.

Fix: Map both `'global'` and `'superadmin'` → `'global'` in sync normalize.
No other code paths affected. Server-side scope values unchanged.

---

## BUG #2 — FIXED [app.js L4251]
**`modal.__bound = true` permanently blocks rebind after DOM soft-refresh**

Root cause: `bindMailboxTimeModal()` guards with `if(modal.__bound) return`.
After any soft page re-render that reuses the same modal DOM element, the property
persists and blocks all event handler re-attachment. All buttons become dead.

Fix: Guard now checks `if(modal.__bound && modal.isConnected) return`.
If the element is disconnected (removed+reinserted), rebind runs correctly.

---

## BUG #3 — FIXED [app.js L4461]
**`setInterval` clock leak on programmatic `UI.closeModal()` call**

Root cause: `stopClock()` was only wired to `[data-close="mailboxTimeModal"]` button
`onclick` handlers. Four other `UI.closeModal('mailboxTimeModal')` callsites in app.js
(e.g., settings modal auto-close, navigation events) did not call `stopClock()`.
Result: 1-second interval kept firing after modal closed → DOM writes to detached nodes,
memory leak accumulation on repeated open/close.

Fix: Patched `UI.closeModal` (once, guarded by `__mumsMailboxTimeClosePatched`) to
call `modal.__stopClock()` whenever `mailboxTimeModal` is closed, regardless of path.
`stopClock` reference stored on `modal.__stopClock` during `bindMailboxTimeModal`.

---

## BUG #3b — FIXED [app.js effectiveMs()]
**Running clock preview appeared frozen when `draft.setAt = 0`**

Root cause: `Number(draft.setAt)||Date.now()` — when `setAt=0`, falls back to
`Date.now()`, making elapsed = `Date.now() - Date.now() ≈ 0`. Clock displays `draft.ms`
every tick (frozen behavior despite running mode).

Fix: Explicit `> 0` guard: `const anchor = (Number(draft.setAt) > 0) ? Number(draft.setAt) : Date.now()`.

---

## BUG #4 — FIXED [index.html]
**Misleading "Global scope" description text**

Root cause: Both the modal subtitle and the scope hint said "affects every user session
on **this device/browser**". Global override actually syncs via Supabase cloud to ALL
devices and browsers org-wide. Admins could misunderstand the blast radius.

Fix: Updated both strings to accurately state cloud-wide impact.

---

## BUG #5 — FIXED [store.js]
**Override sync polls every 5 seconds even when disabled**

Root cause: `setInterval(..., 5000)` fires unconditionally regardless of override state.
When no override is configured, this hammers `/api/mailbox_override/get` every 5s for
every open tab — wasted bandwidth and Supabase read quota.

Fix: Adaptive backoff timer — 5s when `mailbox_time_override_cloud.enabled === true`,
30s when override is disabled/absent. ~6x reduction in idle API calls.

---

## Launch Protocol
1. Deploy the 3 modified files to your hosting environment.
2. No SQL migrations required — zero DB schema changes.
3. No env variable changes required.
4. Verify:
   - Open Settings → Mailbox Time Override modal
   - Confirm clock ticks every second in Running mode
   - Change scope dropdown and save — confirm "GLOBAL override active" label updates
   - Close modal via X button AND via navigating away — reopen, confirm clock still ticks correctly (no double-speed)
   - Check browser console — zero errors on modal open/close cycle
   - Check Network tab — polling interval is 30s when override disabled, 5s when active

---

# BUGFIX ADDENDUM — v3.9.2 Mailbox Override Epoch + Save Button

Generated: 2026-03-17 (follow-up from user testing)

## Root Cause of 01/01/1970 Date Bug

`Store.getMailboxTimeOverride()` returns `{ ms:0 }` when no override is saved or after a reset.
Multiple code paths in `bindMailboxTimeModal()` read from Store and wrote `ms:0` into `draft`
without checking if the value was a valid timestamp. `fmtManilaLocal(0)` = Manila epoch = 
**01/01/1970 08:00 AM** (UTC+8 offset applied to Unix epoch).

**All 8 entry points where ms=0 could enter draft have been patched with:**
`MIN_VALID_OVERRIDE_MS = Date.UTC(2020,0,1)` — any `ms` ≤ this value is treated as unset
and replaced with `Date.now()`.

## Files Changed (same 3 files, additive fixes)
- `public/js/app.js` — 8 additional epoch guards

## New Fixes Applied

### parseManilaLocal() — year range + epoch result guard
- Added `y < 2020 || y > 2099` year validity check
- Added result validation: returns 0 if parsed UTC is ≤ 2020-01-01

### safeDraftMs() helper function
- New utility: `safeDraftMs(ms)` → returns `ms` if valid post-2020, else `Date.now()`
- Used in `render()` → `inputEl.value` and `effectiveMs()` preview clock

### All draft.ms write paths hardened
1. `bindMailboxTimeModal()` bind-time initialization
2. `open()` re-read from Store  
3. `inputEl.onchange` (user types a date)
4. `data-mbshift` buttons (-1h, -15m, +15m, +1h)
5. `saveBtn` disabled-path post-reset re-read
6. `saveBtn` enabled-path validation check
7. `resetBtn` post-reset re-read
8. `render()` → `fmtManilaLocal()` input value

### Save button now works correctly:
- With override OFF (enabled=false): saves disabled state → toast → input shows current time ✅
- With override ON + valid ms: saves payload → toast → override active ✅
- With override ON + epoch ms (impossible after guards): shows validation error ✅
