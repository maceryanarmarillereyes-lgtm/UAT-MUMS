# Quickbase Integration Scaffold

## What this adds
- quickbaseClient.js — minimal Quickbase REST client using a User Token
- api/monitoring.js — Vercel serverless function to read records
- worker/index.mjs — Cloudflare Worker module example
- .github/workflows/reconcile.yml — hourly reconciliation trigger (uses repo secrets)
- .env.example — local env template

## Local dev
1. Copy .env.example to .env and fill values (do not commit .env).
2. From quickbase-integration run:
   - npm install
   - npm start
3. Local test: GET http://localhost:3000/api/monitoring

## Deployment notes
- Vercel: add QB_USER_TOKEN, QB_REALM, QB_TABLE_ID in Project Environment Variables.
- Cloudflare Workers: add QUICKBASE_TOKEN, QUICKBASE_REALM, QUICKBASE_TABLE_ID via wrangler secret put or dashboard.
- GitHub Actions workflow expects repository secrets: QB_USER_TOKEN, QB_REALM, QB_TABLE_ID, VERCEL_URL.

## Security
- Never commit real tokens. Use platform secrets and rotate tokens regularly.
