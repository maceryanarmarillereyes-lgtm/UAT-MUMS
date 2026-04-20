# MUMS Feature Blueprint Index

> Master index for all feature blueprints. Use this first before editing any feature.

## Existing feature blueprints
- `SERVICES_BLUEPRINT.md` — Services Workspace
- `SUPPORT_STUDIO_BLUEPRINT.md` — Support Studio Suite

## New feature blueprints (this update)
- `blueprints/CORE_DASHBOARD_BLUEPRINT.md`
- `blueprints/MAILBOX_BLUEPRINT.md`
- `blueprints/TASKS_AND_MONITORING_BLUEPRINT.md`
- `blueprints/PEOPLE_ACCESS_BLUEPRINT.md`
- `blueprints/SCHEDULE_AND_REMINDERS_BLUEPRINT.md`
- `blueprints/QUICKBASE_AND_CASES_BLUEPRINT.md`
- `blueprints/SEARCH_BLUEPRINT.md`
- `blueprints/AUTH_AND_SYNC_BLUEPRINT.md`

## Coverage map (feature → blueprint)
- Dashboard / Home widgets / Team visibility → `CORE_DASHBOARD_BLUEPRINT.md`
- Commands / Announcements / Logs / System Monitor / Overall Stats / GMT Overview → `CORE_DASHBOARD_BLUEPRINT.md`
- Mailbox + assignment + override + table/state sync → `MAILBOX_BLUEPRINT.md`
- My Task + Distribution Monitoring + Team Config → `TASKS_AND_MONITORING_BLUEPRINT.md`
- Users + Members + Privileges/Delegated Commands → `PEOPLE_ACCESS_BLUEPRINT.md`
- My Schedule + Master Schedule + Attendance + Manila Calendar + Team/My Reminders → `SCHEDULE_AND_REMINDERS_BLUEPRINT.md`
- My QuickBase + QuickBase tab manager + My Case + Support Studio patches bridge → `QUICKBASE_AND_CASES_BLUEPRINT.md`
- Search Engine v2 + React Global Search surfaces → `SEARCH_BLUEPRINT.md`
- CloudAuth/Auth/Store/Realtime/Sync status foundations → `AUTH_AND_SYNC_BLUEPRINT.md`

## Mandatory usage rule
1. Before editing any feature, open the matching blueprint.
2. Implement changes.
3. Update that same blueprint in the same commit.
4. If multiple features are touched, update all relevant blueprints + this index if scope changes.

## Blueprint index change log
- **2026-04-20** — Added complete feature blueprint index covering core app features outside Services and Support Studio.
