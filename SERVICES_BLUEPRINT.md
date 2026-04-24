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
- Row number lane (`__rownum__`) is hard-locked to `49px`; auto-fit must never mutate this lane (auto-fit applies to data columns only).
- Legacy synthetic row-number defs/width entries (`rownum`, `__rownum__`) are sanitized out on load/state-save to prevent ghost wide `#` columns after migrations.

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

- **2026-04-24 (Services `#` column single-source width lock cleanup):**
  - **Edit — `public/js/services-grid.js`:** Removed legacy row-number style injectors `enforceRowNumStyle()` and `applyRowNumStyleSheet()` to eliminate conflicting width enforcement paths.
  - **Edit — `public/js/services-grid.js`:** Removed post-load `setTimeout(enforceRowNumStyle, 50)` and replaced end-of-`render()` force-style call with a single `computeRowNumWidth(totalRowsForWidth)` -> `ROW_NUM_COL_WIDTH_PX` -> `--row-num-w` assignment.
  - **Edit — `public/js/services-grid.js`:** Kept `col[data-key="__rownum__"]` as the only row-number selector path for row-number cell locking in `_applyColumnWidths()`.
  - **Behavior contract update:** Row-number width now has one source of truth (render-time computed width + lock helper), reducing race conditions without auth/realtime/API/router changes.

- **2026-04-24 (Bulletproof `#` width style injection + render-block bypass):**
  - **Edit — `public/js/services-grid.js`:** Updated `computeRowNumWidth(totalRows)` to return numeric pixel value only (`36..72` clamp) and converted to px string at render usage sites.
  - **Edit — `public/js/services-grid.js`:** Added global `enforceRowNumStyle()` that re-injects `#rownum-force-style` on each call, hard-locking `#svcGrid` fixed layout and row-number `col/th/td` widths with `!important`.
  - **Edit — `public/js/services-grid.js`:** Added post-load safety hook (`setTimeout(enforceRowNumStyle, 50)`) immediately after `[LOAD] Loaded ... rows` log to apply row-number width even when render is blocked by loader/resizing guards.
  - **Edit — `public/js/services-grid.js`:** Removed prior inline `svcTable.style.tableLayout/width` render block and moved enforcement to style injection path to avoid drift across rerenders.
  - **Behavior contract update:** Row-number lane width is now force-applied globally after load and after each successful render, without auth/realtime/API/router changes.

- **2026-04-24 (Final row-number `#` fixed-layout enforcement and debug cleanup):**
  - **Edit — `public/js/services-grid.js`:** Enforced `#svcGrid` fixed layout at render start (`table-layout: fixed`, `width: max-content`) before `colgroup` build so column widths are consistently respected.
  - **Edit — `public/js/services-grid.js`:** Hardened row-number `col` + `th` width locks using inline `setProperty(..., 'important')` for width/min-width/max-width and kept HTML `width` attribute numeric sync.
  - **Edit — `public/js/services-grid.js`:** Kept `computeRowNumWidth(totalRows)` formula at `digits * 9 + 22` (clamped `36px–72px`) for correct 3-digit sizing (e.g., 521 rows -> `49px`).
  - **Edit — `public/js/services-grid.js`:** Removed temporary `[ROWNUM-DEBUG]` console probes and delayed DOM debug snapshot block.
  - **Behavior contract update:** Services row-number lane is now fixed-width stable under rerender/filter/sort flows with no auth, realtime, API, or CSS contract changes.

- **2026-04-23 (Temporary debug probe for `#` row-number width path):**
  - **Edit — `public/js/services-grid.js`:** Added `[ROWNUM-DEBUG]` console probes in `computeRowNumWidth(totalRows)`, `render()`, `lockRowNumWidth(th)`, colgroup width application, and a delayed final DOM snapshot check.
  - **Behavior contract update:** No auth/realtime/data/CSS logic changes; this update is diagnostics-only to trace width computation, CSS variable propagation, colgroup width attribute/style, and post-render measured widths.

