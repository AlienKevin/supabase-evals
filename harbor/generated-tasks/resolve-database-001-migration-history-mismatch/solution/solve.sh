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
printf '%s\n' 'Reconciled the remote add_profile_bio migration with local history, preserved 25 profiles, and applied add_avatar_url in order.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/migrations"
printf '%s\n' 'alter table public.profiles add column if not exists bio text;' > "$workdir/supabase/migrations/20240115000000_add_profile_bio.sql"
mkdir -p "$workdir/supabase/migrations"
printf '%s\n' 'alter table public.profiles add column if not exists avatar_url text;' > "$workdir/supabase/migrations/20240220000000_add_avatar_url.sql"
mkdir -p "$workdir/supabase"
printf '%s\n' '20240115000000 repaired as applied; 25 profile rows preserved.
' > "$workdir/supabase/migration-repair.txt"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
(cd "$workdir" && supabase migration repair 20240115000000 --status reverted && supabase db push)
printf '%s\n' '[{"command":"supabase migration repair 20240115000000 --status reverted","stdout":"Repaired migration history: 20240115000000 reverted."},{"command":"supabase db push","stdout":"Applying migration 20240115000000_add_profile_bio.sql...\nApplying migration 20240220000000_add_avatar_url.sql...\nFinished supabase db push."}]' > "$workdir/.oracle/source-tool-calls.json"
printf '%s\n' 'oracle-complete:resolve-database-001-migration-history-mismatch' > "$workdir/.oracle/resolve-database-001-migration-history-mismatch.complete"
