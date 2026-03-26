# Deploy checklist (Node 20)

## Dual deploy (single repo): Vercel (UAT) + Cloudflare Pages (Main)

This repo is structured to deploy the same codebase to both platforms:

- **Vercel (UAT)**
  - Frontend: served from `/public`
  - Backend: `/api/*` (Vercel Serverless Functions)

- **Cloudflare Pages (Main)**
  - Frontend: set **Build output directory** to `public` (no leading slash)
  - Backend: `/functions/api/*` (Cloudflare Pages Functions)
  - Routing: `public/_routes.json` ensures only `/api/*` hits Functions

### Environment variables (both platforms)

Set these env vars in **Vercel** and **Cloudflare Pages**:

- `SUPABASE_URL` (project URL)
- `SUPABASE_ANON_KEY` (public anon key)
- `USERNAME_EMAIL_DOMAIN` (e.g., `mums.local`)

Server-only (never expose to client):

- `SUPABASE_SERVICE_ROLE_KEY`

Verify runtime loader:

- `GET /api/env` returns JSON with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `USERNAME_EMAIL_DOMAIN`.

## Why you saw Node 18 build failures on Vercel
Vercel builds whatever commit is on your production branch. If the build log still shows the same commit SHA, the repo wasn't updated.

## Required steps
1) **Extract** this ZIP locally (do not upload the ZIP file as-is).
2) Copy the extracted contents into your GitHub repo working tree.
3) Commit and push to the branch Vercel deploys (usually `main`).
4) In Vercel → Project → Settings → Environment Variables, set Supabase vars and **Redeploy**.

## Verify before pushing
- `package.json` (root) contains `"engines": { "node": "20.x" }`
- `realtime/package.json` contains `"engines": { "node": "20.x" }` (if applicable)
- `vercel.json` uses `nodejs20.x`
- No `.env` file committed (only `.env.example`)

## Verify on Vercel
In Deployment → Build Logs, confirm it clones a **new commit SHA** and no longer reports Node 18.x.

## Apply Supabase migrations (required for Steps 1–6)
Run these in order (SQL editor or Supabase CLI):
1) `supabase/migrations/20260127_01_profiles_avatar_url.sql`
2) `supabase/migrations/20260127_02_storage_public_bucket.sql`
3) `supabase/migrations/20260128_01_profiles_team_override.sql`

After applying migrations:
- Confirm `mums_profiles.team_override` exists
- Confirm SUPER roles have `team_id = NULL` when `team_override = false`

## Enterprise UI/UX Verification (13126-04)
- Cache-busting:
  - Confirm `?v=20260201-13126-05` is applied to all `public/*.html` assets that reference CSS/JS.