- **2026-04-23 (Permanent `#` row-number auto-fit clamp refinement):**
  - **Edit — `public/js/services-grid.js`:** Replaced row-number width calculator with `computeRowNumWidth(totalRows)` using `digits * 9 + 22`, clamped to `36px–72px`, and recalculated width in `render()` before `colgroup` creation.
  - **Edit — `public/js/services-grid.js`:** `render()` now sets global `ROW_NUM_COL_WIDTH_PX` and pushes `--row-num-w` to document scope, while `rowNumCol` keeps width/min/max + HTML `width` attribute aligned to that computed value.
  - **Edit — `public/js/services-grid.js`:** `lockRowNumWidth(th)` now hard-applies width/min/max to the passed header/cell first, then syncs grid CSS variable to prevent drift during rerenders/resizes.
  - **Behavior contract update:** Services `#` column auto-fits based on row-count digit length with hard min/max guard, without touching auth flow, realtime channel naming, Supabase adapters, or layout structure.

- **2026-04-23 (Row-number lane colgroup hard-width sync for fixed table layout):**
  - **Edit — `public/js/services-grid.js`:** Set explicit `style.width/minWidth/maxWidth` and HTML `width` attribute on `col[data-key="__rownum__"]` using `ROW_NUM_COL_WIDTH_PX` during `render()`.
  - **Behavior contract update:** Row-number lane dynamic width now applies to both cell CSS (`--row-num-w`) and the colgroup width source used by fixed table layout, preventing oversized first-column expansion while preserving existing grid behaviors.

- **2026-04-23 (Dynamic row-number width via CSS variable):**
  - **Edit — `public/css/services.css`:** Replaced row-number lane block to enforce `width/min-width/max-width` from `--row-num-w` with `!important`, overriding generic header `min-width: 60px` without affecting non-row-number columns.
  - **Edit — `public/js/services-grid.js`:** Replaced `computeRowNumWidth()` with digit-count formula (`digitCount * 8 + 20`) and changed `lockRowNumWidth()` to set `--row-num-w` on `#svcGrid` instead of applying per-cell inline width locks.
  - **Edit — `public/js/services-grid.js`:** `render()` now calls `lockRowNumWidth()` at start so width is recalculated before building header/body rows.
  - **Behavior contract update:** Row-number (`#`) lane now auto-fits by row-count digit length (single/double/triple/quad digits) while preserving sticky alignment, row click actions, auth flow, realtime topics/channels, and existing data contracts.

- **2026-04-23 (Services row-number lane width tightened to fit content):**
  - **Edit — `public/js/services-grid.js`:** Added shared `ROW_NUM_COL_WIDTH_PX` constant (`46px`) plus `lockRowNumWidth(el)` helper that enforces `width/min/max-width` with inline `!important` on row-number `col`, `th`, and `td` nodes during render and `_applyColumnWidths()` pass.
  - **Edit — `public/css/services.css`:** Updated sticky row-number header/body lane width and `.row-header` width from `56px` to `46px` so the first column stays fit-to-number and no longer appears oversized.
  - **Behavior contract update:** Grid row-number column remains fixed-width and sticky, now with hard-lock width enforcement across rerenders/filter-row/colgroup without changing filters, auth, realtime, or data-write behavior.

- **2026-04-23 (Services sheet/tree selection visibility hierarchy refresh):**
  - **Edit — `public/css/services.css`:** Updated left sidebar sheet hover + active states to use stronger cyan active lane (`3px` left border + higher-contrast fill/text) so active sheet is immediately distinguishable.
  - **Edit — `public/css/services.css`:** Updated tree folder hover + active states to a distinct indigo active treatment separate from sheet active visuals, clarifying folder selection (`All Records`/`COMPLETED`) vs selected sheet context.
  - **Edit — `public/css/services.css`:** Added explicit badge styling for sheet/folder counts in normal vs active state and toned icon saturation defaults so the `COMPLETED` check icon no longer reads like implicit selection.
  - **Behavior contract update:** Left navigation now has three clearly separated visual states — hover, active sheet, and active folder — without changing Services data, auth, realtime, or filter contracts.

- **2026-04-23 (Services search dedupe + cross-folder search reliability + row-number width lock):**
  - **Edit — `public/services.html`:** Removed legacy duplicate toolbar search input (`#svcGlobalSearchInput`) and stale global-results container (`#svcGlobalSearchResults`), keeping a single canonical all-columns search input (`#searchAllColumns`) with explicit “all folders” placeholder text.
  - **Edit — `public/js/services-grid.js`:** Reworked toolbar search to use grid-native filter composition (`_searchAllQuery`) instead of direct DOM hide/show mutations, so search now evaluates against all sheet rows while temporarily bypassing tree-folder filters without mutating row data.
  - **Edit — `public/js/services-grid.js`:** Hardened `_applyColumnWidths()` to target only first header row cells and skip index `0` (`#` lane), permanently preventing row-number column width bleed caused by filter-row header index drift.
  - **Behavior contract update:** Services toolbar search now has one source of truth and reliably returns matches across treeview folders; row-number lane remains fixed-width regardless of column resize/auto-width operations.

