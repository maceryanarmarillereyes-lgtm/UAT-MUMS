# Contributing to MUMS

Thank you for contributing to MUMS. This document covers the conventions and process for making changes to this repository.

---

## ⚠️ Critical — Untouchable Zones

Files marked with `@AI_CRITICAL_GUARD` or listed in `CODE_UNTOUCHABLES.md` **must not be modified** without explicit clearance from Mace. If you need to change one of these files, open a discussion first and provide a RISK IMPACT REPORT.

---

## Commit Message Convention

MUMS follows **Conventional Commits**:

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `chore` | Maintenance (deps, config, cleanup) |
| `docs` | Documentation only |
| `style` | CSS/visual changes with no logic change |
| `refactor` | Code restructure with no behaviour change |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `revert` | Reverting a previous commit |

### Scopes (examples)

`auth`, `members`, `mailbox`, `tasks`, `presence`, `quickbase`, `studio`, `search`, `services`, `realtime`, `api`, `db`, `ui`, `config`

### Examples

```
feat(tasks): add workload matrix export to CSV
fix(presence): correct TTL calculation for night-shift users
chore: add .gitignore and .env.example
docs(readme): document QB setup steps
perf(realtime): reduce presence poll from 45s to 90s for free tier
```

---

## Branch Naming Convention

```
<type>/<short-slug>
```

Examples:
```
feat/mailbox-assign-animation
fix/presence-ttl-nightshift
chore/repo-cleanup-audit
docs/architecture-diagram
hotfix/rls-policy-recursion
```

---

## Pull Request Process

1. **Branch** off `main` using the naming convention above.
2. **Scope** your PR to one feature or fix — avoid mixing unrelated changes.
3. **Test** using `npm test` and `npm run test:env`.
4. **Self-review** your diff before requesting review.
5. **Fill out** the PR template in `PR_TEMPLATE.md`.
6. **Do not merge** without Mace approval for any changes touching untouchable files.

---

## Code Style Guidelines

### JavaScript
- ES5-compatible syntax for client-side files in `public/js/` (no transpilation).
- ES2020+ is acceptable in `server/`, `api/`, `scripts/`, and `functions/`.
- Use `const`/`let` in server-side code; `var` is acceptable in legacy client files.
- All new `.js` files must include a JSDoc `@file` header.
- No `console.log` in production paths — use the `DBG` logger from `debugger.js`.

### CSS
- Follow the existing CSS variable token system defined in `enterprise_ux.css`.
- Use `var(--token-name)` for all colours, fonts, and spacing — no raw values.
- All new `.css` files must include the standard file header comment.

### SQL
- New migrations go in `supabase/migrations/` with the naming pattern `YYYYMMDD_NN_description.sql`.
- Always include `IF NOT EXISTS` / `IF EXISTS` guards.
- Include a rollback comment at the top of each migration.
- One logical change per migration file.

### HTML
- All HTML files must include the `<!-- @file ... -->` header after `<!DOCTYPE html>`.
- No inline `<script>` blocks with business logic — keep logic in `public/js/`.

---

## Running Tests

```bash
# Unit tests
npm test

# Environment variable validation
npm run test:env

# Route validation
npm run test:routes
```

---

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected behaviour
- Actual behaviour
- Browser + OS
- Console errors (screenshot or paste)
