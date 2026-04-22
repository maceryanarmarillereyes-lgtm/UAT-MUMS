# Support Studio Blueprint (AI + Dev Editing Guide)

> **Scope:** `public/support_studio.html`, `public/js/support_studio/**`, `public/js/studio_cache.js`, Support-Studio-related `/api/studio/*` routes, and Support Studio settings/state persistence.
>
> **MANDATORY RULE:** Any Support Studio change (feature, UI behavior, data flow, API wiring, or performance logic) must update this blueprint in the same commit.

---

## 1) Architecture Snapshot

Support Studio is a single-page enterprise console rendered by `public/support_studio.html` with a **persistent 3-column shell**:

- Left: tab-specific sidebar/panels
- Center: tab canvas content
- Right: call widget + utility surfaces

Tab switching is handled client-side by `public/js/support_studio/core_ui.js` (`activateTab`) while preserving shell layout and loading feature modules per tab.

### Runtime bootstrap order (high-level)

1. `auth_guard.js` gates access before page render.
2. Core dependencies load (`env_runtime`, `cloud_auth`, `auth`, `store`, `quickbase_adapter`, QuickBase pages).
3. `supabase_loader.js` loads SDK with source fallback and emits `mums:supabase_ready`.
4. `studio_cache.js` provides cache manifest/bundle fetch and local IndexedDB layer.
5. Feature modules initialize after DOM script block includes at page bottom.

---

## 2) Feature Inventory (Support Studio)

## A) Global shell & navigation
- Header brand, global search, quick tabs.
- QuickBase grouped dropdown (`qbs`, `knowledge_base`, `support_records`).
- Main tabs: Home, Connect+, Parts Number, Contact Information, Product Controllers, Search Engine 2, General Settings.
- `activateTab()` manages active tab, left-panel visibility, canvas activation, and per-tab init dispatch.

## B) Home canvas modules
- **YCT (Your Case Today):** user-filtered case feed from Studio data source.
- **ODP (daily passwords):** day/month views + save flow.
- **Oncall Tech:** settings + schedule read/display.
- **Home Apps:** custom app launcher tiles, CRUD and polling sync.
- **Controller Booking (CTL Lab):** booking/queue timers, alarm/notifications, shared state sync.

## C) QuickBase_S & Search
- QuickBase monitoring, table rendering and deep search hooks.
- QB interceptors normalize/guard responses.
- Export and deep-search route integration (`qb_search`, `qb_export`).

## D) Knowledge Base + Support Records
- KB sync + settings + download flow.
- Support Records panel and case detail assist flows.

## E) Connect+ / Parts Number / Contact Information
- CSV-driven data tabs with cache-first load strategy.
- Shared filtering/sort/pagination/export flow.
- Settings-driven source URLs and search column configuration.

## F) Product Controllers (Catalog)
- Tree view, sub-item hierarchy, detail tabs, rich text editors, comments.
- Role-aware management capability (SA/SU manage privileges).

## G) Cache Manager system
- Beacon state, cache banner/modal/progress.
- Manifest diffing, outdated detection, critical-change path, auto sync triggers.
- Bundle-level metadata and refresh controls.

## H) Call Information widget
- Per-user notes persisted via `/api/studio/call_notes`.
- Local cache write-back with server sync.

---

## 3) Tab and Panel Map

### Top tabs (`data-tab`)
- `home`
- `qbs`
- `knowledge_base`
- `support_records`
- `connectplus`
- `parts_number`
- `contact_information`
- `catalog`
- `search_engine_2`
- `config`

### Left panels
- `left-panel-home`
- `left-panel-catalog`
- `left-panel-config`
- `left-panel-qbs`
- `left-panel-search_engine_2`
- `left-panel-support_records`
- `left-panel-connectplus`
- `left-panel-parts_number`
- `left-panel-contact_information`
- `left-panel-knowledge_base`

### Center canvases
- `canvas-home`
- `canvas-catalog`
- `canvas-config`
- `canvas-connectplus`
- `canvas-parts_number`
- `canvas-contact_information`
- `canvas-knowledge_base`
- `canvas-support_records`
- `canvas-search_engine_2`
- `canvas-qbs`

---

## 4) Frontend Code Location Map

## Entry and orchestration
- `public/support_studio.html`
  - Main shell, tab declarations, canvas containers, module script order.
- `public/js/support_studio/core_ui.js`
  - Tab activation, grouped-menu behavior, call widget, global stubs.

