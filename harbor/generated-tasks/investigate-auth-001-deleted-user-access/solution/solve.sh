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
printf '%s\n' 'The delete_account flow only soft-deleted public.profiles and never removed auth.users or revoked auth.sessions. I replaced it with a SECURITY DEFINER function that deletes the calling auth.users row, cascading the identity, sessions, and refresh tokens. Existing access tokens are stateless JWTs and can still pass purely local signature/expiry checks until exp; mitigate with a short JWT expiry or server-side auth.getUser()/live user-or-session checks in the data path. The publishable key is safe in frontend code because the signed-in user JWT and RLS govern access. The secret/service_role key bypasses RLS, is server-only, and must never ship to a client.' > "$workdir/answer.md"


if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' 'create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$ begin delete from auth.users where id = auth.uid(); end; $$; grant execute on function public.delete_account() to authenticated;')
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:-supabase-eval}/database/query" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    --data "$payload" >/dev/null
elif [ -f "$workdir/supabase/config.toml" ]; then
  printf '%s\n' 'create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, auth as $$ begin delete from auth.users where id = auth.uid(); end; $$; grant execute on function public.delete_account() to authenticated;' | psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1
fi


printf '%s\n' 'oracle-complete:investigate-auth-001-deleted-user-access' > "$workdir/.oracle/investigate-auth-001-deleted-user-access.complete"
