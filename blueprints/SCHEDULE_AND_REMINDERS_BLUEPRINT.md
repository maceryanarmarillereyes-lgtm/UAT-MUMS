# Schedule and Reminders Blueprint

## Scope
- `public/js/pages/my_schedule.js`
- `public/js/pages/master_schedule.js`
- `public/js/pages/my_attendance.js`
- `public/js/pages/manila_calendar.js`
- `public/js/pages/my_reminders.js`
- `public/js/pages/team_reminders.js`
- Schedule-related store docs and notification keys

## Feature inventory
1. **My Schedule** — member-facing schedule cards and personal weekly view.
2. **Master Schedule** — admin/lead scheduling grid with block and lock controls.
3. **Attendance** — attendance records and status reporting.
4. **Manila Calendar** — leave/events calendar from `/api/calendar/records`.
5. **My Reminders** — user personal reminders.
6. **Team Reminders** — shared reminders, snooze/escalation settings, admin controls.

## Data contracts
- Canonical schedule docs: `mums_schedule_blocks`, `mums_schedule_snapshots`.
- Notification docs: `mums_schedule_notifs` / legacy compatibility keys.
- Reminder docs/settings: `mums_my_reminders`, `mums_team_reminders`, `mums_reminder_settings`.

## Do-not-break contracts
- Maintain Manila-time date normalization for schedule/calendar logic.
- Preserve schedule lock semantics.
- Preserve reminder escalation/snooze settings behavior.

## Change checklist
- [x] Schedule load/edit works for role scopes (validated actor-id sanitization for `/api/member/:uid/schedule` requests to prevent malformed UID fetch loops).
- [ ] Calendar endpoint auth header still applied.
- [ ] Reminder category/escalation settings still persisted.

## Change log
- **2026-04-20** — Initial schedule/reminders blueprint created.

- **2026-05-03** — Added actor-id sanitization requirement for My Schedule API calls to block malformed UID request storms and reduce Supabase/PostgREST load on free-tier projects.
