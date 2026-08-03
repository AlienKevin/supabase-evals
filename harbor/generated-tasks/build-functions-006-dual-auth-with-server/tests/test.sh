#!/usr/bin/env bash
set -u

if [ "${HARBOR_SOURCE_SCORER:-0}" = "1" ]; then
  /usr/local/bin/supabase-harbor-sync
  sleep 2
  exec node --import /opt/source-runtime/node_modules/tsx/dist/loader.mjs /opt/source-runtime/run-source-scorer.mjs
fi


workdir="${HARBOR_WORKDIR:-/app}"
logs_dir="${HARBOR_LOGS_DIR:-/logs}/verifier"
mkdir -p "$logs_dir"
failed=0
answer="$workdir/answer.md"
if [ ! -f "$answer" ]; then
  printf 'FAIL build-functions-006-dual-auth-with-server: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'user-stats' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: user-stats\n'
  failed=1
fi
if grep -Eiq 'supabase/server' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: supabase/server\n'
  failed=1
fi
if grep -Eiq 'RLS' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: RLS\n'
  failed=1
fi
fi
if [ -f "$workdir/supabase/functions/user-stats/index.ts" ]; then
  printf 'PASS file supabase/functions/user-stats/index.ts\n'
else
  printf 'FAIL missing file supabase/functions/user-stats/index.ts\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/build-functions-006-dual-auth-with-server.complete" ]; then
  printf 'PASS source-derived Oracle marker\n'
else
  printf 'FAIL source-derived Oracle marker\n'
  failed=1
fi
if [ "$failed" -eq 0 ]; then
  printf '1\n' > "$logs_dir/reward.txt"
else
  printf '0\n' > "$logs_dir/reward.txt"
fi
