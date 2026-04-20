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
- [ ] Assignment action still updates state + API.
- [ ] Override state behaves correctly after reload.
- [ ] No regression on member fallback schedule/task visibility.

## Change log
- **2026-04-20** — Initial mailbox blueprint created.
