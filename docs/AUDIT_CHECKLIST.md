# MUMS — Audit Readiness Checklist

> Prepared: 2026-05-03 · UAT Release

---

## ✅ Git Hygiene

- [x] `.gitignore` present at repo root (covers `node_modules/`, `.env`, `dist/`, IDE files, `archive/`)
- [x] `.env.example` present with all environment variables documented and commented
- [x] No hardcoded API keys or secrets in source files
- [x] No exposed Supabase service role key in client-side code
- [x] QuickBase tokens stored server-side only; never sent to browser
- [x] Google Apps Script endpoint is a public URL (not a credential); noted in KNOWN_ISSUES.md

---

## ✅ Folder Structure

- [x] Legacy root-level `/css/`, `/js/`, `/Widget Images/`, `/sound alert/`, `/claude-code-templates-main/` moved to `/archive/`
- [x] `public/Widget Images/` renamed to `public/widget-images/` (no spaces in path)
- [x] `public/sound alert/` renamed to `public/sound-alert/` (no spaces in path)
- [x] All references to renamed folders updated in HTML/JS/CSS files
- [x] `functions/functions/` nested folder flattened into `functions/`
- [x] Ad-hoc SQL files moved from `supabase/` root to `supabase/migrations/applied/`
- [x] `public/debug.html` moved to `archive/debug.html`
- [x] `public/controller_lab.html` moved to `archive/controller_lab.html`
- [x] No broken file references remaining after reorganisation

---

## ✅ Documentation

- [x] `README.md` — comprehensive: overview, tech stack, project structure, features, setup, env vars, scripts
- [x] `CONTRIBUTING.md` — Conventional Commits, branch naming, PR process, code style guidelines
- [x] `CHANGELOG.md` — meaningful change history extracted from commit timeline
- [x] `docs/ARCHITECTURE.md` — system architecture with ASCII diagrams, auth flow, realtime flow, QB integration flow, egress budget table
- [x] `docs/FILE_INDEX.md` — table of all source files with one-line descriptions
- [x] `docs/KNOWN_ISSUES.md` — bug scan results, resolved bug history, open architectural notes
- [x] `docs/AUDIT_CHECKLIST.md` — this file

---

## ✅ File Headers

- [x] JSDoc `@file` headers added to all `.js` files (216 files covered)
- [x] CSS `@file` headers added to all `.css` files (10 files covered)
- [x] HTML comment headers added to all `.html` files (8 files covered)
- [x] Headers include: `@file`, `@description`, `@module`, `@version`

---

## ✅ Database Migrations

- [x] Base schema in `supabase/schema.sql`
- [x] Schema v2 additions in `supabase/schema_update_v2.sql`
- [x] Incremental migrations in `supabase/migrations/` (chronological naming `YYYYMMDD_NN_*.sql`)
- [x] Bulk/hotfix SQLs in `supabase/migrations/applied/` (already applied to production)
- [x] All migration files use `IF NOT EXISTS` / `IF EXISTS` guards

---

## ✅ Security

- [x] Row-Level Security (RLS) enabled on all Supabase tables
- [x] `supabaseAdmin` (service role) used only in server routes, never client-side
- [x] Rate limiting applied to all API routes (`server/lib/rateLimit.js`)
- [x] Security PIN gates sensitive admin actions (`server/routes/pin.js`)
- [x] Auth guard on all protected routes (JWT verified server-side)
- [x] No `eval()` or dangerous string interpolation in SQL paths
- [x] Escape helpers used in dynamic query construction (`server/lib/escape.js`)

---

## ✅ Testing

- [x] Unit tests: `tests/unit/` — conditional format evaluation and row highlight
- [x] Integration tests: `tests/quickbaseSync.integration.test.js`
- [x] Service tests: `tests/quickbaseSync.service.test.js`
- [x] Supabase overload test: `tests/supabase-overload.test.js`
- [x] E2E tests: `tests/e2e/` — color swatch conditional format
- [x] `npm test` runs unit tests without external dependencies

---

## ✅ Deployment

- [x] `vercel.json` present — pins API runtime to `nodejs20.x`
- [x] `package.json` has `engines.node=20.x`
- [x] `public/_routes.json` defines Cloudflare Pages routing
- [x] `wrangler.toml` present for Cloudflare Workers deployment
- [x] `DEPLOY_CHECKLIST.md` present with pre-deployment steps
- [x] `DEPLOYMENT_GUIDE.txt` present with step-by-step instructions

---

## ⚠️ Items to Note for Reviewers

| Item | Status | Notes |
|---|---|---|
| Linter | Not configured | No ESLint/Prettier; `npm run lint` is a stub. Planned for future phase. |
| TypeScript (client) | Not used | Client JS is ES5 vanilla by design (no build step). JSDoc provides type hints. |
| `- Copy.sql` migration | Legacy artefact | `20260217_02_phase1_task_distribution_monitoring - Copy.sql` — confirm if duplicate before deleting. |
| `untouchables/` folder | Intentional | Reference copies of MACE-locked files; not served in production. |
| `archive/` folder | Not deployed | All contents excluded from Vercel deployment via `.gitignore` and `_routes.json`. |

---

*This checklist was produced as part of the comprehensive UAT audit readiness cleanup (commit: `chore: comprehensive repository cleanup for audit readiness — no logic changes`).*
