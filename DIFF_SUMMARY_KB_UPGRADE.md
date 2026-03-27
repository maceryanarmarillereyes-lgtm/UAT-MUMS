# KB UPGRADE — DIFF SUMMARY
Generated: 2026-03-28

## Files Changed

### 1. server/services/quickbaseSync.js
ROOT CAUSE FIX — Multi-table sync

BEFORE: Fetched records from ONE table only (parsed from the app URL).
        Often resolved to the app-level dbid, not a table, causing 0 records.

AFTER:
  - fetchAppTables()     → GET /v1/tables?appId=<id> — lists ALL tables in the QB app
  - scoreKnowledgeTable() → weighted scorer: "troubleshoot"=+80, "instruction"=+60,
                             "education/training/course"=+40, "product"=+20, etc.
  - selectKnowledgeTables() → keeps tables with score >= 10, sorted highest-first
  - Loops each selected table → fetchTableRecords() → mapRecordToKbItem()
  - mapRecordToKbItem() now captures: doc_number, table_id, table_name
  - extractDownloadLinks() now also catches fields with "url" in the label
  - writeItems() now stores tables[] metadata alongside items[]
  - readItems() now returns tables[] in response
  - Fallback: if no tables scored >= 10, falls back to single-table mode

### 2. server/routes/studio/kb_sync.js
  - GET /api/studio/kb_sync now returns: { items, tables, count, syncedAt }
  - GET /api/studio/kb_sync?table=<id> — optional per-table filter (for future use)
  - POST /api/studio/kb_sync — triggers full multi-table sync (superadmin only, unchanged)

### 3. public/support_studio.html (3 surgical replacements)

  A) LEFT PANEL (#left-panel-knowledge_base):
     - Added: search clear button (✕)
     - Added: #kb-status, #kb-search-count meta row
     - Added: #kb-active-filter pill (shows active table filter, click ✕ to clear)
     - Added: "Document Type / Table" section with collapse toggle
     - Added: #kb-sidebar-table-list — dynamic per-table navigation (like Parts Number sidebar)
     - Unchanged: stats grid, header identity, search input

  B) CANVAS (#canvas-knowledge_base):
     - Added: #kb-record-count badge in toolbar
     - Added: Export CSV button
     - Chart area: two trend boxes with month-range labels
     - Table: split into fixed header (#kb-table-head) + scrollable body (#kb-table-body-wrap)
     - New columns: # (row num), Doc #, table_name sub-label under Name, Source (Open button)
     - Clickable sort headers with ⇅ / ↑ / ↓ indicators on all columns
     - Full pagination bar with numbered page buttons (matches Parts Number UX)

  C) KB JAVASCRIPT IIFE (full rewrite):
     - state now includes: tables[], tableFilter, sortKey, sortDir
     - applyFilters() — unified pipeline: tableFilter → search → product → family → sort
     - renderSidebar() — dynamic table list with icons + item counts per table
     - getTableIcon() — maps table names to FA icon (troubleshoot→tools, education→graduation-cap, etc.)
     - getTypeBadgeColor() — color-coded type badges per item type
     - renderTable() — 9-col rows with inline download buttons (labeled "File 1/2/…" if multiple)
     - renderPagination() — numbered pages with ellipsis (…), max 7 visible
     - updateSortIndicators() — updates ↑/↓ on the fixed header row
     - renderCharts() — cyan for troubleshooting trend, purple for education trend
     - exportCsv() — exports filtered rows to .csv download
     - syncNow() — disables button during sync, shows table count + item count in feedback
     - All new public functions: _kbSort, _kbGoPage, _kbChangePage, _kbSetTableFilter,
       _kbClearTableFilter, _kbToggleSection, _kbExportCsv, _kbOnSearch

## Zero Regressions Verified
  - Auth logic: UNCHANGED (kbGetToken same pattern, authHeaders unchanged)
  - Settings route (kb_settings.js): NOT TOUCHED
  - Download route (kb_download.js): NOT TOUCHED
  - Realtime subscriptions: NOT AFFECTED (KB has no realtime)
  - Parts Number page: NOT TOUCHED
  - Support Records page: NOT TOUCHED
  - All other tabs/pages: NOT TOUCHED
  - CSS: NO new classes required (all styles inline, reuses prem-* classes)
