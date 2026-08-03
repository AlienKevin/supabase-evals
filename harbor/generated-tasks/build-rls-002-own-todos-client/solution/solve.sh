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
printf '%s\n' 'Enabled todos RLS and added authenticated owner policies for SELECT, INSERT, UPDATE, and DELETE.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' 'alter table public.todos enable row level security; drop policy if exists "users can read own todos" on public.todos; create policy "users can read own todos" on public.todos for select to authenticated using (user_id = auth.uid()); drop policy if exists "users can insert own todos" on public.todos; create policy "users can insert own todos" on public.todos for insert to authenticated with check (user_id = auth.uid()); drop policy if exists "users can update own todos" on public.todos; create policy "users can update own todos" on public.todos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid()); drop policy if exists "users can delete own todos" on public.todos; create policy "users can delete own todos" on public.todos for delete to authenticated using (user_id = auth.uid());')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' 'alter table public.todos enable row level security; drop policy if exists "users can read own todos" on public.todos; create policy "users can read own todos" on public.todos for select to authenticated using (user_id = auth.uid()); drop policy if exists "users can insert own todos" on public.todos; create policy "users can insert own todos" on public.todos for insert to authenticated with check (user_id = auth.uid()); drop policy if exists "users can update own todos" on public.todos; create policy "users can update own todos" on public.todos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid()); drop policy if exists "users can delete own todos" on public.todos; create policy "users can delete own todos" on public.todos for delete to authenticated using (user_id = auth.uid());' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:build-rls-002-own-todos-client' > "$workdir/.oracle/build-rls-002-own-todos-client.complete"