- **2026-04-23 (All-columns toolbar search behavior + filter-row row-number width fix):**
  - **Edit — `public/js/services-grid.js`:** Updated filter-row corner (`th.row-num`) inline sizing to fixed `56px` width/min/max and pinned sticky-left alignment for row-number lane consistency during horizontal grid movement.
  - **Edit — `public/js/services-grid.js`:** Added `initSearchAll` end-of-module controller for `#searchAllColumns` with debounced row text search, row show/hide + highlight, Escape clear flow, and sheet-switch reset observer.
  - **Edit — `public/js/services-grid.js`:** Synced internal tree filter pointer into `window._treeFilter` inside `setTreeFilter()` so temporary search clear/restore can round-trip the prior tree-filter function.
  - **Behavior contract update:** Services now supports a lightweight toolbar all-columns search layer over rendered rows while preserving existing tree-filter API and grid data contracts.

- **2026-04-23 (Toolbar all-columns search input placeholder reintroduced):**
  - **Edit — `public/services.html`:** Added toolbar input shell `#searchAllColumns` (inline-styled container + input) in `.svc-toolbar-actions` for all-columns search entry placement after clear-filters area.
  - **Behavior contract update:** Services toolbar now exposes an additional search input control target (`#searchAllColumns`) without altering auth, realtime, or data write contracts.

- **2026-04-23 (Services grid filter/search rollback to column-filter-only):**
  - **Edit — `public/js/services-grid.js`:** Removed `searchAllFolders(query)` and deleted the Global Search Controller block (`initGlobalSearch`, result rendering, search input wiring, clear-filter toolbar button integration) from the Services grid module.
  - **Edit — `public/js/services-grid.js`:** Removed public filter/search helpers `setColumnFilter`, `setGlobalSearch`, `clearAllFilters`, and `getFilterState` from module scope and from `window.servicesGrid` exports.
  - **Edit — `public/js/services-grid.js`:** Kept `_columnFilters` state, kept the sticky filter-row creation in `render()`, and kept the render wrapper path that composes tree filter + column filters into `current.__treeFilteredRows`.
  - **Behavior contract update:** Services grid filtering now runs as tree-filter + per-column filter only; global sheet-wide search UI/controller APIs are intentionally removed.

- **2026-04-23 (Current-sheet all-folder global search panel):**
  - **Edit — `public/js/services-grid.js`:** Added `searchAllFolders(query)` that scans all rows in the active sheet (not only current tree-filter subset), annotates each hit with folder metadata, matched field/value, and preview text; exposed as `window.servicesGrid.searchAllFolders`.
  - **Edit — `public/js/services-grid.js`:** Added `initGlobalSearch()` controller for `#svcGlobalSearchInput` with debounced search, dropdown result rendering, matched-text highlighting, and click-to-jump row focus flow that clears tree filter before row reveal.
  - **Edit — `public/services.html`:** Added toolbar global-search input (`#svcGlobalSearchInput`) and anchored results panel container (`#svcGlobalSearchResults`) for all-folder within-sheet search UX.
  - **Behavior contract update:** Global search in Services now targets the active sheet across all folders and supports direct row navigation with temporary visual row/cell emphasis.

- **2026-04-23 (Services grid column filters + global search composition):**
  - **Edit — `public/js/services-grid.js`:** Added grid-local filter state (`_columnFilters`, `_globalSearch`) and upgraded the render wrapper so tree filters, per-column filters, and global search compose together into `current.__treeFilteredRows` without mutating source rows.
  - **Edit — `public/js/services-grid.js`:** Added sticky Excel-style filter row under headers with per-column inputs, active-filter indicators, public filter API (`setColumnFilter`, `setGlobalSearch`, `clearAllFilters`, `getFilterState`), search-input wiring, and toolbar clear-filters button.
  - **Edit — `public/css/services.css`:** Added scoped filter-row/input visuals and active-filter dot indicator styles.
  - **Behavior contract update:** Services grid filtering is now multi-layer (tree + column + global) with clear/reset controls while preserving existing render/state contracts.

