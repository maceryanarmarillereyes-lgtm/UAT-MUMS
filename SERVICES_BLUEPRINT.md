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

### H) Conditional Formatting (per column)
- Rules stored in `column_defs[n].conditionalRules[]` — persisted via `servicesDB.updateColumns()`.
- Five format types: Single Color, Color Scale, Data Bar, Icon Set, Custom Formula.
- Single Color operators: text (contains/not contains/starts/ends/eq/neq/empty/not_empty), number (eq/neq/gt/gte/lt/lte/between/not_between), date (today/tomorrow/yesterday/past week/past month/before/after/exact), duplicate/unique.
- Color Scale: 3-stop (min/mid/max) color interpolation across numeric column values.
- Data Bar: proportional bar fill overlay with configurable bar color.
- Icon Set: 6 presets (Traffic Lights, Arrows, Stars, Check Marks, Flags, Numbers) applied by value percentile.
- Custom Formula: JS-expression evaluator using VALUE and ROW variables.
- Style options: background color (palette + custom hex), text color (palette + custom hex), bold, italic, strikethrough, underline.
- Rule priority: first matching rule wins (for single_color/formula/icon/data_bar). Color scale applies independently.
- `paintGrid()` fires after every `render()` via a one-time hook on `window.servicesGrid.load` and `.render`.
- Modal: `#svcCfModal` — enterprise 2-pane layout (rule list left, editor right). CSS scoped to `.svc-cf-*` / `.cf-rule-*`.

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
- `public/js/services-conditional-format.js`
  - Conditional Formatting engine. Modal build, rule CRUD, evaluation engine, `paintGrid()` painter.
  - Exposes `window.svcConditionalFormat = { open, paint, close }`.

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

- **2026-04-21 (Emergency rollback — restore working Services grid path):**
  - **Edit — `public/js/services-grid.js`:** Removed render-level `try/catch` wrapper fallback and restored direct render flow.
  - **Edit — `public/js/services-grid.js`:** Removed status-based row `data-cf-row` assignment block in `render()` and reverted input creation to avoid assigning readonly `input.list` via `Object.assign`; datalist binding now uses `setAttribute('list', listId)` only.
  - **Edit — `public/js/services-grid.js`:** Removed experimental `autoFitColumns()` function and startup timeout call; removed temporary backup button injection block and ad-hoc right-click column menu block.
  - **Edit — `public/css/services.css`:** Rolled back experimental Services styling for `tr[data-cf-row]`, premium row-number overrides, and duplicated premium toast block to restore prior stable stylesheet behavior.
  - **Behavior contract update:** Grid render path is back to the prior stable baseline with only non-breaking date placeholder handling retained for date inputs.

- **2026-04-21 (Hotfix — ES5-safe render recovery for blank Services grid):**
  - **Edit — `public/js/services-grid.js`:** Replaced optional-chaining/modern string-method status-row formatter with ES5-safe loops + `indexOf` checks and explicit `setAttribute('data-cf-row', ...)` writes to prevent parser/runtime failures in older execution contexts.
  - **Edit — `public/js/services-grid.js`:** Wrapped `render()` body in top-level `try/catch` so render exceptions fail into an inline visible error row (`#svcGrid`) instead of blank-grid silent failure.
  - **Edit — `public/js/services-grid.js`:** Hardened deferred auto-fit bootstrap call with guarded `setTimeout(function(){...},1200)` + `typeof autoFitColumns` check and warning-only catch path.
  - **Edit — `public/js/services-grid.js`:** Temporarily disabled toolbar backup button click binding (`btn.onclick = createBackup`) for isolation while triaging grid stability.
  - **Behavior contract update:** Services grid now fails safe under render/autofit errors and remains compatible with ES5-only runtimes without changing auth/realtime/data contracts.

