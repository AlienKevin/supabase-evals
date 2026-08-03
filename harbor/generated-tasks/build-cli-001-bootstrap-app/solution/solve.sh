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
printf '%s\n' 'Created a tracked todos migration, enabled RLS, granted authenticated read access, denied API writes, and seeded sample todos.' > "$workdir/answer.md"
mkdir -p "$workdir/supabase/migrations"
printf '%s\n' 'create table if not exists public.todos (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), body text not null, done boolean not null default false);
insert into public.todos (user_id, body, done) values ('"'"'00000000-0000-0000-0000-000000000001'"'"', '"'"'Set up Supabase'"'"', true), ('"'"'00000000-0000-0000-0000-000000000001'"'"', '"'"'Ship the app'"'"', false);
alter table public.todos enable row level security;
grant select on public.todos to authenticated;
create policy "authenticated can read todos" on public.todos for select to authenticated using (true);' > "$workdir/supabase/migrations/20260801000000_create_todos.sql"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi
if [ ! -f "$workdir/supabase/config.toml" ]; then
  (cd "$workdir" && supabase init --force)
fi
(cd "$workdir" && supabase start)

printf '%s\n' 'oracle-complete:build-cli-001-bootstrap-app' > "$workdir/.oracle/build-cli-001-bootstrap-app.complete"