- **2026-04-22 (Services case detail QuickBase action links):**
  - **Edit — `public/services.html`:** Extended Services case-detail modal hero with inline QuickBase **Edit/View** action buttons and added footer QuickBase ID indicator (`#svcQbcdRid`) with refreshed action button layout.
  - **Edit — `public/js/services-grid.js`:** `_openSvcCaseDetailModal(rowIndex)` now resolves QuickBase `rid` (prefers `Record ID#`, falls back to `CASE#`), populates Edit/View URLs (`/action/er` and `/action/dr`), and keeps copy-button feedback compatible with icon+label markup.
  - **Edit — `public/css/services.css`:** Added premium styles for QuickBase action buttons, footer indicator/dot, and elevated footer button variants used by the Services case-detail modal.
  - **Behavior contract update:** Opening a case detail now provides direct QuickBase Edit/View deep-links and always surfaces the active QuickBase identifier in the modal footer.

- **2026-04-22 (Cache v4 + forced loader freshness + QB DB persistence patch):**
  - **Edit — `public/js/services-supabase.js`:** `listRows(sheetId, force=false)` now supports localStorage cache version `mums_rows_${sheetId}_v4` with 30-second TTL, force-bypass path for loader, filtered DB query (`sheet_id`), ordered/limited fetch, and explicit DB error throw on fetch failure.
  - **Edit — `public/js/services.js`:** Added one-time deploy migration block that clears legacy `mums_rows_*` and `svc_*` localStorage keys, switched loader reads to forced fresh `listRows(sheet.id, true)`, persisted both `svc_lastFullRefresh` and `svc_lastFullUpdate` at loader completion, and immediately synchronized `window.updateTimer`.
  - **Edit — `public/js/services.js`:** `UpdateTimer` now resolves baseline via `getLastTimestamp()` preferring `svc_lastFullRefresh` before `svc_lastFullUpdate`, and exposes `tick()` for immediate post-loader refresh.
  - **Edit — `public/js/services-qb-lookup.js`:** Reworked `refreshAllLinkedColumns()` to batch Quickbase fetch in chunks, persist linked-column updates directly to `services_rows` via Supabase upsert (`onConflict: id`), and refresh cache key `mums_rows_${sheet.id}_v4` after successful persistence.
  - **Behavior contract update:** Initial Services boot now invalidates pre-v4 cache once, fetches fresh sheet rows on loader pass, and aligns freshness timer state with persisted timestamps immediately after QB persistence and loader completion.

- **2026-04-22 (Loader always-real refresh + freshness verification hardening):**
  - **Edit — `public/js/services.js`:** Removed startup cache-gate branch (`shouldRefreshAll`) so loader now always does live `servicesDB.listRows()` per sheet, persists per-sheet and full-refresh timestamps after successful fetches, and logs explicit loader progress for DB/QB phases.
  - **Edit — `public/js/services.js`:** Added post-ready freshness verification (`svc_lastFullUpdate` age check) and hardened `UpdateTimer` constructor to initialize from validated persisted timestamp with diagnostics.
  - **Edit — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns()` now logs enforced live-sync start, performs a pre-sync freshness/cache-bust hook (`fetchFreshQBData`), and tolerates missing `gridEl` by resolving `#svcGrid` lazily to avoid loader-path no-op.
  - **Behavior contract update:** Services boot loader now always performs real DB refresh + blocking QB sync attempt for each sheet before final ready state, with explicit freshness telemetry instead of recent-cache short-circuiting.

- **2026-04-22 (Column-state DB schema fallback hardening):**
  - **Edit — `public/js/services-grid.js`:** Added one-way fallback guard for column-state persistence (`_columnStateDbUnavailable`) so when Supabase responds that `services_sheets.column_state` is unavailable (e.g. schema lag), the app automatically switches to localStorage-only persistence and stops repeating failing DB writes.
  - **Behavior contract update:** Column width/visibility state remains fully functional via local cache even when DB column-state schema is not yet present, preventing recurring console errors while preserving grid behavior.