- **2026-04-21 (Regression fix — sheet data visibility after Update):**
  - **Edit — `public/js/services-grid.js`:** Hardened `autoFitColumns()` so it only processes valid visible columns and persists widths only for explicit/manual calls.
  - **Edit — `public/js/services-grid.js`:** Replaced global startup `setTimeout(autoFitColumns, 800)` with a sheet-scoped timer inside `load(sheet)` that runs `autoFitColumns({ persist:false })`, preventing unintended early metadata writes.
  - **Behavior contract update:** Initial auto-fit is now non-destructive (local render-only). DB `column_defs` writes happen only when user explicitly triggers autofit action.

- **2026-04-21 (Premium UI + backup utilities pass):**
  - **Edit — `public/css/services.css`:** Stabilized grid row backgrounds and row-level conditional highlights via `tr[data-cf-row]` attributes, upgraded row-number rail styling to premium sticky design, and appended new premium toast visuals (`.svc-toast-container`, `.svc-toast*`).
  - **Edit — `public/js/services-grid.js`:** Added status-based `tr.dataset.cfRow` mapping at render time, date-input placeholder/empty styling (`---`), column auto-fit utility with Supabase persistence, backup creation flow + toolbar button, right-click column menu for hide/auto-fit actions, and enhanced success save toast copy with timestamp.
  - **Edit — `public/js/services-import.js`:** Replaced toast renderer implementation with reusable premium toast runtime (dynamic container, icon/color map, animated slide-in/out behavior) while keeping `pulse()` sync chip helper intact.
  - **New — `supabase/migrations/20260421_backup_history.sql`:** Added `services_backups` table, index, RLS enablement, and owner policy for backup snapshot history.
  - **Behavior contract update:** Services grid now applies status highlighting deterministically per-row data, supports one-click backup snapshots, and exposes context-menu column hiding/autofit without altering auth/realtime contracts.

- **2026-04-21 (Instant case detail + smart sync + 5-min edge cache):**
  - **Edit — `functions/api/quickbase/bulk-lookup.js`:** Replaced handler with dual-method endpoint: `GET ?case=` now serves single-case detail payload with 5-minute edge cache (`caches.default`) and optional `fresh=1` bypass; `POST` bulk path keeps 5-minute hashable cache and supports `checkOnly` probes for low-cost sync checks.
  - **Edit — `public/js/services-qb-lookup.js`:** Added `_detailCache` memory store and `getCaseDetailInstant(caseNum)` flow (memory-first, then edge cache GET fallback). `refreshAllLinkedColumns()` now hydrates `_detailCache` so detail modal opens instantly after bulk refresh. Added `startSmartSync()` / `stopSmartSync()` 15-minute hash probe loop using `checkOnly` to refresh only on data change.
  - **Edit — `public/js/services-grid.js`:** Case detail modal flow now paints cached detail immediately and performs background refresh (`fresh=1`) when cache is stale (>60s). Sheet load/update lifecycle now starts smart sync and clear flow stops it.
  - **Behavior contract update:** Case-detail UX is now cache-first/non-blocking while preserving existing modal structure and linked-column update behavior.

- **2026-04-21 (refreshAllLinkedColumns hard rewrite to true bulk path):**
  - **Edit — `public/js/services-qb-lookup.js`:** Replaced `refreshAllLinkedColumns()` implementation with async single-pass bulk pipeline: collect unique case numbers, auto-detect linked field IDs, call `POST /api/quickbase/bulk-lookup` once, stage changed rows only, run one `services_rows` upsert, and repaint linked inputs once.
  - **Edit — `functions/api/quickbase/bulk-lookup.js`:** Request parse now starts with `const { cases = [], fieldIds = [3,25,13] } = await request.json();` and query select uses normalized dynamic field IDs to support caller-provided linked-column sets.
  - **Behavior contract update:** Removed per-row persistence behavior from `refreshAllLinkedColumns()` path (no queued row persistence within refresh), keeping update latency bounded for large sheets.

