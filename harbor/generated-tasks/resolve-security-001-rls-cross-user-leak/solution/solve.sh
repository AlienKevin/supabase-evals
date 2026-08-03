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
printf '%s\n' 'Replaced the broad notes policy with owner USING and WITH CHECK predicates so authenticated users cannot read or reassign another user’s notes.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' 'drop policy if exists "read notes" on public.notes; create policy "read notes" on public.notes for select to authenticated using (user_id = auth.uid()); drop policy if exists "update own notes" on public.notes; create policy "update own notes" on public.notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' 'drop policy if exists "read notes" on public.notes; create policy "read notes" on public.notes for select to authenticated using (user_id = auth.uid()); drop policy if exists "update own notes" on public.notes; create policy "update own notes" on public.notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:resolve-security-001-rls-cross-user-leak' > "$workdir/.oracle/resolve-security-001-rls-cross-user-leak.complete"