- **2026-04-22 (QB-blocking loader + enterprise update timer + render gate):**
  - **Edit — `public/js/services.js`:** Loader per-sheet refresh now runs blocking QB linked-column sync (`refreshAllLinkedColumns`) before marking each sheet done; sheet-level last-update timestamps are persisted, and full refresh now also stores `svc_lastFullUpdate` for timer baseline.
  - **Edit — `public/js/services.js`:** Added `UpdateTimer` runtime (HH:MM:SS counter + fresh/stale/old state classes) initialized post-boot and exposed as `window.updateTimer` for cross-module refresh/save reset hooks.
  - **Edit — `public/services.html`:** Replaced top-bar sync indicator region with composite timer + sync badge container (`#updateTimer`, `#timerValue`, `#syncBadge`).
  - **Edit — `public/css/services.css`:** Added enterprise timer and sync badge styles (`.update-timer*`, `.sync-badge`, `.sync-dot`) with pulse keyframes for stale/old visibility.
  - **Edit — `public/js/services-grid.js`:** Added loader-visible render guard to avoid double render during boot, and timer reset hooks on refresh, QB update, and save paths.
  - **Behavior contract update:** Initial Services bootstrap now waits for QB sync work per sheet before completion, while a persistent top-bar elapsed-update timer reflects data freshness and resets on save and QB Update actions only (manual Refresh no longer resets timer).

- **2026-04-22 (Blocking loader + pre-open sheet refresh gate):**
  - **Edit — `public/services.html`:** Added blocking loader shell (`#svcLoadingScreen`) and set workspace root (`#app`) to hidden by default until boot completes.
  - **Edit — `public/css/services.css`:** Added scoped blocking-loader visuals, per-sheet progress states, and loader transition styles.
  - **Edit — `public/js/services.js`:** Replaced boot init flow with staged loader pipeline (auth → sheet refresh → per-sheet row counts/cache gate → target sheet open), then reveals UI only after completion; added background QB refresh pass after initial reveal.
  - **Edit — `public/js/services-qb-lookup.js`:** Added `quickSync(sheetId)` lightweight QB token health probe used by loader-phase background checks.
  - **Behavior contract update:** Services workspace now blocks first paint until bootstrap refresh completes, reducing stale sheet exposure during startup while preserving existing auth/realtime/write contracts.

- **2026-04-22 (Column resize cross-column bleed fix):**
  - **Edit — `public/js/services-grid.js`:** Fixed `<colgroup>` mapping to match rendered grid structure exactly (`row-num` + visible columns only), eliminating width-index drift that caused non-target columns to move during resize.
  - **Edit — `public/css/services.css`:** Changed fixed-layout width lock from forced `100%` to `max-content` with `min-width:100%` so resizing one column no longer redistributes width across other columns.
  - **Behavior contract update:** Single-column resize now updates only the targeted column width while preserving horizontal scroll behavior and existing layout.

- **2026-04-22 (Resize stability hardening: colgroup + fixed layout lock):**
  - **Edit — `public/js/services-grid.js`:** Added resize safety state (`isResizing`) to pause render/realtime row paint while dragging, and prevent layout churn during active column resize.
  - **Edit — `public/js/services-grid.js`:** Render now builds a `<colgroup>` from `column_defs` + `column_widths`, and resize drag updates `colgroup col[data-key]` widths directly for stable, non-reverting column widths.
  - **Edit — `public/js/services-grid.js`:** `saveColumnState()` now caches state locally first (`localStorage`) and performs delayed DB persistence; `load()` now hydrates local column-state before DB state for faster restore.
  - **Edit — `public/css/services.css`:** Added fixed-table lock styles for `#svcGrid` and strict cell overflow controls to prevent grid break/wrap during resize.
  - **Behavior contract update:** Column resizing now prioritizes stable colgroup width control, with deferred persistence and reduced render/realtime interference while dragging.

- **2026-04-22 (Excel-style column resize + hide/unhide persistence):**
  - **Edit — `public/js/services-grid.js`:** Added Excel-style drag resize handles per header with live preview line, live `<th>/<td>` width updates, in-memory `column_widths`, and debounced persistence via `saveColumnState()`.
  - **Edit — `public/js/services-grid.js`:** Added `saveColumnState()` / `toggleColumnVisibility()` flow so hide/unhide + resize states are saved to `services_sheets.column_state` while keeping `column_defs` updates in sync.
  - **Edit — `public/js/services-grid.js`:** Sheet load now hydrates `column_state` (saved widths + hidden keys), and render now applies saved widths/visibility to headers and cells (`data-col` markers for targeted resize updates).
  - **Edit — `public/css/services.css`:** Added resize-handle styles (`.col-resize-handle`, `.resize-grip`) for hover/active grip affordance.
  - **Edit — `supabase/migrations/20260422_01_services_sheet_column_state.sql`:** Added `services_sheets.column_state` (`jsonb`) with default `{ widths: {}, hidden: [] }` + column comment.
  - **Behavior contract update:** Column widths and visibility now persist across sheet reloads and are included in manual SAVE flow.

