# Auth and Sync Blueprint

## Scope
- `public/js/cloud_auth.js`
- `public/js/auth.js`
- `public/js/store.js`
- `public/js/realtime.js`
- `public/js/sync_status_ui.js`
- `public/js/presence_client.js`
- `public/js/presence_watchdog.js`
- Backend: `api/env`, `api/sync/*`, `api/presence/*`, `api/users/me` and related adapters

## Feature intent
This layer is the platform backbone: session lifecycle, user hydration, local state consistency, realtime collaboration transport, and sync health visibility.

## Core logic map
1. **CloudAuth (session transport)**
   - Session key: `mums_supabase_session`.
   - Reads/writes localStorage + sessionStorage + cookie + memory fallback.
   - Emits auth token lifecycle events consumed by other modules.
2. **Auth facade (identity + permission context)**
   - Hydrates current user profile from Store/API.
   - Exposes `Auth.getUser()`, `Auth.requireUser()`, session barrier events.
3. **Store (state authority for client docs)**
   - Persists business documents (users, schedules, mailbox tables/state, reminders, logs, privileges).
   - Emits store updates consumed by UI pages and sync layer.
4. **Realtime sync transport**
   - Mandatory collaboration sync channel in production.
   - Handles reconnect strategy + fallback reconciliation + push/pull controls.
5. **Sync status UI**
   - Converts transport state to status chips/banners with anti-flicker hysteresis.

## Do-not-break contracts
- Keep session key name and fallback order stable.
- Do not rename realtime channel/topic names.
- Keep auth hydration barrier behavior (avoid race to pages using user profile).
- Keep Store keys stable unless full migration is shipped.
- Maintain no-blank-screen behavior on missing auth/sync env.

## Editing checklist
- [ ] Does change alter session key names/shape? If yes, provide migration.
- [ ] Does change alter realtime event channel naming? If yes, stop and clear with MACE.
- [ ] Are Store keys unchanged or migrated safely?
- [ ] Did sync status still reflect green/yellow/red accurately without flicker?

## Change log
- **2026-04-20** — Initial auth/sync blueprint created.
