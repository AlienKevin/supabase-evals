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
  printf 'FAIL deploy-functions-001-edge-function-secrets: answer.md is missing\n'
  failed=1
else
if grep -Eiq 'weather' "$answer"; then
  printf 'PASS answer check 1\n'
else
  printf 'FAIL answer check 1: weather\n'
  failed=1
fi
if grep -Eiq 'WEATHER_API_KEY' "$answer"; then
  printf 'PASS answer check 2\n'
else
  printf 'FAIL answer check 2: WEATHER_API_KEY\n'
  failed=1
fi
if grep -Eiq 'secret' "$answer"; then
  printf 'PASS answer check 3\n'
else
  printf 'FAIL answer check 3: secret\n'
  failed=1
fi
fi
if [ -f "$workdir/supabase/functions/weather/index.ts" ]; then
  printf 'PASS file supabase/functions/weather/index.ts\n'
else
  printf 'FAIL missing file supabase/functions/weather/index.ts\n'
  failed=1
fi
if [ "${HARBOR_PARITY:-0}" = "1" ]; then
  printf 'INFO parity run: Oracle-only marker check disabled\n'
elif [ -f "$workdir/.oracle/deploy-functions-001-edge-function-secrets.complete" ]; then
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
