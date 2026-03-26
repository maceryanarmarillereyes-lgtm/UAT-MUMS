#!/usr/bin/env bash
set -euo pipefail

# Generates reviewable ALTER POLICY statements that wrap auth.<function>() calls
# as (select auth.<function>()) to address Supabase RLS lint warnings.
#
# Usage:
#   export DATABASE_URL="postgresql://user:pass@host:5432/db"
#   scripts/fix_supabase_rls_policies.sh
#   scripts/fix_supabase_rls_policies.sh --apply
#   scripts/fix_supabase_rls_policies.sh --include-current-setting

SCHEMA_NAME="public"
OUTFILE="/tmp/alter_policies.sql"
APPLY=false
INCLUDE_CURRENT_SETTING=false

while (($# > 0)); do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    --include-current-setting)
      INCLUDE_CURRENT_SETTING=true
      shift
      ;;
    --schema)
      SCHEMA_NAME="$2"
      shift 2
      ;;
    --outfile)
      OUTFILE="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: fix_supabase_rls_policies.sh [options]

Options:
  --apply                    Execute generated SQL after writing review file.
  --include-current-setting  Also wrap current_setting(...) as (select current_setting(...)).
  --schema <name>            Schema to scan (default: public).
  --outfile <path>           SQL output file path (default: /tmp/alter_policies.sql).
  -h, --help                 Show this help text.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

if [[ "$INCLUDE_CURRENT_SETTING" == true ]]; then
  WRAP_CURRENT_SETTING="true"
else
  WRAP_CURRENT_SETTING="false"
fi

{
  echo "-- Generated ALTER POLICY statements (dry-run by default)."
  echo "-- Generated on: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "-- Schema: ${SCHEMA_NAME}"
  echo "-- include_current_setting: ${INCLUDE_CURRENT_SETTING}"
  echo ""
} > "$OUTFILE"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v schema_name="$SCHEMA_NAME" -v wrap_current_setting="$WRAP_CURRENT_SETTING" -At -F $'\t' <<'SQL' >> "$OUTFILE"
WITH policies AS (
  SELECT
    pol.polname AS policy_name,
    n.nspname AS schema_name,
    c.relname AS table_name,
    pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
    pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
  FROM pg_policy pol
  JOIN pg_class c ON pol.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = :'schema_name'
),
rewritten AS (
  SELECT
    *,
    CASE
      WHEN using_expr IS NULL THEN NULL
      ELSE
        replace(
          CASE
            WHEN :'wrap_current_setting'::boolean THEN
              regexp_replace(
                regexp_replace(
                  replace(using_expr, '(select auth.', '__AUTH_SENTINEL__'),
                  'auth\.([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]*)\)',
                  '(select auth.\1(\2))',
                  'g'
                ),
                'current_setting\(([^)]*)\)',
                '(select current_setting(\1))',
                'g'
              )
            ELSE
              regexp_replace(
                replace(using_expr, '(select auth.', '__AUTH_SENTINEL__'),
                'auth\.([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]*)\)',
                '(select auth.\1(\2))',
                'g'
              )
          END,
          '__AUTH_SENTINEL__',
          '(select auth.'
        )
    END AS new_using_expr,
    CASE
      WHEN with_check_expr IS NULL THEN NULL
      ELSE
        replace(
          CASE
            WHEN :'wrap_current_setting'::boolean THEN
              regexp_replace(
                regexp_replace(
                  replace(with_check_expr, '(select auth.', '__AUTH_SENTINEL__'),
                  'auth\.([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]*)\)',
                  '(select auth.\1(\2))',
                  'g'
                ),
                'current_setting\(([^)]*)\)',
                '(select current_setting(\1))',
                'g'
              )
            ELSE
              regexp_replace(
                replace(with_check_expr, '(select auth.', '__AUTH_SENTINEL__'),
                'auth\.([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]*)\)',
                '(select auth.\1(\2))',
                'g'
              )
          END,
          '__AUTH_SENTINEL__',
          '(select auth.'
        )
    END AS new_with_check_expr
  FROM policies
),
targets AS (
  SELECT *
  FROM rewritten
  WHERE (using_expr IS DISTINCT FROM new_using_expr)
     OR (with_check_expr IS DISTINCT FROM new_with_check_expr)
)
SELECT
  format(
    '/* Policy: %I.%I :: %I */%sALTER POLICY %I ON %I.%I%s%s;',
    schema_name,
    table_name,
    policy_name,
    E'\n',
    policy_name,
    schema_name,
    table_name,
    CASE
      WHEN new_using_expr IS NOT NULL THEN format(E'\n  USING (%s)', new_using_expr)
      ELSE ''
    END,
    CASE
      WHEN new_with_check_expr IS NOT NULL THEN format(E'\n  WITH CHECK (%s)', new_with_check_expr)
      ELSE ''
    END
  )
FROM targets
ORDER BY schema_name, table_name, policy_name;
SQL

echo ""
echo "Dry-run SQL written to: $OUTFILE"
echo ""
echo "Preview (first 80 lines):"
sed -n '1,80p' "$OUTFILE"
echo ""
echo "Review each statement before applying."

if [[ "$APPLY" == true ]]; then
  echo "Applying changes from $OUTFILE..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$OUTFILE"
  echo "Apply complete."
else
  echo "No changes applied. Re-run with --apply after review."
fi
