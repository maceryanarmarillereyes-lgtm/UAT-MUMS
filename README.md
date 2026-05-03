# MUMS — User Management System
### UAT Release · Vercel + Supabase + QuickBase

MUMS is an **enterprise-grade team operations platform** built for BPO/contact-centre environments. It provides real-time member presence, shift scheduling, mailbox queue management, task distribution, a QuickBase integration layer, and a Support Studio — all in a single-page application deployable to Vercel with zero build steps.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES5+), HTML5, CSS3 — no framework, no bundler |
| Auth | Supabase Auth (email/password + custom domain) |
| Database | Supabase (PostgreSQL) with Row-Level Security |
| Realtime | Supabase Realtime (WebSocket) |
| API / Server | Vercel Serverless Functions (Node.js 20.x) |
| Edge Functions | Cloudflare Workers (QuickBase proxy) |
| QuickBase | REST API v3 via `QB-USER-TOKEN` |
| Deployment | Vercel (static site + API routes) |

---

## Project Structure

```
UAT-MUMS/
├── public/                     # Static assets served by Vercel
│   ├── index.html              # SPA shell
│   ├── login.html              # Login page
│   ├── mobile.html             # Mobile APEX view
│   ├── support_studio.html     # Support Studio
│   ├── services.html           # Services management
│   ├── search_engine_2.html    # Enterprise search
│   ├── js/                     # All client-side JavaScript
│   │   ├── config.js           # Roles, themes, nav config (source of truth)
│   │   ├── env_runtime.js      # Runtime env bootstrap
│   │   ├── app.js              # SPA router
│   │   ├── auth.js             # Auth state
│   │   ├── realtime.js         # Supabase Realtime channels
│   │   ├── store.js            # Global state store
│   │   ├── ui.js               # UI helpers (modals, toasts)
│   │   ├── pages/              # One file per page/view
│   │   ├── components/         # Reusable UI components
│   │   ├── config/             # Version manifest
│   │   └── support_studio/     # Support Studio sub-modules
│   ├── css/                    # Stylesheets
│   └── widget-images/          # Widget imagery assets
├── api/                        # Vercel Serverless API routes
│   ├── env.js                  # GET /api/env — public runtime config
│   ├── handler.js              # Main API router
│   └── settings/               # Settings API endpoints
├── server/                     # Shared server-side logic
│   ├── lib/                    # Supabase clients, QB client, rate limiter
│   ├── routes/                 # Route handlers (users, tasks, mailbox, etc.)
│   ├── services/               # Background services (QB sync)
│   └── startup/                # Boot-time schema validation
├── functions/                  # Cloudflare Workers (edge functions)
├── supabase/
│   ├── schema.sql              # Base schema
│   ├── schema_update_v2.sql    # Schema v2 additions
│   └── migrations/
│       ├── *.sql               # Incremental migration files
│       └── applied/            # Bulk/hotfix SQLs (already applied)
├── realtime/                   # Local dev WebSocket relay
├── quickbase-integration/      # Standalone QB integration worker
├── scripts/                    # Utility scripts (validation, migration)
├── tests/                      # Unit + integration + e2e tests
├── docs/                       # Architecture and audit documentation
├── blueprints/                 # Feature design blueprints
├── archive/                    # Legacy/debug files (not deployed)
└── untouchables/               # MACE-locked canonical reference files
```

---

## Features

### Core Operations
- **Real-time Presence** — heartbeat-based online/offline/idle status for all members
- **Shift Scheduling** — Morning / Mid / Night shifts with master schedule grid and personal schedule view
- **Mailbox Queue** — case assignment, mailbox manager tracking, duty window enforcement
- **Task Distribution** — task creation, assignment, workload matrix, and command-centre monitoring
- **Member Management** — invite, suspend, role-assign, avatar upload, and activity logs

### QuickBase Integration
- **QB Tab Manager** — personal iFrame tabs pointing at QuickBase reports/pages
- **QB Data Viewer** — live QB data pulled server-side via QB User Token
- **QB Bulk Operations** — field lookup, export, and monitoring

### Support Studio
- **Knowledge Base (KB)** — searchable KB with Supabase-backed sync and CSV export
- **Call Notes** — call note capture linked to cases
- **On-Call Schedule** — on-call rota management
- **Daily Passwords** — secure daily password distribution
- **Controller Lab** — Google Sheets-integrated QA logging tool

### System
- **Theme Engine** — 10 enterprise themes (Obsidian Edge, Slate Ultra, APEX, NEXUS, and more)
- **System Monitor** — Supabase diagnostics, Realtime health, timer monitor, Cloudflare usage
- **Security PIN** — PIN-gated access to sensitive administrative actions
- **Freemium Guard** — adaptive polling to stay within Supabase Free Plan egress limits

---

## Setup & Deployment

### Prerequisites
- Node.js 20.x
- A Supabase project
- A Vercel account
- (Optional) A QuickBase account with API access

### 1. Clone & Install
```bash
git clone https://github.com/maceryanarmarillereyes-lgtm/UAT-MUMS
cd UAT-MUMS
npm install
```

### 2. Environment Variables
```bash
cp .env.example .env
# Fill in all values in .env
```

See `.env.example` for the full list of required variables.

### 3. Supabase Schema
In the Supabase SQL Editor, run in order:
1. `supabase/schema.sql`
2. `supabase/schema_update_v2.sql`
3. All files in `supabase/migrations/` (chronological order)

### 4. Deploy to Vercel
```bash
# Push to GitHub, then in Vercel:
# 1. Import repository
# 2. Set all environment variables from .env.example
# 3. Deploy
```

### 5. Local Development
```bash
# Install Vercel CLI
npm i -g vercel

# Run locally (API routes + static)
vercel dev

# Optional: local Realtime relay
cd realtime && npm install && node server.js
```

---

## Environment Variables

See `.env.example` for a fully documented list. Key variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key (client-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `QB_REALM_HOSTNAME` | QuickBase realm (e.g. `company.quickbase.com`) |
| `QB_USER_TOKEN` | QuickBase API user token |
| `USERNAME_EMAIL_DOMAIN` | Email domain for username login |

---

## Scripts

```bash
npm test                  # Run unit tests
npm run test:env          # Validate required env vars
npm run test:routes       # Validate _routes.json
npm run qa:deploy         # Full QA deploy checklist
npm run package:phase1    # Package Phase 1 release zip
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit conventions, branch naming, and PR process.

---

## Architecture

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for a full system architecture overview.

---

## Known Issues

See [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) for tracked TODOs and FIXMEs.

---

## Security

- All sensitive operations require `SUPABASE_SERVICE_ROLE_KEY` (server-side only).
- Row-Level Security (RLS) is enforced on all Supabase tables.
- Rate limiting is applied to all API routes via `server/lib/rateLimit.js`.
- Security PIN gates destructive admin actions.
- Never commit `.env` — use `.env.example` as reference only.

---

*MUMS UAT Release — maintained by Mace (maceryanarmarillereyes-lgtm)*