## Auth, runtime and integration loaders
- `public/js/support_studio/auth_guard.js` — pre-render auth redirect guard.
- `public/js/support_studio/supabase_loader.js` — multi-source Supabase SDK loader.
- `public/js/support_studio/qb_interceptors.js` — fetch/XHR interception for QB responses.
- `public/js/support_studio/settings_manager.js` — General Settings loader/savers and preloader.
- `public/js/studio_cache.js` — cache manifest/bundle sync and local store logic.

## Feature modules
- `public/js/support_studio/features/catalog.js`
- `public/js/support_studio/features/knowledge_base.js`
- `public/js/support_studio/features/quickbase_s.js`
- `public/js/support_studio/features/yct.js`
- `public/js/support_studio/features/home_apps.js`
- `public/js/support_studio/features/odp.js`
- `public/js/support_studio/features/oncall_tech.js`
- `public/js/support_studio/features/cache_ui.js`
- `public/js/support_studio/features/se2.js`
- `public/js/support_studio/features/tab_connect_parts_contact.js`
- `public/js/support_studio/features/ctl_booking.js`

## CSS surfaces
- `public/css/support_studio/main_studio.css` (Support Studio-specific styling)
- `public/css/styles.css` / `public/css/enterprise_ux.css` (shared shell/theming dependencies)

---

## 5) Backend/API Mapping Used by Support Studio

### Router registration points (must stay dual-platform synced)
- `api/handler.js` (Vercel UAT `/api/*`)
- `functions/api/[[path]].js` (Cloudflare `/api/*` compatibility route table)

### Primary `/api/studio/*` endpoints consumed by Support Studio
- QuickBase: `qb_settings`, `qb_settings_global`, `qb_monitoring`, `qb_search`, `qb_export`, `qb_data`, `qb_fields`
- Cache: `cache_manifest`, `cache_bundle`
- CSV settings: `csv_settings`
- KB: `kb_settings`, `kb_sync`, `kb_download`
- Home widgets: `yct_data`, `home_apps`, `daily_passwords`, `oncall_settings`, `oncall_schedule`
- CTL Lab: `ctl_lab_config`, `ctl_lab_state`, `ctl_lab_log`
- User-specific storage: `call_notes`, `se2_bookmarks`

Server route implementations live in `server/routes/studio/*.js`.

---

## 6) Settings + Persistence Model

## Local/session state keys (important)
- `mums_supabase_session` (token source for auth headers)
- Support Studio feature caches (module-specific; do not rename blindly)

## Persistent server-backed state categories
- Studio QB settings (per-user and/or global adapter format)
- CSV source URLs/search columns by tab type
- KB settings/sync outputs
- CTL Lab shared config + shared runtime booking/queue state
- Call notes (per-user)
- SE2 bookmarks/folders (per-user)
- Home apps configuration

---

## 7) Non-Break Contracts (Critical)

1. **Auth gate first:** `auth_guard.js` must remain pre-render.
2. **Tab isolation:** `activateTab()` target mapping must keep left-panel/canvas pairing consistent.
3. **QuickBase grouped menu:** grouped tab state must reflect active sub-tab.
4. **Dual-platform API parity:** if adding/modifying Support Studio endpoint, update both `api/handler.js` and `functions/api/[[path]].js`.
5. **Cache contract:** cache manifest/bundle schema assumptions in `studio_cache.js` + `cache_ui.js` must remain aligned.
6. **No channel/topic rename drift:** realtime/subscription topic names used by existing features must not be changed without explicit migration plan.
7. **UI resilience:** missing/invalid upstream data should degrade gracefully, never blank-screen.

---

## 8) Mandatory Update Protocol (Non-Skippable)

Any commit that touches Support Studio scope files MUST include updates to this file.

Required minimum edits in this blueprint:
1. Update **Blueprint Change Log** with date + summary + touched paths.
2. Update affected sections (feature inventory, mapping, contracts, API list).
3. If behavior changed, add the new expected runtime flow in plain language.

### PR checklist snippet (copy to PR)
```md
- [ ] I updated `SUPPORT_STUDIO_BLUEPRINT.md` for all Support Studio-related changes.
- [ ] I verified API route mapping remains synced in Vercel + Cloudflare routers.
- [ ] I verified tab/panel/canvas mapping remains consistent.
```

### AI reminder flow
1. Read `SUPPORT_STUDIO_BLUEPRINT.md` before editing Support Studio.
2. Implement change.
3. Update this blueprint before commit.

If step 3 is missing, task is incomplete.

---

## 9) Blueprint Change Log

- **2026-04-20** — Initial Support Studio blueprint created with full feature inventory, module mapping, endpoint map, contracts, and mandatory update protocol.

