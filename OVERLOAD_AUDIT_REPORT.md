# Supabase Free Tier Overload Audit Report - UAT-MUMS

## 1. Executive Summary
The UAT-MUMS webapp is currently exceeding Supabase Free Tier limits (specifically API request and WAL write limits) due to aggressive client-side polling and uncached server-side document reads. With 30 users active, the current architecture generates approximately **15,000 - 20,000 requests per hour**, which far exceeds the sustainable limit for a free tier setup.

## 2. Identified Root Causes

### A. Aggressive Client-Side Polling (Support Studio)
| Feature | File | Interval | Impact (30 users) |
| :--- | :--- | :--- | :--- |
| **Home Apps** | `home_apps.js` | **7 seconds** | ~15,428 req/hr |
| **CTL Lab Config** | `ctl_booking.js` | **30 seconds** | ~3,600 req/hr |
| **CTL Lab State** | `ctl_booking.js` | **30 seconds** | ~3,600 req/hr |
| **YCT Data** | `yct.js` | **60 seconds** | ~1,800 req/hr |

### B. Redundant & Duplicate Logic
*   **Legacy CTL Logic:** `core_ui.js` contains a duplicate `_startPoll` for CTL Lab (30s) that runs alongside the new `ctl_booking.js` poll, doubling the load for that feature.
*   **Presence Watchdog:** `presence_watchdog.js` and `presence_client.js` both perform heartbeats. While partially optimized, they still contribute to a high baseline of "background noise" requests.

### C. Uncached Server-Side Reads
*   **`mums_documents` Access:** Routes like `/api/studio/home_apps` and `/api/studio/ctl_lab_config` perform a fresh Supabase query on every single request. There is no server-side caching (In-memory or ETag) for these shared documents.
*   **Auth Overhead:** Although `supabase.js` has a 4-minute JWT cache, the sheer volume of requests still puts pressure on the auth middleware and connection pool.

### D. Database Write Patterns (WAL Bloat)
*   **Presence Heartbeats:** Every heartbeat results in a `mums_presence` UPSERT. Even with the 40s server-side dedup, 30 users polling at 45s-120s intervals create constant WAL (Write Ahead Log) activity, which is a primary driver of "Disk I/O" exhaustion on Supabase.

## 3. Proposed Fixes

### Phase 1: Polling Optimization (Immediate)
*   Increase **Home Apps** poll from 7s to **300s (5 min)**.
*   Increase **CTL Lab** poll from 30s to **120s (2 min)**.
*   Implement "Smart Polling": Stop all intervals when the tab is hidden (Visibility API).

### Phase 2: Server-Side Caching
*   Introduce a **Global Document Cache** in `supabase.js` or specific routes with a 60s TTL for shared documents (`home_apps`, `ctl_config`).
*   Implement **ETag/If-None-Match** support for document routes to return `304 Not Modified` for polling clients.

### Phase 3: Structural Cleanup
*   Remove legacy CTL polling from `core_ui.js`.
*   Consolidate Presence heartbeats into a single unified client.

### Phase 4: Booking Logic Restructure
*   Move CTL state transitions to a more robust "Locking" pattern to prevent race conditions during the longer poll intervals.
