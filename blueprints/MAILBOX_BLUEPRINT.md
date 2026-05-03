# Mailbox Blueprint

## Scope
- `public/js/pages/mailbox.js`
- Store keys: `mums_mailbox_tables`, `mums_mailbox_state`, `mums_mailbox_time_override*`
- Backend routes: `api/mailbox/*`, `api/mailbox_override/*`, `api/settings/mailbox_status`

## Feature inventory
1. Mailbox table/state rendering and persistence.
2. Duty/team-aware assignment and visibility logic.
3. Time override mechanics (local/global sync behavior).
4. Case action/confirm/assign API wiring.
5. Responsive member label handling and fallback user schedule visibility.

## Logic structure
- Time and shift helper functions drive active duty overlap checks.
- UI actions write mailbox state tables and call mailbox APIs.
- Override sync path persists cloud override state for cross-device visibility.

## Do-not-break contracts
- Preserve mailbox state key structure.
- Preserve assignment action route contracts.
- Preserve duty overlap semantics and Manila-time consistency.
- Preserve override safety handling to prevent ghost active overrides.

## Change checklist
- [x] Assignment action still updates state + API.
- [x] Override state behaves correctly after reload.
- [x] No regression on member fallback schedule/task visibility.
- [x] Resync path cannot trigger repeated schedule fetch storms under realtime bursts.

## Change log
- **2026-04-20** — Initial mailbox blueprint created.
- **2026-05-02** — Stabilized roster rendering during realtime/periodic resync:
  - Kept previous `_scheduleReady` state during soft resync (`_mbxForceResync`) to prevent transient empty-state flicker.
  - Added `_scheduleRefreshing` in-flight marker so UI can show syncing state without dropping already-cached members.
  - Updated table sync-status gating to prefer cached roster visibility over temporary "no active roster members" fallback.
- **2026-05-02** — Hardened mailbox roster sync actor-id parsing:
  - Sanitized actor id extraction to keep valid UUID only (or safe token fallback) before calling `/api/member/:uid/schedule`.
  - Prevented malformed schedule endpoint URLs that triggered repeated failed fetch loops and client-side resource overload.
- **2026-05-03** — Added resync storm guardrails for mailbox schedule sync:
  - Added per-team forced-resync throttle window to collapse rapid repeated triggers.
  - Preserved server backoff cooldown during forced resync instead of clearing it.
  - Ensured in-flight sync requests are never re-triggered by realtime/state event bursts.
- **2026-05-03** — Enabled on-duty Mailbox Manager self-assignment parity in Case Action reassignment:
  - Reassignment target list now merges table members + team roster cache and includes current actor as fallback candidate.
  - Preserved owner exclusion while allowing manager to reassign an existing case to themselves when on-duty.
- **2026-05-03** — Fixed reassigned-case stale ownership record cleanup:
  - Reassign now rewrites `ums_cases` for the case+shift into a single canonical entry owned by the new assignee.
  - Prevents old owner from retaining acknowledged/reassigned case rows in Mailbox matrix-linked My Case record lists.
- **2026-05-03** — Hardened mailbox table reassignment dedupe at source:
  - Reassign action now keeps exactly one canonical assignment row per case number in `table.assignments` (canonical = current assignment id).
  - Rebuilds `table.counts` from canonical assignments to prevent matrix ghost counts/cells after reassignment + acknowledgment.
- **2026-05-03** — Added server-side missing-shift-table bootstrap for mailbox assignment:
  - `/api/mailbox/assign` now auto-creates a canonical shift table payload when `mums_mailbox_tables[shiftKey]` is missing.
  - Prevents false `Mailbox table not found` errors during first assignment on fresh shift keys (especially night shift rollover).