- Dashboard (/#/dashboard):
  - Renders for SUPER_ADMIN / TEAM_LEAD / MEMBER without redirect or blank state.
  - KPI cards show: Active cases, My active cases, Pending acknowledgements, Mailbox shift load.
  - Notification Center:
    - Filters (Unread/Schedule/Mailbox/System/All) work.
    - Acknowledge button updates `ums_schedule_notifs` and removes from Unread.
    - Mailbox case assignment card renders without console errors; **Unique Case ID** shows the case number (or **N/A**), and the copy button copies the case number when present (disabled when missing).
    - Search works without crashing.
  - Activity Heatmap renders with 7-day view and tooltips.
  - Mailbox Analytics panel renders current shift stats (assigned/confirmed/open + avg response), bucket rows, role distribution.
  - Quick Actions and Sidebar toggle behave correctly on desktop and mobile.
- My Schedule (/#/my_schedule):
  - Enterprise grid layout is responsive (desktop/tablet/mobile), no horizontal overflow.
  - Shift blocks are color-coded (Morning/Mid/Night), include role badges, timezone conversion, and countdown timer.
  - Hover tooltips and per-block audit trail render.
  - Drag-to-reschedule is permission-gated, produces an audit entry, and does not break schedule integrity.
  - WCAG checks: keyboard focus visible, sufficient contrast, readable typography.
- Real-time consistency (multi-session):
  - Open two sessions and confirm schedule notifications, mailbox tables, and audit logs remain consistent across users.

## Enterprise UI/UX + Sync Verification (13126-05)
- Cache-busting:
  - Confirm `?v=20260201-13126-05` is applied to **all** `public/*.html` assets that reference CSS/JS.
- My Schedule (/#/my_schedule):
  - Layout:
    - Grid alignment is clean (no stacked/overlapping text). No horizontal overflow on desktop/tablet/mobile.
    - Shift header, timezone strip, and calendar grid are visually distinct and readable.
  - Content:
    - Shift blocks are color-coded (Morning/Mid/Night) and include role badges.
    - Timezone conversion uses `UI.parseManilaDateTimeLocal()` and displays both Manila + local accurately.
    - Countdown timer updates and remains accurate after sleep/wake.
    - Hover tooltips show full block context (role, time, audit).
  - Accessibility:
    - ARIA labels present for interactive blocks.
    - Focus rings visible via keyboard navigation; WCAG AA contrast maintained in dark/light themes.
  - Mobile/tablet:
    - Collapsible sections work; swipe navigation changes focus day without breaking layout.
- Mailbox (/#/mailbox):
  - Realtime sync:
    - Open 2 sessions; confirm duty/time blocks, mailbox manager visibility, assignment counts match across users.
    - Confirm Store.listen triggers on: `mums_mailbox_tables`, `mums_mailbox_state`, `ums_cases`, `ums_schedule_notifs`.
  - Role-based assignment:
    - MEMBER on-duty Mailbox Manager can assign cases **to MEMBERS only** during active duty block.
    - TEAM_LEAD can assign cases for the same shift.
    - SUPER_ADMIN can assign cases by default.
    - Others are blocked (UI disabled) and backend rejects.
  - Audit logging:
    - Each assignment generates an audit entry in `ums_activity_logs` including: assigner, assignee, time block, shiftKey, role, timestamp.


## Verification (13126-06)
- Cache-busting:
  - Confirm `?v=20260201-13126-06` is applied to **all** `public/*.html` assets that reference CSS/JS.
- Sidebar menu routing:
  - Click **Dashboard** → loads Dashboard only.
  - Click **My Schedule** (left sidebar) → loads the My Schedule grid (not Dashboard).
  - From Dashboard quick actions/links, click **Schedule/My Schedule** → loads My Schedule.
- My Schedule page load:
  - `UI.renderSchedule()` renders `Pages.my_schedule` and mounts into `#main` without blank state.
  - No missing container errors; no console errors on navigation.
- JS syntax check:
  - Run `node --check public/js/app.js public/js/ui.js public/js/pages/my_schedule.js` and confirm no syntax errors.


## Verification (13126-07)
- Cache-busting:
  - Confirm `?v=20260201-13126-07` is applied to **all** `public/*.html` assets that reference CSS/JS.
  - Confirm sidebar Build shows `20260201-13126-07` and no mixed-version assets are loaded.
- My Schedule (/#/my_schedule):
  - Layout:
    - Time blocks are properly aligned (no stacked/overlapping text). Hour grid remains readable.
    - Blocks use task color codes (TEAM TASK catalog):
      - Mailbox Manager → light blue
      - Back Office → orange
      - Call Available → green
      - Lunch → cyan
    - Hover tooltips show full context (task/role, time, audit).
  - Accessibility:
    - Keyboard focus rings visible; ARIA labels present; contrast meets WCAG AA.
  - Mobile/tablet:
    - Responsive layout holds; no horizontal overflow; interactions remain usable.
- Members (Team Lead tooling):
  - Lock/Unlock:
    - Team Lead/Super Admin can view all calendar dates, but **locked schedule blocks are immutable** until explicitly unlocked.
    - Editing attempts on locked blocks must show a warning and must not change data.
    - Locked blocks must display the “🔒 Locked” label below the icon/label.
    - Unlocking days persists and does not revert on refresh or cross-session sync.
    - Lock state syncs via `mums_schedule_lock_state`.
  - Apply Changes:
    - “Apply Changes” sends notifications only to affected members (those with actual schedule diffs).
    - Team Lead receives confirmation toast: “The Schedule Changes have been applied and sent to members for visibility.”
    - Action is logged in `ums_activity_logs` with actor, weekStart, affected dates, and recipient count.
- Member Notifications:
  - Popout behavior:
    - Notification appears once per schedule change (no repeated re-open/spam).
    - No close (X) button; only **Acknowledge**.
    - Acknowledge marks read in schedule notifs and prevents re-show unless a new change is pushed.
  - Message format:
    - `Schedule Updated: [Task Label] added/removed on [Weekday, Month DD, YYYY].`
    - Includes task/date context; details list is acceptable.
- JS syntax verification:
  - Run `node --check` against **all** `public/js/**/*.js` and confirm no syntax errors.
  - Navigate: Dashboard → Members → My Schedule → Mailbox. Confirm no console errors.


## Verification (13126-08)
- Cache-busting:
  - Confirm `?v=20260201-13126-08` is applied to **all** `public/*.html` assets that reference CSS/JS.
  - Confirm sidebar Build shows `20260201-13126-08` and no mixed-version assets are loaded.
- My Schedule — Enterprise Calendar:
  - Weekly view:
    - Blocks align cleanly to the shift ruler and hour grid (no shattered layout, no overlap).
    - Horizontal scrolling is acceptable on narrow widths, but **Daily view** must remain the highest-readability mode.
  - Daily view:
    - Toggle works and persists (localStorage `mums_sched_view`).
    - Day tabs work; swipe left/right changes day on mobile.
  - Task color consistency (TEAM TASK catalog):
    - Mailbox Manager → `#4aa3ff`
    - Back Office → `#ffa21a`
    - Call Available → `#2ecc71`
    - Lunch → `#22d3ee`
    - Badges (`.task-label` + `.task-color`) and block backgrounds use the same palette.
  - Tooltip + accessibility:
    - Hover + focus tooltips show task name, Manila time range, optional local time range, and audit info if available.
    - Blocks are keyboard focusable with visible focus ring; ARIA labels present; contrast meets WCAG AA.
- JS syntax verification:
  - Run `node --check` against **all** `public/js/**/*.js` and confirm no syntax errors.
  - Navigate: Dashboard → My Schedule → Members. Confirm no console errors.


## Verification (13126-09)
- Cache-busting:
  - Confirm `?v=20260201-13126-09` is applied to **all** `public/*.html` assets that reference CSS/JS.
  - Confirm sidebar Build shows `20260201-13126-09` and no mixed-version assets are loaded.
- My Schedule (/#/my_schedule):
  - Horizontal alignment:
    - Hour ruler ticks align **pixel-perfect** with the hour grid lines and schedule blocks.
    - Alignment holds during resize and at common zoom levels (90% / 100% / 110%).
  - Date format:
    - Date labels use full format: `Sunday, February 1, 2026` across **Weekly**, **Daily**, and **Team** views.
    - Timezone context is visible (Manila + Local when different).
  - Tabs:
    - Weekly / Daily / Team tabs switch instantly with no blank state.
    - View mode persists via localStorage `mums_sched_view`.
  - Team tabular view:
    - Renders a team schedule table (rows = members, columns = hourly slots).
    - Sticky MEMBER column and sticky header row remain readable while scrolling.
    - TASK color codes match TEAM TASK catalog:
      - Mailbox Manager → `#4aa3ff`
      - Back Office → `#ffa21a`
      - Call Available → `#2ecc71`
      - Lunch → `#22d3ee`
    - Hover/focus tooltips show member name, task label, and time context.
  - Accessibility:
    - Blocks and team cells are keyboard-focusable with visible focus ring.
    - ARIA labels present; contrast meets WCAG AA.
- JS syntax verification:
  - Run `node --check` against **all** `public/js/**/*.js` and confirm no syntax errors.
  - Navigate: Dashboard → My Schedule → Members → Mailbox. Confirm no console errors.


## Verification (13126-10)
- Cache-busting:
  - Confirm `?v=20260201-13126-10` is applied to **all** `public/*.html` assets that reference CSS/JS.
  - Confirm sidebar Build shows `20260201-13126-10` and no mixed-version assets are loaded.
- My Schedule (/#/my_schedule):
  - Time ruler alignment:
    - Hour tick labels (06:00, 07:00, …) align **pixel-perfect** with the hour grid lines.
    - Alignment holds during resize and at common zoom levels (90% / 100% / 110%).
    - Day header spacing does not offset the ruler (ticks start exactly at the grid start).
- Members (/#/members):
  - No runtime errors:
    - Page loads without `ReferenceError: dayLockedForGridDisplay` or any other JS exceptions.
  - Lock behavior:
    - Team Lead/Admin can view all dates, but **cannot edit locked schedule blocks** until unlocked.
    - Editing locked blocks must show a warning and keep blocks unchanged.
    - Non-priv roles (MEMBER) see locked-day indicators and cannot edit locked days.
- JS syntax verification:
  - Run `node --check` against modified files:
    - `public/js/pages/my_schedule.js`
    - `public/js/pages/members.js`
    - `public/js/ui.js`
  - Navigate: Dashboard → My Schedule → Members. Confirm no console errors.


## Verification (13126-11)
- Cache-busting:
  - Confirm `?v=20260201-13126-11` is applied to **all** `public/*.html` assets (index, login, schedule, dashboard, debug, etc.) that reference CSS/JS.
  - Confirm sidebar Build shows `20260201-13126-11` and no mixed-version assets are loaded.
- Task schedule sync:
  - As TEAM_LEAD, in Members view, add/update task blocks for multiple members and click **Apply Changes**.
  - Verify the updated blocks are persisted in `mums_schedule_blocks` and reflected immediately (realtime) in:
    - Members timeline view
    - The affected member’s **My Schedule** (Weekly / Daily / Team)
  - Verify schedule blocks remain after page refresh and across browser restart.
- My Schedule time alignment:
  - Hour tick labels align pixel-perfect with the horizontal hour grid lines and schedule blocks.
  - Alignment holds during resize and common zoom levels (90% / 100% / 110%).
  - Vertical grid lines remain visible and consistent across Weekly/Daily/Team.
- Members graphical task status panel:
  - Toggle:
    - “Show Graphical Task Status” checkbox shows/hides the panel and persists state (localStorage).
  - Behavior:
    - Panel is draggable (header) and resizable (corner); close button hides without errors.
    - Stacked bars render per member (task hour totals) and update live after Apply Changes.
    - Selected member is highlighted.
    - Hover tooltips show **task name + hour count**.
- JS syntax verification:
  - Run `node --check` against **all** `public/js/**/*.js` and `server/**/*.js` and confirm no syntax errors.
  - Navigate: Dashboard → My Schedule → Members → Mailbox. Confirm no console errors.


## Verification (13126-12)
- Cache-busting:
  - Confirm `?v=20260201-keepalive` is applied to **all** `public/*.html` assets (index, login, schedule, dashboard, debug, etc.) that reference CSS/JS.
  - Confirm the UI header shows `Build ID: MUMS Phase 1-504` and no mixed-version assets are loaded.
- Schedule storage authority:
  - Confirm `mums_schedule_blocks` is treated as **authoritative** schedule storage.
  - Confirm `ums_weekly_schedules` is used only as **read-only fallback** (no new writes required for normal operations).
- Members graphical panel stability:
  - Members page loads with **no** `TypeError: Config.shiftByKey is not a function` (or other JS exceptions).
  - Toggle “Show Graphical Task Status”:
    - Panel opens/closes without crashes.
    - Draggable + resizable behavior works.
    - Tooltips show task name + hour count.
- Member schedule visibility (sync + rendering):
  - As TEAM_LEAD, assign/update blocks in Members view and click **Apply Changes**.
  - Verify the affected member’s **My Schedule** shows assigned blocks (not “No blocks”) in:
    - Weekly view
    - Daily view
    - Team tab
  - Refresh both clients; verify blocks persist and remain visible.
- Time label alignment:
  - Verify My Schedule hour tick labels align with the hour grid lines and schedule blocks at 90% / 100% / 110% zoom.
  - Verify Members timeline hour labels align with the timeline grid and blocks.
- JS syntax verification:
  - Run `node --check` against modified files and confirm no syntax errors:
    - `public/js/config.js`
    - `public/js/store.js`
    - `public/js/pages/members.js`
    - `public/js/pages/my_schedule.js`
  - Navigate: Dashboard → My Schedule → Members. Confirm no console errors.

- Supabase keep-alive:
  - API endpoint:
    - Deploy the build, then run: `curl -s https://meystest.vercel.app/api/keep_alive`
    - Expect JSON `{ ok: true }` (or `{ ok: false, need_manual_setup: true }` if `heartbeat` table does not exist).
    - Optional alias test: `curl -s https://meystest.vercel.app/api/keep_alive.js`
  - Heartbeat table:
    - Confirm `heartbeat` table exists and receives a new row on each ping.
    - If missing, create table using the SQL returned by the endpoint (or create manually per ops).
  - Scheduled trigger:
    - Confirm the GitHub Action workflow `Supabase Keep-Alive` exists and runs on schedule.
    - Ensure it triggers at least once every 48h (daily is preferred).

- Vercel deployment warnings:
  - Build step:
    - Confirm Vercel build logs show: `Static site deployment — no build step required`.
    - Confirm there is no repeated/legacy `No build step for static site` message after the script update.
  - ESM/CJS warning:
    - Confirm Vercel logs do **not** show: `Node.js functions are compiled from ESM to CommonJS`.
    - Confirm `server/routes/debug/log.js` is CommonJS (no `export default`) to avoid ESM transpilation.
  - Config presence:
    - Confirm `vercel.json` is present and remains in the v4.2 structure (rewrites + functions.maxDuration).

## Verification (MUMS Phase 1-508)
- Root login enforcement:
  - Deploy, open an **incognito/private** window.
  - Visit `/` (root) and confirm the **login page** appears immediately.
  - Confirm there is **no dashboard flash** / internal UI rendered before authentication.
  - Visit `/login` (no extension) and confirm it also resolves to the login page (via early redirect).

- Release naming + build ID:
  - Confirm the packaged artifact name follows: `MUMS Phase 1-508.zip`.
  - Confirm the UI header shows: `Build ID: MUMS Phase 1-508`.
  - Confirm no legacy build IDs (`13126-*`) appear in the UI.

- Schedule lock enforcement (Members):
  - As TEAM_LEAD and SUPER_ADMIN: lock a weekday (Mon–Fri), then attempt to drag/resize/edit a locked block.
    - Expect: warning shown; no changes persisted.
  - Confirm each locked block shows the label: “🔒 Locked”.
  - Unlock explicitly, then edit; confirm edits now persist.

- Graphical Task Status panel (Members):
  - Enable **Graphical Task Status**.
  - Paint ↔ Graph dropdown sync:
    - Change the Paint dropdown → Graph panel updates instantly (dropdown + list).
    - Change the Graph panel dropdown → Paint dropdown updates instantly.
    - Assign/paint/drag blocks → Graph panel refreshes live and reflects updated hours.

  - Landscape layout + percentage bars:
    - Confirm panel renders landscape layout (Member names + `(Xh)` + progress bar).
    - Confirm progress bars reflect **percentage** based on the task’s max-hours setting.
    - Confirm sorting is by percentage (lowest at top → highest at bottom).
    - Confirm layout matches Paint selection.

  - Analytics selector removal:
    - Confirm the **Select Analytic View** dropdown is removed.

  - Graph Panel Settings toggle:
    - Confirm the button “⚙️ Graph Panel Settings” exists.
    - Confirm settings are **hidden by default**.
    - Toggle open/close and confirm state persists across task switches.

  - Member highlight:
    - Select a member row in Members → confirm the same member is highlighted in Graph Panel.
    - Confirm highlight persists across task switches and panel refresh.

  - Floating + resizable:
    - Confirm the panel stays above other UI layers (z-index dominance).
    - Confirm the panel is resizable from edges/corners and does not clip contents.
    - Resize, refresh page → confirm size persists.



- Members progress bars + fixed anchors + grid compression (Phase 1-508):
  - Confirm each member row shows a progress bar under the name, based on total task hours converted to percentage.
  - Confirm color thresholds:
    - 0–60% → green
    - 61–85% → orange
    - 86–100% → red
  - Resize browser: confirm Team dropdown, Week selector, and lock bar stay anchored (scale down but do not drift or wrap incorrectly).
  - Confirm Members block grid density is compressed ~20% (row padding/height reduced) while time labels remain aligned to vertical grid lines.
  - Confirm leave buttons (SL/EL/VL/HL) render horizontally with consistent spacing and no overflow.
  - Confirm overlay background density is reduced ~20% (more members visible without scrolling).

- Members page compression + REPORTS dropdown:
  - Confirm the team label (e.g., “Morning Shift”) is removed from each member row.
  - Confirm the pill badges are replaced by a single compressed stats line below the name:
    - `Mailbox: 3h • Back Office: 10h • Call: 27h • Cases: 0`
  - Confirm member row padding/height is reduced so more members fit onscreen.
  - Confirm the 📊 REPORTS dropdown replaces the individual report/export icons and opens on hover/focus.

- Block deletion error handling:
  - Delete unlocked blocks (single + bulk) and confirm no error toast appears.
  - If deletion fails, confirm the warning is readable (not `[object Object]`) and falls back to: “Unable to delete block. Please try again.”
- Sequential packaging auto-increment:
  - Confirm the tool exists: `tools/package_phase1_release.js`.
  - Dry-run check: `npm run package:phase1 -- --dry-run`.
    - Expect: it would create `MUMS Phase 1-511.zip`, then bump SEQ/cache tokens to `MUMS Phase 1-512`.
  - After packaging (real run), confirm the next run would generate: `MUMS Phase 1-512.zip`.

- Keep-alive regression:
  - Confirm `/api/keep_alive` still returns `{ ok: true }` and inserts into `heartbeat`.
  - Supabase RLS alignment (public.heartbeat):
    - Confirm column `uid uuid` exists on `public.heartbeat`.
    - Confirm Row Level Security is **enabled** on `public.heartbeat`.
    - Confirm policies exist: SELECT/INSERT/UPDATE restricted to `auth.uid() = uid`.
    - Confirm the app performs an authenticated heartbeat insert including `uid` (Cloud mode):
      - In DevTools Network, look for a `rest/v1/heartbeat` insert (200) or verify with SQL: `SELECT * FROM public.heartbeat WHERE uid = auth.uid();`
    - Confirm Supabase Security Advisor no longer reports RLS issues for `public.heartbeat`.
  - Confirm GitHub Actions `Supabase Keep-Alive` workflow still exists and runs on schedule.

- Build version + cache busting (Phase 1-511+):
  - Confirm `public/js/config/version.js` exists and defines `const SEQ = <n>`.
  - Confirm UI build label placeholders exist (`[data-build-label]`) and show the correct build in UI.
  - Confirm key HTML pages include `?v=p1-<n>` on CSS/JS assets and that the token matches SEQ.
  - Confirm packager dry-run indicates it will bump SEQ and cache tokens to the next build.

- Member progress tooltip UX (Phase 1-511):
  - Confirm tooltip label does not shift layout (no reflow) and uses hover/fade animation only.
  - Confirm schedule task blocks are unchanged by progress/tooltip behavior.

