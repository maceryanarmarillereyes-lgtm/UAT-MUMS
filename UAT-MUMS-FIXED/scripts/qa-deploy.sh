#!/usr/bin/env bash
set -euo pipefail

# Master local automation script: sync → install → env check → tests → build → keep repo clean

# 0) Safety note
echo "⚠️  This script will hard reset your local branch to origin/main and discard local changes." 

# 1) Sync local repo with remote (force reset to avoid conflicts)
git fetch origin main
git reset --hard origin/main

# 2) Clean install dependencies
rm -rf node_modules
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# 3) Ensure environment variables are present + load them into this shell
if [ ! -f .env ]; then
  echo "Missing .env file. Please add Supabase/Cloudflare/Vercel test keys."
  exit 1
fi

# Load .env into environment for node/playwright scripts
# NOTE: .env must be shell-compatible KEY=VALUE lines
set -a
# shellcheck disable=SC1091
source .env
set +a

# Required vars used by tests
required_vars=(
  CLOUDFLARE_URL
  VERCEL_URL
  UAT_USER_EMAIL
  UAT_USER_PASSWORD
  PROD_USER_EMAIL
  PROD_USER_PASSWORD
)
missing=0
for v in "${required_vars[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "❌ Missing required env var: $v"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  exit 1
fi

# 4) Install Playwright browsers (required for test:login)
# You can remove '--with-deps' if you're on macOS and already have system deps.
npx playwright install --with-deps chromium

# 5) Run automated tests
npm run test:env
npm run test:login

# 6) Build project for deployment
npm run build

# 7) Add/update .gitignore for clean repo (do NOT clobber existing rules)
if [ ! -f .gitignore ]; then
  cat <<'EOT' > .gitignore
# dependencies
node_modules/

# build output
.next/
out/
dist/

# environment files
.env
.env.local
.env.*.local

# logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# test artifacts
playwright-report/
test-results/

# misc
.DS_Store
*.swp
EOT
else
  # Append only missing entries
  grep -qxF "node_modules/" .gitignore || echo "node_modules/" >> .gitignore
  grep -qxF ".env" .gitignore || echo ".env" >> .gitignore
  grep -qxF "playwright-report/" .gitignore || echo "playwright-report/" >> .gitignore
  grep -qxF "test-results/" .gitignore || echo "test-results/" >> .gitignore
fi

git add .gitignore
git commit -m "chore: update .gitignore" || echo "No changes to commit"
git push

# 8) Confirm success
echo "✅ Webapp synced, env loaded, tested, built, and ready for deployment."
