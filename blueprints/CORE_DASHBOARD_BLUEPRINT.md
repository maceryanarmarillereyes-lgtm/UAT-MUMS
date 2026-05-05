# Core Dashboard and Operations Blueprint

## Scope
- `public/js/pages/dashboard.js`
- `public/js/pages/announcements.js`
- `public/js/pages/commands.js`
- `public/js/pages/logs.js`
- `public/js/pages/system.js`
- `public/js/pages/overall_stats.js`
- `public/js/pages/gmt_overview.js`
- `public/js/my-notes.js`

## Feature inventory
1. **Dashboard** (`dashboard.js`)
   - Role-aware leadership/member view.
   - Shift/team normalization and active shift signals.
2. **Announcements** (`announcements.js`)
   - CRUD/import/export announcement entries used by top-bar rotator.
3. **Commands** (`commands.js`)
   - Delegated quick-access command tiles based on extra privileges.
4. **Activity Logs** (`logs.js`)
   - Search/filter/export logs, role-scoped visibility, error-centric filtering.
5. **System Monitor** (`system.js`)
   - Super-admin diagnostics for timers, request usage, sync health, tier thresholds.
6. **Overall Stats** (`overall_stats.js`)
   - Cross-member statistics with date presets, sorting, paging, and access gates.
7. **GMT Overview** (`gmt_overview.js`)
   - Global timezone matrix and pinned world clock integration.
8. **My Notes v2** (`my-notes.js`)
   - Injects a dedicated My Notes icon button before `releaseNotesBtn` without mutating existing topbar controls.
   - Provides local cache + Supabase-backed personal/team/projects note workspaces via modal UI.

## Data dependencies
- Store docs: users, announcements, logs, reminders, schedule-derived aggregates.
- Auth/Config roles and permissions.
- System monitor may observe env/runtime request telemetry.

## Do-not-break contracts
- Keep role gates intact (especially super-admin-only surfaces).
- Keep dashboard safe fallback rendering when data is partial.
- Keep logs visibility filters aligned with role/team boundaries.
- Do not silently widen access scope.
- Sidebar navigation handlers must prioritize `data-page` as canonical page ID; href parsing is fallback only to avoid cross-page misrouting.

## Change checklist
- [ ] Verified role-based guards unchanged.
- [ ] Verified export/import flows still work.
- [ ] Verified page does not throw on missing fields.

## Change log
- **2026-04-20** — Initial core dashboard/operations blueprint created.
- **2026-04-22** — Leave Monitor right-sidebar overflow handling updated: monitor body now scrolls independently while footer action buttons remain visible, with session scroll position persistence.
- **2026-04-26** — Added My Notes v2 widget integration scope (topbar pre-release-notes insertion + Supabase notes persistence contract).

- **2026-05-03** — Dashboard gate tightened: users without a valid Quickbase name assignment are hard-blocked from dashboard counters to prevent global data bleed; UI now shows `DATA NOT AVAILABLE` with admin-contact instruction.

- **2026-05-05** — Navigation contract hardened: dashboard/menu routing now resolves page target from `data-page` first, with href-derived routing as fallback to prevent accidental Team Report renders from delegated click handlers.

- **2026-05-05** — Team Report QB OPEN alignment hardened: Quickbase assignee-to-profile matching now normalizes punctuation/whitespace and applies safe fuzzy fallback so member QB OPEN mirrors per-user Dashboard/My Active Cases scope when Assigned QB names vary in format.

- **2026-05-05** — Team Report QB OPEN source-of-truth aligned to Dashboard hero counter logic by reusing Global QB filters + report filter + per-user hero field clause, so per-member QB OPEN now equals My Active Cases counts.
