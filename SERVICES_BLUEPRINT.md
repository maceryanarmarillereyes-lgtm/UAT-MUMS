# Services Page Blueprint (AI Editing Guide)

> **Scope:** `public/services.html`, `public/css/services.css`, `public/js/services*.js`, Services-related API endpoints, and Services DB schema.
>
> **MANDATORY RULE:** Any change related to Services page behavior, data, integration, performance, or UI must include an update to this blueprint in the same commit/PR.

---

## 1) Purpose and Architecture

The Services workspace is a spreadsheet-style module for authenticated users, backed by Supabase tables and realtime sync. It is loaded as a static page (`/services.html`) with modular JS loaded in strict order.

### Runtime flow (high-level)

1. `public/services.html` loads Supabase SDK + `env_runtime.js`.
2. It waits for `window.MUMS_ENV` (timeout fallback), then loads Services modules in strict chain.
3. `public/js/services.js` calls `servicesDB.init()` to attach MUMS session to Supabase client.
4. On auth success, sheet list is loaded, then selected sheet grid + realtime subscription starts.

---

## 2) Core Feature Inventory

### A) Workspace shell
- 3-column layout: left (sheets), center (grid), right (dashboard).
- Auth banner + sync chip + user chip.
- Keyboard shortcuts: `Ctrl/Cmd+N` new sheet, `Ctrl/Cmd+K` search sheet.
- Right panel collapse state persisted in localStorage (`svc.rightCollapsed`).

### B) Sheet management
- Create, rename, archive-delete sheets.
- Left list search filtering.
- Sheet item context menu (custom modal/menu; no browser prompt/confirm).

### C) Grid and cell engine
- Dynamic columns from `column_defs` JSON.
- Row/cell editing and autosave behavior.
- Undo/redo controls.
- CSV export and force-save bulk upsert.
- Column sanitization self-heal (`sanitizeHeaderLabel`) then persisted.

### D) Treeview folders (per sheet)
- Folder definitions stored in `services_treeview_folders`.
- Per-folder condition filter operators (`eq`, `neq`, `contains`, `starts`, `ends`, `empty`, `notempty`).
- “All Records” virtual node is computed (not stored).
- Folder counts and sheet-level “main” counts.

### E) Quickbase lookup integration
- QB field picker (`/api/studio/qb_fields`).
- Batch data fetch (`/api/studio/qb_data?recordIds=...`) with fallback to `/api/studio/qb_search`.
- In-flight dedupe, safe not-found caching, rate gate.
- Auto-paint linked QB values into grid.

### F) Import and toasts
- XLSX/CSV import with mapping preview.
- Append/overwrite modes.
- Batch upsert write path.
- Global toast + subtle sync pulse helper.

### G) Dashboard widgets
- Rows, columns, fill %, updated time.
- Recent row activity list.

---

## 3) File-by-File Mapping

## Frontend entry and orchestration
- `public/services.html`
  - Services DOM shell, script load order, auth banner, boot wait-for-env logic.
- `public/js/services.js`
  - App orchestrator, sync chip states, keyboard shortcuts, right-panel collapse, boot sequence.

## Frontend data adapter
- `public/js/services-supabase.js`
  - Reads MUMS session (`mums_supabase_session`), builds singleton Supabase client, exposes `window.servicesDB`.
  - CRUD methods: sheets, rows, columns, tree folders.
  - Realtime subscribe/unsubscribe guards, cleanup on unload.
  - Additive `bulkUpsertRows` helper.

## Frontend feature modules
- `public/js/services-sheet-manager.js`
  - Left sheet list render/search, sheet create/rename/delete modals, tree container per sheet.
- `public/js/services-grid.js`
  - Grid render, cell handlers, header/row context menu, save/update flow, tree filter handoff, QB paint call.
- `public/js/services-treeview.js`
  - Folder cache/load/render, folder conditions, folder context menu + modals, filter application.
- `public/js/services-qb-lookup.js`
  - QB link picker + batch/fallback data retrieval + linked value autofill.
- `public/js/services-import.js`
  - Toast system + import modal pipeline (xlsx/csv parse, map, preview, bulk write).
- `public/js/services-dashboard.js`
  - Right sidebar KPI/activity widgets.

## Styling
- `public/css/services.css`
  - Full Services-specific visual styles (layout, modals, table, widgets, context menus, import UI, treeview).

## Backend API routes used by Services
- Router registrations (must stay dual-platform in sync):
  - `api/handler.js` (Vercel `/api/*`)
  - `functions/api/[[path]].js` (Cloudflare `/api/*` compatibility)
- Services-dependent Studio QB endpoints:
  - `server/routes/studio/qb_fields.js`
  - `server/routes/studio/qb_data.js`
  - `server/routes/studio/qb_search.js`

## Database / schema
- `supabase/migrations/20260420_services_schema.sql`
  - `services_sheets`, `services_rows`, RLS policies, realtime publication, unique `(sheet_id,row_index)`.
- `supabase/migrations/20260421_services_treeview.sql`
  - `services_treeview_folders` schema, policies, realtime publication.
- `supabase/migrations/20260420_02_services_treeview_repair.sql`
  - Repair/idempotent creation for `services_treeview_folders`.

---

## 4) Logic Contracts (Do-Not-Break)

1. **Boot order contract**
   - `servicesDB.init()` must complete before any DB CRUD/list calls.
2. **Session source contract**
   - Session key remains `mums_supabase_session` from local/session/cookie fallback.
3. **Realtime contract**
   - Keep singleton channel behavior to avoid subscription leaks.
4. **Upsert contract**
   - Row writes rely on `ON CONFLICT(sheet_id,row_index)`; DB uniqueness must remain.
5. **Folder filter contract**
   - `All Records` is computed exclusion of all explicit folder matchers.
6. **QB fallback contract**
   - Batch path is primary; qb_search fallback only for transient/miss-safe conditions.
7. **No blank-screen resilience**
   - Rendering must tolerate missing data with safe fallbacks.

---

## 5) Dual-Platform Mapping Checklist (Backend Changes)

If you add/modify any Services-related endpoint:

- [ ] Update Vercel router mapping in `api/handler.js`.
- [ ] Update Cloudflare router mapping in `functions/api/[[path]].js`.
- [ ] If adding `/functions/*` endpoint, sync `public/_routes.json`.
- [ ] Prefer logic in `server/routes` / `server/lib` then thin adapters.

---

## 6) Mandatory Update Protocol (Non-Skippable)

## Rule
**Any commit that changes Services scope files MUST update this blueprint in the same commit.**

## Required updates inside this blueprint
At minimum, update the following:

1. **"Blueprint Change Log"** section below (date, what changed, files touched).
2. The relevant section(s): feature inventory, file mapping, logic contracts, or checklist.
3. If behavior changed, include the new expected flow in plain language.

## PR / Commit gate text (copy into PR description)
```md
- [ ] I updated `SERVICES_BLUEPRINT.md` to reflect all Services-related changes in this PR.
- [ ] I verified the file/route/schema mapping is still accurate.
```

## AI Agent reminder rule
Before editing any Services file, the agent must:
1. Read `SERVICES_BLUEPRINT.md` first.
2. Implement change.
3. Update `SERVICES_BLUEPRINT.md` before commit.

If step #3 is missing, task is incomplete.

---

## 7) Blueprint Change Log

- **2026-04-20** — Initial blueprint created. Added mandatory update protocol, feature inventory, logic contracts, file-location mapping, API/DB mapping, and dual-platform checklist.

