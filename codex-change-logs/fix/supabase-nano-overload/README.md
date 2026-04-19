# fix/supabase-nano-overload

1. **Server pooler client singleton**: added `server/lib/supabaseAdmin.js` using `SUPABASE_DB_POOLER_URL` with transaction-pool headers.
2. **JWT auth cache**: added `server/lib/authCache.js` with LRU cache (500 entries, positive + negative TTL).
3. **Rate limiting + breaker primitives**: added `server/lib/rateLimit.js` (sync pull/push windows + auth-heavy profile + circuit breaker counters).
4. **sync/pull hardening**: updated `server/routes/sync/pull.js` to use cached auth, per-user limiter, upstream-503 retry-after and breaker checks.
5. **sync/push hardening**: updated `server/routes/sync/push.js` to use cached auth, per-user limiter, upstream-503 retry-after and breaker checks.
6. **API auth middleware**: updated `api/handler.js` with route-level auth middleware using cached verifier and semistatic GET cache headers.
7. **Browser singleton client**: added `src/lib/supabaseClient.js` with singleton `createClient`, PKCE/session settings, realtime throttling and fetch timeout.
8. **Auth context centralization**: added `src/lib/AuthContext.jsx` to call `getSession()` once on mount and subscribe to auth changes.
9. **Shared poller utility**: added `src/utils/poller.js` with 30s minimum interval, visibility pause/resume and AbortController cancellation.
10. **Realtime cleanup helper**: added `src/utils/realtimeChannels.js` with 3-channel cap and centralized `removeChannel` cleanup.
11. **Perf indexes migration**: added `supabase/migrations/20260419_02_perf_indexes.sql` for `mums_documents` and `mums_profiles` query columns.
12. **Overload tests**: added `tests/supabase-overload.test.js` for auth caching, rate limit, circuit breaker and hidden-tab poller behavior.
