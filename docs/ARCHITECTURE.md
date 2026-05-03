# MUMS — System Architecture

> Version: UAT · Updated: 2026-05-03

---

## Overview

MUMS is a **static SPA + serverless API** system. There is no build step — HTML/JS/CSS are served as-is by Vercel's CDN. All dynamic server logic lives in Vercel Serverless Functions under `/api/*`. Supabase provides the database, auth, and realtime layers.

---

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         BROWSER (Client)                       │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │index.html│  │login.html│  │mobile.html│  │support_studio │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘ │
│       │              │              │                │          │
│  ┌────▼──────────────▼──────────────▼────────────────▼──────┐  │
│  │                   public/js/ (Vanilla JS SPA)            │  │
│  │  env_runtime.js → config.js → app.js → pages/* → ui.js  │  │
│  │  realtime.js (Supabase WS)  │  presence_client.js        │  │
│  │  store.js (global state)    │  auth.js (session)         │  │
│  └────────────────────────────────────────────────────────--┘  │
└────────────┬──────────────────────────┬────────────────────────┘
             │ HTTPS REST               │ WebSocket
             ▼                          ▼
┌────────────────────────┐   ┌─────────────────────────────────┐
│   VERCEL (CDN + API)   │   │         SUPABASE                │
│                        │   │                                 │
│  Static Assets (CDN)   │   │  ┌──────────┐ ┌─────────────┐  │
│  /api/env              │   │  │ Auth     │ │  Realtime   │  │
│  /api/handler.js ──────┼───┼─▶│ (JWT)    │ │  (WS Chan.) │  │
│    routes/users/*      │   │  └──────────┘ └─────────────┘  │
│    routes/tasks/*      │   │  ┌────────────────────────────┐ │
│    routes/mailbox/*    │   │  │  PostgreSQL Database        │ │
│    routes/presence/*   │   │  │  mums_profiles             │ │
│    routes/studio/*     │   │  │  mums_presence             │ │
│    routes/quickbase/*  │   │  │  mums_sync_log             │ │
│    routes/settings/*   │   │  │  mums_mailbox_time_override │ │
│    routes/sync/*       │   │  │  task_distributions        │ │
│    routes/catalog/*    │   │  │  task_items                │ │
│    server/lib/*        │   │  │  support_catalog           │ │
│    server/services/*   │   │  │  global_settings           │ │
│                        │   │  │  quickbase_tabs            │ │
│  /functions/* ─────────┼───┘  │  daily_passwords           │ │
│  (Cloudflare Workers)  │      │  my_notes                  │ │
│                        │      │  pause_sessions            │ │
└────────────┬───────────┘      └────────────────────────────┘ │
             │                   └─────────────────────────────┘
             │ QB REST API
             ▼
┌───────────────────────┐
│  QUICKBASE            │
│  (realm.quickbase.com)│
│  QB-USER-TOKEN auth   │
│  Table data / Reports │
└───────────────────────┘
```

---

## Authentication Flow

```
User visits login.html
        │
        ▼
username + PIN entered
        │
        ▼
cloud_auth.js → supabase.auth.signInWithPassword({
    email: username + "@" + USERNAME_EMAIL_DOMAIN,
    password: PIN
})
        │
        ▼
Supabase returns JWT session
        │
        ▼
auth.js caches session → Store.setUser(profile)
        │
        ▼
app.js loads → renders requested page
```

---

## Realtime & Presence Flow

```
env_runtime.js fetches /api/env
        │
        ▼
MUMS_ENV populated (SUPABASE_URL, ANON_KEY, poll intervals)
        │
        ▼
realtime.js creates Supabase Realtime channel
        │
        ├─▶ Subscribes to mums_profiles changes (INSERT/UPDATE/DELETE)
        ├─▶ Subscribes to mums_presence changes
        └─▶ Subscribes to task_items changes
                │
                ▼
presence_client.js runs heartbeat loop
  every PRESENCE_POLL_MS (default: 120s on free tier)
  → upserts row in mums_presence with { user_id, last_seen, status }

presence_watchdog.js
  → monitors staleness threshold (PRESENCE_TTL_SECONDS)
  → marks users GRAY if last_seen > threshold
  → triggers re-heartbeat on reconnect
```

---

## QuickBase Integration Flow

```
User opens "My QuickBase" page
        │
        ▼
my_quickbase.js → GET /api/handler → routes/studio/qb_settings.js
        │
        ▼
User's QB token + realm fetched from Supabase (encrypted at rest)
        │
        ▼
quickbase_adapter.js → POST /api/handler → routes/quickbase/*
        │
        ▼
server/lib/quickbase.js → QB REST API v3
  Authorization: QB-USER-TOKEN {token}
  Content-Type: application/json
        │
        ▼
Response proxied back to client (token never exposed)
```

---

## Free-Tier Egress Budget

MUMS targets Supabase's 5 GB/month free egress for 30 users × 8hr/day × 30 days.

| Source | Interval | Monthly Estimate |
|---|---|---|
| Presence Heartbeat | 120s | ~0.16 GB |
| Presence List Poll | 300s | ~1.10 GB |
| Sync Reconcile | 180s | ~0.55 GB |
| QB Refresh (QB users only) | 300s | ~1.36 GB |
| Offline Pull | 180s | ~0.04 GB |
| **Total** | | **~3.21 GB ✅** |

Adaptive idle scaling: MAILBOX_OVERRIDE_POLL_MS escalates from 120s → 720s when idle.

---

## Key Design Decisions

**No framework / No bundler** — The client is pure HTML+JS+CSS. This eliminates build complexity, makes the codebase auditable by non-engineers, and deploys as static files with zero transformation.

**Supabase Free Tier first** — All polling intervals are calibrated to stay within the 5 GB/month egress budget. The `freemium_guard.js` enforces minimum intervals globally.

**Server-side QB token proxy** — QuickBase tokens are stored server-side (Supabase, encrypted by RLS) and never sent to the client. All QB API calls are proxied through Vercel functions.

**RLS everywhere** — Every Supabase table has Row-Level Security policies. The `supabaseAdmin` client (service role) is used only in server routes that require bypass.

---

## Module Dependency Graph (Simplified)

```
index.html
  └── env_runtime.js     (loads first, async)
        └── config.js    (static config)
              └── app.js (SPA router)
                    ├── auth.js
                    │     └── cloud_auth.js → Supabase Auth
                    ├── store.js
                    ├── ui.js
                    ├── realtime.js → Supabase Realtime
                    ├── presence_client.js
                    ├── presence_watchdog.js
                    └── pages/*
                          ├── members.js → cloud_users.js
                          ├── mailbox.js
                          ├── tasks/*.js → cloud_tasks.js
                          ├── my_quickbase.js → quickbase_adapter.js
                          └── system.js
```