- **2026-04-21 (Services QB Update bulk-write optimization):**
  - **Edit — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns()` now calls `POST /api/studio/qb_bulk` once, maps returned `{ caseNumber: { fieldId: value } }` payload into linked columns, and performs one Supabase bulk upsert (`services_rows` onConflict `id`) instead of per-row writes.
  - **Edit — `server/routes/studio/qb_bulk.js`:** Added POST support with request shape `{ sheetId, caseFieldId, fields }`, retained auth via `getUserFromJwt`, still uses Studio settings via `readStudioQbSettings(user.id)` (no env token), calls Quickbase reports endpoint with `top=1000`, and returns case map optimized for Services bulk update.
  - **Edit — `functions/api/[[path]].js`:** Added Cloudflare `/api/*` router mapping for `studio/qb_bulk` to keep Vercel and Cloudflare route tables in sync.
  - **Behavior contract update:** Services Update button path is now single-QB-fetch + single-DB-upsert pipeline for large sheets (~520 rows), with existing UI/UX intact.

- **2026-04-21 (Treeview Folder Update performance parity):**
  - **Edit — `public/js/services-treeview.js`:** Reworked folder update action to call `svcQbLookup.refreshAllLinkedColumns()` on a folder-only state slice, removing old `autofillLinkedColumns + waitIdle + servicesDB.saveRows` sequence. This preserves folder isolation and inherits the same fast bulk pipeline used by sheet-level Update.
  - **Edit — `public/js/services-qb-lookup.js`:** Sheet-level refresh now writes through `servicesDB.bulkUpsertRows(sheetId, rows)` (single bulk write) using `{ row_index, data }` payload, avoiding direct `window.supabase.from(...).upsert(...)` call.
  - **Edit — `server/routes/studio/qb_bulk.js`:** Split cache key by method (`GET` vs `POST`) to avoid response-shape collisions and keep POST map output deterministic.

- **2026-04-21 (Dynamic QB field detection for linked columns):**
  - **Edit — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns()` now auto-detects all linked Quickbase field IDs (`fieldIds`) and sends them to `/api/studio/qb_bulk` with `caseNumbers` and typed `fields` metadata. Also added schema cache-buster hooks (`_qbSchemaCache = null` and localStorage `qb_field_cache` clear) during refresh.
  - **Edit — `server/routes/studio/qb_bulk.js`:** POST mode now queries `https://api.quickbase.com/v1/records/query` using dynamic `select` from request `fieldIds`, optional case-number where clause, and returns `{ caseNum: { fieldId: value } }` map for unlimited linked columns.

- **2026-04-20** — Initial blueprint created. Added mandatory update protocol, feature inventory, logic contracts, file-location mapping, API/DB mapping, and dual-platform checklist.

- **2026-04-21** — Services Lookup + Case Detail Modal overhaul (all MACE CLEARED):
  - **Fix 1 — Server cache bust on Update:** `server/routes/studio/qb_data.js` now accepts `?bust=1` to bypass `BATCH_CACHE` on Update button click. Forces fresh QB data without affecting normal load-time caching.
  - **Fix 2 — Force-refresh rowNeedsLookup:** `services-qb-lookup.js` clears `_rowCaseSeen` when `refreshCache:true` so Update button re-fetches ALL rows, including rows that already had values painted.
  - **Fix 3 — Parallel batch pipeline (1-2s load):** Replaced sequential `chunks.reduce()` with parallel pipeline (`MAX_CONCURRENT=3`). Extracted `_processOneChunk()`. Added `_urgentMode` flag that drops rate gate from 200ms → 50ms during Update. Result: 520 rows in ~4 parallel rounds × ~400ms QB latency = 1.6s vs 5–8s before.
  - **Fix 4 — Row number click → Case Detail Modal:** Added `_initSvcCaseDetailModal()` IIFE in `services-grid.js`. LEFT-click on any row number opens a self-contained case detail overlay (`#svcCaseDetailModal` in `services.html`). Calls `svcQbLookup.lookupCase()` → cache-first, then QB fetch. Shows KB field groups (Assignment, Classification, Notes, Latest Update, Extra Fields) matching the my_quickbase deep-search case view design. Full CSS added to `services.css` under `svc-qbcd-*` scope.
  - **Files changed:** `server/routes/studio/qb_data.js`, `public/js/services-qb-lookup.js`, `public/js/services-grid.js`, `public/services.html`, `public/css/services.css`.

- **2026-04-21 (CF)** — Conditional Formatting engine implemented (MACE CLEARED):
  - **New File — `public/js/services-conditional-format.js`:** Complete Google Sheets-accurate CF engine. Supports: Single Color (text/number/date/duplicate operators), Color Scale (3-stop gradient), Data Bar (bar fill overlay), Icon Set (6 presets), Custom Formula (JS-expression evaluator). Rules persisted in `column_defs[n].conditionalRules[]` via `servicesDB.updateColumns()`. `paintGrid()` is called after every `render()` via hook. Modal scoped to `#svcCfModal` / `.svc-cf-*` / `.cf-rule-*` — zero conflict with existing DOM.
  - **Edit — `public/js/services-grid.js`:** Replaced `alert('Conditional Formatting — coming soon.')` with `window.svcConditionalFormat.open(colIdx, key, label, existingRules)` call.
  - **Edit — `public/services.html`:** Added `services-conditional-format.js` to boot chain (loads after treeview, before services.js).
  - **Edit — `public/css/services.css`:** Appended `CONDITIONAL FORMATTING — Enterprise UI v1.0` block (~350 lines). Scoped to `#svcCfModal`, `.svc-cf-*`, `.cf-rule-*`. Zero override of existing rules.


- **2026-04-21 (P3 — Treeview + Refresh + Case Detail v2):** All MACE CLEARED.

  ### Bug Fixes

  **BUG FIX 1 — TreeView Active State Never Highlighted (Triple Mismatch)**
  - ROOT CAUSE: `onSheetOpened()` sets `_activeFolderId = '__main__'`. But `renderTree` checked for `_activeFolderId === null` and `allNode.dataset.folderId = '__all__'`. Triple key mismatch → "All Records" node never highlighted after sheet switch.
  - FIX (`services-treeview.js`):
    - `allNode.dataset.folderId` changed from `'__all__'` → `'__main__'` (unified key).
    - renderTree active check: now `_activeFolderId === null || _activeFolderId === '__main__'`.
    - `onSheetOpened` querySelector: now targets `'__main__'` (matches unified folderId).

  **BUG FIX 2 — Folder Conditions Not Auto-Applying on Sheet Open**
  - ROOT CAUSE: `applyGridFilter('__main__')` runs before `loadFolders()` completes. Grid renders with no matchers → main filter = show all rows → folder sorting never applied.
  - FIX (`services-treeview.js`): `loadAndRender()` now calls `applyGridFilter('__main__', sheetId)` AFTER `loadFolders()` resolves, so matchers are built with real folder conditions.

  ### New Features

  **FEATURE 1 — Refresh Button**
  - Added `⟳ Refresh` button (`#svcRefreshBtn`) in toolbar, right of Update.
  - Keyboard shortcut: `Ctrl+Shift+R`.
  - Behavior: reloads sheet list (`servicesSheetManager.refresh()`) + reloads active sheet rows (`servicesApp.openSheet()`) + refreshes treeview counts.
  - CSS: `.svc-refresh-btn` — cyan tinted, matches toolbar aesthetic.
  - Files: `services.html` (button), `services-grid.js` (handler), `services.css` (styles).

  **FEATURE 2 — Per-Folder Isolated QB Update Button**
  - Each folder node now shows a `⟳` icon button (`.svc-tv-folder-update-btn`), visible on hover/active.
  - Clicking it calls `runFolderUpdate(folder, sheetId, btn)` — updates QB lookup ONLY for rows matching that folder's condition.
  - Saves only folder rows to Supabase. Main sheet rows are NEVER touched.
  - Prevents accidental mass-save across the full 520-row sheet when only a subset needs update.
  - Files: `services-treeview.js` (button + `runFolderUpdate()`), `services.css` (styles).

  **FEATURE 3 — Case Detail Modal v2 (Premium Enterprise Layout)**
  - Removed: `svc-qbcd-row-badge` (redundant Case# circle badge top-left). Case# now only in Hero.
  - Removed: `svc-qbcd-header`, `svc-qbcd-status-bar`, `svc-qbcd-accent-bar` (replaced by Hero).
  - Added: `svc-qbcd-hero` — full-width gradient hero with eyebrow, large Case# (JetBrains Mono), description, inline status badge.
  - Case Notes promoted to #1 in body flow: full-width `svc-qbcd-notes-primary` with purple glow dot, large readable text (13.5px, 1.75 line-height), 320px max scroll.
  - Latest Update: full-width below Case Notes, cyan tinted (`svc-qbcd-update-primary`).
  - KPI tiles: order unchanged (Case Age, Last Updated, Type, End User).
  - Assignment + Classification: 2-column blocks unchanged.
  - Additional Fields: unchanged at bottom.
  - All DOM IDs preserved (`svcQbcdCaseId`, `svcQbcdNotes`, `svcQbcdLatest`, etc.) — zero JS changes needed.
  - Files: `services.html` (modal HTML), `services.css` (hero + notes styles appended).

  ### Logic Contracts Updated

  - **Folder filter contract (updated):** `All Records` node uses `folderId = '__main__'` (was `__all__`). Active check is `_activeFolderId === null || _activeFolderId === '__main__'`.
  - **Per-folder update contract (new):** Folder update ONLY touches rows matching folder condition. Main sheet state is not modified.


- **2026-04-21 (Bulk QB Lookup via Cloudflare Function):** MACE-cleared performance fix for Services Workspace Quickbase update path.
  - **New endpoint — `functions/api/quickbase/bulk-lookup.js`:** Added POST bulk query endpoint that deduplicates case numbers, chunks by 100, runs parallel Quickbase `records/query` calls, and returns field map for Case # (`3`) → status (`25`) + assigned/tracking (`13`).
  - **New client script — `js/services-lookup.js`:** Added bulk lookup button interceptor, 60-second localStorage cache (`qb_last_lookup`), and table paint function to update status/tracking columns in-place.
  - **Entry wiring — `index.html`:** Added `<script src="/js/services-lookup.js"></script>` before `</body>`.
  - **Files changed:** `functions/api/quickbase/bulk-lookup.js`, `js/services-lookup.js`, `index.html`.

- **2026-04-21 (QB dynamic fields + bulk save hardening):** MACE-cleared Services QB lookup reliability update.
  - **Update — `functions/api/quickbase/bulk-lookup.js`:** Endpoint now accepts request body `{ cases, fieldIds }`, validates `fieldIds`, and sends dynamic Quickbase `select` fields instead of fixed `[3,25,13]`.
  - **Update — `public/js/services-qb-lookup.js`:** `_bulkFetchAll(allNks, linkedCols)` now computes linked `fieldIds` dynamically and posts them to `/api/quickbase/bulk-lookup`.
  - **Update — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns` now calls `_bulkFetchAll(allNks, linkedCols)`, paints all linked cells from the fetched field map, and performs one Supabase `upsert(..., { onConflict: 'id' })` bulk write for all affected rows.
  - **Files changed:** `functions/api/quickbase/bulk-lookup.js`, `public/js/services-qb-lookup.js`, `SERVICES_BLUEPRINT.md`.
  - **Patch — `functions/api/quickbase/bulk-lookup.js`:** Added QB object-value normalization (`name/email/display`) so User/List-User fields no longer surface as `[object Object]` in linked columns.
  - **Patch — `public/js/services-qb-lookup.js`:** Removed per-row `queuePersistRow()` calls during lookup paint and enforced one bulk `services_rows` upsert payload with `sheet_id`, `row_index`, `data`, and `updated_at`.
  - **Patch — `public/js/services-qb-lookup.js`:** UI paint now normalizes object values (`name/email`) before assigning `inp.value`, preventing `[object Object]` in grid cells.
