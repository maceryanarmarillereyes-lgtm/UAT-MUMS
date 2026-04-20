> 🛑 SUPREME AI GUARDRAIL ACTIVE v3.0 — MACE APPROVAL REQUIRED.
> Protected domains: Enterprise UI/UX · Realtime Sync · Core State · DB/API Adapters ·
> Tab Isolation · Virtual Column State · QuickBase Settings Persistence · Auth Flow.
> Any AI touching these domains without a cleared RISK IMPACT REPORT is in violation.
> AWAITING CLEARANCE TO PROCEED FROM MACE on all guarded changes.
🛑 SUPREME AI GUARDRAIL ACTIVE v2.0: You are STRICTLY FORBIDDEN from modifying existing High Level Enterprise UI/UX layouts, CSS themes, Core System Logics, Realtime Sync behaviors (e.g., realtime.js, WebSockets), State Management isolated arrays, Database API Adapters, and Auth flow structures without explicit clearance.
PROTOCOL: If a requested feature overlaps with, alters, or risks breaking these critical domains, you MUST STOP immediately. You MUST output a "RISK IMPACT REPORT" detailing the specific files and logic conflicts. End your response strictly with "AWAITING CLEARANCE TO PROCEED FROM MACE". Do NOT output execution code until cleared.

# AGENTS.md

This repository is intentionally designed as a **Dual-Platform Architecture**.

## Deployment Roles

### Vercel = UAT
- **Purpose:** user acceptance testing / staging
- **API base path:** `/api/*`
- **Routing implementation:** single-function router at `api/handler.js` (via `vercel.json` rewrites)

### Cloudflare Pages = PROD
- **Purpose:** production
- **API base path:** `/functions/*`
- **Routing implementation:** Cloudflare Pages Functions under `functions/`.
- **Routing implementation:** Cloudflare Pages Functions under `functions/`.
- **IMPORTANT:** `public/_routes.json` controls which paths are handled by Functions.

#### Cloudflare routing note (file extensions)
Cloudflare Pages Functions map routes based on file paths, and **function file extensions are not part of the route**.
If you need a Cloudflare endpoint that *ends with an extension* (e.g. `/functions/vendor/supabase.js`), implement it
using a **dynamic segment** so the extension becomes part of the parameter value (example: `functions/functions/vendor/[file].js`).

## Rules for ALL future changes (for humans + AI agents)

1. **Any backend/API fix must be implemented for BOTH platforms.**
   - If you add or modify an endpoint, update:
     - `api/handler.js` (Vercel router table), AND
     - Cloudflare Functions (either `functions/api/[[path]].js` route table for `/api/*` back-compat, and/or a dedicated Pages Function file under `functions/` for `/functions/*`).

2. **Cloudflare Functions routing must be kept in sync with `_routes.json`.**
   - When introducing a new `/functions/*` endpoint, ensure `public/_routes.json` includes the matching route pattern.

3. **Prefer shared logic in `/server/routes` and `/server/lib`.**
   - Implement business logic once, then expose it through both platform routers.
   - Keep platform-specific files thin adapters.

4. **UI resilience standard (no blank-screen crashes).**
   - Rendering functions must not throw on missing/undefined data.
   - If a label or field is missing, render a safe fallback (`"N/A"` or empty string) instead of crashing the UI.

5. **Do NOT alter `vercel.json` structure.**
   - It must remain in the approved v4.2 structure (rewrites + `functions.maxDuration` only).

## Quick reference

- Vercel UAT endpoints live under: `/api/...`
- Cloudflare PROD endpoints live under: `/functions/...`

## Services Blueprint Enforcement (MANDATORY)

For any change related to the Services page/workspace (`public/services.html`, `public/css/services.css`, `public/js/services*.js`, Services QB endpoints, or Services DB schema), the agent **MUST**:

1. Read `SERVICES_BLUEPRINT.md` before editing.
2. Update `SERVICES_BLUEPRINT.md` in the same commit/PR.
3. Add/keep a completed checklist item in PR notes confirming the blueprint was updated.

If Services-related code changes are present but `SERVICES_BLUEPRINT.md` is not updated, the task is considered **incomplete**.

## Support Studio Blueprint Enforcement (MANDATORY)

For any change related to Support Studio (`public/support_studio.html`, `public/js/support_studio/**`, `public/js/studio_cache.js`, Support Studio `/api/studio/*` routes, or related settings/state persistence), the agent **MUST**:

1. Read `SUPPORT_STUDIO_BLUEPRINT.md` before editing.
2. Update `SUPPORT_STUDIO_BLUEPRINT.md` in the same commit/PR.
3. Include a completed PR checklist item confirming Support Studio blueprint update.

If Support Studio-related code changes are present but `SUPPORT_STUDIO_BLUEPRINT.md` is not updated, the task is **incomplete**.

## Global Feature Blueprint Protocol (MANDATORY)

For all core app features outside Services and Support Studio, use the `blueprints/FEATURE_BLUEPRINT_INDEX.md` map.

Rules:
1. Before editing a feature, open its mapped blueprint from the index.
2. Update that blueprint in the same commit if behavior, mappings, or contracts changed.
3. If a new feature is introduced, add a new blueprint and register it in `blueprints/FEATURE_BLUEPRINT_INDEX.md`.
