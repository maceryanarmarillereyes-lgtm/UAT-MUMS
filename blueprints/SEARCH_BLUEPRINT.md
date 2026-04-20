# Search Blueprint

## Scope
- `public/js/search_engine_v2.js`
- `public/search_engine_2.html`
- `src/pages/GlobalSearch.jsx` + `src/components/search/*` + `src/lib/searchEngine.js`
- Search data sources from Support Records and QuickBase-related feeds

## Feature inventory
1. **Search Engine v2 (classic JS surface)**
   - NLU query cleanup, BM25+ ranking, fuzzy matching, phonetic support, source-aware routing.
2. **Search Engine 2 page integration**
   - Embedded/linked usage from Support Studio tabs.
3. **React Global Search page**
   - batched loading, tab filter, sorting, pagination, recent search history.

## Search logic contracts
- Keep ranking/normalization deterministic for same input dataset.
- Keep noise-token dampening and part-number boosting logic stable unless intentionally recalibrated.
- Maintain source labels/categories compatibility with UI filter chips.

## Do-not-break contracts
- Do not remove fallback behavior when a source is missing.
- Do not regress query latency by removing batching/debouncing.
- Keep output resilient to missing fields.

## Change checklist
- [ ] Search results deterministic for same data snapshot.
- [ ] Source counts and tabs still align.
- [ ] UI still handles empty/error/loading states safely.

## Change log
- **2026-04-20** — Initial search blueprint created.
