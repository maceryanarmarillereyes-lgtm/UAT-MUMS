# Changelog

All meaningful changes to MUMS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [UAT] — 2026-05-03 — Audit Readiness Cleanup

### Changed
- Repository structure reorganised for audit readiness (no logic changes)
- Legacy root-level `css/`, `js/`, `Widget Images/`, `sound alert/` moved to `archive/`
- `public/Widget Images/` renamed to `public/widget-images/` (no spaces)
- `public/sound alert/` renamed to `public/sound-alert/` (no spaces)
- `functions/functions/` nested folder flattened into `functions/`
- Ad-hoc SQL files moved from `supabase/` root to `supabase/migrations/applied/`
- `public/debug.html` and `public/controller_lab.html` moved to `archive/`
- JSDoc `@file` headers added to all `.js` files (216 files)
- CSS file headers added to all `.css` files (10 files)
- HTML comment headers added to all `.html` files (8 files)
- `.gitignore`, `.env.example`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` updated/created
- `docs/ARCHITECTURE.md`, `docs/FILE_INDEX.md`, `docs/AUDIT_CHECKLIST.md`, `docs/KNOWN_ISSUES.md` created

---

## [v3.9.30] — 2026-04-30

### Fixed
- Pause session columns schema fix — aligns DB columns with client expectations

---

## [v3.9.22] — 2026-04-28

### Added
- My Notes workspaces v2 — workspace switching with persistent state in Supabase

### Fixed
- My Notes workspace migration — FINAL version resolves column conflicts

---

## [v3.9.21] — 2026-04-26

### Added
- My Notes feature — personal rich-text note-taking with workspace support
- `supabase/migrations/20260426_my_notes.sql` — initial My Notes schema

---

## [v3.9.x] — 2026-04-25

### Added
- Pause session settings — configurable pause timer with DB persistence
- `supabase/migrations/20260425_pause_session_settings.sql`

---

## [v3.9.1] — 2026-04-21

### Added
- Services treeview — hierarchical category navigation for service records
- Services backups — snapshot and restore for service grid data
- `supabase/migrations/20260421_services_treeview.sql`
- `supabase/migrations/20260421_02_services_backups.sql`

### Fixed
- Services treeview repair migration — fixes orphan node handling

---

## [v3.8.x] — 2026-04-20

### Added
- Services schema — full services management data model
- `supabase/migrations/20260420_services_schema.sql`
- Performance indexes — composite indexes for presence and task queries
- `supabase/migrations/20260419_02_perf_indexes.sql`

---

## [v3.7.x] — 2026-04-13

### Added
- Complete free-tier hardening — adaptive polling and egress budgeting for 30 users on Supabase Free Plan
- `supabase/migrations/20260413_01_complete_free_tier_hardening.sql`

### Fixed
- Daily passwords free-tier fix — reduces password sync poll frequency
- RLS security fix — patches policy recursion on `mums_profiles`

---

## [v3.6.x] — 2026-04-10

### Added
- Free-tier IO rescue — emergency disk IO optimisation migration
- `supabase/migrations/20260410_01_free_tier_io_rescue.sql`

---

## [v3.5.x] — 2026-03-31

### Added
- Daily passwords feature — secure daily password distribution via Support Studio
- `supabase/migrations/20260331_daily_passwords.sql`

---

## [v3.4.x] — 2026-03-24

### Added
- APEX forced defaults — sets APEX theme as default for new users
- `supabase/migrations/20260324_01_apex_forced_defaults.sql`

---

## [v3.3.x] — 2026-03-23

### Fixed
- Studio QB settings upsert guard — prevents duplicate rows on concurrent saves

---

## [v3.2.x] — 2026-03-21

### Added
- Security PIN feature — PIN-gated access to sensitive admin actions
- `supabase/migrations/20260321_01_security_pin.sql`

---

## [v3.1.x] — 2026-03-16

### Added
- Support catalog and subtree — hierarchical support catalogue with category codes
- `supabase/migrations/20260316_01_support_catalog.sql`
- `supabase/migrations/20260316_02_catalog_subtree.sql`

---

## [v3.0.x] — 2026-03-12

### Added
- Global QuickBase name config — per-deployment QB display name setting

---

## [v2.x.x] — 2026-02-28 to 2026-03-06

### Added
- QuickBase extended columns on profiles — personal QB settings per user
- `supabase/migrations/20260228_03_mums_profiles_quickbase_extended_columns.sql`
- QuickBase settings JSONB — JSON column for flexible QB config storage
- `supabase/migrations/20260303_02_add_quickbase_settings_jsonb.sql`
- QuickBase tabs feature — personal QB iframe tabs per user
- `supabase/migrations/20260303_create_quickbase_tabs.sql`
- QuickBase tabs upsert constraint
- Login mode trigger guard

---

## [v1.x.x] — 2026-01-27 to 2026-02-17

### Added
- Initial schema — `mums_profiles`, `mums_documents`, `mums_presence`, `mums_sync_log`
- Profile avatar URL column
- Storage public bucket migration
- Profiles team override
- Deduplicate superadmin migration
- Heartbeat table and RLS
- Invite-only Azure auth guard
- Task items with reference URL and distribution index
- Task orchestration core schema
- Security advisor hardening
- Phase 1 task distribution monitoring

---

*Earlier changes predate structured commit tracking.*
