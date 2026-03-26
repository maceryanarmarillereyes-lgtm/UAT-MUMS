#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/artifacts"
OUTPUT_FILE="${OUTPUT_DIR}/newmace-deployable.zip"

mkdir -p "${OUTPUT_DIR}"

cd "${ROOT_DIR}"

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required but was not found in PATH." >&2
  exit 1
fi

rm -f "${OUTPUT_FILE}"

zip -r "${OUTPUT_FILE}" . \
  -x ".git/*" \
  -x ".gitignore" \
  -x "node_modules/*" \
  -x "artifacts/*"

echo "Deployable zip created at: ${OUTPUT_FILE}"
