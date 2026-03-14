🛑 SUPREME AI GUARDRAIL ACTIVE v2.0: You are STRICTLY FORBIDDEN from modifying existing High Level Enterprise UI/UX layouts, CSS themes, Core System Logics, Realtime Sync behaviors (e.g., realtime.js, WebSockets), State Management isolated arrays, Database API Adapters, and Auth flow structures without explicit clearance.
PROTOCOL: If a requested feature overlaps with, alters, or risks breaking these critical domains, you MUST STOP immediately. You MUST output a "RISK IMPACT REPORT" detailing the specific files and logic conflicts. End your response strictly with "AWAITING CLEARANCE TO PROCEED FROM MACE". Do NOT output execution code until cleared.

# CODE UNTOUCHABLES (Permanent)

This repository contains **permanent safeguards** that MUST NOT be removed in future rebuilds, refactors, or AI-generated exports, unless an explicit external platform change requires it (see “Conditional Exceptions”).

---

## 1) vercel.json (Permanent Lock)

`vercel.json` MUST remain in the **v4.2** shape below.  
**Do NOT** re-introduce any `functions.runtime` overrides (e.g., `nodejs20.x`). Vercel will default to Node serverless functions automatically.

> Note: JSON does not support comments. The lock is documented here to avoid breaking Vercel’s JSON parser.

