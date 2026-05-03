# Known Issues & Outstanding TODOs

> Last scanned: 2026-05-03 (UAT Audit Cleanup)

---

## Summary

A full codebase scan for `TODO`, `FIXME`, `HACK`, and `BUG` markers was performed as part of the UAT audit cleanup. The results are positive:

- **No outstanding `TODO` or `FIXME` items** were found in active source files.
- **No `HACK` markers** were found in active source files.
- All `BUG` comment occurrences in the codebase are **resolved bug-fix notes** (e.g. `// BUG FIX 2026-04-xx: ...`) documenting fixes that have already been applied.

---

## Resolved Bug History (inline in code)

The codebase contains detailed inline comments for bugs that were identified and fixed during development. These serve as audit trail notes. Key areas:

### Controller Lab (`public/js/support_studio/`)
- **BUG 1–10** documented in the controller lab module covering race conditions, stale state, double booking, queue duplicates, notify loops, timer clears, stale modal states, poll storms, override handling, and CSS injection issues. All 10 confirmed fixed.

### Search Engine v2 (`public/js/search_engine_v2.js`)
- Part-number query sort order fixed (exact match priority)
- KB JSON shared promise introduced to prevent duplicate 12MB fetches
- Multi-path QB data discovery implemented

### QuickBase My Quickbase Page (`public/js/pages/my_quickbase.js`)
- Token field save validation (empty URL guard)
- Token sentinel `__QB_TOKEN_SAVED__` prevents accidental token wipe
- Debounced reconnect on token rotation
- Server error propagation to UI

### Services Grid (`public/js/services-backup.js`, `services-grid.js`)
- Schedule block key operator corrected (`op='set'` not `'merge'`)
- Assignment-based count cache introduced as source of truth

### Realtime / Presence
- Auth readiness guard before presence subscription
- Reconnect heartbeat on WebSocket resume

---

## Open Architectural Notes (Not Bugs)

These are known design trade-offs documented for audit awareness:

| Area | Note |
|---|---|
| **Linter** | No ESLint/Prettier configured. `npm run lint` is a no-op stub. Adding a linter is recommended for future phases. |
| **No TypeScript on client** | Client-side JS is ES5-compatible vanilla for zero-build simplicity. Type safety relies on JSDoc only. |
| **`untouchables/` canonical copies** | `untouchables/members/members.js` and `enterprise_ux.css` are reference copies of MACE-locked files. They are not served directly. |
| **Google Apps Script endpoint** | `window._CTL_SHEETS_ENDPOINT` is hardcoded in `env_runtime.js`. Configurable via `CTL_SHEETS_ENDPOINT` env var in `server/routes/studio/ctl_lab_log.js`. Recommend moving the client-side default to `/api/env` output in a future release. |
| **Supabase Free Plan egress** | The free plan (5 GB/month) is tight for 30 users. The freemium guard helps, but any new realtime subscriptions or polling loops must be reviewed against the egress budget in `docs/ARCHITECTURE.md`. |
| **Migration `- Copy.sql`** | `supabase/migrations/20260217_02_phase1_task_distribution_monitoring - Copy.sql` has a space and ` - Copy` suffix in the filename. This is a legacy artefact and should be renamed/removed if confirmed as a duplicate. |

---

## Reporting New Issues

If you discover a bug or technical debt item:

1. Add a `// TODO(yourname): description` comment in the relevant file.
2. Open an issue in the repository.
3. Update this file as part of the fix PR.
