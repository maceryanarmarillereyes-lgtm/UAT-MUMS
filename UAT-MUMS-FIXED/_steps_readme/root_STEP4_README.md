# Step 4 – Optimize Login Screen Performance (optimize_login_performance.zip)

## Goals
1) Reduce delay before the dashboard becomes interactive after login / refresh.
2) Avoid presence polling competing with initial session + profile hydration.
3) Prevent flicker and errors when `mums_profiles` schema is behind (optional columns missing).
4) Improve presence heartbeat reliability (best‑effort retry on transient failures).

## What changed

### Client
- `public/js/auth.js`
  - Adds a global hydration barrier: `window.__MUMS_SESSION_HYDRATED`.
  - Resolves it when `Auth.requireUser()` successfully returns a user (meaning profile + Store hydration has completed).

- `public/js/presence_client.js`
  - Waits for `window.__MUMS_SESSION_HYDRATED` (with a timeout fallback) before starting presence polling.
  - Yields the first heartbeat/list call by 500ms so first paint and routing are not blocked.
  - Adds in‑flight guards so heartbeat/list requests cannot overlap.

### Server
- `server/routes/presence/list.js`
  - De‑duplicates presence rows by `user_id` as before, but now profile overrides are schema‑tolerant:
    progressively retries profile selects if optional columns (`team_override`, `avatar_url`) do not exist.
  - Normalizes the "Developer Access" team value to `NULL` for SUPER roles when `team_override` is absent, preventing role/team flicker on older schemas.

- `server/routes/presence/heartbeat.js`
  - Adds schema‑tolerant profile updates via `safeProfileUpdate()` (drops `team_override` if the column does not exist).
  - Normalizes the "Developer Access" team value to `NULL` when forming the presence record.
  - Retries the presence upsert once on 5xx errors to improve reliability.

## Deploy / Apply
1) Copy the files into your repo at the same paths (overwrite).
2) Deploy to Vercel.
3) Hard refresh the browser (or clear cache) after deploy.

## Notes
- This patch is compatible whether or not Step 1 (team_override migration) has been applied.
- If Step 1 is applied, presence will still honor `team_override` as intended.