- **2026-04-22 (Persistent duplicate alert state for CASE fields):**
  - **Edit — `public/js/services-grid.js`:** Replaced transient duplicate popup behavior with persistent duplicate bubbles (`showDuplicateBubble`) that stay visible until resolved/manual dismiss, while preserving client-only detection (no added DB/API calls).
  - **Edit — `public/js/services-grid.js`:** Added persistent cell warning state (`cell-has-duplicate`, data attributes, red border/background) and recovery logic that auto-clears bubble/styles once CASE duplicates are fixed; focus now re-shows warnings when duplicate state still exists.
  - **Edit — `public/js/services-grid.js`:** Added `beforeunload` safety prompt when unresolved duplicate CASE indicators are present.
  - **Edit — `public/css/services.css`:** Added persistent duplicate warning CSS (`.cell-has-duplicate`, pulse animations, `.dup-bubble-inner` emphasis).
  - **Behavior contract update:** Duplicate alerts now remain visible until data is corrected or user manually dismisses the bubble; duplicate detection remains in-memory and sheet-scoped.

- **2026-04-22 (Free-tier duplicate detection for CASE columns):**
  - **Edit — `public/js/services-grid.js`:** Added lightweight in-memory `DupCheck` index (single-pass `Map`, O(1) lookup, throttled rebuild window) initialized from already-loaded sheet rows, plus `clear()`/load cleanup to release memory on sheet changes.
  - **Edit — `public/js/services-grid.js`:** Added debounced duplicate checks (`300ms`) on CASE inputs (`blur` and Enter) with inline duplicate notice (`Go` jump-to-row + auto-dismiss + input/row highlight) and index refresh on edited CASE values; no additional Supabase or API requests introduced.
  - **Edit — `public/css/services.css`:** Added scoped `.dup-notice` action button and icon styling for duplicate warning UI.
  - **Behavior contract update:** Duplicate detection is client-only and operates solely on the current in-memory sheet dataset (`current.rows`), preserving existing DB/auth/realtime contracts.

- **2026-04-22 (Auto-open sheet + forced QB persistence + empty-date display hardening):**
  - **Edit — `public/js/services.js`:** Boot flow now auto-opens the persisted last sheet (`svc_lastSheetId`) after successful sheet refresh, with fallback to the first available sheet.
  - **Edit — `public/js/services-sheet-manager.js`:** `openSheet()` now persists the active sheet id to localStorage (`svc_lastSheetId`) to support restore-on-login behavior.
  - **Edit — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns()` now force-assigns linked QB values and always enqueues rows with CASE data for persistence, preventing no-diff skips from dropping writes.
  - **Edit — `public/js/services-grid.js`:** Grid load now logs row count and triggers delayed background QB refresh; render path enforces muted `---` for empty QB-linked date cells when a CASE-like id is present.

- **2026-04-22 (QB refresh write-path resilience fix):**
  - **Edit — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns()` now validates write-capable `servicesDB` methods (`bulkUpsertRows` or `upsertRow`) before processing and uses guarded persistence: bulk path when available, deterministic row-by-row fallback via `upsertRow` when bulk helper is absent.
  - **Edit — `public/js/services-supabase.js`:** `bulkUpsertRows()` now awaits `servicesDB.ready` and verifies client shape (`client.from` function) before attempting writes, preventing invalid SDK-namespace usage from surfacing as `window.supabase.from is not a function`.
  - **Verification contract:** QB refresh persistence must execute only through ready/validated `servicesDB` client paths.

- **2026-04-21 (Supabase reference hardening for Services QB/Grid):**
  - **Edit — `public/js/services-qb-lookup.js`:** `refreshAllLinkedColumns()` now hard-fails early when `window.servicesDB` is unavailable (`Database not ready`) to prevent invalid fallback paths, and bulk row persistence now uses `servicesDB.bulkUpsertRows(sheetId, [{ row_index, data }])` instead of direct `window.supabase.from('services_rows').upsert(...)`.
  - **Edit — `public/js/services-grid.js`:** Column hide/unhide persistence now routes through `window.servicesDB.updateColumns(sheetId, column_defs)` (both context-menu hide and Columns popover toggle flows), removing direct `window.supabase.from('services_sheets').update(...)` writes while preserving optimistic UI + revert-on-error behavior.
  - **Verification contract:** No direct `supabase.from('services_rows'|'services_sheets')` calls remain in Services frontend modules; persistence path is centralized in `servicesDB`.

