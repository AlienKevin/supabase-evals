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
printf '%s\n' 'Updated the declarative products schema with a description text column and generated the matching migration.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/schemas"
printf '%s\n' 'create table public.products (
  id serial primary key,
  name text not null,
  price numeric not null,
  description text
);' > "$workdir/supabase/schemas/products.sql"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
(cd "$workdir" && supabase db diff -f add_product_description && supabase migration up)
printf '%s\n' '[{"command":"supabase db diff -f add_product_description","stdout":"Finished supabase db diff."},{"command":"supabase migration up","stdout":"Finished supabase migration up."}]' > "$workdir/.oracle/source-tool-calls.json"
printf '%s\n' 'oracle-complete:build-cli-002-declarative-schema' > "$workdir/.oracle/build-cli-002-declarative-schema.complete"
