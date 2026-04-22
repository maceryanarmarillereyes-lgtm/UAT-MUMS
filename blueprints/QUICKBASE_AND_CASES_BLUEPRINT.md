# QuickBase and Cases Blueprint

## Scope
- `public/js/pages/my_quickbase.js`
- `public/js/pages/my_quickbase_tab_manager.js`
- `public/js/pages/my_case.js`
- `public/js/pages/support_studio_patches.js` (bridge behavior where applicable)
- Backend routes: `api/quickbase/*`, `api/quickbase_tabs*`, `api/studio/qb_*`

## Feature inventory
1. **My QuickBase Dashboard**
   - QuickBase report parsing, filter normalization, data display, search and export integration.
2. **QuickBase Tab Manager**
   - Per-user tab isolation, local fallback cache, virtual column settings per tab.
3. **My Case**
   - Case-centric views tied to QuickBase data and assignment context.
4. **Support Studio bridge patch layer**
   - Non-invasive post-load fixes for cross-surface deep search and detail modal behavior.

## Core contracts
- Tab isolation must stay strict (no settings leakage across tabs/users).
- QB URL parsing and qid/table extraction must remain backward compatible.
- Virtual column config schema must stay stable.

## Do-not-break contracts
- Never rename tab settings keys without migration.
- Keep per-user storage namespace behavior intact.
- Preserve deep search -> case detail bridge behavior.

## Change checklist
- [ ] Tab create/save/load/delete still isolated by user.
- [ ] QB settings parsing still fills realm/table/qid.
- [ ] Case detail renders with populated column map.
- [x] Case detail modal exposes QuickBase Edit/View links (header + footer) using record RID fallback (`recordId` → field `3`).

## Change log
- **2026-04-20** — Initial QuickBase/cases blueprint created.
- **2026-04-22** — Added My QuickBase case-detail modal outbound QuickBase Edit/View actions (header quick links + footer actions), with resilient RID resolution and disabled-link fallback when RID is unavailable.