- **2026-04-21 (QB `---` blink regression fix):**
  - **Edit — `public/js/services-qb-lookup.js`:** Introduced shared `formatLinkedCellDisplay()` + `paintLinkedInput()` helpers and reused them across both autofill paint paths (`autofillLinkedColumns` and `refreshAllLinkedColumns`) so empty QB date values consistently render as `---` with the same muted style.
  - **Edit — `public/js/services-qb-lookup.js`:** Removed direct empty-string DOM writes in cached/fallback paint path that previously overpainted `---` after a brief flash.
  - **Edit — `public/js/services-grid.js`:** Removed duplicated date pre-paint guard block that could conflict with the existing CASE/date handler and contribute to flicker.

- **2026-04-21 (QB `---` preservation + explicit `window.supabase` fix):**
  - **Edit — `public/js/services-qb-lookup.js`:** QB pending start now clears stale input values before showing `⋯`, and completion paint uses an inline date-safe formatter that preserves `---` for empty/invalid date values instead of collapsing to empty string.
  - **Edit — `public/js/services-grid.js`:** Initial grid render now immediately reapplies muted `---` styling for date columns when CASE exists but date is empty, preventing QB completion/refresh from visually erasing placeholders.
  - **Edit — `public/js/services-grid.js`:** Replaced direct `supabase.*` references with `window.supabase.*` for hide/unhide + backup paths to align with global client usage and avoid runtime reference errors.

- **2026-04-21 (QB placeholder stuck fix + empty-date paint contract):**
  - **Edit — `public/js/services-qb-lookup.js`:** Pending indicator now applies only to empty linked cells (`!inp.value`), and post-lookup paint now always clears `.cell-qb-pending` plus `inp.placeholder` before assigning linked styles.
  - **Edit — `public/js/services-qb-lookup.js`:** Linked date columns now render `---` for empty QB values with centered italic muted style, while non-empty or non-date values restore default inline styles.
  - **Verification — `public/js/services-grid.js`:** `formatCellValue()` date fallbacks remain strict `---` for empty/invalid dates (no em-dash fallback reintroduced).

- **2026-04-21 (Permanent fixes: date-case placeholder, QB visual reset, CF clear-all cleanup):**
  - **Edit — `public/js/services-grid.js`:** Replaced `formatCellValue()` with strict date fallback (`---`), removed temporary `[DEBUG-RENDER]` instrumentation, and added date render guard that shows empty when no CASE value exists but shows `---` only when CASE exists with missing date.
  - **Edit — `public/js/services-qb-lookup.js`:** Removed `[DEBUG-QB]` / `[DEBUG-SAVE]` console traces from bulk lookup/upsert path and disabled `.cell-qb-linked` class application so linked cells stay on default neutral styling.
  - **Edit — `public/css/services.css`:** Simplified `.cell-qb-linked` contract to inherit/default styles only (no cyan override restoration path).
  - **Edit — `public/js/services-conditional-format.js`:** `Clear All` now strips row-level CF data attributes/CSS vars before forcing a grid re-render, guaranteeing zebra baseline is restored instantly.
  - **Verification contract:** Column hide remains optimistic (`col.hidden = true` + immediate `render()` + background Supabase update with revert on error).

- **2026-04-21 (Audit fixes: date placeholder/QB class/upsert conflict/column unhide/row header freeze):**
  - **Edit — `public/js/services-grid.js`:** Date formatter fallback now returns `---`, removed date placeholder injection on em-dash sentinel, added `Columns` toolbar toggle popover (`#svcColumnsBtn`) to hide/unhide columns with persisted `services_sheets.column_defs`, and updated hide-column notification copy to direct users to the new Columns control.
  - **Edit — `public/js/services-conditional-format.js`:** Removed CF logic that stripped `.cell-qb-linked`, preserving QB-linked class compatibility while CF still applies inline styles.
  - **Edit — `public/js/services-qb-lookup.js`:** Bulk refresh upsert conflict key switched to `sheet_id,row_index` to match Services row uniqueness contract.
  - **Edit — `public/services.html`:** Added toolbar button `⊞ Columns` (`#svcColumnsBtn`) adjacent to backup controls.
  - **Edit — `public/css/services.css`:** Added sticky row-number header rule (`.svc-grid thead th.row-num`) and explicit QB-linked input style contract (`color: #5eead4`, italic).
  - **Behavior contract update:** Hidden columns are now recoverable from the in-grid Columns popover, and QB-linked cell class remains intact under conditional formatting paint paths.