### Required v4.2 structure (do not change)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/handler?path=:path*" }
  ],
  "functions": {
    "api/**/*.js": { "maxDuration": 10 }
  }
}
```

**Conditional Exceptions (vercel.json):**
- Only change if required by **documented Vercel platform updates** or **explicit runtime format requirements** that are confirmed to be necessary for builds to succeed.

---

## 2) Backend: User creation safeguards

File: `server/routes/users/create.js`

**Do NOT remove:**
- Duplicate suppression checks (prevents repeated creates for the same identity)
- Cooldown/backoff logic (prevents hammering upstream Auth provider on 429)

**Conditional Exceptions (backend):**
- Only change if required by **Supabase Auth Admin API updates** or **documented behavior changes**.

---

## 3) Frontend: Submission + cooldown UX safeguards

Files:
- `public/js/cloud_users.js`
- `public/js/pages/users.js`

**Do NOT remove:**
- Immediate “Save” disable (`dataset.busy=1`)
- Cooldown countdown UI and auto re-enable after retry window
- Non-JSON safe parsing so users see actionable errors instead of generic “Failed (429)”

**Conditional Exceptions (frontend):**
- Only change if required by **updated UX specifications** or **documented frontend behavior changes**.

---

## 4) Mailbox override visibility + audit logging (Permanent)

Files:
- `server/routes/mailbox_override/get.js`
- `server/routes/mailbox_override/set.js`
- `public/js/store.js`
- `public/js/app.js`
- `public/js/pages/mailbox.js`
- `supabase/migrations/20260130_01_mums_sync_log.sql`

**Do NOT remove or weaken:**

- **Global Override Label:** When mailbox override is active and `scope === 'global'`, **all users** (Member, Team Lead, Super Admin) must see a visible label on the Mailbox screen: **GLOBAL OVERRIDE ACTIVE**. The label must only display when the override is **synced via `startMailboxOverrideSync()`** and must disappear when the override is reset/disabled.
- **Override reset rule:** When Mailbox Override is disabled, system must revert to normal Manila time logic immediately. No stale override flags or cached override values allowed.
- **Visibility rule:** If override `scope === 'global'` and enabled, the mailbox override indicator/banner and the override modal **must be viewable by all authenticated roles** (read-only for non-Super Admin).
- **Permission rule:** Only **SUPER_ADMIN** can modify overrides (backend enforced).
- **Audit rule:** Every successful override change must attempt to write an audit record to `public.mums_sync_log` (who changed it, scope, timestamp, action, effective_time).
- **API contract:** `/api/mailbox_override/get` returns `{ ok:true, override:{...} }` and `/api/mailbox_override/set` returns `{ ok:true, override_row, audit }`.

- **Cross-tab rule:** Global override state must be persisted to `localStorage` (cloud key) and other tabs must react via `storage` events (refresh sync + re-render).
- **Render scheduling rule:** Mailbox page must coalesce renders with `requestAnimationFrame` and guard against recursive tick/render loops.

**Conditional Exceptions (mailbox override):**
- Only change if required by **documented Supabase platform/API changes**, **documented security requirements**, or an **approved UX spec change** that explicitly supersedes these rules.

---

## 3) Mailbox override visibility & safety (Permanent)

Files:
- `server/routes/mailbox_override/get.js`
- `server/routes/mailbox_override/set.js`
- `public/js/store.js`
- `public/js/pages/mailbox.js`
- `public/js/app.js`
- `public/js/ui.js`

**Do NOT remove or weaken:**
- **Global scope visibility**: when `scope === "global"` and override is enabled, the banner/UI must be visible to **all roles**.
- **Permission enforcement**: only `SUPER_ADMIN` can change override state; all authenticated users may read global scope state.
- **Audit logging**: every override change MUST insert a row into `public.mums_sync_log` with `user_id`, `scope`, `action`, `effective_time`, and `timestamp`.
- **Anti-recursion guard** on mailbox page: never call `render()` synchronously from `tick()`; always schedule renders to prevent `RangeError: Maximum call stack size exceeded`.
- **Fallback safety**: if override state is missing/invalid, UI must fall back to system Manila time.

**Conditional exceptions:**
- Only change if required by documented security updates, Supabase API behavior changes, or formal UX specification updates.

---

## 4) RLS: profiles_select_own (Permanent)

Migration:
- `supabase/migrations/20260130_01_rls_profiles_select_own.sql`

**Do NOT remove:**
- The `profiles_select_own` SELECT policy on `public.mums_profiles`
- RLS enablement for `public.mums_profiles`

This is required so authenticated users can read their own profile row under RLS.

**Conditional exceptions:**
- Only change if required by a documented security policy change (and update the backend to match).


## Dashboard Routing (Permanent)
- Dashboard menu must always route to /dashboard and load the correct view for all roles. No redirect to /mailbox is allowed.
- Dashboard route must remain stable after load. No auto-redirect to Mailbox is allowed. Sidebar must always reflect the correct active view.

## Global Layout Scaling (Permanent)
- Global layout must scale proportionally (like zooming out) when browser size changes. No element scattering or misalignment is allowed.

## User Deletion Enforcement (Permanent)
- User deletion must fully remove authentication access, database records, and active sessions. Deleted users must not be able to log in under any condition.

## Mobile Layout Parity (Permanent)
- Mobile users must have a dedicated layout that exposes all features and menus. Future changes to the main webapp must remain visible and accessible on mobile.


## Mobile Layout Visibility & Overlays (Permanent)
- Mobile layout must prioritize visibility of main content. Overlay bars (User Online + Quick Links) must be hidden by default but accessible via toggles (#toggleUserOnlineBar, #toggleQuickLinksBar). All features must remain available and future-proofed.

## Role Sync + Deleted User Auto Logout (Permanent)
- User role and shift must update across all UI panels immediately after change. No stale sidebar data allowed.
- Deleted users must be automatically logged out from all active sessions and redirected to login with: "This account has been removed from the system."

## Login Flow Safety (Permanent)
- Login flow must hydrate session safely and defer UI rendering until user context is complete. No blocking render loops or unresponsive states allowed.
- First-time login must succeed without false session errors. Hydration must retry once before showing failure. Flash messages must only appear on confirmed failure.



## Deleted User Real-Time Logout (Permanent)
- When a user is deleted, all active sessions must be terminated immediately. No continued access allowed. Presence polling must detect deletion and trigger forced logout.

## User Management Real-Time Sync (Permanent)
- User Management must reflect new users in real time across all open sessions and roles. No manual refresh required. Sync queue must dispatch user_created events and trigger partial re-render with scroll preservation.

## Classic Style Theme (Permanent)
- Classic Style theme must maintain enterprise-grade layout, fixed sidebar, top bar, and responsive card-based content. Theme must be selectable via Settings and persist across sessions.

## JWT Expiry Recovery on Resume (Permanent)
- App must detect expired/invalid JWT tokens on resume (sleep/wake, tab restore) and recover gracefully.
- On boot/resume: silently refresh session if a refresh_token is available; otherwise clear session and redirect to login.
- Must show flash message: "Session expired. Please log in again."
- Must not spam console or hammer Supabase endpoints with repeated 401/403 POSTs.
- Dashboard and Mailbox must fail gracefully (no crashes, no broken UI state).


## Mailbox Manager Duty + Schedule Notifications (Permanent)
- “Mailbox Manager must retain full assignment capability during duty hours. Notification logic must include schedule context. Time Table must reflect current Mailbox Manager.”

## Mailbox Real-Time Consistency + Assign Modal Persistence (Permanent)
- “Mailbox data must be real-time and consistent across all users. Assignment logic must respect role + duty block. Assign Case form must remain open until explicitly submitted or canceled.”
- Mailbox data must be real-time and consistent across all users (duty assignments, time blocks, and Mailbox Manager visibility must match for everyone).
- Assignment logic must respect role + duty block:
  - TEAM_LEAD / SUPER_ADMIN / ADMIN roles can assign regardless of shift.
  - MEMBER can assign only when on-duty as Mailbox Manager during their active duty window.
- Assign Case form must remain open until explicitly submitted (Send) or canceled. No auto-close on re-render. Must show a loading spinner and prevent double sends.

## Enterprise UI/UX: Schedule + Dashboard (Permanent)
- “Schedule and Dashboard must reflect real-time data, role-aware visibility, and enterprise-grade UX. All layout changes must be responsive, accessible, and audit-tracked.”
- My Schedule must remain mobile-first, include shift visualization, timezone conversion, countdowns, and per-block audit trail. Interactive rescheduling must be permission-gated and always generate an audit entry.
- Dashboard must remain modular and card-based with realtime metrics, activity heatmap, mailbox analytics, and a notification center with unread counts and safe acknowledge actions.

## Mailbox Assignment RBAC + Schedule Readability (Permanent)
- “Mailbox Manager on duty must be able to assign cases to members. TEAM LEAD and SUPER ADMIN can assign by default. All mailbox data must sync in real time across users. My Schedule must be clean, readable, and enterprise‑grade.”
- Mailbox assignment RBAC must always be enforced end-to-end (UI gate + backend re-check).
- Mailbox store/state must remain consistent across all open sessions in real time.
- My Schedule must remain readable across dark/light themes, with clear hierarchy (shift header → timezone strip → calendar grid) and accessible focus/ARIA.

## Schedule Apply Changes + One-Time Notifications + Task Colors (Permanent)
- “Team Lead must be able to apply schedule changes across all dates. Members must receive one-time, acknowledge-only notifications with task and date context. My Schedule must reflect TEAM TASK color codes and enterprise-grade layout.”
- Team Lead/Super Admin can view all dates, but **cannot edit locked schedule blocks**. Locked blocks must remain immutable until explicitly unlocked.
- Members receive schedule update notifications only when their schedule changed. Notifications must:
  - Pop out once per change (no spam loops)
  - Have no close (X) control — only **Acknowledge**
  - Include task label + action (added/removed) + formatted date
- My Schedule must always match TEAM TASK color codes (Mailbox Manager light blue, Back Office orange, Call Available green, Lunch cyan).

## My Schedule Calendar Views + Task Color Standards (Permanent)
- “My Schedule must reflect TEAM TASK color codes, support daily and weekly views, and meet enterprise-grade layout and accessibility standards.”
- Weekly view must keep schedule blocks aligned to the shift ruler; Daily view must remain the highest-readability mode for mobile.
- Tooltips and focus states must remain accessible (ARIA labels + visible focus ring). No shattered layouts on resize.

## My Schedule Weekly/Daily/Team + Alignment Standards (Permanent)
- “My Schedule must support Weekly, Daily, and Team views. Team tab must show full team schedule in tabular format with task color coding. Layout must be aligned, readable, and enterprise-grade.”
- Hour ruler and grid lines must stay pixel-perfect aligned with schedule blocks across resize and common zoom levels.
- Date labels must use full format (e.g., "Sunday, February 1, 2026") consistently across Weekly/Daily/Team.
- Team view must be scrollable and responsive with a sticky MEMBER column and sticky time header row.

## Schedule Time Ruler Alignment + Lock Function Safety (Permanent)
- “Time labels must align precisely with schedule grid lines. All lock-related functions must be defined and scoped correctly. Locked blocks must be immutable until explicitly unlocked. Members page must not throw runtime errors.”
- Time ruler (left column) must share the same header offset + row-height unit system as the schedule grid to prevent drift on resize/zoom.
- Lock helpers (e.g., `dayLockedForGridDisplay`, `isDayLockedForEdit`) must always be defined before any render path and must **not** allow role-based bypass of block locks.

## Task Sync + Time Alignment + Graphical Balancing Panel (Permanent)
- “All task assignments must sync across Team Lead and Member views. Time labels must align with grid blocks. Team Lead must have access to a floating graphical panel to balance task hours across members.”
- Canonical schedule store is `mums_schedule_blocks` (client mirror `Store.KEYS.schedule_blocks`), with `mums_schedule_snapshots` used for rollback/audit.
- My Schedule ruler + grid must share a single unit system (`--schx-row-h`, `--schx-hours`) to prevent drift on resize/zoom.
- Members graphical status panel must remain role-gated (Team Lead/Admin) and must not block scheduling workflows if disabled.
- Graph panel must support **Mailbox Manager vs Call Available** comparison mode, auto-sort by fewest hours in the selected task, and show governance notices (<10h low / ≥20h high) to guide balanced assignment.

## Graph Panel Stability + Member Schedule Visibility (Permanent)
- “Graphical panels must not throw runtime errors. Member schedules must be visible across all views. Time labels must align with grid blocks and layout must meet enterprise-grade standards.”

## Supabase Keep-Alive Governance (Permanent)
- “Supabase must receive periodic activity via keep-alive endpoint to prevent project pausing. Heartbeat table must exist and be writable. Cron job must trigger endpoint at least once every 48 hours.”
- Keep-alive must remain best-effort and non-blocking (no UI freezes; failures should only log + return `{ ok: false }`).
- Endpoint must remain available at `/api/keep_alive` (and alias `/api/keep_alive.js`), and should attempt a lightweight insert into `heartbeat`.
- Heartbeat table must include a `uid` column. RLS must be enabled, with policies restricting SELECT/INSERT/UPDATE to the authenticated user's own rows only (`auth.uid() = uid`).

## Root Login + Release Packaging Naming (Permanent)
- “Root access must always load login page. No internal content visible before authentication.”
- “All packaged builds must follow naming format `MUMS Phase 1-<sequence>`, starting at 500 and incrementing by +1 per release.”
- Packaging must use the authoritative tool: `tools/package_phase1_release.js` (or `npm run package:phase1`) to generate the zip and bump build labels for the next release (500 → 501 → 502...).

## Members Tooling: Paint + Graph Panel Sync (Permanent)
- Paint dropdown selection must directly control the **Graphical Task Status** panel task filter. No manual re-selection required.
- Graph panel dropdown must also sync back to Paint if changed manually (bidirectional sync).
- Graphical Task Status must refresh in real time after schedule edits (paint/drag/apply changes), reflecting updated task hours immediately.
- Governance notices must appear as enterprise-grade tooltips (or modal alerts) using thresholds:
  - Low hours (< 10h): “This member has limited hours in this task. Priority assignment recommended.”
  - High hours (≥ 20h): “This member already has 20 hours in this task. Assigning more may cause imbalance. You may proceed or reselect from the list below.”

- “Graph Panel must render in landscape layout with progress bars. Analytics view selector must be removed. Member selection must highlight name. Panel must be resizable and float above all layers.”

- “Graph Panel must render in landscape layout with progress bars based on percentage logic. Task layout must match Paint selection. Sorting must be by percentage, descending.”
- “Members Page must support compressed layout with task stats below name. Graph Panel must include toggle for settings. Reporting tools must be consolidated into a dropdown. Block deletion must be error-free and readable.”

- “Members Page must support real-time progress bars (0–60% green, 61–85% orange, 86–100% red) under member names, fixed header anchors (Team/Week/Lock bar), compressed block grid density, and horizontal leave buttons (SL/EL/VL/HL).”

## Phase 1 Build Version + Cache Busting + Tooltip UX (Permanent)
- Build/version must be sourced from `public/js/config/version.js` (`const SEQ = <n>`). UI build labels must render via `[data-build-label]` placeholders (no hardcoded build IDs in HTML).
- Cache-busting must be applied via `?v=p1-<SEQ>` on all HTML asset links (CSS/JS). The packager must bump both `SEQ` and the `p1-<n>` tokens after each release.
- Member progress tooltip must use hover/fade animation only (no layout shifts). Schedule task blocks must not be altered by tooltip, progress, or cache-busting changes.
