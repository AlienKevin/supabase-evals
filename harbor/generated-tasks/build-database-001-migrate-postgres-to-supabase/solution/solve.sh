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
printf '%s\n' 'Restored the supplied Postgres dump into the local Supabase project, preserving teams, members, tasks, keys, and indexes.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/migrations"
printf '%s\n' 'create table if not exists public.teams (id bigint primary key, name text not null);
create table if not exists public.members (id bigint primary key, team_id bigint not null references public.teams(id), email text not null, full_name text not null);
create table if not exists public.tasks (id bigint primary key, team_id bigint not null references public.teams(id), assigned_to bigint references public.members(id), title text not null, status text not null);' > "$workdir/supabase/migrations/20260801000000_restore_source.sql"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
(cd "$workdir" && supabase init --force && supabase start && docker exec -i supabase_db_app pg_restore --clean --if-exists --no-owner --no-privileges --username postgres --dbname postgres < source.dump)

printf '%s\n' 'oracle-complete:build-database-001-migrate-postgres-to-supabase' > "$workdir/.oracle/build-database-001-migrate-postgres-to-supabase.complete"