- **2026-04-21 (Services zebra vs CF priority fix):**
  - **Edit — `public/css/services.css`:** Replaced legacy zebra striping with explicit priority stack: base zebra (`grid-row` + even rows), row-level conditional-format overrides via `tr[data-cf-applied]`/`data-cf-rule`, and enforced hover as highest priority; retained `.cell-qb-linked` as text-only styling with transparent background.
  - **Edit — `public/js/services-grid.js`:** Added `evaluateConditionalFormat(row, columns)` fallback evaluator and row render hook that writes `data-cf-applied`, `data-cf-rule`, and `--cf-bg` CSS variable on each `<tr>` when CF matches, while preserving zebra defaults when no rule matches.
  - **Behavior contract update:** Default row visuals now remain zebra unless a row-level CF match is present; hover always wins over zebra and CF.

- **2026-04-21 (Audit fixes: layout/autofit/backup/date/hide-column/notify):**
  - **Edit — `public/css/services.css`:** Consolidated row-number sticky column rules into one canonical `.svc-grid ... .row-num` block (56px fixed), aligned zebra backgrounds to `td:not(.row-num)`, and updated `.cell-qb-linked` + notification style contracts to the premium toast spec.
  - **Edit — `public/js/services-grid.js`:** Updated `formatCellValue()` date output to `YYYY-MM-DD` with em-dash fallback, upgraded `autoFitColumns()` floor/ceiling to `140..400`, changed row-number render cell/title contract, added `createBackup(name)` (snapshot payload insert to `services_backups`), made toolbar backup action call backup create flow, and added notify feedback for hide-column action.
  - **New migration — `supabase/migrations/20260421_add_backups.sql`:** Added/normalized `services_backups.snapshot` schema, ensured backup policy `users_manage_own_backups`, and index `idx_backups_sheet`.

- **2026-04-21 (Services grid UX + backup history + notify uplift):**
  - **Edit — `public/js/services-grid.js`:** Added date display formatter fallback (`---`), row-header class/data attributes, QB update row pulse, right-click column actions (hide + autofit + freeze placeholder), auto-fit width pipeline (`autoFitColumns` + `applyColumnWidths`), backup modal open/save/restore handlers, and migrated user feedback calls to `Notify.show(...)`.
  - **Edit — `public/services.html`:** Added toolbar `Backup` button + backup modal shell (`#svcBackupModal`) and included new script boot chain (`services-notify.js`, `services-backup.js`) before grid init.
  - **Edit — `public/css/services.css`:** Updated `.cell-qb-linked` visual contract to transparent bg, added zebra row backgrounds + `qbPulse` animation, premium `.row-header` style, and appended premium notification CSS blocks.
  - **New file — `public/js/services-notify.js`:** Global `window.Notify` toast utility (`show/hide/update`) with container auto-create.
  - **New file — `public/js/services-backup.js`:** Global `window.BackupManager` for Supabase backup save/list/restore on `services_backups`.
  - **New migration — `supabase/migrations/20260421_02_services_backups.sql`:** Added `services_backups` table + RLS + user-owned manage policy.
  - **Behavior contract update:** Services save/refresh/CF/treeview/import now route toast notifications through `Notify` while preserving existing sync pulse behavior.

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

- **2026-04-24 (Services # column dynamic auto-fit):** MACE-cleared UI improvement to make row number column width dynamic based on digit count.
  - **Update — `public/js/services-grid.js`:** Replaced fixed `ROW_NUM_LOCK_PX` with dynamic `computeRowNumWidth(totalRows)` that calculates width based on the number of digits in `totalRows`.
  - **Update — `public/css/services.css`:** Changed fixed 49px overrides to use `var(--row-num-w)` CSS variable, allowing the JS-calculated width to take effect while maintaining strict layout constraints.
  - **Behavior contract:** `#` column width now auto-fits to the maximum row index digits (e.g., ~36px for 1-2 digits, ~44px for 3 digits, etc.), ensuring no wasted space.
  - **Files changed:** `public/js/services-grid.js`, `public/css/services.css`, `SERVICES_BLUEPRINT.md`.


## Blueprint Change Log
- 2026-04-24: Implemented dynamic auto-fit for Services `#` column width based on row digit count.

- 2026-04-24: Added row-number migration guard to drop legacy synthetic keys (`rownum`, `__rownum__`) from `column_defs` and persisted width maps.
