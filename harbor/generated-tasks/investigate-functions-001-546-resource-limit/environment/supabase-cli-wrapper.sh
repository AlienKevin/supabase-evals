#!/usr/bin/env bash
set -e

real=/usr/local/bin/supabase-real

# Supabase starts Edge Runtime as a sibling container on the nested Docker
# daemon. Absolute bind mounts such as `/app/supabase/functions` are therefore
# resolved on that daemon's filesystem, not in this task container.
sync_workspace_to_docker_host() {
  /usr/local/bin/supabase-harbor-sync
}

# Compose launches the upstream prestarted stack asynchronously. Match the
# source harness's contract by blocking the first CLI command until startup is
# complete instead of racing a half-created database.
if [ "${SUPABASE_PRESTART:-0}" = "1" ] && [ "${1:-}" != "start" ]; then
  for _ in $(seq 1 600); do
    [ -f /tmp/supabase-ready ] && break
    [ -f /tmp/supabase-start.failed ] && { cat /tmp/supabase-start.log >&2; exit 1; }
    sleep 1
  done
  [ -f /tmp/supabase-ready ] || { cat /tmp/supabase-start.log >&2 2>/dev/null || true; exit 1; }
fi

# In Modal's nested-Docker runtime, the CLI's pg_prove helper cannot bind-mount
# files from the main container: `/app` belongs to that container, not the
# inner daemon host. Execute the same pgTAP SQL directly against the running
# local Postgres and emit pg_prove's summary shape for the unchanged scorer.
if [ "${1:-} ${2:-}" = "test db" ]; then
  db_url=postgresql://postgres:postgres@127.0.0.1:54322/postgres
  psql "$db_url" -v ON_ERROR_STOP=1 -qAtc 'create extension if not exists pgtap' >/dev/null
  files=0
  tests=0
  failed=0
  for test_file in /app/supabase/tests/*.sql; do
    [ -f "$test_file" ] || continue
    files=$((files + 1))
    if tap=$(psql "$db_url" -v ON_ERROR_STOP=1 -qAtf "$test_file" 2>&1); then
      printf '%s\n' "$tap"
    else
      printf '%s\n' "$tap" >&2
      exit 1
    fi
    file_tests=$(printf '%s\n' "$tap" | grep -Ec '^(ok|not ok)[[:space:]]+[0-9]+' || true)
    file_failed=$(printf '%s\n' "$tap" | grep -Ec '^not ok[[:space:]]+[0-9]+' || true)
    tests=$((tests + file_tests))
    failed=$((failed + file_failed))
  done
  printf 'Files=%s, Tests=%s, Failed: %s\n' "$files" "$tests" "$failed"
  [ "$files" -gt 0 ] && [ "$tests" -gt 0 ]
  exit
fi

# `supabase functions deploy` normally starts a sibling edge-runtime container
# to bundle `/app`. That sibling sees the inner daemon host's filesystem, not
# the main container workspace. Hosted evals use platform-lite, so preserve the
# CLI operation's management-API result while packaging the source directly.
if [ "${1:-} ${2:-}" = "functions deploy" ] && [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  slug=${3:-}
  source_path="/app/supabase/functions/$slug/index.ts"
  [ -n "$slug" ] && [ -f "$source_path" ] || { printf 'missing function source for %s\n' "$slug" >&2; exit 1; }
  metadata=$(mktemp)
  printf '{"name":"%s","entrypoint_path":"index.ts","verify_jwt":false}\n' "$slug" > "$metadata"
  curl --fail-with-body --silent --show-error \
    -X POST "$SUPABASE_PLATFORM_URL/v1/projects/${SUPABASE_PROJECT_REF:?}/functions/deploy?slug=$slug" \
    -H "authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-}" \
    -F "metadata=<$metadata;type=application/json" \
    -F "file=@$source_path;filename=index.ts;type=application/typescript" >/dev/null
  rm -f "$metadata"
  printf 'Deployed Function %s to project %s.\n' "$slug" "$SUPABASE_PROJECT_REF"
  exit 0
fi

# Mirror packages/sandbox's source-harness shim: an eval's `services` list is
# authoritative even when the agent starts or restarts the stack itself.
if [ "${1:-}" = "start" ]; then
  sync_workspace_to_docker_host
  if [ -n "${SUPABASE_EXCLUDED_SERVICES:-}" ]; then
    shift
    exec "$real" start "$@" -x "$SUPABASE_EXCLUDED_SERVICES"
  fi
  exec "$real" "$@"
fi

# Keep agent edits visible when it explicitly serves local functions after the
# stack has already started. This preserves the source harness's live bind-mount
# behavior in Harbor's nested-Docker execution model.
if [ "${1:-} ${2:-}" = "functions serve" ]; then
  sync_workspace_to_docker_host
fi

# Hosted-project CLI tasks are pre-linked to platform-lite. Keep common agent
# recovery commands on that private endpoint rather than public Supabase.
if [ "${1:-}" = "link" ] && [[ " $* " != *" --dns-resolver "* ]]; then
  shift
  exec "$real" link "$@" --dns-resolver native
fi

case "${1:-} ${2:-}" in
  "db push"|"db pull"|"db dump"|"migration repair"|"migration list")
    if [ -f /app/supabase/.temp/pooler-url ] &&
       [[ " $* " != *" --db-url "* ]] && [[ " $* " != *" --local "* ]]; then
      exec "$real" "$@" --db-url "$(cat /app/supabase/.temp/pooler-url)"
    fi
    ;;
esac

exec "$real" "$@"
