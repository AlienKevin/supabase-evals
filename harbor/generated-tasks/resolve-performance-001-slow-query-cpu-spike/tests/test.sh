#!/usr/bin/env bash
set -euo pipefail

if [ "${HARBOR_SOURCE_SCORER:-0}" = "1" ]; then
  /usr/local/bin/supabase-harbor-sync
  sleep 2
  exec node --import /opt/source-runtime/node_modules/tsx/dist/loader.mjs /opt/source-runtime/run-source-scorer.mjs
fi


api="${SUPABASE_PLATFORM_URL:?platform-lite sidecar is required}"
ref="${SUPABASE_PROJECT_REF:?project ref is required}"
logs_dir="${HARBOR_LOGS_DIR:-/logs}/verifier"
mkdir -p "$logs_dir"

query() {
  local sql="$1"
  local payload
  payload=$(node -e 'process.stdout.write(JSON.stringify({query: process.argv[1]}))' "$sql")
  curl --fail-with-body --silent --show-error \
    -X POST "$api/v1/projects/$ref/database/query" \
    -H 'content-type: application/json' \
    --data "$payload"
}

failed=0
indexes=$(query 'SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = '"'"'public'"'"' AND tablename = '"'"'events'"'"';')
  if printf '%s' "$indexes" | grep -Eiq 'user_id[^\n]*created_at|created_at[^\n]*user_id'; then
    printf 'PASS composite recent-events index (name-independent)\n'
  else
    printf 'FAIL composite recent-events index (user_id, created_at)\n'
  failed=1
fi

insert=$(query "INSERT INTO events (user_id, kind, payload) VALUES ('00000000-0000-0000-0000-000000000001', 'oracle_probe', '{\"ok\": true}'::jsonb) RETURNING id;")
if printf '%s' "$insert" | grep -Eq '"id"'; then
  printf 'PASS inserts remain functional\n'
else
  printf 'FAIL inserts remain functional\n'
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
