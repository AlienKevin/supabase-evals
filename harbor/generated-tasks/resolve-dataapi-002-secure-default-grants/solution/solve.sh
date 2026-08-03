#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir/.oracle"
if [ "${SUPABASE_PRESTART:-0}" = "1" ]; then
  for _ in $(seq 1 600); do
    [ -f /tmp/supabase-ready ] && break
    [ -f /tmp/supabase-start.failed ] && { cat /tmp/supabase-start.log >&2; exit 1; }
    sleep 1
  done
  [ -f /tmp/supabase-ready ] || { cat /tmp/supabase-start.log >&2 2>/dev/null || true; exit 1; }
fi
printf '%s\n' 'Journal entries had no authenticated table grants; added least-privilege SELECT and INSERT grants while retaining owner RLS.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' 'grant select, insert on table public.journal_entries to authenticated; revoke select, insert on table public.journal_entries from anon;')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' 'grant select, insert on table public.journal_entries to authenticated; revoke select, insert on table public.journal_entries from anon;' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:resolve-dataapi-002-secure-default-grants' > "$workdir/.oracle/resolve-dataapi-002-secure-default-grants.complete"
