# Staging Verification Report (2026-02-28)

## Step 1: Detect users table schema on STAGING
Command:
```bash
psql "$DATABASE_URL" -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name='users';"
```
Output:
```text
bash: command not found: psql
```

## Step 2: Prepare and run schema-correct migration on STAGING
Not executed because SQL client (`psql`) is unavailable and `DATABASE_URL` is unset.

## Step 3: Verify column exists
Not executed because SQL client (`psql`) is unavailable and `DATABASE_URL` is unset.

## Step 4: Run integration tests against STAGING DB
Environment checks:
```text
DATABASE_URL is <unset>
```

Command:
```bash
npm ci
```
Output:
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
npm error code EUSAGE
npm error
npm error The `npm ci` command can only install with an existing package-lock.json or
npm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or
npm error later to generate a package-lock.json file, then try again.
npm error
npm error Clean install a project
npm error
npm error Usage:
npm error npm ci
npm error
npm error Options:
npm error [--install-strategy <hoisted|nested|shallow|linked>] [--legacy-bundling]
npm error [--global-style] [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
npm error [--include <prod|dev|optional|peer> [--include <prod|dev|optional|peer> ...]]
npm error [--strict-peer-deps] [--foreground-scripts] [--ignore-scripts] [--no-audit]
npm error [--no-bin-links] [--no-fund] [--dry-run]
npm error [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
npm error [--workspaces] [--include-workspace-root] [--install-links]
npm error
npm error aliases: clean-install, ic, install-clean, isntall-clean
npm error
npm error Run "npm help ci" for more info
npm error A complete log of this run can be found in: /root/.npm/_logs/2026-02-28T12_42_17_337Z-debug-0.log
```

Command:
```bash
DATABASE_URL='<staging-connection-string-not-provided>' npm test -- tests/update_me.integration.test.js
```
Output:
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> mums-realtime-green-mandatory@1.0.0 test
> node tests/normalizeFilters.test.js && node tests/escape.test.js && node tests/update_me.integration.test.js tests/update_me.integration.test.js

normalizeFilters tests passed
escapeQuickbaseValue tests passed
[users.update] quickbase filter normalization applied { count: 1 }
[users.update] quickbase_settings saved { userId: 'u-1', filtersCount: 1 }
[users.update] quickbase filter normalization applied { count: 1 }
[users.update] quickbase_settings column missing; writing to quickbase_config fallback
[users.update] quickbase_settings saved { userId: 'u-2', filtersCount: 1 }
update_me integration tests passed
```

## Step 5: Replay failing request on STAGING
Environment checks:
```text
STAGING_URL=<unset>
payload.json missing
```

Command:
```bash
curl -v -X PATCH "https://<staging-url>/api/users/update" -H "Content-Type: application/json" -d @payload.json
```
Output:
```text
curl: Failed to open payload.json
curl: option -d: error encountered when reading a file
curl: try 'curl --help' or 'curl --manual' for more information
```

HTTP status: Not available (request did not execute).
Response body: Not available (request did not execute).
Server logs (timestamped): Not available (no request reached staging endpoint).

## Step 6: Verify persisted row
Not executed due unavailable DB connection details and missing SQL client.

## Step 7: Failures with exact errors
- `psql` unavailable: `bash: command not found: psql`
- `DATABASE_URL` missing: `<unset>`
- `npm ci` failed due missing lockfile (`package-lock.json` / `npm-shrinkwrap.json`)
- curl replay failed due missing `payload.json`
